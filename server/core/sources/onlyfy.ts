import { load } from 'cheerio'
import type { Employer } from '../config/employers'
import type { SearchQuery, SearchResult, Seen } from '../types'
import { searchPagedBoards, type PagedCard } from './ats'
import { toDate } from './board'

export const name = 'onlyfy'

/**
 * `{token}.onlyfy.jobs`, a Next.js careers page with `data-testid` hooks. No API: the list is
 * server-rendered HTML, and the posting page loads the ad itself in an iframe from
 * `/job/show/{id}/full`, a separate server-rendered page — which is what we fetch.
 */
export function listUrl({ token }: Employer, page: number): string {
  return `https://${token}.onlyfy.jobs/en?page=${page}`
}

/**
 * `job-more-info` is `City | employment type | dd.mm.yyyy`; the city has no country. `url` is the
 * ad iframe.
 */
export function parseList(html: string, { token }: Employer): PagedCard[] {
  const $ = load(html)
  const out: PagedCard[] = []
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
 */
export const search = (_query: SearchQuery, seen: Seen): Promise<SearchResult> =>
  searchPagedBoards(name, seen, listUrl, parseList, parseDetail, 1, 20)
