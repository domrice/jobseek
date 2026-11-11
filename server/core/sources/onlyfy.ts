import { load } from 'cheerio'
import type { Employer } from '../config/employers'
import type { SearchQuery, SearchResult, Seen } from '../types'
import { eachEmployer, swissPlace } from './ats'
import { fetchDetails, toDate, walkPages } from './board'

export const name = 'onlyfy'

/**
 * `{token}.onlyfy.jobs`, a Next.js careers page with `data-testid` hooks. No API: the list is
 * server-rendered HTML, and the posting page loads the ad itself in an iframe from
 * `/job/show/{id}/full`, a separate server-rendered page — which is what we fetch.
 */
export function listUrl({ token }: Employer, page: number): string {
  return `https://${token}.onlyfy.jobs/en?page=${page}`
}

interface Card {
  sourceJobId: string
  /** The ad iframe — `fetchDetails` GETs `url`; `page` is the public posting. */
  url: string
  page: string
  title: string
  location: string | null
  postedAt: Date | null
}

/** `job-more-info` is `City | employment type | dd.mm.yyyy`; the city has no country. */
export function parseList(html: string, { token }: Employer): Card[] {
  const $ = load(html)
  const out: Card[] = []
  const origin = `https://${token}.onlyfy.jobs`
  $('a[data-testid=job-card]').each((_, a) => {
    const id = $(a).attr('href')?.match(/\/job\/([^/?]+)/)?.[1]
    const title = $(a).find('[data-testid=job-title]').text().trim()
    const [city, , date] = $(a).find('[data-testid=job-more-info]').text().split('|').map(s => s.trim())
    if (!id || !title) return
    out.push({
      sourceJobId: `${token}:${id}`,
      url: `${origin}/job/show/${id}/full?lang=en`,
      page: `${origin}/en/job/${id}`,
      title,
      location: city || null,
      postedAt: date ? toDate(date.split('.').reverse().join('-')) : null,
    })
  })
  return out
}

/** Templates differ per tenant (Hexagon `.job-ad-component`, Leica `#jobAdContainer`), so the whole body. */
export function parseDetail(html: string) {
  const $ = load(html)
  $('script, style, noscript').remove()
  return { description: $('body').html()?.trim() || null }
}

/**
 * Past the last page the site 307s to `/en`, i.e. page 1 again — `walkPages`' "no new ids" break
 * ends the walk, as on jobs.ch. Page size differs per tenant (15, 10), so no count arithmetic.
 * The Swiss test runs after the walk, not in `parseList` — an all-foreign page would otherwise end
 * it — and before the details, so a foreign card costs no request. A card with no city is kept.
 */
async function searchEmployer(employer: Employer, seen: Seen): Promise<SearchResult> {
  const cards = await walkPages(page => listUrl(employer, page), html => parseList(html, employer), 1, 20)
  const swiss = [...cards.values()].filter(c => !c.location || swissPlace(c.location))
  return fetchDetails(swiss, seen, parseDetail, (card, d) => ({
    source: name,
    sourceJobId: card.sourceJobId,
    url: card.page,
    title: card.title,
    company: employer.company,
    location: card.location,
    description: d.description,
    postedAt: card.postedAt,
  }))
}

export const search = (_query: SearchQuery, seen: Seen): Promise<SearchResult> =>
  eachEmployer('onlyfy', employer => searchEmployer(employer, seen))
