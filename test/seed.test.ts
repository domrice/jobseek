import { beforeAll, expect, it } from 'vitest'
import { db } from '../server/core/db/index'
import { jobScores, jobs, pipelineRuns, searchProfiles } from '../server/core/db/schema'
import { profiles, seed } from '../scripts/seed'

let job: (typeof jobs.$inferSelect)[]
let scores: (typeof jobScores.$inferSelect)[]

beforeAll(() => {
  seed()
  job = db.select().from(jobs).all()
  scores = db.select().from(jobScores).all()
  // Not a total: a profile created in the UI is not the seed's and must still be there.
  const seeded = db
    .select()
    .from(searchProfiles)
    .all()
    .map(p => p.name)
  expect(profiles.every(p => seeded.includes(p.name))).toBe(true)
  expect(db.select().from(pipelineRuns).all()).toHaveLength(3)
})

it('covers the sources and volume the UI needs', () => {
  expect(job.length).toBeGreaterThanOrEqual(30)
  expect(new Set(job.map(j => j.source)).size).toBeGreaterThanOrEqual(4)
})

it('flags exactly one cross-source duplicate', () => {
  const dupes = job.filter(j => j.duplicateOf !== null)
  expect(dupes).toHaveLength(1)
  const origin = job.find(j => j.id === dupes[0].duplicateOf)!
  expect(origin.source).not.toBe(dupes[0].source)
  expect(origin.contentHash).toBe(dupes[0].contentHash)
})

it('includes the rendering edge cases', () => {
  expect(job.some(j => j.postedAt === null)).toBe(true)
  expect(job.some(j => j.location === null)).toBe(true)
  expect(job.some(j => (j.company?.length ?? 0) > 80)).toBe(true)
  expect(job.some(j => (j.description?.length ?? 0) >= 6000)).toBe(true)
})

// All four work-mode states must render: null is the common one, not the edge case.
it('covers every work mode including "the posting did not say"', () => {
  expect(new Set(job.map(j => j.workMode))).toEqual(new Set(['remote', 'hybrid', 'onsite', null]))
})

it('scores every job for every profile, and spans the full range', () => {
  expect(scores).toHaveLength(job.length * profiles.length)
  expect(scores.some(s => s.finalScore === 0)).toBe(true)
  expect(scores.some(s => s.finalScore === 100)).toBe(true)
  expect(scores.some(s => s.keywordDetail.missing.length >= 3)).toBe(true)
})

it('covers all three LLM recommendations plus the no-LLM default', () => {
  expect(new Set(scores.map(s => s.llmRecommendation).filter(Boolean))).toEqual(
    new Set(['strong_match', 'possible_match', 'poor_match']),
  )
  expect(scores.filter(s => s.llmScore === null).length).toBeGreaterThan(scores.length / 2)
})

// The one that fails loudest if the fixture drifts from the Phase 7 rule.
it('obeys finalScore = llmScore ?? keywordScore', () => {
  for (const s of scores) expect(s.finalScore).toBe(s.llmScore ?? s.keywordScore)
})
