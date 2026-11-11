import { WORK_MODE } from './format'

/** UI filter state, as it comes off the URL query and the form inputs. */
export interface Filters {
  profileId?: number
  q?: string
  source?: string
  location?: string
  company?: string
  /** '' when the number input is cleared. */
  minScore?: string | number
  /** 'YYYY-MM-DD' straight from <input type="date">. */
  postedAfter?: string
  /**
   * Freshness as a relative window, so a bookmarked URL does not go stale. Converted to an absolute
   * `firstSeenAfter` on the way out — the query layer stays clock-free and its tests cannot drift.
   */
  firstSeenDays?: string | number
  /** Filtering by work mode excludes rows where the source said nothing. */
  workMode?: 'remote' | 'hybrid' | 'onsite'
  /** 'keyword' = no LLM verdict yet, 'llm' = judged. */
  scored?: 'llm' | 'keyword'
  /** The model's own hedge, at most. '' when the number input is cleared. Excludes unjudged rows. */
  maxConfidence?: string | number
  includeDuplicates?: boolean
  /** 'verdict' (the default) sorts judged postings above unjudged ones. */
  sort?: 'verdict' | 'score' | 'posted' | 'confidence'
  page?: number
}

export const PAGE_SIZE = 50

/** The closed sets a filter select offers, value → label. Also what a URL value is narrowed against. */
export const SCORED = { llm: 'judged by the model', keyword: 'keyword only' } as const
export const SORTS = {
  verdict: 'verdict first',
  score: 'score',
  posted: 'date posted',
  confidence: 'model confidence',
} as const

/** `k` if it is one of `o`'s own keys — so a hand-edited URL cannot send a value the route 400s on. */
const oneOf = <T extends object>(o: T, k?: string) => (k && Object.hasOwn(o, k) ? (k as keyof T) : undefined)

/** route.query values are string | string[] | null; the UI only ever writes single strings. */
const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined)

/** route.query → Filters, with `page` and `sort` always set. */
export function parseFilters(q: Record<string, unknown>) {
  return {
    profileId: Number(q.profileId) || undefined,
    q: str(q.q),
    source: str(q.source),
    location: str(q.location),
    company: str(q.company),
    minScore: str(q.minScore),
    maxConfidence: str(q.maxConfidence),
    postedAfter: str(q.postedAfter),
    firstSeenDays: str(q.firstSeenDays),
    workMode: oneOf(WORK_MODE, str(q.workMode)),
    scored: oneOf(SCORED, str(q.scored)),
    includeDuplicates: q.includeDuplicates === 'true',
    sort: oneOf(SORTS, str(q.sort)) ?? 'verdict',
    page: Number(q.page) || 1,
  }
}

/** A cleared number input is `''`, which must mean "no filter" — while a real `0` must survive. */
const num = (v: string | number | undefined) =>
  String(v ?? '').trim() && Number.isFinite(Number(v)) ? Number(v) : undefined

/**
 * Filters → /api/jobs query params.
 *
 * The route is strict in three ways: `source=` (empty) is a 400 and not "unfiltered",
 * `includeDuplicates` is z.stringbool so it wants 'true', and `postedAfter` must be a
 * date string z.coerce.date() can parse — 'YYYY-MM-DD' qualifies, epoch-ms does not.
 */
export function buildJobQuery(f: Filters): Record<string, string | number> {
  const q: Record<string, string | number> = {}
  if (f.profileId) q.profileId = f.profileId
  for (const k of ['q', 'source', 'location', 'company', 'postedAfter', 'workMode', 'scored'] as const) {
    const v = f[k]?.trim()
    if (v) q[k] = v
  }
  // 'YYYY-MM-DD' parses as UTC midnight, so the window is rounded outwards to whole days —
  // "last 7 days" keeps a job first seen 7 days ago at 23:00. Generous is the right direction here.
  const days = Number(f.firstSeenDays)
  if (Number.isFinite(days) && days > 0) {
    q.firstSeenAfter = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  }
  // `!== ''`, not falsy: minScore=0 and maxConfidence=0 are real filters, not absent ones — which
  // is also why neither can join the string loop above, and why this is not `Number(v) || undefined`.
  const min = num(f.minScore)
  if (min !== undefined) q.minScore = min
  const conf = num(f.maxConfidence)
  if (conf !== undefined) q.maxConfidence = conf
  if (f.includeDuplicates) q.includeDuplicates = 'true'
  if (f.sort) q.sort = f.sort
  q.limit = PAGE_SIZE
  q.offset = (Math.max(1, f.page ?? 1) - 1) * PAGE_SIZE
  return q
}
