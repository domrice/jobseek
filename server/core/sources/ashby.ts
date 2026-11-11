import type { Employer } from '../config/employers'
import type { RawJob } from '../types'
import { searchBoards, swissPlace } from './ats'
import { toDate } from './board'

const BASE = 'https://api.ashbyhq.com/posting-api/job-board'
export const name = 'ashby'

/**
 * The public job-board API: one request, whole board, `descriptionHtml` inline — the greenhouse
 * shape again. `includeCompensation` is left off; there is no salary column to put it in.
 */
export function listUrl({ token }: Employer): string {
  return `${BASE}/${encodeURIComponent(token)}`
}

interface AsLocation {
  location?: string | null
  address?: { postalAddress?: { addressCountry?: string | null; addressLocality?: string | null } | null } | null
}

/** Only the fields read below. */
interface AsJob extends AsLocation {
  id?: string
  title?: string
  jobUrl?: string
  descriptionHtml?: string | null
  publishedAt?: string | null
  isListed?: boolean
  secondaryLocations?: AsLocation[] | null
}

/** Every string one location record can offer: its label, its country and its city. */
const strings = (l: AsLocation | undefined | null): (string | null | undefined)[] => [
  l?.location,
  l?.address?.postalAddress?.addressCountry,
  l?.address?.postalAddress?.addressLocality,
]

export function parseBoard(json: unknown, employer: Employer): RawJob[] {
  const out: RawJob[] = []
  for (const job of (json as { jobs?: AsJob[] } | null)?.jobs ?? []) {
    if (!job.id || !job.title || !job.jobUrl) continue
    // Ashby marks a posting it is no longer showing; there is no reason for us to show it either.
    if (job.isListed === false) continue

    // `secondaryLocations` are the *job's* other locations, not the company's offices, so they are
    // OR-ed in — the opposite of greenhouse, and load-bearing: Langfuse's Zurich role declares
    // `location: "Europe"` and names Zurich only here. Reading the primary alone loses it.
    // The first Swiss string is also what gets shown: the primary label when it is Swiss (it comes
    // first), else e.g. DeepJudge's nested `addressCountry: "Switzerland"` over "Multiple Locations".
    const shown = [job, ...(job.secondaryLocations ?? [])].flatMap(strings).find(swissPlace)
    if (!shown) continue

    out.push({
      source: name,
      sourceJobId: `${employer.token}:${job.id}`,
      url: job.jobUrl,
      title: job.title,
      company: employer.company,
      location: shown.trim(),
      description: job.descriptionHtml || null,
      postedAt: toDate(job.publishedAt),
    })
  }
  return out
}

export const search = () => searchBoards('ashby', listUrl, parseBoard)
