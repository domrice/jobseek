import { load } from 'cheerio'
import type { Employer } from '../config/employers'
import type { RawJob } from '../types'
import { searchBoards, swissPlace } from './ats'
import { toDate } from './board'

const BASE = 'https://boards-api.greenhouse.io/v1/boards'
export const name = 'greenhouse'

/**
 * One request returns a whole company's board with descriptions inline, so this source has no detail
 * step, no `parseDetail`, and `touched` is always empty — the swissdevjobs shape.
 *
 * There are no query parameters beyond `content`: a Greenhouse board is one employer's open reqs and
 * has no search endpoint, so the parameter-diff check does not apply (there is nothing to diff), and
 * `query`/`location`/`remoteOnly` are dropped exactly as swissdevjobs drops them.
 * Coverage is the employer list; keyword scoring does the filtering.
 */
export function listUrl({ token }: Employer): string {
  return `${BASE}/${encodeURIComponent(token)}/jobs?content=true`
}

/** Only the fields read below; the board sends ~20 more per job. */
interface GhJob {
  id?: number
  title?: string
  absolute_url?: string
  content?: string
  first_published?: string | null
  updated_at?: string | null
  location?: { name?: string | null } | null
  offices?: { location?: string | null }[] | null
}

/**
 * `location.name` is what the posting itself declares and is authoritative whenever it is present —
 * `offices` is the *company's* office list, not the job's, so a Datadog role in Lisbon at a firm with
 * a Zurich office reads as Swiss if the two are merely OR-ed. That was measured, not imagined: on the
 * first live run 15 of 187 stored rows were Paris, Lisbon, Warsaw and Tampere postings admitted by
 * their employer's Zurich entry.
 *
 * Offices are still read, but only as a fallback for a posting that declares no location at all —
 * there, the office list is the only evidence there is, and using it costs nothing that was not
 * already going to be dropped. (Ashby is the opposite case and ORs, because its `secondaryLocations`
 * belong to the job.)
 */
function isSwiss(job: GhJob): boolean {
  const declared = job.location?.name
  if (declared?.trim()) return swissPlace(declared)
  return (job.offices ?? []).some(o => swissPlace(o.location))
}

/**
 * `content` arrives HTML-escaped (`&lt;p&gt;`), so it is decoded exactly once — cheerio parses the
 * escaped string as text and `.text()` hands back the markup with its *inner* entities (`&nbsp;`,
 * `&amp;`) still encoded, which is what `normalize()`'s htmlToText expects to receive. Decoding twice
 * would corrupt a posting that legitimately writes `&amp;lt;`.
 */
export function parseBoard(json: unknown, employer: Employer): RawJob[] {
  const out: RawJob[] = []
  for (const job of (json as { jobs?: GhJob[] } | null)?.jobs ?? []) {
    if (job.id === undefined || !job.title || !job.absolute_url || !isSwiss(job)) continue
    out.push({
      source: name,
      // One registry source spans many boards, so the identity key must carry the board: Greenhouse
      // ids look global today, and `UNIQUE(source, sourceJobId)` must not rest on that holding.
      sourceJobId: `${employer.token}:${job.id}`,
      url: job.absolute_url,
      title: job.title,
      // From the employer entry, never the feed: a Greenhouse board has no company field at the top
      // level and the per-job `company_name` is the ATS tenant's spelling.
      company: employer.company,
      location: job.location?.name?.trim() || null,
      description: job.content ? load(job.content).root().text() || null : null,
      // `first_published` is when the posting went up; `updated_at` moves on every edit and would
      // keep re-dating an old req. The LLM age cap reads this column, so the distinction is real.
      postedAt: toDate(job.first_published) ?? toDate(job.updated_at),
    })
  }
  return out
}

export const search = () => searchBoards('greenhouse', listUrl, parseBoard)
