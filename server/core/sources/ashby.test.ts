import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { listUrl, parseBoard } from './ashby'

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../test/fixtures/${name}`, import.meta.url), 'utf8')) as unknown
const langfuse = { company: 'Langfuse', platform: 'ashby', token: 'langfuse' } as const

it('builds a board url and encodes the token', () => {
  expect(listUrl(langfuse)).toBe('https://api.ashbyhq.com/posting-api/job-board/langfuse')
})

it('reads secondaryLocations, skips unlisted rows, and drops what it cannot place', () => {
  const jobs = parseBoard(fixture('ashby-board.json'), langfuse)
  expect(jobs.map(j => j.sourceJobId)).toEqual([
    'langfuse:1225fa3d-d590-41d2-b798-ef927320fb2e',
    'langfuse:2336ab4e-e601-52f3-c8a9-fa0384319c3f',
    'langfuse:3447bc5f-f712-63a4-d9ba-0b1495420d40',
    'langfuse:677aef82-2a45-96d7-0ced-3e47c8753073',
  ])

  expect(jobs[0]).toEqual({
    source: 'ashby',
    sourceJobId: 'langfuse:1225fa3d-d590-41d2-b798-ef927320fb2e',
    url: 'https://jobs.ashbyhq.com/langfuse/1225fa3d-d590-41d2-b798-ef927320fb2e',
    title: 'Senior Backend Engineer (Data Infrastructure)',
    company: 'Langfuse',
    // NOT the primary "Europe": the row was kept because a secondary location is Swiss, so that is
    // what gets shown. This is the case that makes reading the primary alone wrong.
    location: 'Zurich',
    description: expect.stringContaining('About Langfuse'),
    postedAt: new Date('2026-02-17T17:52:58.822Z'),
  })

  const titles = jobs.map(j => j.title)
  // Kept via the nested addressCountry alone — no city text anywhere on the row — and that country
  // is then what gets displayed, since "Hybrid" and "HQ" tell the reader nothing.
  expect(titles).toContain('Legal Engineer')
  expect(jobs.find(j => j.title === 'Legal Engineer')!.location).toBe('Switzerland')
  // Excluded: nothing Swiss, primary or secondary.
  expect(titles).not.toContain('Senior Product Marketing Manager - B2C')
  // Excluded: Ashby has stopped listing it.
  expect(titles).not.toContain('Head of Talent')

  // Primary is already Swiss, so it wins verbatim rather than being replaced by a secondary.
  expect(jobs.find(j => j.title === 'Software Engineer - Applications')!.location).toBe('Zurich HQ')
  expect(jobs[0]!.description).toContain('<p>')
  expect(jobs.find(j => j.title === 'Founding Designer')!.postedAt).toBeNull()
})

it('degrades to an empty board instead of throwing', () => {
  expect(parseBoard(null, langfuse)).toEqual([])
  expect(parseBoard({ apiVersion: '1' }, langfuse)).toEqual([])
  expect(parseBoard({ jobs: [{ id: 'x' }] }, langfuse)).toEqual([])
  // Swiss, but every optional field absent: stored with nulls, never invented.
  expect(parseBoard({ jobs: [{ id: '7', title: 'T', jobUrl: 'https://x/7', location: 'Bern' }] }, langfuse)).toEqual([
    {
      source: 'ashby',
      sourceJobId: 'langfuse:7',
      url: 'https://x/7',
      title: 'T',
      company: 'Langfuse',
      location: 'Bern',
      description: null,
      postedAt: null,
    },
  ])
})
