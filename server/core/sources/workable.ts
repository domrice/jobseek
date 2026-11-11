import type { Employer } from '../config/employers'
import type { RawJob } from '../types'
import { searchBoards, swissPlace } from './ats'
import { toDate } from './board'

const BASE = 'https://apply.workable.com/api/v1/widget/accounts'
export const name = 'workable'

/**
 * The public board widget's own endpoint: one request, whole account, `details=true` for the
 * descriptions — the greenhouse shape again, no authentication. No search endpoint, so the query is
 * dropped and coverage is the employer list.
 */
export function listUrl({ token }: Employer): string {
  return `${BASE}/${encodeURIComponent(token)}?details=true`
}

interface WkLocation {
  city?: string | null
  country?: string | null
  region?: string | null
}

/** Only the fields read below. */
interface WkJob extends WkLocation {
  title?: string
  shortcode?: string
  url?: string
  shortlink?: string
  state?: string | null
  locations?: WkLocation[] | null
  description?: string | null
  published_on?: string | null
  created_at?: string | null
}

export function parseBoard(json: unknown, employer: Employer): RawJob[] {
  const out: RawJob[] = []
  for (const job of (json as { jobs?: WkJob[] } | null)?.jobs ?? []) {
    if (!job.shortcode || !job.title) continue
    const url = job.url ?? job.shortlink
    if (!url) continue

    // `country` is spelled out ("Switzerland"), not an ISO code, and `locations` is the multi-site
    // list — all of them the job's own places, so ORing is right.
    const places = [
      job.city,
      job.country,
      job.state,
      ...(job.locations ?? []).flatMap(l => [l.city, l.country, l.region]),
    ]
    if (!places.some(swissPlace)) continue

    out.push({
      source: name,
      // The shortcode is unique per account, not globally, so it carries the token like the rest.
      sourceJobId: `${employer.token}:${job.shortcode}`,
      url,
      title: job.title,
      company: employer.company,
      location: job.city?.trim() || job.state?.trim() || job.country?.trim() || null,
      // One field here — unlike lever and recruitee, Workable does not split off requirements.
      description: job.description || null,
      // `published_on` is when it went live; `created_at` can predate that by a year on a req that
      // sat in draft, and the LLM age cap reads this column.
      postedAt: toDate(job.published_on) ?? toDate(job.created_at),
    })
  }
  return out
}

export const search = () => searchBoards('workable', listUrl, parseBoard)
