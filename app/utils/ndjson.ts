import type { Progress } from '~~/server/core/types'
/**
 * Read an NDJSON response line by line. The only place in the app that reads a stream — and the
 * reason the run and rescore calls use native `fetch` rather than `$fetch`, which buffers the whole
 * body and so would deliver every progress event after the run had already finished.
 *
 * The buffer is the whole point: a chunk boundary falls wherever the network puts it, never on a
 * newline, so the tail of a chunk is held over until the next one completes it.
 */
export async function* ndjson<T>(res: Response): AsyncGenerator<T> {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += value
    const lines = buf.split('\n')
    buf = lines.pop()!
    for (const l of lines) if (l) yield JSON.parse(l) as T
  }
}

/**
 * What a run reports, plus the two lines only the route emits. `Progress` itself, not a copy of it:
 * the three progress lines are the server's own definition and were restated here until a field was
 * added to one of them and only the server half knew.
 */
export type RunEvent<R> = Progress | { phase: 'done'; result: R } | { phase: 'error'; message: string }

/**
 * How many times a scoring pass announces itself. The label below feeds a `role="status"` live
 * region, which reads its whole subtree on every change — so the per-posting count that used to
 * live here was ~590 announcements over a 49-minute pass, i.e. a screen reader made unusable by the
 * one operation whose progress matters most. Quarters is four. The exact count is still on screen,
 * in a sibling *outside* the live region, where it can be read on demand instead of being spoken.
 */
const ANNOUNCEMENTS = 4

/**
 * The coarse, rare words: what phase this is and roughly how far in. `undefined` for an event that
 * is not a milestone, which the caller reads as "keep saying what you were saying".
 */
export const progressLabel = (e: RunEvent<unknown>) =>
  e.phase === 'source'
    ? `fetching ${e.name} (${e.index}/${e.total})`
    : e.phase === 'llm'
      ? llmLabel(e.done, e.total)
      : e.phase === 'write'
        ? 'writing…'
        : undefined

/** Start, then once per quarter. `done` is postings *completed*, so event 0 is the start. */
const llmLabel = (done: number, total: number) =>
  done === 0
    ? `judging ${total} posting${total === 1 ? '' : 's'}`
    : Math.floor((done / total) * ANNOUNCEMENTS) > Math.floor(((done - 1) / total) * ANNOUNCEMENTS)
      ? `judged ${done} of ${total}`
      : undefined

/** Postings that must be in the mean before an estimate is shown at all. */
const MIN_SAMPLES = 4

export interface EtaReading {
  /** Postings completed. */
  done: number
  total: number
  elapsedMs: number
  /** Absent until the mean means something. Never shown as a wrong number first. */
  remainingMs?: number
}

/**
 * The live, self-correcting estimate for the `llm` phase — client-side, off the stream's own
 * timing, so no server change and no widening of `Progress`. Call it with each `llm` event, and
 * with no argument on a clock tick to advance the elapsed time between events.
 *
 * Two details decide whether this reads as an instrument or as noise, and both are measured rather
 * than assumed:
 *
 * - **The clock starts at the first event, not at the click.** The event fires *before* its call
 *   (`onProgress({ done: i })`, then `await scoreJob`), so at event `i` exactly `i` postings have
 *   completed. Anchoring on event 0 also puts the candidate query and the work map over the whole
 *   table outside the mean, neither of which is instant.
 * - **Posting 0 is dropped from the mean.** It pays model load and a cold prompt cache — the same
 *   reason `scratchpad/eval.mts` excludes a warm-up call per cell. Folded in, one ~40 s load
 *   inflates the estimate for the entire pass.
 *
 * The mean is cumulative, not a trailing window: within one pass the model, the thinking level and
 * the description cap are all fixed, so there is no regime change to chase and a window would only
 * add jitter. Only the `llm` phase belongs here — a run's `source` events are boards, not uniform
 * units, and must never be fed to the same estimator.
 */
export const createEta = () => {
  let startedAt = 0
  /** When the warm-up call landed: the anchor of the mean, one posting after `startedAt`. */
  let meanFrom = 0
  let done = 0
  let total = 0
  return (e?: { done: number; total: number }, now = Date.now()): EtaReading | undefined => {
    if (e) {
      if (!startedAt) startedAt = now
      else if (!meanFrom && e.done >= 1) meanFrom = now
      done = e.done
      total = e.total
    }
    if (!startedAt) return undefined
    // Postings whose duration is inside the window that starts at `meanFrom`: everything since the
    // warm-up, which is exactly the ones that ran warm.
    const sampled = done - 1
    return {
      done,
      total,
      elapsedMs: now - startedAt,
      remainingMs: meanFrom && sampled >= MIN_SAMPLES ? ((now - meanFrom) / sampled) * (total - done) : undefined,
    }
  }
}

/**
 * POST a body and drive the stream: `onEvent` for every progress line, the resolved value is the
 * final result. An `{ phase: 'error' }` line throws, so a caller's try/catch covers both a dead
 * request and a failed run.
 */
export async function postStream<R>(url: string, body: unknown, onEvent: (e: RunEvent<R>) => void): Promise<R> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  // A validation 400 never reaches the stream: it is a plain JSON error response. errorMessage()
  // is written against a `$fetch` error, whose `.data` is h3's `data` field for a Zod 400 and the
  // body itself for a route's createError — so hand it whichever is there.
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body ? errorMessage({ data: body.data ?? body }) : `HTTP ${res.status}`)
  }
  let result: R | undefined
  for await (const e of ndjson<RunEvent<R>>(res)) {
    onEvent(e)
    if (e.phase === 'error') throw new Error(e.message)
    if (e.phase === 'done') result = e.result
  }
  if (result === undefined) throw new Error('Stream ended without a result')
  return result
}
