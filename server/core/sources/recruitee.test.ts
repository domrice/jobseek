import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { listUrl, parseBoard } from './recruitee'

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../test/fixtures/${name}`, import.meta.url), 'utf8')) as unknown
const imnoo = { company: 'Imnoo', platform: 'recruitee', token: 'imnoo' } as const

it('builds a board url on the employer subdomain', () => {
  expect(listUrl(imnoo)).toBe('https://imnoo.recruitee.com/api/offers/')
})

it('keeps published Swiss offers, spells out country_code, and drops the rest', () => {
  const jobs = parseBoard(fixture('recruitee-board.json'), imnoo)
  expect(jobs.map(j => j.sourceJobId)).toEqual(['imnoo:2666211', 'imnoo:2666212', 'imnoo:2666215'])

  expect(jobs[0]).toEqual({
    source: 'recruitee',
    sourceJobId: 'imnoo:2666211',
    url: 'https://imnoo.recruitee.com/o/product-operations-customer-manager',
    title: 'Product Operations Customer Manager',
    company: 'Imnoo',
    // The city wins over `location`, which here is the display string "Remote job".
    location: 'Zürich',
    description: expect.stringContaining('build the physical world'),
    postedAt: new Date('2026-07-03T10:44:03.000Z'),
  })
  // Reading `description` alone would drop the half that decides a match.
  expect(jobs[0]!.description).toContain('3+ years in a customer-facing product role')
  // published_at is null on this one, so created_at stands in.
  expect(jobs[2]!.postedAt!.toISOString()).toMatch(/^2026-06-15T/)

  const titles = jobs.map(j => j.title)
  // Kept: Swiss only via country_code 'CH', which the word list cannot match unless spelled out.
  expect(titles).toContain('Senior AI Engineer')
  // Excluded: Berlin.
  expect(titles).not.toContain('Working Student Growth')
  // Excluded: Recruitee leaves closed reqs in the feed; only `published` is live.
  expect(titles).not.toContain('Head of Operations')
  // Excluded: no careers_url, so there is nothing to store or dedupe on.
  expect(titles).not.toContain('Office Manager')
})

it('degrades to an empty board instead of throwing', () => {
  expect(parseBoard(null, imnoo)).toEqual([])
  expect(parseBoard({ offers: [] }, imnoo)).toEqual([])
  expect(parseBoard({}, imnoo)).toEqual([])
  expect(parseBoard({ offers: [{ id: 1 }] }, imnoo)).toEqual([])
  // Swiss, but every optional field absent: stored with nulls, never invented. No `status` at all
  // must not be read as "not published".
  expect(parseBoard({ offers: [{ id: 7, title: 'T', careers_url: 'https://x/7', city: 'Bern' }] }, imnoo)).toEqual([
    {
      source: 'recruitee',
      sourceJobId: 'imnoo:7',
      url: 'https://x/7',
      title: 'T',
      company: 'Imnoo',
      location: 'Bern',
      description: null,
      postedAt: null,
    },
  ])
})
