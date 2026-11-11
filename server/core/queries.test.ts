import { eq } from 'drizzle-orm'
import { beforeAll, expect, it } from 'vitest'
import { db } from './db/index'
import { searchProfiles } from './db/schema'
import { getJob, listJobs, listSources } from './queries'
import type { JobListQuery } from './types'

// Same pattern as test/seed.test.ts: seed() writes through the shared `db` singleton, which
// vitest.config.ts points at ./data/test.db. fileParallelism is off because that file is shared.
const { seed } = await import('../../scripts/seed')

// Profile ids autoincrement across reseeds, so look them up by name.
let dflt: number
let minimal: number
const list = (f: Partial<JobListQuery> & { profileId: number }) =>
  listJobs({ sort: 'score', limit: 50, offset: 0, ...f })

beforeAll(() => {
  seed()
  const byName = (name: string) => db.select().from(searchProfiles).where(eq(searchProfiles.name, name)).get()!.id
  dflt = byName('default')
  minimal = byName('minimal')
})

it('counts every matching row, not just the page', () => {
  const all = list({ profileId: dflt })
  const page = list({ profileId: dflt, limit: 10 })
  expect(page.items).toHaveLength(10)
  expect(page.total).toBe(all.total)
  expect(list({ profileId: dflt, limit: 10, offset: 10 }).total).toBe(all.total)
})

it('pages without repeating or skipping a row', () => {
  const a = list({ profileId: dflt, limit: 10 })
  const b = list({ profileId: dflt, limit: 10, offset: 10 })
  expect(new Set([...a.items, ...b.items].map(j => j.id)).size).toBe(20)
  for (const { items } of [a, b]) {
    const scores = items.map(j => j.score.finalScore)
    expect(scores).toEqual([...scores].sort((x, y) => y - x))
  }
})

it('joins only the requested profile', () => {
  const d = list({ profileId: dflt })
  const m = list({ profileId: minimal })
  expect(d.items.every(j => j.score.profileId === dflt)).toBe(true)
  expect(m.items.every(j => j.score.profileId === minimal)).toBe(true)
  // minimal halves every keyword score, so the top score differs.
  expect(m.items[0].score.finalScore).not.toBe(d.items[0].score.finalScore)
})

it('hides duplicates by default', () => {
  const hidden = list({ profileId: dflt })
  const shown = list({ profileId: dflt, includeDuplicates: true })
  expect(shown.total).toBe(hidden.total + 1)
  expect(hidden.items.every(j => j.duplicateOf === null)).toBe(true)
})

// The duplicate is hidden, so the surviving row is the only place its other board can be seen.
it('reports every board of a duplicate group on the surviving row', () => {
  const dupe = list({ profileId: dflt, includeDuplicates: true }).items.find(j => j.duplicateOf !== null)!
  const origin = list({ profileId: dflt }).items.find(j => j.id === dupe.duplicateOf)!
  expect(origin.sources).toEqual([dupe.source, origin.source].sort())
  // Both rows of the group answer the same thing, whichever one is looked at.
  expect(dupe.sources).toEqual(origin.sources)

  // A row with no duplicates reports itself, once — not an empty list and not a null.
  const solo = list({ profileId: dflt }).items.find(j => j.id !== origin.id && j.sources.length === 1)!
  expect(solo.sources).toEqual([solo.source])
})

it('offers exactly the sources that have rows', () => {
  const sources = listSources()
  const stored = new Set(list({ profileId: dflt, includeDuplicates: true, limit: 200 }).items.map(j => j.source))
  expect(sources).toEqual([...sources].sort())
  expect(new Set(sources)).toEqual(stored)
})

it('treats minScore 0 as a filter, not as absent', () => {
  expect(list({ profileId: dflt, minScore: 90 }).items.every(j => j.score.finalScore >= 90)).toBe(true)
  expect(list({ profileId: dflt, minScore: 0 }).items.some(j => j.score.finalScore === 0)).toBe(true)
})

// The seed stamps every row with one fixed firstSeenAt (2026-08-01T09:00Z), so both directions are
// exact and cannot drift with the calendar — the reason listJobs takes a date, not a day count.
it('filters on first seen, including rows with no postedAt', () => {
  const all = list({ profileId: dflt })
  expect(list({ profileId: dflt, firstSeenAfter: new Date('2026-07-31') }).total).toBe(all.total)
  expect(list({ profileId: dflt, firstSeenAfter: new Date('2026-08-02') }).total).toBe(0)
  // postedAfter would drop these; firstSeenAt is notNull, so this filter keeps them.
  const kept = list({ profileId: dflt, firstSeenAfter: new Date('2026-07-31'), includeDuplicates: true })
  expect(kept.items.some(j => j.postedAt === null)).toBe(true)
})

// The seed keeps both kinds on purpose: rows with a verdict and rows with empty LLM columns.
it('splits the table by whether a verdict exists', () => {
  const all = list({ profileId: dflt, limit: 200 })
  const judged = list({ profileId: dflt, scored: 'llm', limit: 200 })
  const kw = list({ profileId: dflt, scored: 'keyword', limit: 200 })
  expect(judged.items.length).toBeGreaterThan(0)
  expect(kw.items.length).toBeGreaterThan(0)
  expect(judged.total + kw.total).toBe(all.total)
  expect(judged.items.every(j => j.score.llmScore !== null)).toBe(true)
  expect(kw.items.every(j => j.score.llmScore === null)).toBe(true)
})

it('searches title and company', () => {
  const { items } = list({ profileId: dflt, q: 'helvetia' })
  expect(items.length).toBeGreaterThan(0)
  expect(items.every(j => /helvetia/i.test(`${j.title} ${j.company}`))).toBe(true)
  expect(items.some(j => /helvetia/i.test(j.company ?? ''))).toBe(true)
})

it('sorts by date with unknown dates last', () => {
  const { items } = list({ profileId: dflt, sort: 'posted', includeDuplicates: true })
  const dates = items.map(j => j.postedAt)
  expect(dates.at(-1)).toBeNull()
  const known = dates.filter(d => d !== null).map(d => d!.getTime())
  expect(known).toEqual([...known].sort((a, b) => b - a))
})

// Confidence lives in the llm_detail JSON, so both of these ride json_extract rather than a column.
const conf = (j: { score: { llmDetail: { confidence: number } | null } }) => j.score.llmDetail?.confidence ?? null

it('sorts by confidence with unjudged rows last', () => {
  const { items } = list({ profileId: dflt, sort: 'confidence', includeDuplicates: true })
  const all = items.map(conf)
  expect(all.at(-1)).toBeNull()
  const judged = all.filter(c => c !== null)
  expect(judged.length).toBeGreaterThan(1)
  expect(judged).toEqual([...judged].sort((a, b) => b - a))
})

it('filters to hedged verdicts, excluding rows with no verdict at all', () => {
  const { items } = list({ profileId: dflt, maxConfidence: 0.6, includeDuplicates: true })
  expect(items.length).toBeGreaterThan(0)
  // NULL <= 0.6 is NULL, so a keyword-only row must not survive as if it were a zero.
  expect(items.every(j => conf(j) !== null && conf(j)! <= 0.6)).toBe(true)
  const unfiltered = list({ profileId: dflt, includeDuplicates: true })
  expect(unfiltered.items.some(j => conf(j) === null)).toBe(true)
  expect(unfiltered.total).toBeGreaterThan(items.length)
})

it('returns a detail row with an optional score and its duplicate origin', () => {
  const dupe = list({ profileId: dflt, includeDuplicates: true }).items.find(j => j.duplicateOf !== null)!
  const withScore = getJob(dupe.id, dflt)!
  expect(withScore.score?.profileId).toBe(dflt)
  expect(withScore.duplicate?.id).toBe(dupe.duplicateOf)
  expect(withScore.duplicate?.source).not.toBe(dupe.source)
  expect(getJob(dupe.id)!.score).toBeNull()
  expect(getJob(999_999)).toBeNull()
})
