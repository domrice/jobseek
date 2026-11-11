import { load } from 'cheerio'
import { httpGet } from '../http'
import type { RawJob, SearchQuery, SearchResult, Seen } from '../types'
import { fetchDetails, toDate } from './board'
import { jobPostingLd } from './jsonld'

const BASE = 'https://www.jobscout24.ch'
export const name = 'jobscout24'

/** A list card, before the detail fetch fills in description and postedAt. */
type Card = Pick<RawJob, 'sourceJobId' | 'url' | 'title' | 'company' | 'location'>

/**
 * The search accepts one parameter over GET: `SearchWhat`.
 *
 * ponytail: `location`, `remoteOnly` and pagination are all dropped. Ceiling: one page of ~20
 * organic hits, countrywide. The site's real search is a POST to /en/jobs/search/ carrying
 * `SearchWhere`, region checkboxes and an `__RequestVerificationToken`; over GET those parameters
 * are silently ignored (`SearchWhere=Zurich` still returns Basel and Berne, `page=2` returns page
 * one reshuffled). Upgrade path: GET the form for a token and cookie, then POST — accepted cost is
 * a token-shaped dependency that can break without warning. Meanwhile location stays a display
 * column and a LIKE filter, which is what the UI already does with it.
 */
export function listUrl({ query }: SearchQuery): string {
  const u = new URL('/en/jobs/', BASE)
  u.searchParams.set('SearchWhat', query)
  return u.toString()
}

/**
 * Search results, sponsored placements dropped. A card carrying `data-view-source`
 * (`toplisting`/`bottomlisting`) is paid and unrelated to the query — a search for "architect"
 * returns nursing jobs in those slots — so it is not a result. Organic cards carry no such
 * attribute. Ids are deduped because the same paid card can appear top and bottom.
 */
export function parseList(html: string): Card[] {
  const $ = load(html)
  const out = new Map<string, Card>()
  for (const el of $('li.job-list-item[data-job-id]').toArray()) {
    const li = $(el)
    if (li.attr('data-view-source')) continue
    const sourceJobId = li.attr('data-job-id')!
    const href = li.attr('data-job-detail-url')
    const title = li.find('a.job-title').first().text().trim()
    if (!href || !title || out.has(sourceJobId)) continue
    const parts = li
      .find('p.job-attributes span')
      .map((_, s) => $(s).text().trim())
      .toArray()
    out.set(sourceJobId, {
      sourceJobId,
      url: new URL(href, BASE).toString(),
      title,
      company: parts[0] || null,
      location: parts[1] || null,
    })
  }
  return [...out.values()]
}

/**
 * Description and postedAt from the detail page's JSON-LD `JobPosting`. The description stays HTML
 * — normalize() runs htmlToText over it. An unparseable or absent date is null, never guessed.
 */
export function parseDetail(html: string): Pick<RawJob, 'description' | 'postedAt'> {
  const ld = jobPostingLd(html)
  return { description: ld?.description ?? null, postedAt: toDate(ld?.datePosted) }
}

/** One list fetch, then one detail fetch per *unseen* card. */
export async function search(query: SearchQuery, seen: Seen): Promise<SearchResult> {
  const cards = parseList(await (await httpGet(listUrl(query))).text())
  return fetchDetails(cards, seen, parseDetail, (card, detail) => ({ source: name, ...card, ...detail }))
}
