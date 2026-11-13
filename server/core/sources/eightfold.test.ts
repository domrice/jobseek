import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { listUrl, parseDetail, parseList } from './eightfold'

const fixture = (name: string) => readFileSync(new URL(`../../../test/fixtures/${name}`, import.meta.url), 'utf8')
const on = { company: 'On AG', platform: 'eightfold', token: 'jobs.on.com/on.com' } as const

it('builds the Swiss-filtered list url from host/domain and page', () => {
  expect(listUrl(on, 2)).toBe(
    'https://jobs.on.com/api/pcsx/search?domain=on.com&query=&location=Switzerland&start=20',
  )
})

it('parses positions, keeps foreign ones for the walk', () => {
  const cards = parseList(fixture('eightfold-list.json'), on)
  expect(cards.map(c => c.location)).toEqual(['Zurich', 'Zürich, Switzerland; London, UK', 'tokyo'])
  expect(cards[1]).toEqual({
    sourceJobId: 'jobs.on.com/on.com:563980770816534',
    url: 'https://jobs.on.com/api/pcsx/position_details?position_id=563980770816534&domain=on.com&hl=en',
    page: 'https://jobs.on.com/careers/job/563980770816534',
    title: 'Senior Retail Allocator, EMEA',
    location: 'Zürich, Switzerland; London, UK',
    postedAt: new Date(1791365061 * 1000),
  })
})

it('parses the description', () => {
  expect(parseDetail(fixture('eightfold-detail.json')).description).toContain('Senior Retail Allocator, you will')
})

it('degrades to empty instead of throwing', () => {
  expect(parseDetail('')).toEqual({ description: null })
  expect(parseDetail('{}')).toEqual({ description: null })
})
