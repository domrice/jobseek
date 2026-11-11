import type { Employer } from '../config/employers'
import type { RawJob } from '../types'
import { searchBoards, swissPlace } from './ats'
import { toDate } from './board'

const BASE = 'https://api.lever.co/v0/postings'
export const name = 'lever'

/**
 * `mode=json` returns the whole board as a bare array, descriptions inline — the greenhouse shape
 * with different field names. No search endpoint, so the query is dropped and coverage is the
 * employer list; see [greenhouse.ts](greenhouse.ts) for the reasoning that applies to all three.
 */
export function listUrl({ token }: Employer): string {
  return `${BASE}/${encodeURIComponent(token)}?mode=json`
}

/** Only the fields read below. */
interface LvJob {
  id?: string
  text?: string
  hostedUrl?: string
  createdAt?: number
  country?: string | null
  description?: string | null
  additional?: string | null
  lists?: { text?: string | null; content?: string | null }[] | null
  categories?: { location?: string | null; allLocations?: string[] | null } | null
}

/**
 * Lever splits one posting across four fields: `description` is the intro, `lists` are the titled
 * bullet sections (Requirements, What you'll do), and `additional` is the closing boilerplate. Only
 * the intro is stitched from `description` alone, which would hand the LLM a posting with no
 * requirements in it — the half that decides a match. So all four are concatenated back into one
 * HTML document, `lists` regaining the headings Lever stripped into `text`.
 */
function body(job: LvJob): string | null {
  const parts = [
    job.description ?? '',
    ...(job.lists ?? []).map(l => `${l.text ? `<h3>${l.text}</h3>` : ''}${l.content ?? ''}`),
    job.additional ?? '',
  ]
  return parts.join('') || null
}

export function parseBoard(json: unknown, employer: Employer): RawJob[] {
  // Lever answers with a bare array, not an object — anything else is a board we cannot read.
  if (!Array.isArray(json)) return []

  const out: RawJob[] = []
  for (const job of json as LvJob[]) {
    if (!job.id || !job.text || !job.hostedUrl) continue
    // `allLocations` is the job's own list of places, not the company's offices, so unlike
    // greenhouse it is safe to OR — a role open in Geneva and London is a Geneva role.
    const places = [job.categories?.location, ...(job.categories?.allLocations ?? []), job.country]
    if (!places.some(swissPlace)) continue
    out.push({
      source: name,
      sourceJobId: `${employer.token}:${job.id}`,
      url: job.hostedUrl,
      title: job.text,
      company: employer.company,
      location: job.categories?.location?.trim() || null,
      description: body(job),
      // Epoch milliseconds, unlike the other two platforms' ISO strings.
      postedAt: toDate(job.createdAt),
    })
  }
  return out
}

export const search = () => searchBoards('lever', listUrl, parseBoard)
