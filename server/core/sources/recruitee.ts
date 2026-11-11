import type { Employer } from '../config/employers'
import type { RawJob } from '../types'
import { searchBoards, swissPlace } from './ats'
import { toDate } from './board'

export const name = 'recruitee'

/**
 * Every Recruitee careers site serves its own board at `/api/offers/`, unauthenticated — the
 * greenhouse shape with different field names. robots.txt on those subdomains disallows only `/v/`.
 * No search endpoint, so the query is dropped and coverage is the employer list; see
 * [greenhouse.ts](greenhouse.ts) for the reasoning shared by all of these.
 */
export function listUrl({ token }: Employer): string {
  return `https://${token}.recruitee.com/api/offers/`
}

/** Only the fields read below; an offer carries ~50. */
interface RcOffer {
  id?: number
  title?: string
  careers_url?: string
  status?: string
  city?: string | null
  country?: string | null
  country_code?: string | null
  location?: string | null
  locations?: unknown[] | null
  description?: string | null
  requirements?: string | null
  published_at?: string | null
  created_at?: string | null
}

export function parseBoard(json: unknown, employer: Employer): RawJob[] {
  const out: RawJob[] = []
  for (const offer of (json as { offers?: RcOffer[] } | null)?.offers ?? []) {
    if (offer.id === undefined || !offer.title || !offer.careers_url) continue
    // Recruitee leaves closed and draft offers in the feed; only `published` is live.
    if (offer.status !== undefined && offer.status !== 'published') continue

    // `country_code` is an ISO code, which the Swiss word list cannot match — spell it out. The rest
    // are the job's own place fields, so they are safe to OR.
    const places = [
      offer.city,
      offer.country,
      offer.country_code === 'CH' ? 'Switzerland' : null,
      offer.location,
      ...(offer.locations ?? []).map(l => (typeof l === 'string' ? l : JSON.stringify(l))),
    ]
    if (!places.some(swissPlace)) continue

    out.push({
      source: name,
      sourceJobId: `${employer.token}:${offer.id}`,
      url: offer.careers_url,
      title: offer.title,
      company: employer.company,
      // `city` is the real place; `location` is a display string that is often just "Remote job".
      location: offer.city?.trim() || offer.location?.trim() || null,
      // `requirements` is the half that decides a match; `description` alone is only the pitch.
      description: [offer.description, offer.requirements].join('') || null,
      // `published_at` is when it went live; `created_at` is when someone started drafting it.
      postedAt: toDate(offer.published_at) ?? toDate(offer.created_at),
    })
  }
  return out
}

export const search = () => searchBoards(name, listUrl, parseBoard)
