import { eq, getTableColumns } from 'drizzle-orm'
import { llmRescoreDays } from './config/env'
import { db } from './db/index'
import { jobScores, jobs, searchProfiles } from './db/schema'
import { getProvider } from './llm/index'
import { compare, compareCompany, contentHash } from './normalize'
import { scoreKeywords } from './score/keyword'
import { buildScoreRow, judge, priorKey, priorLlm, tooOldToJudge } from './score/row'
import type { ScoringProvider } from './llm/index'
import type { NormalizedJob, ProgressFn, RescoreInput, RescoreResult } from './types'

/**
 * Rescore every stored job for one profile: no sources, no fetching — the only way a job gets a
 * score without being fetched. Covers what a run cannot: the postings already in the table.
 *
 * Keyword scoring is the whole of it unless `useLlm` is set. The LLM half has an age cap, because
 * it spends, and only ever judges what carries no verdict: nothing invalidates a stored verdict —
 * not a CV edit, not a keyword edit, not a prompt bump. Re-judging is the deep pass's job alone.
 *
 * This is also both tiers of the cascade, which is why there is no second function: `input.band`
 * swaps one clause of the candidate filter and nothing else. Absent it is tier 1 — judge everything
 * eligible that is unjudged, normally with the fast model. Present it is tier 2 — re-judge only the
 * rows whose fast verdict landed in that band, under a (model, thinking) configuration that did not
 * produce it.
 */
export async function rescoreProfile(
  profileId: number,
  input: RescoreInput = { useLlm: false },
  provider: ScoringProvider | null = getProvider(input.think, input.model),
  // Same optional seam as runPipeline's; there is no `source` phase because nothing is fetched.
  onProgress?: ProgressFn,
  // Cooperative stop: the loop breaks, so every verdict paid for is still written.
  signal?: AbortSignal,
): Promise<RescoreResult> {
  const profile = db.select().from(searchProfiles).where(eq(searchProfiles.id, profileId)).get()
  if (!profile) throw new Error(`No profile ${profileId}`)

  // Duplicates included — the pipeline scores those too, because the detail page opens on a
  // flagged duplicate. Every column, so an entry below is a NormalizedJob and the LLM prompt needs
  // no shape of its own.
  const rows = db.select(getTableColumns(jobs)).from(jobs).all()

  const prior = priorLlm(profileId)
  const scoredAt = new Date()
  const errors: RescoreResult['errors'] = []

  // Comparison forms rebuilt from the stored columns rather than stored as columns of their own —
  // jobs.description is already htmlToText-ed by normalize, so this is what scripts/seed.ts does
  // for its hash. A recomputed hash that differs from the stored one means the row predates a
  // normalize change: the posting's text did not move, only the function deriving the hash did.
  const work = rows.map(j => {
    const norm = {
      normTitle: compare(j.title) ?? '',
      normCompany: compareCompany(j.company),
      normLocation: compare(j.location),
      normDescription: compare(j.description),
    }
    const hash = contentHash([norm.normTitle, norm.normCompany, norm.normLocation, norm.normDescription])
    return {
      hash,
      storedHash: j.contentHash,
      keyword: scoreKeywords(profile, norm),
      // Keyed on the stored hash: `prior` was loaded before the repair below.
      llm: prior.get(priorKey(profileId, j.contentHash)),
      job: { ...j, ...norm, contentHash: hash } satisfies NormalizedJob,
    }
  })

  let judged: Awaited<ReturnType<typeof judge>> | undefined
  // Before the transaction, because better-sqlite3 transactions are synchronous and cannot await —
  // the same constraint that shapes the pipeline.
  if (provider && input.useLlm) {
    const cutoff = new Date(scoredAt.getTime() - llmRescoreDays * 86_400_000)
    const claimed = new Set<string>()
    const candidates = work
      .filter(w => {
        // A row whose detail fetch failed has no description; a call could only judge its title.
        if (!w.job.description) return false
        // Two age caps, two questions: lastSeenAt says the board stopped listing it, postedAt says
        // the posting was stale even while listed. Both tiers pay them.
        if (w.job.lastSeenAt < cutoff) return false
        if (tooOldToJudge(w.job.postedAt, scoredAt)) return false
        if (input.band) {
          // Tier 2: in band, judged under a different (model, think); null think = off.
          if (w.llm?.llmScore == null) return false
          if (w.llm.llmScore < input.band[0] || w.llm.llmScore > input.band[1]) return false
          if (w.llm.llmModel === provider.model && (w.llm.llmThink ?? 'off') === provider.think) return false
        } else {
          // Tier 1: never judged, full stop. Not a profile edit, not the prompt version, not the
          // model — nothing invalidates a verdict, so nothing can put the whole eligible table one
          // click away from a re-spend. A repeat pass is free, exactly like a repeat deep pass.
          if (w.llm?.llmScore != null) return false
        }
        // One call per posting: duplicates across sources are separate rows with the same hash.
        if (claimed.has(w.hash)) return false
        claimed.add(w.hash)
        return true
      })
      // Strongest first. Not a gate: it only decides which candidates survive a biting LLM_MAX_JOBS.
      .sort((a, b) => b.keyword.score - a.keyword.score)

    judged = await judge(
      candidates.map(w => w.job),
      profile,
      provider,
      scoredAt,
      errors,
      onProgress,
      signal,
    )
    // Fanned out over the twins the `claimed` set skipped, which are their own rows.
    for (const w of work) w.llm = judged.fresh.get(w.hash) ?? w.llm
  }

  onProgress?.({ phase: 'write' })
  return db.transaction(tx => {
    let repaired = 0
    for (const w of work) {
      // The recomputed hash is the truthful one today, so the stored one is brought up to it
      // rather than the row being skipped — a skipped row can never be scored for a new profile.
      // Every profile's score rows are re-keyed, LLM columns untouched: the content is unchanged,
      // so the verdicts still hold.
      if (w.hash !== w.storedHash) {
        tx.update(jobs).set({ contentHash: w.hash }).where(eq(jobs.id, w.job.id)).run()
        tx.update(jobScores).set({ contentHash: w.hash }).where(eq(jobScores.jobId, w.job.id)).run()
        repaired++
      }
      const row = buildScoreRow(w.hash, w.keyword, w.llm, scoredAt)
      tx.insert(jobScores)
        .values({ jobId: w.job.id, profileId, ...row })
        .onConflictDoUpdate({ target: [jobScores.jobId, jobScores.profileId], set: row })
        .run()
    }
    return {
      scored: work.length,
      repaired,
      llmScored: judged?.fresh.size ?? 0,
      strong: judged?.strong ?? 0,
      stopped: judged?.stopped,
      errors,
    }
  })
}
