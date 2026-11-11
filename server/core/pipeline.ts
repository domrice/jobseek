import { setTimeout as sleep } from 'node:timers/promises'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { db } from './db/index'
import { jobs, jobScores, pipelineRuns, searchProfiles } from './db/schema'
import { resolveDuplicates, upsertJob } from './dedupe'
import { getProvider } from './llm/index'
import { normalize } from './normalize'
import { scoreKeywords } from './score/keyword'
import { buildScoreRow, judge, priorKey, priorLlm, tooOldToJudge } from './score/row'
import { registry } from './sources/registry'
import type { ScoringProvider } from './llm/index'
import type { JobSource, PipelineResult, PipelineRunInput, ProgressFn, RawJob } from './types'

/**
 * The one pipeline. Imports nothing from Nitro or h3, so the API route and the CLI are both thin
 * wrappers over this.
 *
 * `sources` defaults to the registry and `provider` to whatever `.env` configures; tests pass
 * fakes for both. Those parameter types are the real contracts, so there is no test-only
 * abstraction to unwind later.
 */
export async function runPipeline(
  input: PipelineRunInput,
  sources: JobSource[] = registry,
  // Reads an earlier parameter, so a run bar's thinking choice reaches the provider without the
  // route having to construct one.
  provider: ScoringProvider | null = getProvider(input.think, input.model),
  // Optional and side-effect-only: absent, the run behaves exactly as it did.
  onProgress?: ProgressFn,
  /**
   * Stop, and keep what has already been paid for — the same optional seam as `onProgress`, and
   * the same cooperative shape `rescoreProfile` uses. Both loops `break` rather than throw, which
   * falls through to the write, so the boards already read and the verdicts already bought are
   * stored and reported instead of being thrown away at the last step.
   */
  signal?: AbortSignal,
): Promise<PipelineResult> {
  // All of them, one query: every fetched job is keyword-scored for every profile, because
  // listJobs inner-joins job_scores — a job with no row for a profile is invisible to it, so a
  // posting fetched under one profile would otherwise be lost to the others.
  const profiles = db.select().from(searchProfiles).all()
  const profile = profiles.find(p => p.id === input.profileId)
  // ponytail: a plain Error, which the route surfaces as a 500 rather than a 404. Ceiling: an
  // unhelpful status for a nonexistent profile. Upgrade path: none — the UI only ever posts an
  // id it just listed.
  if (!profile) throw new Error(`No profile ${input.profileId}`)

  // The run row goes in first, finishedAt null: a run that dies mid-flight still leaves a trace,
  // and the UI already renders that state.
  const startedAt = new Date()
  const { id: runId } = db
    .insert(pipelineRuns)
    .values({ profileId: profile.id, startedAt })
    .returning({ id: pipelineRuns.id })
    .get()

  const enabled = sources.filter(s => s.enabled && (!input.sources || input.sources.includes(s.name)))
  const errors: { source: string; message: string }[] = []
  const raw: RawJob[] = []
  const touched: { source: string; ids: string[] }[] = []
  // Boards actually queried, pushed as the loop reaches each one, rather than `enabled` read off
  // at the end. A stopped run has not searched the boards it never got to, and the run row is the
  // permanent record of what happened.
  const sourcesQueried: string[] = []
  let stopped: true | undefined

  // Sequential on purpose: nine sources fetching in parallel is how an IP gets blocked.
  for (const [i, source] of enabled.entries()) {
    if (signal?.aborted) {
      stopped = true
      break
    }
    sourcesQueried.push(source.name)
    onProgress?.({ phase: 'source', name: source.name, index: i + 1, total: enabled.length })
    try {
      // One query per source per run, not per card, on the source index. `isNotNull(description)`
      // so a row whose detail fetch failed on an earlier run is retried rather than skipped forever.
      const stored = new Set(
        db
          .select({ id: jobs.sourceJobId })
          .from(jobs)
          .where(and(eq(jobs.source, source.name), isNotNull(jobs.description)))
          .all()
          .map(r => r.id),
      )
      const res = await source.search({ query: profile.query, location: profile.location ?? undefined }, id =>
        stored.has(id),
      )
      raw.push(...res.jobs)
      if (res.touched.length) touched.push({ source: source.name, ids: res.touched })
    } catch (err) {
      errors.push({ source: source.name, message: (err as Error).message })
    }
    if (i < enabled.length - 1) await sleep(source.rateLimitMs)
  }

  // Normalize and score before the write, because better-sqlite3 transactions are synchronous
  // and their callback cannot await. This is what enforces "score before insert" — and it is
  // where the Phase 9 LLM call has to sit, too.
  const prior = priorLlm()
  const scored = raw.map(r => {
    const job = normalize(r)
    return {
      job,
      keyword: scoreKeywords(profile, job),
      llm: prior.get(priorKey(profile.id, job.contentHash)),
      // Every other profile's keyword score and carried-forward verdict. Pure regex, no I/O — free.
      others: profiles
        .filter(p => p.id !== profile.id)
        .map(p => ({
          profileId: p.id,
          keyword: scoreKeywords(p, job),
          llm: prior.get(priorKey(p.id, job.contentHash)),
        })),
    }
  })

  let llmScored = 0
  if (provider && input.useLlm) {
    const claimed = new Set<string>()
    const candidates = scored
      .filter(s => {
        // A posting whose detail fetch failed carries no description; the prompt has a placeholder
        // for it, but the call could only judge a title. Cheap to skip, guaranteed waste to send.
        if (!s.job.description) return false
        // tooOldToJudge, not just "we fetched it": a board still lists postings it dated years ago.
        if (s.llm || tooOldToJudge(s.job.postedAt, startedAt)) return false
        // Dedupes within the batch too: two sources carrying the same posting hash identically.
        if (claimed.has(s.job.contentHash)) return false
        claimed.add(s.job.contentHash)
        return true
      })
      // Strongest first, like the rescore. Not a gate: it only decides which candidates survive a
      // biting LLM_MAX_JOBS.
      .sort((a, b) => b.keyword.score - a.keyword.score)
    const judged = await judge(
      candidates.map(c => c.job),
      profile,
      provider,
      startedAt,
      errors,
      onProgress,
      signal,
    )
    stopped ??= judged.stopped
    llmScored = judged.fresh.size
    // Fanned out over the twins from other sources, which are separate job rows and would otherwise
    // be written verdict-less and only pick it up on the next run.
    for (const s of scored) s.llm ??= judged.fresh.get(s.job.contentHash)
  }

  onProgress?.({ phase: 'write' })
  const written = db.transaction(tx => {
    let inserted = 0
    let updated = 0

    for (const { job, keyword, llm, others } of scored) {
      const res = upsertJob(tx, job, startedAt)
      if (res.action === 'inserted') inserted++
      else updated++
      // Keyed `collision`, not by the board. `errors[].source` is what failed, and the UI now acts
      // on that: a board name means that board's search failed and can be re-run on its own, `llm`
      // means the scoring step, and this is a dedupe mismatch that re-running would reproduce
      // exactly. The message already opens with `source:sourceJobId`, so the board is not lost.
      if (res.collision) errors.push({ source: 'collision', message: res.collision })

      // Every job gets a score row for every profile, duplicates included — the detail page opens
      // on a flagged duplicate too. The run's profile carries this run's verdict, every other
      // profile only its own carried-forward columns.
      for (const o of [{ profileId: profile.id, keyword, llm }, ...others]) {
        const row = buildScoreRow(job.contentHash, o.keyword, o.llm, startedAt)
        tx.insert(jobScores)
          .values({ jobId: res.id, profileId: o.profileId, ...row })
          // Single target, and it is the primary key — none of the ambiguity `jobs` has.
          .onConflictDoUpdate({ target: [jobScores.jobId, jobScores.profileId], set: row })
          .run()
      }
    }

    // A card the DB already had: the posting is still listed, so its clock moves and nothing else
    // does. Deliberately not dedupe.ts's `mutable()` — that is the "we re-fetched it" set, this is
    // the "we only re-saw it" set. Writing a description or contentHash here is the exact bug this
    // path exists to avoid. `updated_at` is bumped too, by $onUpdateFn; nothing reads it.
    // ponytail: one statement per source, `inArray` binding one parameter per id. Ceiling:
    // SQLITE_MAX_VARIABLE_NUMBER (32766), ~60× the deepest page walk. Upgrade path: chunk the ids.
    let touchedRows = 0
    for (const t of touched) {
      touchedRows += tx
        .update(jobs)
        .set({ lastSeenAt: startedAt })
        .where(and(eq(jobs.source, t.source), inArray(jobs.sourceJobId, t.ids)))
        .run().changes
    }

    const duplicates = resolveDuplicates(
      tx,
      scored.map(s => s.job.contentHash),
    )
    // `touched` reports rows actually changed, not ids offered, so an adapter naming an id the DB
    // does not hold shows up as a shortfall instead of a lie.
    return { fetched: scored.length, inserted, updated, touched: touchedRows, duplicates }
  })

  const finishedAt = new Date()
  // Same keys the seed writes, so /api/runs and the UI need no change.
  const summary = { sourcesQueried, ...written, llmScored }
  db.update(pipelineRuns).set({ finishedAt, summary, errors }).where(eq(pipelineRuns.id, runId)).run()

  return { runId, profileId: profile.id, startedAt, finishedAt, sourcesQueried, ...written, llmScored, stopped, errors }
}
