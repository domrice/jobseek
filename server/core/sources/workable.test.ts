import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { listUrl, parseBoard } from './workable'

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../test/fixtures/${name}`, import.meta.url), 'utf8'))
const flexion = { company: 'Flexion Robotics', platform: 'workable', token: 'flexion-robotics' } as const

it('builds the widget url with details=true', () => {
  expect(listUrl(flexion)).toBe('https://apply.workable.com/api/v1/widget/accounts/flexion-robotics?details=true')
})

it('reads the locations array, falls back to shortlink, and drops the rest', () => {
  const jobs = parseBoard(fixture('workable-board.json'), flexion)
  expect(jobs.map(j => j.sourceJobId)).toEqual([
    'flexion-robotics:9708973E90',
    'flexion-robotics:DA88B40606',
    'flexion-robotics:AA11BB2233',
    'flexion-robotics:BB22CC3344',
  ])

  expect(jobs[0]).toEqual({
    source: 'workable',
    sourceJobId: 'flexion-robotics:9708973E90',
    url: 'https://apply.workable.com/j/9708973E90',
    title: 'AI Engineer - Dexterous Manipulation',
    company: 'Flexion Robotics',
    location: 'Zürich',
    description: expect.stringContaining('dexterous manipulation expert'),
    // published_on, NOT the year-older created_at.
    postedAt: new Date('2026-04-21T00:00:00.000Z'),
  })

  const titles = jobs.map(j => j.title)
  // Kept: Swiss only via the locations array; the job itself names no city or country.
  expect(titles).toContain('Palantir Foundry Engineer')
  // Excluded: Athens.
  expect(titles).not.toContain('Data & AI Engineer')
  // Excluded: no shortcode, so there is no identity key.
  expect(titles).not.toContain('Office Manager')

  // No `url`, so `shortlink` stands in rather than the row being dropped.
  expect(jobs.find(j => j.title === 'Machine Learning Engineer')!.url).toBe('https://apply.workable.com/j/AA11BB2233')
})

it('prefers published_on over created_at and leaves both-missing null', () => {
  const jobs = parseBoard(fixture('workable-board.json'), flexion)

  expect(jobs[0]!.description).toContain('<p>')

  expect(jobs.find(j => j.title === 'Robotics Software Intern')!.postedAt).toBeNull()
  // A job with no city of its own is still shown by the place it does have.
  expect(jobs.find(j => j.title === 'Palantir Foundry Engineer')!.location).toBeNull()
})

it('degrades to an empty board instead of throwing', () => {
  expect(parseBoard(null, flexion)).toEqual([])
  expect(parseBoard({ jobs: [] }, flexion)).toEqual([])
  expect(parseBoard({ name: 'X' }, flexion)).toEqual([])
  expect(parseBoard({ jobs: [{ title: 'T' }] }, flexion)).toEqual([])
  // Swiss, but every optional field absent: stored with nulls, never invented.
  expect(parseBoard({ jobs: [{ shortcode: '7', title: 'T', url: 'https://x/7', city: 'Bern' }] }, flexion)).toEqual([
    {
      source: 'workable',
      sourceJobId: 'flexion-robotics:7',
      url: 'https://x/7',
      title: 'T',
      company: 'Flexion Robotics',
      location: 'Bern',
      description: null,
      postedAt: null,
    },
  ])
})
