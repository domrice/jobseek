import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeAll, expect, it } from 'vitest'
import { jobScores, jobs, searchProfiles } from './schema'

// ponytail: in-memory DB migrated from the checked-in SQL, so this also proves the
// generated migration matches the schema. Ceiling: none worth naming.
const sqlite = new Database(':memory:')
const db = drizzle(sqlite)

const job = {
  source: 'jobs.ch',
  sourceJobId: 'abc',
  url: 'https://www.jobs.ch/en/vacancies/detail/1/',
  canonicalUrl: 'https://www.jobs.ch/en/vacancies/detail/1/',
  title: 'Engineer',
  contentHash: 'hash1',
}

beforeAll(() => {
  migrate(db, { migrationsFolder: './drizzle' })
  db.insert(searchProfiles)
    .values({ name: 'default', query: 'engineer', requiredKeywords: ['ts'] })
    .run()
  db.insert(jobs).values(job).run()
  db.insert(jobScores)
    .values({
      jobId: 1,
      profileId: 1,
      contentHash: 'hash1',
      keywordScore: 70,
      keywordDetail: { matched: ['ts'], missing: [], excluded: [] },
      finalScore: 70,
    })
    .run()
})

it('round-trips JSON columns as values, timestamps as Dates', () => {
  const profile = db.select().from(searchProfiles).all()[0]
  expect(profile.requiredKeywords).toEqual(['ts'])
  expect(profile.excludedKeywords).toEqual([])
  expect(profile.remoteOnly).toBe(false)
  expect(profile.createdAt).toBeInstanceOf(Date)

  const score = db.select().from(jobScores).all()[0]
  expect(score.keywordDetail.matched).toEqual(['ts'])
  expect(score.llmScore).toBeNull()

  expect(db.select().from(jobs).all()[0].postedAt).toBeNull()
})

it('rejects a second job with the same (source, sourceJobId)', () => {
  expect(() =>
    db
      .insert(jobs)
      .values({ ...job, canonicalUrl: 'https://other.example/1', contentHash: 'hash2' })
      .run(),
  ).toThrow(/UNIQUE/)
})

it('rejects a second job with the same canonicalUrl', () => {
  expect(() =>
    db
      .insert(jobs)
      .values({ ...job, sourceJobId: 'def', contentHash: 'hash2' })
      .run(),
  ).toThrow(/UNIQUE/)
})

it('rejects a second score for the same (jobId, profileId)', () => {
  expect(() =>
    db
      .insert(jobScores)
      .values({
        jobId: 1,
        profileId: 1,
        contentHash: 'hash1',
        keywordScore: 10,
        keywordDetail: { matched: [], missing: [], excluded: [] },
        finalScore: 10,
      })
      .run(),
  ).toThrow(/UNIQUE|PRIMARY/)
})
