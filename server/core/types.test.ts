import { expect, it } from 'vitest'
import { llmScoreSchema, searchProfileInsertSchema } from './types'

const llm = {
  score: 82,
  recommendation: 'strong_match',
  strengths: ['ts'],
  gaps: [],
  concerns: [],
  explanation: 'good fit',
  confidence: 0.7,
}

it('validates LLM responses', () => {
  expect(llmScoreSchema.parse(llm).score).toBe(82)
  expect(llmScoreSchema.safeParse({ ...llm, score: 150 }).success).toBe(false)
  expect(llmScoreSchema.safeParse({ ...llm, recommendation: 'maybe' }).success).toBe(false)
})

it('accepts a minimal profile body and rejects a nameless one', () => {
  expect(searchProfileInsertSchema.safeParse({ name: 'default', query: 'engineer' }).success).toBe(true)
  expect(searchProfileInsertSchema.safeParse({ query: 'engineer' }).success).toBe(false)
})

it('cleans what a form submits: blanks become null, blank keywords vanish', () => {
  const parsed = searchProfileInsertSchema.parse({
    name: '  default  ',
    query: 'engineer',
    location: '   ',
    cv: '',
    requiredKeywords: [' TypeScript ', '', '  '],
  })
  expect(parsed).toMatchObject({ name: 'default', location: null, cv: null, requiredKeywords: ['TypeScript'] })
  // A name that is only whitespace is a nameless profile, not a named one.
  expect(searchProfileInsertSchema.safeParse({ name: '   ', query: 'engineer' }).success).toBe(false)
  expect(searchProfileInsertSchema.safeParse({ name: 'a', query: '' }).success).toBe(false)
  expect(searchProfileInsertSchema.safeParse({ name: 'a', query: 'b', cv: 'x'.repeat(20_001) }).success).toBe(false)
})
