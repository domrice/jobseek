import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { asc, eq } from 'drizzle-orm'
import { beforeAll, beforeEach, expect, it } from 'vitest'
import { jobs } from './db/schema'
import { resolveDuplicates, upsertJob } from './dedupe'
import { normalize } from './normalize'
import type { RawJob } from './types'

// ponytail: in-memory DB migrated from the checked-in SQL, so the shared data/ file is never
// touched and this also re-proves the migration matches the schema. Ceiling: none worth naming.
const sqlite = new Database(':memory:')
const db = drizzle(sqlite, { schema: { jobs } })

const SEEN = new Date('2026-08-01T09:00:00Z')
const LATER = new Date('2026-08-08T09:00:00Z')

const raw = (over: Partial<RawJob> = {}): RawJob => ({
  source: 'jobs.ch',
  sourceJobId: 'a1',
  url: 'https://www.jobs.ch/en/vacancies/detail/1/',
  title: 'Engineer',
  company: 'Alpine Fintech AG',
  location: 'Zürich',
  description: 'TypeScript and Node.',
  postedAt: null,
  ...over,
})

/** upsertJob writes only inside a transaction; so does every caller. */
const put = (over: Partial<RawJob>, seenAt = SEEN) => db.transaction(tx => upsertJob(tx, normalize(raw(over)), seenAt))

const rowCount = () => db.select().from(jobs).all().length

beforeAll(() => migrate(db, { migrationsFolder: './drizzle' }))
beforeEach(() => db.delete(jobs).run())

it('updates in place on the same (source, sourceJobId)', () => {
  const first = put({})
  expect(first.action).toBe('inserted')

  const again = put({ title: 'Senior Engineer' }, LATER)
  expect(again).toEqual({ id: first.id, action: 'updated' })
  expect(rowCount()).toBe(1)

  const row = db.select().from(jobs).get()!
  expect(row.title).toBe('Senior Engineer')
  expect(row.firstSeenAt).toEqual(SEEN)
  expect(row.lastSeenAt).toEqual(LATER)
})

it('takes over the identity keys when only the canonicalUrl matches', () => {
  const first = put({})
  const again = put({ sourceJobId: 'a2' })

  expect(again).toEqual({ id: first.id, action: 'updated' })
  expect(rowCount()).toBe(1)
  expect(db.select().from(jobs).get()!.sourceJobId).toBe('a2')
})

it('survives the two UNIQUE keys disagreeing', () => {
  const byKey = put({ sourceJobId: 'a1', url: 'https://www.jobs.ch/en/vacancies/detail/1/' })
  const byUrl = put({ sourceJobId: 'a2', url: 'https://www.jobs.ch/en/vacancies/detail/2/' })

  // 'a1' now claims the URL that 'a2' holds.
  const res = put({ sourceJobId: 'a1', url: 'https://www.jobs.ch/en/vacancies/detail/2/', title: 'Lead' })
  expect(res.id).toBe(byKey.id)
  expect(res.action).toBe('updated')
  expect(res.collision).toContain(`job ${byUrl.id}`)
  expect(rowCount()).toBe(2)

  const kept = db.select().from(jobs).where(eq(jobs.id, byKey.id)).get()!
  expect(kept.title).toBe('Lead')
  // Unchanged, trailing slash already dropped by canonicalUrl().
  expect(kept.canonicalUrl).toBe('https://www.jobs.ch/en/vacancies/detail/1')
})

it('points every duplicate at the lowest id in its hash group, one hop deep', () => {
  const shared = { title: 'Engineer', company: 'Alpine Fintech AG', location: 'Zürich' }
  const a = put({ ...shared, source: 'jobs.ch', sourceJobId: 'x', url: 'https://a.example/1' })
  const b = put({ ...shared, source: 'linkedin', sourceJobId: 'y', url: 'https://b.example/2' })
  const c = put({ ...shared, source: 'jobup.ch', sourceJobId: 'z', url: 'https://c.example/3' })
  const other = put({ title: 'Baker', source: 'indeed.ch', sourceJobId: 'w', url: 'https://d.example/4' })

  const hashes = db
    .select({ h: jobs.contentHash })
    .from(jobs)
    .all()
    .map(r => r.h)
  const flagged = db.transaction(tx => resolveDuplicates(tx, hashes))
  expect(flagged).toBe(2)

  const rows = db.select().from(jobs).orderBy(asc(jobs.id)).all()
  const pointers = new Map(rows.map(r => [r.id, r.duplicateOf]))
  expect(pointers.get(a.id)).toBeNull()
  expect(pointers.get(b.id)).toBe(a.id)
  expect(pointers.get(c.id)).toBe(a.id)
  expect(pointers.get(other.id)).toBeNull()

  // Idempotent.
  expect(db.transaction(tx => resolveDuplicates(tx, hashes))).toBe(2)
  expect(db.select().from(jobs).orderBy(asc(jobs.id)).all()).toEqual(rows)
})
