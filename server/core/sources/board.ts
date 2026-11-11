import { setTimeout as sleep } from 'node:timers/promises'
import { requestDelayMs } from '../config/env'
import { httpGet } from '../http'
import type { RawJob, SearchResult, Seen } from '../types'

/**
 * What the paginating, detail-fetching adapters share. Every request is sequential with a delay
 * before it — the pipeline only sleeps *between sources*, so a source making N requests paces itself.
 */

/** `null` for anything absent or unparseable — a missing date is never guessed. */
export function toDate(value: string | number | null | undefined): Date | null {
  const d = new Date(value ?? NaN)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * List pages from `first`, up to `max` of them. A failed *first* page is a real error and belongs to
 * the pipeline's per-source catch; a failed later page (züri.jobs 404s past the last) ends the walk,
 * and so does a page that adds no new id (jobs.ch 301s back to page 1, michaelpage repeats).
 *
 * `seen` must never filter this output: on a repeat run page 1 would then add nothing fresh, the
 * walk would end there, and every deeper page would go permanently unrequested.
 */
export async function walkPages<C extends { sourceJobId: string }>(
  url: (page: number) => string,
  parseList: (html: string) => C[],
  first: number,
  max: number,
): Promise<Map<string, C>> {
  const cards = new Map<string, C>()
  for (let page = first; page < first + max; page++) {
    await sleep(requestDelayMs)
    const html = await httpGet(url(page))
      .then(res => res.text())
      .catch((err: unknown) => {
        if (page === first) throw err
        return null
      })
    if (html === null) break
    const fresh = parseList(html).filter(c => !cards.has(c.sourceJobId))
    if (!fresh.length) break
    for (const c of fresh) cards.set(c.sourceJobId, c)
  }
  return cards
}

/**
 * One detail fetch per *unseen* card. A seen card costs no request and — the point of the exercise —
 * no sleep, and goes to `touched` instead of on as a RawJob: with no description it would rehash the
 * row and strip its verdict. A single dead detail page must not lose the other cards, so it keeps its
 * card with `parseDetail('')` — every adapter's all-null detail — in place of the detail.
 */
export async function fetchDetails<C extends { sourceJobId: string; url: string }, D>(
  cards: Iterable<C>,
  seen: Seen,
  parseDetail: (html: string) => D,
  toJob: (card: C, detail: D) => RawJob,
): Promise<SearchResult> {
  const jobs: RawJob[] = []
  const touched: string[] = []
  for (const card of cards) {
    if (seen(card.sourceJobId)) {
      touched.push(card.sourceJobId)
      continue
    }
    await sleep(requestDelayMs)
    const detail = await httpGet(card.url)
      .then(res => res.text())
      .then(parseDetail)
      .catch(() => parseDetail(''))
    jobs.push(toJob(card, detail))
  }
  return { jobs, touched }
}
