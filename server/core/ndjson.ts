/**
 * One JSON object per line: a run's progress events as they happen, then one final line carrying
 * the result. Chosen over run-id + poll because there is no progress state to store, no second
 * route and no client timer — and the bytes flowing are what stops a long LLM pass from looking
 * like a hung request.
 *
 * `run` is handed the same `line` it reports through, so a route passes it straight in as the
 * `onProgress` parameter of `runPipeline` / `rescoreProfile`, plus the `AbortSignal` both take as
 * their stop seam.
 *
 * A throw becomes `{ phase: 'error' }` rather than an HTTP status: by then the response headers
 * are long since sent. Web-standard `ReadableStream` only — nothing from Nitro or h3.
 */

/**
 * Every stream running in this process. A set rather than one handle, because two browser tabs can
 * each start a pass and `stopRuns()` means "stop what is running", not "stop the one I happen to
 * remember" — on a single-user local app those are the same intent and only the set is the truth.
 * The CLI is a separate process and neither sees nor is seen by this.
 *
 * This is the whole of the server-side stop state: no run ids, no registry keyed by anything, and
 * it empties itself when the stream does. That is why stopping did not need the run-id-plus-poll
 * shape this module exists to avoid.
 */
const active = new Set<AbortController>()

/**
 * Ask every in-flight run to stop. Cooperative, and that is the contract the UI states: the loops
 * break at their next iteration boundary, keep the verdicts already paid for, and still write and
 * report them. So the caller keeps reading the stream — the result line is the report — rather
 * than dropping the connection, which is a different thing and handled below.
 *
 * Returns how many runs were asked, which is 0 when the pass finished between the click and this
 * call. Nothing here waits: the stopped run answers on its own stream.
 */
export const stopRuns = () => {
  const n = active.size
  for (const ac of active) ac.abort()
  return n
}

export function ndjsonStream<T>(
  run: (line: (o: unknown) => void, signal: AbortSignal) => Promise<T>,
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  const ac = new AbortController()
  // A cancelled stream is a client that has gone away — a closed tab, a navigation, a killed
  // request. It aborts the run for the same reason a deliberate stop does (an abandoned pass must
  // not keep spending GPU minutes on a page nobody is reading), but it is *not* the same state:
  // there is no longer anyone to report to, and enqueueing into a cancelled controller throws.
  // A deliberate stop keeps writing lines, because its whole point is that the client hears how
  // much work was kept.
  let gone = false
  active.add(ac)
  return new ReadableStream({
    async start(c) {
      const line = (o: unknown) => {
        if (gone) return
        try {
          c.enqueue(enc.encode(`${JSON.stringify(o)}\n`))
        } catch {
          gone = true
        }
      }
      try {
        line({ phase: 'done', result: await run(line, ac.signal) })
      } catch (err) {
        line({ phase: 'error', message: (err as Error).message })
      } finally {
        active.delete(ac)
      }
      if (!gone) c.close()
    },
    cancel() {
      gone = true
      ac.abort()
    },
  })
}
