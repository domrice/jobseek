import type { RawJob, SearchQuery, SearchResult, Seen } from '../types'
import { fetchDetails, toDate, walkPages } from './board'
import { jobPostingLd, jobPostingsLd } from './jsonld'

const BASE = 'https://www.jobs.ch'
const MAX_PAGES = 10
export const name = 'jobs.ch'

/** A list card. Only the description comes from the detail page — the card carries the rest. */
type Card = Pick<RawJob, 'sourceJobId' | 'url' | 'title' | 'company' | 'location' | 'postedAt'>

/**
 * `term` and `location` both filter server-side, checked by diffing unrelated queries on 2026-08-23:
 * `term=architect` and `term=nurse` share none of their 20 ids, and `location=Geneva` changes 18 of
 * them. `page` is 1-indexed, 20 rows a page, omitted on the first page.
 *
 * ponytail: `remoteOnly` is dropped. Ceiling: home-office postings are not preferred. Upgrade path:
 * none — the site's home-office facet is a `feat=` parameter, and robots.txt disallows `/*?*feat=`.
 */
export function listUrl({ query, location }: SearchQuery, page = 1): string {
  const u = new URL('/en/vacancies/', BASE)
  u.searchParams.set('term', query)
  if (location) u.searchParams.set('location', location)
  if (page > 1) u.searchParams.set('page', String(page))
  return u.toString()
}

/**
 * The result cards are the page's own JSON-LD `ItemList`, not the markup: every entry is a full
 * `JobPosting` with the id, absolute URL, title, company, locality and `datePosted`. Nothing is read
 * out of the class soup, and the `WebSite`/`CollectionPage` blocks beside the list are not
 * JobPostings so they never reach here.
 *
 * Its `description` is a generated stub ("We are looking for a X to join our team."), which is the
 * one and only reason the detail page is fetched at all.
 *
 * Ids are deduped: two promoted cards ride along on every page of a query.
 */
export function parseList(html: string): Card[] {
  const out = new Map<string, Card>()
  for (const ld of jobPostingsLd(html)) {
    const sourceJobId = ld.identifier?.value
    if (!sourceJobId || !ld.url || !ld.title || out.has(sourceJobId)) continue
    out.set(sourceJobId, {
      sourceJobId,
      url: new URL(ld.url, BASE).toString(),
      title: ld.title,
      company: ld.hiringOrganization?.name ?? null,
      location: ld.jobLocation?.address?.addressLocality ?? null,
      postedAt: toDate(ld.datePosted),
    })
  }
  return [...out.values()]
}

/**
 * The description, raw HTML — normalize() owns htmlToText — plus the city, which is what the *card*
 * most often lacks: two thirds of a page's cards ship an address with only `addressCountry`, while
 * the detail page names the city in `addressRegion` (not `addressLocality`, which it omits). Both
 * spellings are read here and the card still wins in `search`, so neither source of the field can
 * null out the other. Company and postedAt are not re-read: the card always has them.
 */
export function parseDetail(html: string): Pick<RawJob, 'description' | 'location'> {
  const ld = jobPostingLd(html)
  const address = ld?.jobLocation?.address
  return {
    description: ld?.description ?? null,
    location: address?.addressLocality ?? address?.addressRegion ?? null,
  }
}

/**
 * Up to 10 list pages, then one detail fetch per *unseen* card. Past the last page jobs.ch
 * 301-redirects to page 1 instead of answering 404, so the walk ends on the "no new ids" test.
 *
 * ponytail: the page walk still costs 10 requests every run, and caps a query at 200 rows ("architect"
 * reports 424). Ceiling: ~20s of list pages before the first new posting is fetched. Upgrade path:
 * stop early on K consecutive known ids — sound here only if the listing is newest-first, which is
 * unverified (`datePosted` per card would make it checkable offline).
 */
export async function search(query: SearchQuery, seen: Seen): Promise<SearchResult> {
  const cards = await walkPages(page => listUrl(query, page), parseList, 1, MAX_PAGES)
  // The card's location wins where it has one — it is the site's own `addressLocality`.
  return fetchDetails(cards.values(), seen, parseDetail, (card, detail) => ({
    source: name,
    ...card,
    ...detail,
    location: card.location ?? detail.location,
  }))
}
