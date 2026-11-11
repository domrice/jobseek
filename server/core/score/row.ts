import { and, eq, isNotNull } from 'drizzle-orm'
import { llmMaxJobs, llmMaxPostedDays } from '../config/env'
import { scoreBands } from '../config/rubric'
import { db } from '../db/index'
import { jobScores } from '../db/schema'
import { PROMPT_VERSION } from '../llm/index'
import type { ScoringProvider } from '../llm/index'
import type { KeywordScore, NormalizedJob, ProgressFn, SearchProfile } from '../types'

/**
 * The columns of an LLM verdict, named once: the write type, the carry-forward select and the null
 * reset in buildScoreRow all derive from this list, so they cannot drift. `llmScoredAt` is carried
 * like the rest, so a keyword rescore cannot make a fresh verdict look stale. `explanation` is the
 * model's only on a row with an llmScore — the only rows `priorLlm` selects.
 */
const llmKeys = [
  'llmScore',
  'llmRecommendation',
  'llmDetail',
  'llmModel',
  'llmThink',
  'llmPromptVersion',
  'llmScoredAt',
  'explanation',
] as const
type LlmKey = (typeof llmKeys)[number]

/** The write shape of an LLM verdict, derived from the table. */
export type LlmColumns = Pick<typeof jobScores.$inferInsert, LlmKey>

/** Map key: a verdict belongs to one (profile, posting) pair, never to a hash alone. */
export const priorKey = (profileId: number, contentHash: string) => `${profileId}\n${contentHash}`

/**
 * Every (profile, hash) that has *already paid an LLM*, with its columns. Two jobs:
 *
 * - it is the pipeline's skip gate. Narrower than "any existing score row": a --no-llm run writes a
 *   keyword row with the same hash, and that must not block scoring the job later.
 * - a skipped pair carries its old columns into the write, so the rewrite in buildScoreRow cannot
 *   null out a verdict that is still valid. Unchanged hash, unchanged verdict — including its
 *   original llmModel, which may not be the model configured today.
 *
 * Keyed on profileId too, not the hash alone: a run now writes rows for *every* profile, and
 * without each profile's own carry-forward it would erase verdicts other profiles paid for.
 * `profileId` omitted loads all of them in one query.
 */
export function priorLlm(profileId?: number): Map<string, LlmColumns> {
  return new Map(
    db
      .select({
        profileId: jobScores.profileId,
        contentHash: jobScores.contentHash,
        ...(Object.fromEntries(llmKeys.map(k => [k, jobScores[k]])) as Pick<typeof jobScores, LlmKey>),
      })
      .from(jobScores)
      .where(
        and(isNotNull(jobScores.llmScore), profileId === undefined ? undefined : eq(jobScores.profileId, profileId)),
      )
      .all()
      .map(({ profileId: p, contentHash, ...cols }) => [priorKey(p, contentHash), cols as LlmColumns] as const),
  )
}

/**
 * Too old for an LLM verdict to be worth paying for — the run's gate and the rescore's, one
 * definition. `null` passes: a source that gave no date has not said the posting is stale, and
 * guessing one is exactly what normalize refuses to do. The complement of the rescore's
 * lastSeenAt cap, which answers "still listed" where this answers "still plausibly open".
 */
export const tooOldToJudge = (postedAt: Date | null, now: Date) =>
  postedAt != null && postedAt.getTime() < now.getTime() - llmMaxPostedDays * 86_400_000

/**
 * Judge `candidates` (one per contentHash, strongest first) and return the verdicts keyed by hash,
 * for the caller to fan out over every row sharing one. The run's loop and the rescore's, one
 * definition.
 *
 * Sequential: a local model serialises on one GPU anyway, and a remote provider gets rate-limited. A
 * failure costs one job's verdict, never the pass. A biting LLM_MAX_JOBS is reported in `errors`.
 *
 * Emit first, then test the stop — the order is what makes the client's own count exact. The event
 * carries `done: i`, meaning *i postings complete*, and breaking here leaves exactly `i` verdicts.
 * Testing before the emit would leave the last announced figure one short of what was kept. The
 * loop `break`s rather than throws, so every verdict bought before a stop is still written.
 */
export async function judge(
  candidates: NormalizedJob[],
  profile: SearchProfile,
  provider: ScoringProvider,
  at: Date,
  errors: { source: string; message: string }[],
  onProgress?: ProgressFn,
  signal?: AbortSignal,
) {
  if (candidates.length > llmMaxJobs) {
    errors.push({
      source: 'llm',
      message: `capped at ${llmMaxJobs} candidates, ${candidates.length - llmMaxJobs} skipped (LLM_MAX_JOBS)`,
    })
  }
  const fresh = new Map<string, LlmColumns>()
  let strong = 0
  let stopped: true | undefined
  const queue = candidates.slice(0, llmMaxJobs)
  for (const [i, job] of queue.entries()) {
    onProgress?.({ phase: 'llm', done: i, total: queue.length, strong })
    if (signal?.aborted) {
      stopped = true
      break
    }
    try {
      const llm = await provider.scoreJob({ profile, job })
      fresh.set(job.contentHash, {
        llmScore: llm.score,
        llmRecommendation: llm.recommendation,
        llmDetail: { strengths: llm.strengths, gaps: llm.gaps, concerns: llm.concerns, confidence: llm.confidence },
        llmModel: provider.model,
        llmThink: provider.think,
        llmPromptVersion: PROMPT_VERSION,
        llmScoredAt: at,
        explanation: llm.explanation,
      })
      if (llm.score >= scoreBands.strong) strong++
    } catch (err) {
      errors.push({ source: 'llm', message: `${job.canonicalUrl}: ${(err as Error).message}` })
    }
  }
  return { fresh, strong, stopped }
}

/**
 * What a score row means, in one place — the pipeline and rescoreProfile both write this shape,
 * including the carry-forward rule, so the two cannot drift.
 */
export function buildScoreRow(contentHash: string, keyword: KeywordScore, llm: LlmColumns | undefined, scoredAt: Date) {
  return {
    contentHash,
    keywordScore: keyword.score,
    // ponytail: the column is flatter than KeywordScore — required and preferred collapse
    // into `matched`, which is all the UI shows. Ceiling: the split is not persisted.
    // Upgrade path: widen the column.
    keywordDetail: {
      matched: [...keyword.matchedRequired, ...keyword.matchedPreferred],
      missing: keyword.missingRequired,
      excluded: keyword.matchedExcluded,
    },
    // Every llm column is written every time, null included — either this run's verdict or the
    // one already attached to this (profile, contentHash). Omitting them from the conflict `set`
    // would leave a stale verdict beside a freshly overwritten keyword finalScore once an edited
    // posting rehashes.
    ...(Object.fromEntries(llmKeys.map(k => [k, null])) as Record<LlmKey, null>),
    explanation: keyword.explanation,
    ...llm,
    finalScore: llm?.llmScore ?? keyword.score,
    scoredAt,
  }
}
