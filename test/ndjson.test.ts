import { describe, expect, it } from 'vitest'
import { createEta, ndjson, progressLabel } from '../app/utils/ndjson'
import { ndjsonStream, stopRuns } from '../server/core/ndjson'

const collect = async (chunks: string[]) => {
  const enc = new TextEncoder()
  const body = new ReadableStream({
    start(c) {
      for (const s of chunks) c.enqueue(enc.encode(s))
      c.close()
    },
  })
  return Array.fromAsync(ndjson(new Response(body)))
}

// The one non-obvious line in the reader: a chunk boundary falls wherever the network puts it, so
// the tail has to be held over. These chunks cut one object mid-key and another mid-newline.
it('reassembles objects split across chunk boundaries', async () => {
  expect(await collect(['{"phase":"sou', 'rce","name":"a"}\n{"phase":"write"}', '\n'])).toEqual([
    { phase: 'source', name: 'a' },
    { phase: 'write' },
  ])
})

it('streams progress events and then the result', async () => {
  const events = await collect([
    await new Response(
      ndjsonStream(async line => {
        line({ phase: 'llm', done: 0, total: 2 })
        return { scored: 2 }
      }),
    ).text(),
  ])
  expect(events).toEqual([
    { phase: 'llm', done: 0, total: 2 },
    { phase: 'done', result: { scored: 2 } },
  ])
})

// A throw past the headers cannot be an HTTP status, so it is the last line instead.
it('turns a throwing run into an error line', async () => {
  const text = await new Response(
    ndjsonStream(async () => {
      throw new Error('No profile 999')
    }),
  ).text()
  expect(JSON.parse(text)).toEqual({ phase: 'error', message: 'No profile 999' })
})

// The estimator's two measured rules: the clock starts at the first event (not the click), and
// posting 0 — model load plus a cold prompt cache — is outside the mean. An event fires *before*
// its call, so at event `i` exactly `i` postings have completed.
describe('createEta', () => {
  /** 5 s a posting after a 40 s warm-up, as measured on the 31B. */
  const feed = (events: number, total = 100) => {
    const eta = createEta()
    let t = 1_000_000
    let r
    for (let i = 0; i < events; i++) {
      r = eta({ done: i, total }, t)
      t += i === 0 ? 40_000 : 5_000
    }
    return r
  }

  it('withholds the estimate until four warm postings are in the mean', () => {
    // Events 0..4 → 4 postings done, of which 3 ran warm. Still nothing to say.
    expect(feed(5)?.remainingMs).toBeUndefined()
    expect(feed(5)?.done).toBe(4)
    expect(feed(6)?.remainingMs).toBeDefined()
  })

  it('excludes the warm-up call from the mean', () => {
    // 10 postings done, 9 of them warm at 5 s → 90 left × 5 s, not × the 8.5 s a folded-in load
    // would have averaged.
    expect(feed(11)?.remainingMs).toBe(90 * 5_000)
  })

  it('measures elapsed from the first event, warm-up included', () => {
    expect(feed(11)?.elapsedMs).toBe(40_000 + 9 * 5_000)
  })

  it('advances elapsed between events, and reports nothing before the first one', () => {
    const eta = createEta()
    expect(eta(undefined, 1_000)).toBeUndefined()
    eta({ done: 0, total: 10 }, 1_000)
    expect(eta(undefined, 61_000)?.elapsedMs).toBe(60_000)
  })
})

// A per-posting count in a live region is ~590 announcements over a 49-minute pass.
describe('progressLabel', () => {
  const llm = (done: number, total = 100) => progressLabel({ phase: 'llm', done, total })

  it('announces the start and each quarter, and nothing in between', () => {
    expect(llm(0)).toBe('judging 100 postings')
    expect(llm(25)).toBe('judged 25 of 100')
    expect(llm(50)).toBe('judged 50 of 100')
    expect(llm(75)).toBe('judged 75 of 100')
    expect([...Array(100).keys()].filter(d => llm(d)).length).toBe(4)
  })
})

describe('stopRuns', () => {
  it('aborts the running stream and still delivers its result line', async () => {
    let seen: boolean | undefined
    const stream = ndjsonStream(async (line, signal) => {
      // Whatever the loop was doing when the stop landed.
      expect(stopRuns()).toBe(1)
      seen = signal.aborted
      line({ phase: 'write' })
      return { llmScored: 3, stopped: true }
    })
    const events = await collect([await new Response(stream).text()])
    expect(seen).toBe(true)
    // The result is the report of what was kept, so it must survive the stop — which is why the
    // client holds the connection open instead of aborting the fetch.
    expect(events).toEqual([{ phase: 'write' }, { phase: 'done', result: { llmScored: 3, stopped: true } }])
    // The set empties itself: a finished run cannot be stopped.
    expect(stopRuns()).toBe(0)
  })

  it('aborts a run whose reader has gone away', async () => {
    let aborted = false
    const stream = ndjsonStream(async (_line, signal) => {
      await new Promise(r => setTimeout(r, 0))
      aborted = signal.aborted
      return {}
    })
    await stream.cancel()
    await new Promise(r => setTimeout(r, 5))
    expect(aborted).toBe(true)
    expect(stopRuns()).toBe(0)
  })
})
