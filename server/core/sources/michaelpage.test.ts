import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { listUrl, parseDetail, parseList } from './michaelpage'

const fixture = (name: string) => readFileSync(new URL(`../../../test/fixtures/${name}`, import.meta.url), 'utf8')

// `search`, not `keywords` — `keywords` is inert on this view. The landing page it redirects to has
// no pagination, so `page` switches to the browse view and drops `search` entirely.
it('builds a landing-page url from search and location', () => {
  expect(listUrl({ query: 'architect' })).toBe('https://www.michaelpage.ch/jobs?search=architect')
  expect(listUrl({ query: 'architect', location: 'Zurich' })).toBe(
    'https://www.michaelpage.ch/jobs?search=architect&location=Zurich',
  )
})

// `page` is 0-indexed here (züri.jobs is 1-indexed), and page 0 is the bare listing.
it('builds a browse url with 0-indexed pagination and no search param', () => {
  expect(listUrl({ query: 'architekt' }, 0)).toBe('https://www.michaelpage.ch/jobs')
  expect(listUrl({ query: 'architekt' }, 1)).toBe('https://www.michaelpage.ch/jobs?page=1')
  expect(listUrl({ query: 'architekt', location: 'Zurich' }, 1)).toBe(
    'https://www.michaelpage.ch/jobs?location=Zurich&page=1',
  )
})

it('parses result tiles, dedupes refs and drops recommendation tiles', () => {
  const cards = parseList(fixture('michaelpage-list.html'))
  expect(cards.map(c => c.sourceJobId)).toEqual(['jn-072026-7057899', 'jn-072026-7068225'])
  // The first card's title sits in an <h2>, and its location is behind a map-marker icon.
  expect(cards[0]).toEqual({
    sourceJobId: 'jn-072026-7057899',
    url: 'https://www.michaelpage.ch/fr/job-detail/architecte-exp%C3%A9riment%C3%A9e-orient%C3%A9e-ex%C3%A9cution/ref/jn-072026-7057899?lang=en',
    title: 'Architecte expérimenté(e) orienté(e) exécution',
    location: 'Switzerland',
  })
  expect(cards[1]).toEqual({
    sourceJobId: 'jn-072026-7068225',
    url: 'https://www.michaelpage.ch/job-detail/sap-fico-architect-or-manager/ref/jn-072026-7068225',
    title: 'SAP FI/CO Architect or Manager',
    location: 'Geneva',
  })
  // The "other users also applied" tile ignores the query, so it must not become a result.
  expect(cards.some(c => c.title.includes('Receptionist'))).toBe(false)
})

it('parses the browse view with the same selectors', () => {
  const cards = parseList(fixture('michaelpage-browse.html'))
  expect(cards.map(c => c.sourceJobId)).toEqual(['jn-082026-7082972', 'jn-052026-7026478', 'jn-082026-7082789'])
  // Titles come off the .job-title link, not the row's second "View Job" href; `?lang=en` stays on
  // the URL but never reaches the id, which is read off the pathname.
  expect(cards[0]).toEqual({
    sourceJobId: 'jn-082026-7082972',
    url: 'https://www.michaelpage.ch/de/job-detail/key-account-manager-bauwesen100/ref/jn-082026-7082972?lang=en',
    title: 'Key Account Manager (a) (Bauwesen)100%',
    location: 'Zürich',
  })
  expect(cards.some(c => c.title.includes('View Job'))).toBe(false)
})

it('parses description and postedAt out of the detail JSON-LD despite its raw newlines', () => {
  const { description, postedAt } = parseDetail(fixture('michaelpage-detail.html'))
  // Description stays raw HTML — normalize() is the only thing that turns it into text.
  expect(description).toContain('<p>')
  expect(description!.length).toBeGreaterThan(500)
  expect(postedAt).toBeInstanceOf(Date)
  expect(postedAt!.toISOString()).toMatch(/^2026-07-22T/)
})

it('returns nulls rather than throwing when the detail page has no usable JSON-LD', () => {
  const empty = { description: null, postedAt: null }
  expect(parseDetail('<html><body>gone</body></html>')).toEqual(empty)
  expect(parseDetail('<script type="application/ld+json">{ not json</script>')).toEqual(empty)
  expect(parseDetail('<script type="application/ld+json">{"@type":"WebPage","name":"x"}</script>')).toEqual(empty)
})
