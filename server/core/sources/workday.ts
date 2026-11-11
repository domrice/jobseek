import { setTimeout as sleep } from 'node:timers/promises'
import type { Employer } from '../config/employers'
import { requestDelayMs } from '../config/env'
import { httpPostJson } from '../http'
import type { SearchQuery, SearchResult, Seen } from '../types'
import { eachEmployer, swissPlace } from './ats'
import { fetchDetails, toDate } from './board'

export const name = 'workday'
const PAGE = 20

/**
 * The JSON endpoints behind every `{tenant}.wdN.myworkdayjobs.com/{site}` careers page. Undocumented
 * but unauthenticated: the list is a POST, each posting a GET. The token is `{tenant}.wdN/{site}`,
 * the two things the hostname and path need — a tenant can run several sites.
 */
export function endpoints(token: string) {
  const [host, site] = token.split('/') as [string, string]
  const origin = `https://${host}.myworkdayjobs.com`
  const api = `${origin}/wday/cxs/${host.split('.')[0]}/${site}`
  return { api, page: `${origin}/${site}` }
}

interface WdFacet {
  facetParameter?: string
  descriptor?: string
  id?: string
  values?: WdFacet[]
}

interface WdList {
  total?: number
  facets?: WdFacet[]
  jobPostings?: { title?: string; externalPath?: string; locationsText?: string }[]
}

/** Every leaf facet, flattened: the location facets sit one level down under `locationMainGroup`. */
function leaves(facets: WdFacet[] = []): WdFacet[] {
  return facets.flatMap(f => (f.values?.some(v => v.values) ? leaves(f.values) : [f]))
}

/**
 * The Swiss filter, sent to Workday rather than applied to the cards: a multi-site posting's card
 * says only "2 Locations". Facets differ per tenant — Novartis has `locationCountry`, Roche only
 * per-city `locations` — so the country facet wins when present. Region facets are never used (ABB's
 * `Zurich` region sits beside `Baden-Wurttemberg`). Facets list only values with postings, so `null`
 * means this tenant has nothing Swiss open, not that the filter failed.
 */
export function swissFacets(json: unknown): Record<string, string[]> | null {
  const all = leaves((json as WdList | null)?.facets)
  for (const param of ['locationCountry', 'locations']) {
    const ids = all
      .find(f => f.facetParameter === param)
      ?.values?.filter(v => v.id && swissPlace(v.descriptor))
      .map(v => v.id!)
    if (ids?.length) return { [param]: ids }
  }
  return null
}

interface Card {
  sourceJobId: string
  /** The detail *API* url — `fetchDetails` GETs `url`; `page` is the public posting. */
  url: string
  page: string
  title: string
  location: string | null
}

export function parseList(json: unknown, { token }: Employer): Card[] {
  const { api, page } = endpoints(token)
  const out: Card[] = []
  for (const j of (json as WdList | null)?.jobPostings ?? []) {
    if (!j.externalPath || !j.title) continue
    out.push({
      // The path's last segment is the posting id (`Title_202608-121188`); the req id alone is not
      // unique — one req can carry several postings (`…-1`).
      sourceJobId: `${token}:${j.externalPath.split('/').pop()}`,
      url: api + j.externalPath,
      page: page + j.externalPath,
      title: j.title,
      // "2 Locations" is a count, not a place.
      location: /^\d+ Locations$/.test(j.locationsText ?? '') ? null : j.locationsText?.trim() || null,
    })
  }
  return out
}

export function parseDetail(text: string) {
  let info: {
    jobDescription?: string
    location?: string
    additionalLocations?: string[]
    startDate?: string
  } = {}
  try {
    info = JSON.parse(text).jobPostingInfo ?? {}
  } catch {}
  // A multi-site posting's primary site can be Boston; the Swiss facet admitted it, so show the
  // Swiss site.
  const sites = [info.location, ...(info.additionalLocations ?? [])]
  return {
    description: info.jobDescription || null,
    location: (sites.find(swissPlace) ?? info.location)?.trim() || null,
    // `startDate` is the posting's go-live date; `postedOn` is only "Posted 30+ Days Ago".
    postedAt: toDate(info.startDate),
  }
}

async function postList(list: string, appliedFacets: Record<string, string[]>, offset: number) {
  await sleep(requestDelayMs)
  return httpPostJson<WdList>(list, { appliedFacets, limit: PAGE, offset, searchText: '' })
}

/**
 * One unfiltered POST to read the facets, then the Swiss-filtered pages, then a detail GET per
 * unseen card — so `seen`/`touched` are live here, unlike the other ATS platforms.
 */
async function searchEmployer(employer: Employer, seen: Seen): Promise<SearchResult> {
  const list = `${endpoints(employer.token).api}/jobs`
  const facets = swissFacets(await postList(list, {}, 0))
  if (!facets) return { jobs: [], touched: [] }

  // Only the first page carries `total`; later pages report 0.
  const first = await postList(list, facets, 0)
  // Keyed by id: offset paging over a live list can repeat a posting across pages. A failed later
  // page ends the walk, as in `walkPages` — Workday throttles fast paging, and a 429 on page 5 must
  // not cost pages 1–4.
  const cards = new Map(parseList(first, employer).map(c => [c.sourceJobId, c]))
  for (let offset = PAGE; offset < (first.total ?? 0); offset += PAGE) {
    const page = await postList(list, facets, offset).catch(() => null)
    if (!page) break
    for (const c of parseList(page, employer)) cards.set(c.sourceJobId, c)
  }

  return fetchDetails(cards.values(), seen, parseDetail, (card, d) => ({
    source: name,
    sourceJobId: card.sourceJobId,
    url: card.page,
    title: card.title,
    company: employer.company,
    location: d.location ?? card.location,
    description: d.description,
    postedAt: d.postedAt,
  }))
}

export const search = (_query: SearchQuery, seen: Seen): Promise<SearchResult> =>
  eachEmployer('workday', employer => searchEmployer(employer, seen))
