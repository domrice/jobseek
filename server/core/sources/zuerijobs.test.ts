import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { listUrl, parseDetail, parseList } from './zuerijobs'

const fixture = (name: string) => readFileSync(new URL(`../../../test/fixtures/${name}`, import.meta.url), 'utf8')

// `q` is the only parameter sent; `page` is 1-indexed and omitted on the first page.
it('builds a list url from the query and the page', () => {
  expect(listUrl({ query: 'architekt' })).toBe('https://www.zueri.jobs/jobs?q=architekt')
  expect(listUrl({ query: 'architekt', location: 'Basel' })).toBe('https://www.zueri.jobs/jobs?q=architekt')
  expect(listUrl({ query: 'a & b' }, 3)).toBe('https://www.zueri.jobs/jobs?q=a+%26+b&page=3')
})

it('parses cards, dedupes repeated ids and ignores the apply link', () => {
  const cards = parseList(fixture('zuerijobs-list.html'))
  expect(cards.map(c => c.sourceJobId)).toEqual(['505966714', '523175347'])
  expect(cards[0]).toEqual({
    sourceJobId: '505966714',
    url: 'https://www.zueri.jobs/jobs/505966714-sap-solution-architekt-80-100',
    title: 'SAP Solution Architekt, 80-100 %',
  })
  // The /apply and /companies hrefs sit on the same card and must never become the job url.
  expect(cards.some(c => c.url.includes('/apply') || c.url.includes('/companies/'))).toBe(false)
})

it('parses company, location, description and postedAt out of the detail JSON-LD', () => {
  const { company, location, description, postedAt } = parseDetail(fixture('zuerijobs-detail.html'))
  expect(company).toBe('Stadt Zürich – Organisation und Informatik')
  expect(location).toBe('Zürich')
  // Description stays raw HTML — normalize() is the only thing that turns it into text.
  expect(description).toContain('<p>')
  expect(description!.length).toBeGreaterThan(500)
  expect(postedAt!.toISOString()).toMatch(/^2026-06-30T/)
})

it('returns nulls rather than throwing when the detail page has no usable JSON-LD', () => {
  const empty = { company: null, location: null, description: null, postedAt: null }
  expect(parseDetail('<html><body>gone</body></html>')).toEqual(empty)
  expect(parseDetail('<script type="application/ld+json">{ not json</script>')).toEqual(empty)
  // A page whose only JSON-LD is something else must not be mistaken for a posting.
  expect(parseDetail('<script type="application/ld+json">{"@type":"WebPage"}</script>')).toEqual(empty)
})
