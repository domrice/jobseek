import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { listUrl, parseDetail, parseList } from './jobscout24'

const fixture = (name: string) => readFileSync(new URL(`../../../test/fixtures/${name}`, import.meta.url), 'utf8')

// SearchWhat is the only parameter the GET search honours; location is deliberately not sent.
it('builds a list url from the query alone', () => {
  expect(listUrl({ query: 'architect' })).toBe('https://www.jobscout24.ch/en/jobs/?SearchWhat=architect')
  expect(listUrl({ query: 'architect', location: 'Zürich' })).toBe(
    'https://www.jobscout24.ch/en/jobs/?SearchWhat=architect',
  )
})

it('parses organic cards and drops paid placements', () => {
  const cards = parseList(fixture('jobscout24-list.html'))
  expect(cards.map(c => c.sourceJobId)).toEqual(['10351179', '10330576'])
  expect(cards[0]).toEqual({
    sourceJobId: '10351179',
    url: 'https://www.jobscout24.ch/en/job/eb655235-5ecb-4ce0-9bbc-a2c514e6b02a/',
    title: 'Architektin / Architekt für die Denkmalpflege',
    company: 'Kanton Obwalden',
    location: 'Sarnen',
  })
})

it('parses description and postedAt out of the detail JSON-LD', () => {
  const { description, postedAt } = parseDetail(fixture('jobscout24-detail.html'))
  // Description stays raw HTML — normalize() is the only thing that turns it into text.
  expect(description).toContain('<p>')
  expect(description!.length).toBeGreaterThan(1000)
  // datePosted has a 7-digit fraction and no zone ('2026-08-17T10:35:49.2130000'); Date takes it.
  expect(postedAt!.toISOString()).toMatch(/^2026-08-17T/)
})

it('returns nulls rather than throwing when the detail page has no JSON-LD', () => {
  expect(parseDetail('<html><body>gone</body></html>')).toEqual({ description: null, postedAt: null })
})
