import type { Employer } from '../config/employers'
import type { SearchQuery, SearchResult, Seen } from '../types'
import { searchPagedBoards, type PagedCard } from './ats'

export const name = 'eightfold'
const PAGE = 10

/**
 * An Eightfold careers site (`{host}/careers`): its page calls `/api/pcsx/search` and
 * `/api/pcsx/position_details`, JSON, no auth. The tenant is a `domain` parameter that need not
 * match the host (`jobs.on.com` serves `on.com`), so the token is `{host}/{domain}`.
 */
function tenant(token: string) {
  const [host, domain] = token.split('/') as [string, string]
  return { origin: `https://${host}`, domain }
}

/**
 * `location=Switzerland` filters server-side (diffed: Switzerland 69, Tokyo 14, none 179), but by
 * radius, so the Swiss test still runs on the cards. The page size is fixed at 10 (`num` is
 * ignored) and past the end `positions` is empty, which ends `walkPages`.
 */
export function listUrl({ token }: Employer, page: number): string {
  const { origin, domain } = tenant(token)
  return `${origin}/api/pcsx/search?domain=${domain}&query=&location=Switzerland&start=${page * PAGE}`
}

interface EfPosition {
  id: number
  name: string
  locations?: string[]
  /** Unix seconds; `creationTs` is when the req was opened, before it went public. */
  postedTs?: number
}

export function parseList(text: string, { token }: Employer): PagedCard[] {
  const { origin, domain } = tenant(token)
  return ((JSON.parse(text) as { data?: { positions?: EfPosition[] } }).data?.positions ?? []).map(p => ({
    sourceJobId: `${token}:${p.id}`,
    url: `${origin}/api/pcsx/position_details?position_id=${p.id}&domain=${domain}&hl=en`,
    page: `${origin}/careers/job/${p.id}`,
    title: p.name.trim(),
    location: p.locations?.join('; ') || null,
    postedAt: p.postedTs ? new Date(p.postedTs * 1000) : null,
  }))
}

export function parseDetail(text: string) {
  let description: string | undefined
  try {
    description = JSON.parse(text).data.jobDescription
  } catch {}
  return { description: description || null }
}

export const search = (_query: SearchQuery, seen: Seen): Promise<SearchResult> =>
  searchPagedBoards(name, seen, listUrl, parseList, parseDetail, 0, 30)
