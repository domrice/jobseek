import { load } from 'cheerio'
import type { RawJob, SearchQuery, SearchResult, Seen } from '../types'
import { fetchDetails, toDate, walkPages } from './board'
import { jobPostingLd } from './jsonld'

const BASE = 'https://www.zueri.jobs'
const MAX_PAGES = 10
export const name = 'zueri.jobs'

/** A list card. Company, location, description and postedAt come from the detail JSON-LD. */
type Card = Pick<RawJob, 'sourceJobId' | 'url' | 'title'>

/**
 * `q` filters, and it filters server-side: `q=pflege` returns 50 nursing cards in the served
 * markup, `q=architekt` four architecture ones. `page` is 1-indexed and omitted on the first page.
 *
 * ponytail: `l` and `remoteOnly` are dropped. Ceiling: countrywide-as-the-site-defines-it, which is
 * greater Zürich anyway. `l=Zürich` produced no measurable change (both runs hit the 50-per-page
 * cap), so sending it would be cargo cult. Location stays a display column and a LIKE filter.
 */
export function listUrl({ query }: SearchQuery, page = 1): string {
  const u = new URL('/jobs', BASE)
  u.searchParams.set('q', query)
  if (page > 1) u.searchParams.set('page', String(page))
  return u.toString()
}

/**
 * Search results. Cards carry `data-jobId`; the title link is the only href on the card that points
 * at the posting (`/jobs/{id}-{slug}`) — `/jobs/{id}/apply` and the `/companies/…` link are not it.
 * Ids are deduped because a card can repeat across the featured and organic blocks.
 */
export function parseList(html: string): Card[] {
  const $ = load(html)
  const out = new Map<string, Card>()
  for (const el of $('[data-jobId]').toArray()) {
    const card = $(el)
    const sourceJobId = card.attr('data-jobid')!
    const link = card.find('a.job-details-link[href]').first()
    const href = link.attr('href')
    const title = link.text().trim()
    if (!sourceJobId || !href || !title || out.has(sourceJobId)) continue
    out.set(sourceJobId, { sourceJobId, url: new URL(href, BASE).toString(), title })
  }
  return [...out.values()]
}

/**
 * The detail page's JSON-LD `JobPosting` carries everything the card does not. The description
 * stays raw HTML — normalize() owns htmlToText. Any missing field is null, never guessed.
 */
export function parseDetail(html: string): Pick<RawJob, 'company' | 'location' | 'description' | 'postedAt'> {
  const ld = jobPostingLd(html)
  return {
    company: ld?.hiringOrganization?.name ?? null,
    location: ld?.jobLocation?.address?.addressLocality ?? null,
    description: ld?.description ?? null,
    postedAt: toDate(ld?.datePosted),
  }
}

/**
 * Up to 10 list pages (past the last the site answers 404), then one detail fetch per *unseen* card.
 *
 * ponytail: the page walk still costs 10 requests every run. Ceiling: ~20s of list pages before the
 * first new posting is fetched. Upgrade path: stop early on K consecutive known ids — only sound if
 * the listing is sorted newest-first, which is unverified here.
 */
export async function search(query: SearchQuery, seen: Seen): Promise<SearchResult> {
  const cards = await walkPages(page => listUrl(query, page), parseList, 1, MAX_PAGES)
  return fetchDetails(cards.values(), seen, parseDetail, (card, detail) => ({ source: name, ...card, ...detail }))
}
