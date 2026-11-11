import { load } from 'cheerio'
import { httpGet } from '../http'
import type { RawJob, SearchQuery, SearchResult, Seen } from '../types'
import { fetchDetails, toDate, walkPages } from './board'
import { jobPostingLd } from './jsonld'

const BASE = 'https://www.michaelpage.ch'
/** Browse pages, 30 rows each — only walked when the query has no landing page. */
const MAX_PAGES = 5
export const name = 'michaelpage'

/** A list card. Description and postedAt come from the detail JSON-LD. */
type Card = Pick<RawJob, 'sourceJobId' | 'url' | 'title' | 'location'>

/**
 * Two shapes, one function.
 *
 * `page === undefined` is the **landing-page attempt**: `?search=X` 302-redirects to `/jobs/{x}`, a
 * curated page that exists for `architect` and `finance-manager` and 404s for `architekt`,
 * `bauleiter` and `data engineer`. It holds ~7 rows and has no pagination at all — `/jobs/architect
 * ?page=1` 404s. The view's exposed filter really is `search` and **not** `keywords`:
 * `?keywords=architect` and `?keywords=nurse` return byte-identical listings, so `keywords` is inert
 * — exactly the trap jobscout24's `SearchWhere` set.
 *
 * A `page` gives the **browse walk**: the unredirected `/jobs`, 30 rows a page, `page` 0-indexed
 * (unlike züri.jobs) and omitted for page 0. `search` must not be sent here — it would 302 straight
 * back into the landing page and its 404. `location` filters for real (`?location=zurich` returns
 * Zürich rows only) and does not redirect.
 */
export function listUrl({ query, location }: SearchQuery, page?: number): string {
  const u = new URL('/jobs', BASE)
  if (page === undefined) u.searchParams.set('search', query)
  if (location) u.searchParams.set('location', location)
  if (page) u.searchParams.set('page', String(page))
  return u.toString()
}

/**
 * Search results, both shapes — the landing page and a browse page use the same view markup.
 *
 * An "other users also applied" tile ignores the query and shows up only when the result set is
 * small, so it is not a result — the same call as jobscout24's paid `data-view-source` cards. Those
 * tiles sit in a bare `li` outside `.views-row`, so the scope drops them.
 *
 * The title is `h3` today and `h2` on some rows historically, so both are read.
 *
 * The id is the posting's own reference (`/job-detail/{slug}/ref/jn-082026-7085549`), not the slug:
 * the slug is a title the agency can reword, the ref is what the ATS keys on. It comes off
 * `pathname`, which is what keeps the live `?lang=en` off the end of the id.
 */
export function parseList(html: string): Card[] {
  const $ = load(html)
  const out = new Map<string, Card>()
  for (const el of $('.view-content .views-row').toArray()) {
    const row = $(el)
    const link = row.find('.job-title h3 a[href], .job-title h2 a[href]').first()
    const href = link.attr('href')
    const title = link.text().trim()
    if (!href || !title) continue
    const url = new URL(href, BASE)
    const sourceJobId = url.pathname.split('/ref/')[1]
    if (!sourceJobId || out.has(sourceJobId)) continue
    out.set(sourceJobId, {
      sourceJobId,
      url: url.toString(),
      title,
      location: row.find('.job-location').first().text().replace(/\s+/g, ' ').trim() || null,
    })
  }
  return [...out.values()]
}

/**
 * Description and postedAt from the detail page's JSON-LD `JobPosting`; its raw newlines inside
 * JSON strings are why jobPostingLd strips control characters.
 *
 * ponytail: company is deliberately not read. Ceiling: the employer is never stored for this
 * source. `hiringOrganization` is always "Michael Page" — the agency, not the employer, because the
 * postings are anonymised client mandates — so storing it would put a false company on every row.
 * null renders as `—`. Upgrade path: none; the page does not name the client.
 */
export function parseDetail(html: string): Pick<RawJob, 'description' | 'postedAt'> {
  const ld = jobPostingLd(html)
  return { description: ld?.description ?? null, postedAt: toDate(ld?.datePosted) }
}

/**
 * The curated landing page first, the browse walk as the fallback, then one detail fetch per *unseen*
 * card.
 *
 * A landing-page 404 is this source's "no page for that term", not a failure, so it does not throw:
 * every non-English query would otherwise fill pipeline_runs.errors.
 *
 * `seen` gates the detail fetch and nothing else. Filtering the landing cards with it would send a
 * perfectly good landing page down the browse path.
 *
 * ponytail: the fallback is filtered by `location` only — the query does not constrain it, so those
 * rows arrive as board noise that keyword scoring ranks. Ceiling: MAX_PAGES × 30 cards, and a query
 * with its own landing page never sees more than that page's ~7 rows. That is the price of answering
 * a query outside Michael Page's English vocabulary at all. Upgrade path: Playwright for the site's
 * real keyword search, which is a JS "show more" widget — not this file.
 */
export async function search(query: SearchQuery, seen: Seen): Promise<SearchResult> {
  const res = await httpGet(listUrl(query)).catch((err: Error) => {
    if (err.message.includes('404')) return null
    throw err
  })
  const landing = res ? parseList(await res.text()) : []
  // No landing page for this term (or an empty one): browse instead, pages 0-indexed.
  const cards = landing.length
    ? landing
    : (await walkPages(page => listUrl(query, page), parseList, 0, MAX_PAGES)).values()
  return fetchDetails(cards, seen, parseDetail, (card, detail) => ({ source: name, company: null, ...card, ...detail }))
}
