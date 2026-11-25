import type { Employer } from '../config/employers'
import type { SearchQuery, SearchResult, Seen } from '../types'
import { searchPagedBoards, type PagedCard } from './ats'
import { toDate } from './board'
import { jobPostingLd } from './jsonld'

export const name = 'breezy'

/**
 * `{token}.breezy.hr/json` is the public feed Breezy serves for embedding a board: the whole account
 * in one unpaged request, no auth, but no description — that is the posting page's JSON-LD.
 */
export function listUrl({ token }: Employer): string {
  return `https://${token}.breezy.hr/json`
}

interface BzPosition {
  id: string
  name: string
  url: string
  published_date?: string
  /** `name` is `City, ST` — a state code, no country — so the country is appended for `swissPlace`. */
  locations?: { name?: string; country?: { name?: string } }[]
}

/** Breezy boards carry the open-application form as a posting; it has no location, so `swissPlace` keeps it. */
const OPEN_APPLICATION = /\b(spontaneous|unsolicited) application\b/i

export function parseList(text: string, { token }: Employer): PagedCard[] {
  return (JSON.parse(text) as BzPosition[])
    .filter(p => !OPEN_APPLICATION.test(p.name))
    .map(p => ({
      sourceJobId: `${token}:${p.id}`,
      url: p.url,
      page: p.url,
      title: p.name.trim(),
      location: p.locations?.map(l => [l.name, l.country?.name].filter(Boolean).join(', ')).join('; ') || null,
      postedAt: toDate(p.published_date),
    }))
}

export function parseDetail(html: string) {
  return { description: jobPostingLd(html)?.description || null }
}

export const search = (_query: SearchQuery, seen: Seen): Promise<SearchResult> =>
  searchPagedBoards(name, seen, listUrl, parseList, parseDetail, 0, 1)
