import { and, desc, eq, gte, isNotNull, isNull, like, or, sql } from 'drizzle-orm'
import { llmMaxPostedDays, llmRescoreDays } from './config/env'
import { db } from './db/index'
import { jobScores, jobs } from './db/schema'
import type { JobListQuery } from './types'

// ponytail: `count(*) over ()` instead of a second COUNT query — one scan, one round trip.
// Ceiling: an offset past the end returns zero rows, so `total` reads 0 even though rows
// exist; the UI derives its page count from `total`, so it cannot generate that request.
// Upgrade path: a second `db.select({ n: count() })` sharing the same where-clause.
export function listJobs(f: JobListQuery) {
  // The duplicate group's origin: the row itself when it is not a duplicate. Chain depth is 1 by
  // construction (resolveDuplicates points every member at the group min), so this is the whole
  // group and no recursion is needed.
  const origin = sql`coalesce(${jobs.duplicateOf}, ${jobs.id})`

  // ponytail: confidence read out of the llm_detail JSON rather than its own column — no migration,
  // no backfill, and LlmColumns' carry-forward stays untouched. Ceiling: unindexed, so it cannot
  // drive the scan; it rides the profile-scoped job_scores scan the join already needs, the same
  // ceiling location and firstSeenAfter accept. Upgrade path: promote it to an llm_confidence
  // column beside llmScore, the shape that column already has. NULL for a keyword-only row.
  const confidence = sql`json_extract(${jobScores.llmDetail}, '$.confidence')`

  const rows = db
    .select({
      // ponytail: no `description` here — one seeded job is 6000 chars, times a 50-row page.
      // Ceiling: the list cannot render a snippet. Upgrade path: add a substr() column.
      id: jobs.id,
      source: jobs.source,
      sourceJobId: jobs.sourceJobId,
      url: jobs.url,
      canonicalUrl: jobs.canonicalUrl,
      title: jobs.title,
      company: jobs.company,
      location: jobs.location,
      workMode: jobs.workMode,
      postedAt: jobs.postedAt,
      firstSeenAt: jobs.firstSeenAt,
      lastSeenAt: jobs.lastSeenAt,
      duplicateOf: jobs.duplicateOf,
      // Every board this posting was found on, not just the surviving row's. A duplicate is hidden
      // by default, so without this the other boards carrying the same job are invisible — and that
      // is information no click can recover.
      // ponytail: a correlated subquery per row, two index seeks (jobs PK and duplicate_of) on a
      // page of 50. Ceiling: it runs for every row, duplicate group or not. Upgrade path: a second
      // query over the page's origins, keyed into a Map — only worth it if a page ever gets slow.
      sources:
        sql<string>`(select group_concat(distinct d.source) from ${jobs} d where d.id = ${origin} or d.duplicate_of = ${origin})`.as(
          'sources',
        ),
      score: jobScores,
      total: sql<number>`count(*) over ()`.as('total'),
    })
    .from(jobs)
    // profileId sits in the ON clause so SQLite can drive off job_scores_profile_final_score_idx.
    .innerJoin(jobScores, and(eq(jobScores.jobId, jobs.id), eq(jobScores.profileId, f.profileId)))
    .where(
      and(
        // `=== undefined`, not falsy: minScore=0 is a real filter.
        f.minScore === undefined ? undefined : gte(jobScores.finalScore, f.minScore),
        f.source ? eq(jobs.source, f.source) : undefined,
        // ponytail: LIKE is case-insensitive for ASCII only — 'ZÜRICH' will not match 'Zürich'.
        // Ceiling: a non-ASCII filter silently returns nothing. Upgrade path: SQLite built with ICU.
        f.location ? like(jobs.location, `%${f.location}%`) : undefined,
        f.company ? like(jobs.company, `%${f.company}%`) : undefined,
        f.postedAfter ? gte(jobs.postedAt, f.postedAfter) : undefined,
        // firstSeenAt is notNull, so unlike postedAfter this cannot hide a row for lacking a date —
        // which is the whole reason it exists, since most postings never state one.
        // ponytail: no index on first_seen_at. Ceiling: the filter rides the profile-scoped
        // job_scores scan the join already needs, at four figures of rows. Upgrade path: add one.
        f.firstSeenAfter ? gte(jobs.firstSeenAt, f.firstSeenAfter) : undefined,
        // A workMode filter excludes null rows: "did not say" is not a claim of anything.
        f.workMode ? eq(jobs.workMode, f.workMode) : undefined,
        // llmScore is the verdict's own column, not llmScoredAt: the carry-forward writes both, and
        // a keyword-only row has neither.
        f.scored === 'llm'
          ? isNotNull(jobScores.llmScore)
          : f.scored === 'keyword'
            ? isNull(jobScores.llmScore)
            : undefined,
        // `=== undefined`, not falsy: maxConfidence=0 is a real filter, same trap as minScore.
        // NULL <= x is NULL, so a keyword-only row drops out on its own — no verdict, no hedge.
        f.maxConfidence === undefined ? undefined : sql`${confidence} <= ${f.maxConfidence}`,
        f.includeDuplicates ? undefined : isNull(jobs.duplicateOf),
        f.q ? or(like(jobs.title, `%${f.q}%`), like(jobs.company, `%${f.q}%`)) : undefined,
      ),
    )
    // jobs.id breaks ties so paging cannot repeat or skip a row. DESC puts null postedAt last,
    // which is where "date unknown" belongs — and does the same for a keyword-only row's absent
    // confidence, so a confidence sort sinks the unjudged rows instead of hiding them.
    // The default sorts the verdict first and the keyword score only as a tiebreak among the
    // unjudged, so the top of the list is always what the model has actually read. `score` is the
    // single-key `finalScore` ordering, still selectable.
    .orderBy(
      ...(f.sort === 'posted'
        ? [desc(jobs.postedAt)]
        : f.sort === 'confidence'
          ? [desc(confidence)]
          : f.sort === 'score'
            ? [desc(jobScores.finalScore)]
            : [desc(jobScores.llmScore), desc(jobScores.keywordScore)]),
      desc(jobs.id),
    )
    .limit(f.limit)
    .offset(f.offset)
    .all()

  // group_concat gives no ordering guarantee, so sort here: the UI renders the list in a title
  // attribute and an unstable order would reshuffle between identical requests.
  const items = rows.map(({ total, sources, ...row }) => ({ ...row, sources: sources.split(',').sort() }))
  return { items, total: rows[0]?.total ?? 0 }
}

/**
 * What the source filter may offer: the sources actually present in `jobs`, not the enabled
 * registry. A source disabled after its rows were stored must stay filterable, and one enabled
 * before its first run must not offer an option that selects nothing. Rides jobs_source_source_job_id_unique.
 */
export function listSources() {
  return db
    .selectDistinct({ source: jobs.source })
    .from(jobs)
    .orderBy(jobs.source)
    .all()
    .map(r => r.source)
}

/** null when no such job. `score` is null without a profileId — the detail page must handle it. */
export function getJob(id: number, profileId?: number) {
  const job = db.select().from(jobs).where(eq(jobs.id, id)).get()
  if (!job) return null
  const score = profileId
    ? db
        .select()
        .from(jobScores)
        .where(and(eq(jobScores.jobId, id), eq(jobScores.profileId, profileId)))
        .get()
    : undefined
  const duplicate = job.duplicateOf
    ? db
        .select({ id: jobs.id, source: jobs.source, url: jobs.url, title: jobs.title })
        .from(jobs)
        .where(eq(jobs.id, job.duplicateOf))
        .get()
    : undefined
  return { ...job, score: score ?? null, duplicate: duplicate ?? null }
}

/**
 * The standing fact the dashboard could not state before a button was pressed: how much of the
 * stored table the model has read for this profile, and how much of the rest it could still read.
 *
 * Counted per `contentHash`, not per row — the unit a call is made in, and the same unit
 * `RescoreResult`'s `eligible` and `band` counts use, so the sentence before a pass and the
 * sentence after it are in the same currency. Twins across two boards are one judgement.
 *
 * `ready` mirrors tier 1's candidate filter in SQL: a description to judge, still listed within
 * `LLM_RESCORE_DAYS`, posted within `LLM_MAX_POSTED_DAYS` (a null `postedAt` passes — normalize
 * never guesses a date, so an absent one is not a claim of staleness), and no verdict yet for this
 * profile under that hash.
 *
 * One scan of `jobs` with a distinct-hash subquery of this profile's verdicts, rather than three
 * counts: at rest this runs on every dashboard load, and it must not become a reason not to state
 * the fact. It reads the *stored* hash, exactly as `priorLlm` does — a row whose hash a normalize
 * change has moved is counted as unjudged here and repaired by the pass that judges it, which is
 * the same order of events `rescoreProfile` already documents.
 */
export function scoringDebt(
  profileId: number,
  /**
   * The deep pass's own selection, which unlike tier 1's is not a property of the database alone:
   * it depends on the configuration and the score range the user currently has set, so the caller
   * passes them and the answer changes as those controls move. Absent — no provider, no models —
   * the deep half is simply not counted.
   */
  deep?: { model: string; think: string; min: number; max: number },
) {
  const day = 86_400_000
  const seenCutoff = Date.now() - llmRescoreDays * day
  const postedCutoff = Date.now() - llmMaxPostedDays * day
  // The age gates both tiers pay, written once so the two `ready` counts cannot drift from each
  // other or from `rescoreProfile`'s own filter.
  const fresh = sql`${jobs.description} is not null
    and ${jobs.lastSeenAt} >= ${seenCutoff}
    and (${jobs.postedAt} is null or ${jobs.postedAt} >= ${postedCutoff})`
  /**
   * Tier 2's two counts, mirroring `rescoreProfile`'s band clause in SQL exactly as `ready` mirrors
   * tier 1's: a verdict inside the range, produced under a configuration that is *not* the one
   * selected now. `is not` rather than `<>` because it is SQLite's null-safe comparison, and
   * `llmModel` is null on rows written before the column — those must count as "some other
   * configuration", not vanish into a null.
   */
  const deepCols = deep
    ? sql`,
      count(distinct case when v.model is ${deep.model} and v.think is ${deep.think}
        then ${jobs.contentHash} end) as deepJudged,
      count(distinct case when v.score is not null
        and v.score >= ${deep.min} and v.score <= ${deep.max}
        and (v.model is not ${deep.model} or v.think is not ${deep.think})
        and ${fresh}
        then ${jobs.contentHash} end) as deepReady`
    : sql``
  // Aggregates without `group by`: always exactly one row, and count() is never null.
  const { deepJudged, deepReady, ...counts } = db.get<{
    stored: number
    judged: number
    ready: number
    deepJudged?: number
    deepReady?: number
  }>(sql`
    select
      count(distinct ${jobs.contentHash}) as stored,
      count(distinct case when v.hash is not null then ${jobs.contentHash} end) as judged,
      count(distinct case when v.hash is null and ${fresh} then ${jobs.contentHash} end) as ready${deepCols}
    from ${jobs}
    left join (
      select ${jobScores.contentHash} as hash,
        max(${jobScores.llmScore}) as score,
        max(${jobScores.llmModel}) as model,
        max(coalesce(${jobScores.llmThink}, 'off')) as think
      from ${jobScores}
      where ${jobScores.profileId} = ${profileId} and ${jobScores.llmScore} is not null
      group by ${jobScores.contentHash}
    ) v on v.hash = ${jobs.contentHash}`)!
  // Only when asked for, so a caller with no deep configuration gets no half-answer about one.
  return { ...counts, deep: deep && { judged: deepJudged!, ready: deepReady! } }
}
