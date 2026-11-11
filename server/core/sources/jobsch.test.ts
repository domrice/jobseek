import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { listUrl, parseDetail, parseList } from './jobsch'

const fixture = (name: string) => readFileSync(new URL(`../../../test/fixtures/${name}`, import.meta.url), 'utf8')

// `term` and `location` both filter; `page` is 1-indexed and omitted on the first page.
it('builds a list url from the query, the location and the page', () => {
  expect(listUrl({ query: 'architekt' })).toBe('https://www.jobs.ch/en/vacancies/?term=architekt')
  expect(listUrl({ query: 'architekt', location: 'Basel' })).toBe(
    'https://www.jobs.ch/en/vacancies/?term=architekt&location=Basel',
  )
  expect(listUrl({ query: 'architekt' }, 1)).toBe('https://www.jobs.ch/en/vacancies/?term=architekt')
  expect(listUrl({ query: 'a & b' }, 3)).toBe('https://www.jobs.ch/en/vacancies/?term=a+%26+b&page=3')
})

it('parses cards out of the ItemList, dedupes repeated ids and skips non-postings', () => {
  const cards = parseList(fixture('jobsch-list.html'))
  expect(cards.map(c => c.sourceJobId)).toEqual([
    '8a79411f-6b28-4202-a42a-444e425beb39',
    '7439d9b9-194b-4d61-aac0-11888af0985c',
    '7605946c-ba60-477d-a9f4-9af141cf87a7',
    '92ff6627-146f-4b2d-80b1-94c3a265e4e4',
  ])
  expect(cards[2]).toEqual({
    sourceJobId: '7605946c-ba60-477d-a9f4-9af141cf87a7',
    url: 'https://www.jobs.ch/en/vacancies/detail/7605946c-ba60-477d-a9f4-9af141cf87a7/',
    title: 'Architekt/in – Projektleiter/in',
    company: 'RZintegral AG',
    location: 'Bern',
    postedAt: new Date('2026-08-21T17:12:37+02:00'),
  })
  // A missing field is null, never guessed: card 1 has no addressLocality, card 2 no organisation.
  expect(cards[0]!.location).toBeNull()
  expect(cards[1]!.company).toBeNull()
  expect(parseList('<html><body>gone</body></html>')).toEqual([])
})

it('parses the description and the city out of the detail JSON-LD', () => {
  const { description, location } = parseDetail(fixture('jobsch-detail.html'))
  // Description stays raw HTML — normalize() is the only thing that turns it into text.
  expect(description).toContain('<p>')
  expect(description!.length).toBeGreaterThan(500)
  // This page names the city in addressRegion and omits addressLocality entirely.
  expect(location).toBe('Münchenstein')
  expect(
    parseDetail(
      '<script type="application/ld+json">' +
        '{"@type":"JobPosting","jobLocation":{"address":{"addressLocality":"Bern","addressRegion":"BE"}}}' +
        '</script>',
    ).location,
  ).toBe('Bern')
})

it('returns nulls rather than throwing when the detail page has no usable JSON-LD', () => {
  const empty = { description: null, location: null }
  expect(parseDetail('<html><body>gone</body></html>')).toEqual(empty)
  expect(parseDetail('<script type="application/ld+json">{ not json</script>')).toEqual(empty)
  // A page whose only JSON-LD is something else must not be mistaken for a posting.
  expect(parseDetail('<script type="application/ld+json">{"@type":"WebPage"}</script>')).toEqual(empty)
})
