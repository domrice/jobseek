import { describe, expect, it } from 'vitest'
import { buildJobQuery, parseFilters } from '../app/utils/jobQuery'
import { jobListQuerySchema } from '../server/core/types'

describe('buildJobQuery', () => {
  it('omits empty values — `source=` is a 400, not "unfiltered"', () => {
    const q = buildJobQuery({ profileId: 1, source: '', q: '   ', location: undefined })
    expect(q).not.toHaveProperty('source')
    expect(q).not.toHaveProperty('q')
    expect(q).not.toHaveProperty('location')
  })

  it.each(['minScore', 'maxConfidence'] as const)('keeps %s 0 and drops a cleared input', k => {
    expect(buildJobQuery({ profileId: 1, [k]: 0 })[k]).toBe(0)
    expect(buildJobQuery({ profileId: 1, [k]: '' })).not.toHaveProperty(k)
  })

  it('sends includeDuplicates as the stringbool the route parses', () => {
    expect(buildJobQuery({ profileId: 1, includeDuplicates: true }).includeDuplicates).toBe('true')
    expect(buildJobQuery({ profileId: 1, includeDuplicates: false })).not.toHaveProperty('includeDuplicates')
  })

  it('turns page into offset', () => {
    expect(buildJobQuery({ profileId: 1, page: 3 }).offset).toBe(100)
    expect(buildJobQuery({ profileId: 1 })).toMatchObject({ limit: 50, offset: 0 })
  })

  it('passes postedAfter through as an ISO date, not epoch-ms', () => {
    expect(buildJobQuery({ profileId: 1, postedAfter: '2026-08-01' }).postedAfter).toBe('2026-08-01')
  })

  it('turns a relative firstSeenDays into an absolute date the route accepts', () => {
    // Clock-dependent by design: the relative→absolute conversion lives here so the query layer
    // stays clock-free. Asserted as a day range, not a literal.
    const q = buildJobQuery({ profileId: 1, firstSeenDays: 7 })
    const cutoff = jobListQuerySchema.parse(q).firstSeenAfter!
    const daysBack = (Date.now() - cutoff.getTime()) / 86_400_000
    expect(daysBack).toBeGreaterThan(6.9)
    expect(daysBack).toBeLessThan(8.1) // 'YYYY-MM-DD' truncates to UTC midnight, so up to a day more
    expect(buildJobQuery({ profileId: 1, firstSeenDays: '' })).not.toHaveProperty('firstSeenAfter')
    expect(buildJobQuery({ profileId: 1, firstSeenDays: 0 })).not.toHaveProperty('firstSeenAfter')
  })

  // The one assertion that matters: whatever this builds, the route must accept.
  it('produces a query the route schema parses', () => {
    const q = buildJobQuery({
      profileId: 2,
      q: 'engineer',
      source: 'jobs.ch',
      location: 'Zürich',
      company: 'AG',
      minScore: 0,
      maxConfidence: 0,
      postedAfter: '2026-08-01',
      includeDuplicates: true,
      sort: 'confidence',
      page: 2,
    })
    expect(jobListQuerySchema.parse(q)).toMatchObject({
      profileId: 2,
      minScore: 0,
      maxConfidence: 0,
      sort: 'confidence',
      includeDuplicates: true,
      offset: 50,
    })
  })
})

describe('parseFilters', () => {
  it('narrows hand-edited values instead of sending them to a route that would 400', () => {
    const f = parseFilters({
      profileId: '1',
      workMode: 'toString',
      scored: 'nope',
      sort: 'random',
      page: 'x',
      source: '',
    })
    expect(f).toMatchObject({ workMode: undefined, scored: undefined, sort: 'verdict', page: 1, source: undefined })
    expect(jobListQuerySchema.safeParse(buildJobQuery(f)).success).toBe(true)
  })

  it('keeps valid values', () => {
    expect(parseFilters({ workMode: 'hybrid', scored: 'llm', sort: 'posted', page: '3' })).toMatchObject({
      workMode: 'hybrid',
      scored: 'llm',
      sort: 'posted',
      page: 3,
    })
  })
})
