import { and, count, eq, inArray, isNotNull, or, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { jobs } from './db/schema'
import type * as schema from './db/schema'
import type { NormalizedJob } from './types'

/**
 * The handle drizzle hands to `db.transaction()`. Both functions here take it rather than the
 * db singleton, which is what lets the tests run against an in-memory database.
 */
export type Writer = Parameters<Parameters<BetterSQLite3Database<typeof schema>['transaction']>[0]>[0]

interface UpsertResult {
  id: number
  action: 'inserted' | 'updated'
  /** Set only when the two UNIQUE keys disagree; the pipeline records it in pipeline_runs.errors. */
  collision?: string
}

/** Everything a re-seen posting may have changed. Never `firstSeenAt`, `createdAt`, `duplicateOf`. */
const mutable = (job: NormalizedJob, seenAt: Date) => ({
  url: job.url,
  title: job.title,
  company: job.company,
  location: job.location,
  description: job.description,
  postedAt: job.postedAt,
  workMode: job.workMode,
  contentHash: job.contentHash,
  lastSeenAt: seenAt,
})

/**
 * One read, then exactly one write.
 *
 * `jobs` has UNIQUE(source, sourceJobId) *and* UNIQUE(canonicalUrl), and SQLite's ON CONFLICT
 * takes a single target — so no single upsert statement can express this. The lookup below
 * returns 0, 1 or 2 rows, and that is the whole decision table.
 *
 * Because the read happens inside the caller's transaction, a job written earlier in the same
 * run is visible here: two sources returning the same canonicalUrl in one batch land in case 3,
 * not in a constraint error.
 */
export function upsertJob(tx: Writer, job: NormalizedJob, seenAt: Date): UpsertResult {
  const found = tx
    .select({
      id: jobs.id,
      source: jobs.source,
      sourceJobId: jobs.sourceJobId,
      canonicalUrl: jobs.canonicalUrl,
    })
    .from(jobs)
    .where(
      or(
        and(eq(jobs.source, job.source), eq(jobs.sourceJobId, job.sourceJobId)),
        eq(jobs.canonicalUrl, job.canonicalUrl),
      ),
    )
    .all()

  const byKey = found.find(r => r.source === job.source && r.sourceJobId === job.sourceJobId)
  const byUrl = found.find(r => r.canonicalUrl === job.canonicalUrl)

  // 1. Neither key is taken.
  if (!byKey && !byUrl) {
    const row = tx
      .insert(jobs)
      // Listed column by column: NormalizedJob also carries the norm* comparison forms, which
      // are not columns.
      .values({
        source: job.source,
        sourceJobId: job.sourceJobId,
        canonicalUrl: job.canonicalUrl,
        firstSeenAt: seenAt,
        ...mutable(job, seenAt),
      })
      .returning({ id: jobs.id })
      .get()
    return { id: row.id, action: 'inserted' }
  }

  // 2 & 4. The identity key resolves it; the URL is either free or already on this row.
  // 5. Both, different rows (`clash`): one owns the identity key, the other owns the URL. Keep the
  //    identity-key row (a source's own job id is more stable than a URL it can reshuffle) and
  //    leave its canonicalUrl alone — writing the new one would violate the URL UNIQUE.
  //    If the two rows' content agrees, resolveDuplicates() links them anyway.
  //
  //    ponytail: the surviving row keeps a stale canonicalUrl until the other row's URL moves.
  //    Ceiling: one row can point at an outdated link. Upgrade path: a two-step swap through a
  //    sentinel URL — not done, because it rewrites a row that is not the one being upserted.
  if (byKey) {
    const clash = byUrl && byUrl.id !== byKey.id
    tx.update(jobs)
      .set(clash ? mutable(job, seenAt) : { ...mutable(job, seenAt), canonicalUrl: job.canonicalUrl })
      .where(eq(jobs.id, byKey.id))
      .run()
    return {
      id: byKey.id,
      action: 'updated',
      ...(clash && {
        collision: `${job.source}:${job.sourceJobId} kept job ${byKey.id}; ${job.canonicalUrl} is held by job ${byUrl.id}`,
      }),
    }
  }

  // 3. URL only: the source reissued the posting under a new sourceJobId. Taking the new
  //    identity pair is safe — the lookup above proved no row holds it.
  tx.update(jobs)
    .set({ ...mutable(job, seenAt), source: job.source, sourceJobId: job.sourceJobId })
    .where(eq(jobs.id, byUrl!.id))
    .run()
  return { id: byUrl!.id, action: 'updated' }
}

/**
 * Link cross-source duplicates: every row sharing a contentHash points at the lowest id in its
 * group. Never deletes.
 *
 * Earliest is the lowest `id`, not the earliest `firstSeenAt`: a whole batch shares one run
 * clock (and every seeded row shares one fixed clock), so firstSeenAt ties by construction.
 *
 * Both statements are pure functions of the current table state, so a second call over the same
 * hashes writes nothing. Returns how many rows in these groups are now flagged.
 *
 * ponytail: `duplicateOf` is a view of the present, not history — editing the earliest posting
 * moves its hash and hands the group to the next id. Ceiling: no audit trail. Upgrade path: none
 * wanted.
 */
export function resolveDuplicates(tx: Writer, hashes: string[]): number {
  const uniq = [...new Set(hashes)]
  if (!uniq.length) return 0

  const minId = sql<number>`(select min(o.id) from ${jobs} o where o.content_hash = ${jobs.contentHash})`

  // Every member points at the group min; the min itself gets null (`nullif`), which also clears a
  // pointer left by an earlier run whose group was different — so no self-reference, and a chain
  // can never be deeper than one hop. Safe in one statement: `minId` reads only id and
  // content_hash, which this never writes. `is not` is SQLite's null-safe comparison.
  const target = sql`nullif(${minId}, ${jobs.id})`
  tx.update(jobs)
    .set({ duplicateOf: target })
    .where(and(inArray(jobs.contentHash, uniq), sql`${jobs.duplicateOf} is not ${target}`))
    .run()

  return tx
    .select({ n: count() })
    .from(jobs)
    .where(and(inArray(jobs.contentHash, uniq), isNotNull(jobs.duplicateOf)))
    .get()!.n
}
