import { expect, it } from 'vitest'
import { weights } from '../config/rubric'
import { compare } from '../normalize'
import { matchesTerm, scoreKeywords } from './keyword'

/** The seed's `default` profile, so the scorer is exercised against a real profile shape. */
const profile = {
  requiredKeywords: ['TypeScript', 'Node', 'SQL'],
  preferredKeywords: ['Vue', 'Drizzle', 'Playwright'],
  excludedKeywords: ['Java', 'internship'],
}

/** Same folding the pipeline applies before scoring. */
const job = (title: string, description: string | null = null) => ({
  normTitle: compare(title) ?? '',
  normDescription: compare(description),
})

const text = (s: string) => compare(s)!

it('respects word boundaries where \\b works', () => {
  expect(matchesTerm(text('Google engineer'), 'Go')).toBe(false)
  expect(matchesTerm(text('Go and Rust'), 'Go')).toBe(true)
  expect(matchesTerm(text('Nodemailer only'), 'Node')).toBe(false)
})

it('matches punctuation-edged terms, where \\b cannot', () => {
  expect(matchesTerm(text('C++ developer'), 'C++')).toBe(true)
  expect(matchesTerm(text('experience: c++'), 'C++')).toBe(true)
  expect(matchesTerm(text('CI/CD pipelines'), 'CI/CD')).toBe(true)
})

it('matches aliases in both directions', () => {
  expect(matchesTerm(text('deep TypeScript work'), 'TS')).toBe(true)
  expect(matchesTerm(text('strong TS skills'), 'TypeScript')).toBe(true)
  expect(matchesTerm(text('runs on K8s'), 'Kubernetes')).toBe(true)
})

it('reports the profile spelling, not the alias that fired', () => {
  const s = scoreKeywords({ ...profile, requiredKeywords: ['TypeScript'] }, job('TS engineer'))
  expect(s.matchedRequired).toEqual(['TypeScript'])
})

it('spans 0 to 100', () => {
  const perfect = scoreKeywords(profile, job('TypeScript Engineer', 'Node, SQL, Vue, Drizzle and Playwright.'))
  expect(perfect.score).toBe(100)
  expect(perfect.missingRequired).toEqual([])

  const nothing = scoreKeywords(profile, job('Baker', 'Bread, and Java, and an internship.'))
  expect(nothing.score).toBe(0)
  expect(nothing.missingRequired).toEqual(['TypeScript', 'Node', 'SQL'])
  expect(nothing.matchedExcluded).toEqual(['Java', 'internship'])
})

it('penalises excluded matches', () => {
  const clean = scoreKeywords(profile, job('TypeScript Engineer', 'Node, SQL, Vue, Drizzle, Playwright.'))
  const one = scoreKeywords(profile, job('TypeScript Engineer', 'Node, SQL, Vue, Drizzle, Playwright. Some Java too.'))
  expect(one.score).toBeLessThan(clean.score)
  expect(one.matchedExcluded).toEqual(['Java'])
})

it('scores a keywordless profile neutrally', () => {
  const s = scoreKeywords({ requiredKeywords: [], preferredKeywords: [], excludedKeywords: [] }, job('Anything at all'))
  expect(s.score).toBe(weights.noKeywords)
  expect(s.explanation).toBe('no profile keywords matched')
})

it('scores title-only postings', () => {
  const a = scoreKeywords(profile, job('TypeScript and SQL Engineer'))
  expect(a.matchedRequired).toEqual(['TypeScript', 'SQL'])
})
