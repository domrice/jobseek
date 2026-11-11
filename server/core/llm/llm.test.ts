import { expect, it } from 'vitest'
import { scoreBands } from '../config/rubric'
import { parseLlmResponse } from './index'
import { buildSystem, buildUser, MAX_DESCRIPTION } from './prompt'
import type { NormalizedJob, SearchProfile } from '../types'

const valid = {
  score: 82,
  recommendation: 'strong_match',
  strengths: ['TypeScript depth'],
  gaps: ['No Playwright'],
  concerns: [],
  explanation: 'Covers the required stack.',
  confidence: 0.8,
}

it('parses plain JSON', () => {
  expect(parseLlmResponse(JSON.stringify(valid))).toEqual(valid)
})

// The one repair worth making: small local models wrap output in a fence despite the instruction.
it('parses JSON inside a code fence', () => {
  expect(parseLlmResponse(`\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``)).toEqual(valid)
})

it('rejects non-JSON', () => {
  expect(() => parseLlmResponse('Sure! Here is my assessment:')).toThrow('non-JSON')
})

// `gaps: undefined` is dropped by JSON.stringify, i.e. a missing field.
it.each([{ score: 140 }, { confidence: 88 }, { recommendation: 'perfect' }, { gaps: undefined }])('rejects %o', bad =>
  expect(() => parseLlmResponse(JSON.stringify({ ...valid, ...bad }))).toThrow('failed validation'),
)

const profile = {
  id: 1,
  name: 'default',
  query: 'typescript engineer',
  location: 'Zürich',
  remoteOnly: false,
  requiredKeywords: ['TypeScript'],
  preferredKeywords: ['Vue'],
  excludedKeywords: ['Java'],
  cv: '## Experience\nEight years of TypeScript. Native German, fluent English.',
  createdAt: new Date(0),
  updatedAt: new Date(0),
} as SearchProfile

const job = {
  source: 'fake',
  sourceJobId: 'p1',
  url: 'https://example.test/p1',
  title: 'TypeScript Engineer',
  company: 'Alpine AG',
  location: 'Zürich',
  description: 'TypeScript and Vue. Français courant requis.',
  postedAt: null,
  workMode: 'hybrid',
  canonicalUrl: 'https://example.test/p1',
  contentHash: 'abc',
  normTitle: 'typescript engineer',
  normCompany: 'alpine',
  normLocation: 'zurich',
  normDescription: 'typescript and vue. français courant requis.',
} as NormalizedJob

it('puts the rules and the candidate in the system message', () => {
  const system = buildSystem(profile)
  expect(system).toMatch(/German and English are never a gap/i)
  expect(system).toMatch(/only evidence present/i)
  expect(system).toContain('Native German, fluent English')
})

// The model is told one set of bands and ScoreBadge colours by another unless both read `scoreBands`.
// They had already drifted once (prompt 75/25 against a badge at 70/40, so a possible_match rendered
// green), so this pins the prompt to the constant rather than to the numbers.
it('states the shared score bands to the model', () => {
  const system = buildSystem(profile)
  expect(system).toContain(`strong_match is ${scoreBands.strong}-100`)
  expect(system).toContain(`possible_match ${scoreBands.possible}-${scoreBands.strong - 1}`)
  expect(system).toContain(`poor_match 0-${scoreBands.possible - 1}`)
  // Bands are floors of contiguous ranges, so a gap or an inversion would silently mislabel a score.
  expect(scoreBands.possible).toBeLessThan(scoreBands.strong)
})

it('puts the posting in the user message, and no keyword pre-screen', () => {
  const user = buildUser(job)
  expect(user).toContain('Français courant requis')
  // The keyword scorer no longer gates which postings arrive here, so its verdict must not bias
  // the model's own. Its vocabulary is hand-written and monolingual; that is the whole point.
  expect(user).not.toMatch(/keyword/i)
})

it('truncates a very long description and says so', () => {
  const long = buildUser({ ...job, description: 'x'.repeat(20_000) } as NormalizedJob)
  expect(long).toContain('(Description truncated.)')
  expect(long.length).toBeLessThan(MAX_DESCRIPTION + 2_000)
})

it('does not pretend a missing CV is evidence', () => {
  const system = buildSystem({ ...profile, cv: null })
  expect(system).toContain('no CV')
  expect(system).toContain('keep confidence low')
})
