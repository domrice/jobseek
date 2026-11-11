import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { listUrl, parseBoard } from './lever'

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../test/fixtures/${name}`, import.meta.url), 'utf8')) as unknown
const sonar = { company: 'Sonar', platform: 'lever', token: 'sonarsource' } as const

it('builds a board url with mode=json and encodes the token', () => {
  expect(listUrl(sonar)).toBe('https://api.lever.co/v0/postings/sonarsource?mode=json')
})

it('keeps Swiss postings, ORs allLocations, and drops what it cannot place', () => {
  const jobs = parseBoard(fixture('lever-board.json'), sonar)
  expect(jobs.map(j => j.sourceJobId)).toEqual([
    'sonarsource:54743786-1ad7-4be7-bcbe-67f660e9c381',
    'sonarsource:aa11bb22-cc33-dd44-ee55-ff6677889900',
    'sonarsource:cc33dd44-ee55-ff66-7788-990011223344',
  ])

  expect(jobs[0]).toEqual({
    source: 'lever',
    sourceJobId: 'sonarsource:54743786-1ad7-4be7-bcbe-67f660e9c381',
    url: 'https://jobs.lever.co/sonarsource/54743786-1ad7-4be7-bcbe-67f660e9c381',
    title: 'Account Based Marketing (ABM) Manager',
    company: 'Sonar',
    location: 'Geneva',
    description: expect.stringContaining('Who is Sonar?'),
    postedAt: new Date(1785155309260),
  })

  const titles = jobs.map(j => j.title)
  // Kept: Swiss only via allLocations, which are the job's places rather than the company's offices.
  expect(titles).toContain('Staff Engineer, Clean Code')
  // Excluded: nothing Swiss anywhere.
  expect(titles).not.toContain('Enterprise Account Executive, UK')
  // Excluded: no hostedUrl, so there is nothing to store or dedupe on.
  expect(titles).not.toContain('Office Coordinator')
})

it('stitches the four body fields back together and leaves a missing date null', () => {
  const jobs = parseBoard(fixture('lever-board.json'), sonar)
  const [first] = jobs

  // Reading `description` alone would hand the LLM a posting with no requirements in it.
  expect(first!.description).toContain('<h3>Requirements</h3>')
  expect(first!.description).toContain('5+ years in B2B marketing')
  expect(first!.description).toContain('diversity, equity and inclusion')

  const noDate = jobs.find(j => j.title === 'Developer Advocate')!
  expect(noDate.postedAt).toBeNull()
})

it('degrades to an empty board instead of throwing', () => {
  // Lever answers with a bare array; an object is a board we cannot read.
  expect(parseBoard({ jobs: [] }, sonar)).toEqual([])
  expect(parseBoard([{ id: 'x' }], sonar)).toEqual([])
  // Swiss, but every optional field absent: stored with nulls, never invented.
  expect(
    parseBoard([{ id: '7', text: 'T', hostedUrl: 'https://x/7', categories: { location: 'Bern' } }], sonar),
  ).toEqual([
    {
      source: 'lever',
      sourceJobId: 'sonarsource:7',
      url: 'https://x/7',
      title: 'T',
      company: 'Sonar',
      location: 'Bern',
      description: null,
      postedAt: null,
    },
  ])
})
