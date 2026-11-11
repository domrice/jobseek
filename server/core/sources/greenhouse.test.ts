import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { listUrl, parseBoard } from './greenhouse'

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../test/fixtures/${name}`, import.meta.url), 'utf8')) as unknown
const scandit = { company: 'Scandit', platform: 'greenhouse', token: 'scandit' } as const

it('builds a board url with content=true', () => {
  expect(listUrl(scandit)).toBe('https://boards-api.greenhouse.io/v1/boards/scandit/jobs?content=true')
})

it('keeps Swiss postings, board-scopes the id, and drops what it cannot place', () => {
  const jobs = parseBoard(fixture('greenhouse-board.json'), scandit)
  expect(jobs.map(j => j.sourceJobId)).toEqual([
    'scandit:8043068',
    'scandit:8043070',
    'scandit:8043072',
    'scandit:8043075',
  ])

  expect(jobs[0]).toEqual({
    source: 'greenhouse',
    sourceJobId: 'scandit:8043068',
    url: 'https://www.scandit.com/careers/job-description/?gh_jid=8043068',
    title: 'Product Manager (ShelfView)',
    // From the employer entry, not the feed.
    company: 'Scandit',
    // The posting's own bare spelling wins over the office's full address.
    location: 'Zurich',
    description: expect.stringContaining('<strong>Product Manager (ShelfView)</strong>'),
    postedAt: new Date('2026-07-02T08:54:17.000Z'),
  })

  const titles = jobs.map(j => j.title)
  // Excluded: not in Switzerland ("Mission" must not match the city Sion).
  expect(titles).not.toContain('Mission Control Engineer')
  // Excluded: no location and no office — dropped, never guessed.
  expect(titles).not.toContain('Chief of Staff')
  // Excluded: no absolute_url, so there is nothing to store or dedupe on.
  expect(titles).not.toContain('Solutions Architect')
  // Kept: Swiss only per the multi-country location string, with no offices to corroborate it.
  expect(titles).toContain('Forward Deployed Engineer - EMEA')
  // Excluded: the job is in Lisbon. A Zurich entry in the *employer's* office list is not the job's
  // location — OR-ing the two admitted 15 of 187 rows wrongly on the first live run.
  expect(titles).not.toContain('Staff Engineer, Compute')
  // Kept: declares no location at all, so the Swiss office is the only evidence and it decides.
  expect(titles).toContain('Office Manager')
  expect(jobs.find(j => j.title === 'Office Manager')!.location).toBeNull()
})

it('decodes the escaped description exactly once and falls back for a missing publish date', () => {
  const jobs = parseBoard(fixture('greenhouse-board.json'), scandit)
  const [first] = jobs

  // Decoded once: the outer escaping is gone...
  expect(first!.description).toContain('<p>')
  expect(first!.description).not.toContain('&lt;p&gt;')
  // ...while the inner entities survive for normalize()'s htmlToText to handle.
  expect(first!.description).toContain('&nbsp;')
  expect(first!.description).toContain('&amp;')
  expect(first!.description!.length).toBeGreaterThan(200)

  // first_published is null on this one, so updated_at stands in.
  const fallback = jobs.find(j => j.sourceJobId === 'scandit:8043072')!
  expect(fallback.postedAt!.toISOString()).toMatch(/^2026-08-18T/)
})

it('degrades to an empty board instead of throwing', () => {
  expect(parseBoard(null, scandit)).toEqual([])
  expect(parseBoard({ jobs: [] }, scandit)).toEqual([])
  // 200 with a shape we did not expect is still not a crash.
  expect(parseBoard({ meta: { total: 0 } }, scandit)).toEqual([])
  expect(parseBoard({ jobs: [{ id: 1 }] }, scandit)).toEqual([])
  // Swiss, but every optional field absent: stored with nulls, never invented.
  expect(
    parseBoard({ jobs: [{ id: 7, title: 'T', absolute_url: 'https://x/7', location: { name: 'Bern' } }] }, scandit),
  ).toEqual([
    {
      source: 'greenhouse',
      sourceJobId: 'scandit:7',
      url: 'https://x/7',
      title: 'T',
      company: 'Scandit',
      location: 'Bern',
      description: null,
      postedAt: null,
    },
  ])
})
