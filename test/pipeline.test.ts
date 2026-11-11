import { desc, eq } from 'drizzle-orm'
import { beforeAll, expect, it } from 'vitest'
import { db } from '../server/core/db/index'
import { jobScores, jobs, pipelineRuns, searchProfiles } from '../server/core/db/schema'
import { PROMPT_VERSION } from '../server/core/llm/index'
import { runPipeline } from '../server/core/pipeline'
import { seed } from '../scripts/seed'
import type { ScoringProvider } from '../server/core/llm/index'
import type { JobSource, LlmScore, Progress, RawJob, SearchQuery } from '../server/core/types'

/** rateLimitMs 0 so the inter-source sleep never bites; the registry floor is not in play here. */
const source = (name: string, search: JobSource['search']): JobSource => ({
  name,
  enabled: true,
  rateLimitMs: 0,
  tosNote: 'test fixture, never fetched',
  search,
})

/**
 * A source that ignores `seen` and re-fetches everything, which is what most of these tests want:
 * they assert on scoring, dedupe and the LLM gate, not on the incremental path.
 */
const fake = (name: string, search: (query: SearchQuery) => Promise<RawJob[]>): JobSource =>
  source(name, async q => ({ jobs: await search(q), touched: [] }))

const posting = (over: Partial<RawJob> = {}): RawJob => ({
  source: 'fake-a',
  sourceJobId: 'p1',
  url: 'https://fake-a.example/jobs/p1',
  title: 'TypeScript Engineer',
  company: 'Alpine Fintech AG',
  location: 'Zürich',
  description: 'TypeScript, Node and SQL. Some Vue.',
  // Relative, not a fixed date: the LLM gate excludes anything past LLM_MAX_POSTED_DAYS, so a
  // literal would silently stop being a candidate once the calendar passed it.
  postedAt: new Date(Date.now() - 5 * 86_400_000),
  ...over,
})

const llmResult: LlmScore = {
  score: 91,
  recommendation: 'strong_match',
  strengths: ['TypeScript depth'],
  gaps: [],
  concerns: [],
  explanation: 'Strong overlap with the stack.',
  confidence: 0.9,
}

/** Records what it was asked to score, so the gate itself is what the tests assert on. */
const fakeProvider = () => {
  const asked: string[] = []
  const provider: ScoringProvider = {
    model: 'fake-model',
    think: 'off',
    async scoreJob({ job }) {
      asked.push(job.title)
      return llmResult
    },
  }
  return { provider, asked }
}

let profileId: number

beforeAll(() => {
  seed()
  profileId = db.select().from(searchProfiles).where(eq(searchProfiles.name, 'default')).get()!.id
})

const countJobs = () => db.select().from(jobs).all().length

it('is idempotent across identical runs', async () => {
  const source = fake('fake-a', async () => [
    posting(),
    posting({ sourceJobId: 'p2', url: 'https://fake-a.example/jobs/p2' }),
  ])

  const before = countJobs()
  const first = await runPipeline({ profileId, useLlm: false }, [source])
  expect(first).toMatchObject({ fetched: 2, inserted: 2, updated: 0, llmScored: 0 })
  expect(countJobs()).toBe(before + 2)

  const second = await runPipeline({ profileId, useLlm: false }, [source])
  expect(second).toMatchObject({ fetched: 2, inserted: 0, updated: 2 })
  expect(countJobs()).toBe(before + 2)

  const row = db.select().from(jobs).where(eq(jobs.sourceJobId, 'p1')).get()!
  expect(row.lastSeenAt.getTime()).toBeGreaterThan(row.firstSeenAt.getTime())

  const score = scoreOf('p1')
  expect(score.finalScore).toBe(score.keywordScore)
  expect(score.keywordDetail.matched).toContain('TypeScript')
})

it('flags cross-source duplicates without deleting either row', async () => {
  const same = { title: 'Data Engineer', company: 'Lakeside Analytics GmbH', location: 'Bern' }
  const a = fake('fake-a', async () => [
    posting({ ...same, source: 'fake-a', sourceJobId: 'd1', url: 'https://fake-a.example/jobs/d1' }),
  ])
  const b = fake('fake-b', async () => [
    posting({ ...same, source: 'fake-b', sourceJobId: 'd1', url: 'https://fake-b.example/jobs/d1' }),
  ])

  const res = await runPipeline({ profileId, useLlm: false }, [a, b])
  expect(res.sourcesQueried).toEqual(['fake-a', 'fake-b'])
  expect(res.inserted).toBe(2)

  const rows = db.select().from(jobs).where(eq(jobs.sourceJobId, 'd1')).all()
  expect(rows).toHaveLength(2)
  const flagged = rows.filter(r => r.duplicateOf !== null)
  expect(flagged).toHaveLength(1)
  expect(flagged[0].duplicateOf).toBe(Math.min(...rows.map(r => r.id)))
  // Both scored, duplicate included.
  for (const r of rows) {
    expect(db.select().from(jobScores).where(eq(jobScores.jobId, r.id)).all().length).toBeGreaterThan(0)
  }
})

it('records a throwing source and keeps going', async () => {
  const bad = fake('fake-bad', async () => {
    throw new Error('502 from upstream')
  })
  const good = fake('fake-a', async () => [posting({ sourceJobId: 'ok1', url: 'https://fake-a.example/jobs/ok1' })])

  const res = await runPipeline({ profileId, useLlm: false }, [bad, good])
  // Keyed by the board's own name, which is what makes the entry actionable: the run summary
  // offers a retry exactly when `source` is a name the registry holds, and re-runs that board
  // alone through the `sources` seam the test below pins.
  expect(res.errors).toEqual([{ source: 'fake-bad', message: '502 from upstream' }])
  expect(res.sourcesQueried).toEqual(['fake-bad', 'fake-a'])
  expect(res.fetched).toBe(1)
  expect(db.select().from(jobs).where(eq(jobs.sourceJobId, 'ok1')).get()).toBeTruthy()
})

// No sources passed means no sources — never the real registry, which would hit the network.
it('writes a finished run row, and runs at all with no sources', async () => {
  const res = await runPipeline({ profileId, useLlm: false }, [])
  expect(res).toMatchObject({
    sourcesQueried: [],
    fetched: 0,
    inserted: 0,
    updated: 0,
    duplicates: 0,
    llmScored: 0,
    errors: [],
  })

  const run = db.select().from(pipelineRuns).orderBy(desc(pipelineRuns.id)).get()!
  expect(run.id).toBe(res.runId)
  expect(run.finishedAt).toBeInstanceOf(Date)
  expect(Object.keys(run.summary!).sort()).toEqual([
    'duplicates',
    'fetched',
    'inserted',
    'llmScored',
    'sourcesQueried',
    'touched',
    'updated',
  ])
})

// The incremental path: a stored card costs no request, and the only thing that may move is its
// clock. Anything else written here would rehash the row and strip the verdict it paid for.
it('skips a stored card, moves only its lastSeenAt, and never rescores it', async () => {
  const card = (id: string) => posting({ sourceJobId: id, url: `https://fake-a.example/jobs/${id}` })
  // Behaves like a real adapter: it consults `seen` per card and reports what it skipped.
  const incremental = (ids: string[], asked: string[]) =>
    source('fake-a', async (_q, seen = () => false) => {
      const out: { jobs: RawJob[]; touched: string[] } = { jobs: [], touched: [] }
      for (const id of ids) {
        asked.push(id)
        if (seen(id)) out.touched.push(id)
        else out.jobs.push(card(id))
      }
      return out
    })

  const firstAsked: string[] = []
  const first = await runPipeline({ profileId, useLlm: false }, [incremental(['inc-1'], firstAsked)])
  expect(first).toMatchObject({ fetched: 1, inserted: 1, touched: 0 })
  const before = db.select().from(jobs).where(eq(jobs.sourceJobId, 'inc-1')).get()!
  const scoreBefore = scoreOf('inc-1')

  const asked: string[] = []
  const second = await runPipeline({ profileId, useLlm: false }, [incremental(['inc-1', 'inc-2'], asked)])
  expect(asked).toEqual(['inc-1', 'inc-2'])
  expect(second).toMatchObject({ fetched: 1, inserted: 1, updated: 0, touched: 1 })

  const after = db.select().from(jobs).where(eq(jobs.sourceJobId, 'inc-1')).get()!
  expect(after.lastSeenAt.getTime()).toBeGreaterThan(before.lastSeenAt.getTime())
  expect(after.firstSeenAt).toEqual(before.firstSeenAt)
  expect(after.contentHash).toBe(before.contentHash)
  expect(after.description).toBe(before.description)
  // The observable proof the touched card never entered `scored`: a rewritten score row would have
  // moved scoredAt, and a re-normalized empty description would have moved the hash with it.
  expect(scoreOf('inc-1').scoredAt).toEqual(scoreBefore.scoredAt)
})

// An id no row matches must not throw, and must not be counted — `touched` reports rows changed.
it('reports touched rows the DB does not hold as zero', async () => {
  const ghost = source('fake-a', async () => ({ jobs: [], touched: ['no-such-id'] }))
  const res = await runPipeline({ profileId, useLlm: false }, [ghost])
  expect(res.touched).toBe(0)
})

// Two boards' id spaces are unrelated, so a source may only ever be asked about its own rows.
it('scopes the seen predicate to the source that is being queried', async () => {
  const a = fake('fake-a', async () => [
    posting({ source: 'fake-a', sourceJobId: 'shared-id', url: 'https://fake-a.example/jobs/shared-id' }),
  ])
  await runPipeline({ profileId, useLlm: false }, [a])

  const answers: boolean[] = []
  const b = source('fake-b', async (_q, seen = () => false) => {
    answers.push(seen('shared-id'))
    return {
      jobs: [
        posting({
          source: 'fake-b',
          sourceJobId: 'shared-id',
          url: 'https://fake-b.example/jobs/shared-id',
          title: 'Rust Engineer',
        }),
      ],
      touched: [],
    }
  })
  const res = await runPipeline({ profileId, useLlm: false }, [b])

  expect(answers).toEqual([false])
  expect(res.inserted).toBe(1)
  expect(db.select().from(jobs).where(eq(jobs.sourceJobId, 'shared-id')).all()).toHaveLength(2)
})

const scoreOf = (sourceJobId: string) => {
  const job = db.select().from(jobs).where(eq(jobs.sourceJobId, sourceJobId)).get()!
  return db
    .select()
    .from(jobScores)
    .where(eq(jobScores.jobId, job.id))
    .all()
    .find(s => s.profileId === profileId)!
}

// The keyword score gates nothing, so a posting matching none of the
// profile's keywords is judged like any other — that is the whole point of retiring the gate. What
// still excludes a row is a missing description: the detail fetch failed, so a call could only
// judge a title.
it('scores every eligible job regardless of keyword score, and only once per contentHash', async () => {
  const hit = posting({ sourceJobId: 'llm-hit', url: 'https://fake-a.example/jobs/llm-hit' })
  const offVocabulary = posting({
    sourceJobId: 'llm-off-vocab',
    url: 'https://fake-a.example/jobs/llm-off-vocab',
    title: 'Gardener',
    description: 'Pruning hedges in the park.',
  })
  const noDescription = posting({
    sourceJobId: 'llm-no-desc',
    url: 'https://fake-a.example/jobs/llm-no-desc',
    title: 'Detail Fetch Failed',
    description: null,
  })
  const source = fake('fake-a', async () => [hit, offVocabulary, noDescription])

  const first = fakeProvider()
  const res = await runPipeline({ profileId, useLlm: true }, [source], first.provider)
  expect(res.llmScored).toBe(2)
  // Strongest keyword score first, which is now only a tiebreak for a biting LLM_MAX_JOBS.
  expect(first.asked).toEqual(['TypeScript Engineer', 'Gardener'])
  expect(res.errors).toEqual([])

  // Stored and keyword-scored like anything else; only the call is withheld.
  const skipped = scoreOf('llm-no-desc')
  expect(skipped.llmScore).toBeNull()
  expect(skipped.finalScore).toBe(skipped.keywordScore)

  const scored = scoreOf('llm-hit')
  expect(scored.llmScore).toBe(91)
  expect(scored.finalScore).toBe(91)
  expect(scored.llmRecommendation).toBe('strong_match')
  expect(scored.llmModel).toBe('fake-model')
  // Imported, not hardcoded: a prompt bump is expected, and should not fail the gate's test.
  expect(scored.llmPromptVersion).toBe(PROMPT_VERSION)
  expect(scored.llmDetail).toEqual({ strengths: ['TypeScript depth'], gaps: [], concerns: [], confidence: 0.9 })
  expect(scored.explanation).toBe('Strong overlap with the stack.')

  // Judged despite matching no profile keyword — the recall the retired gate was costing.
  expect(scoreOf('llm-off-vocab').llmScore).toBe(91)

  // Same contentHash, already paid for: a second run must not spend a token on it.
  const second = fakeProvider()
  const again = await runPipeline({ profileId, useLlm: true }, [source], second.provider)
  expect(again.llmScored).toBe(0)
  expect(second.asked).toEqual([])
  expect(scoreOf('llm-hit').llmScore).toBe(91)
})

// A board still lists postings it dated years ago, so "we just fetched it" is not evidence the
// role is open. A missing date is not evidence either way, and must not cost the job its verdict.
it('skips a posting dated past the age cap, but not one with no date', async () => {
  const old = posting({
    sourceJobId: 'llm-old',
    url: 'https://fake-a.example/jobs/llm-old',
    title: 'Ancient TypeScript Engineer',
    postedAt: new Date(Date.now() - 200 * 86_400_000),
  })
  const undated = posting({
    sourceJobId: 'llm-undated',
    url: 'https://fake-a.example/jobs/llm-undated',
    title: 'Undated TypeScript Engineer',
    postedAt: null,
  })
  const { provider, asked } = fakeProvider()
  const res = await runPipeline({ profileId, useLlm: true }, [fake('fake-a', async () => [old, undated])], provider)

  expect(res.llmScored).toBe(1)
  expect(asked).toEqual(['Undated TypeScript Engineer'])
  expect(scoreOf('llm-undated').llmScore).toBe(91)
  // Stored and keyword-scored like anything else — the cap withholds the LLM, not the row.
  const skipped = scoreOf('llm-old')
  expect(skipped.llmScore).toBeNull()
  expect(skipped.keywordScore).toBeGreaterThan(0)
  expect(skipped.finalScore).toBe(skipped.keywordScore)
})

// A hash the LLM already judged keeps that judgement even on a keyword-only run — otherwise a
// --no-llm rerun would strip an expensive verdict off an unchanged posting.
it('carries an existing verdict forward instead of nulling it', async () => {
  const source = fake('fake-a', async () => [
    posting({ sourceJobId: 'llm-hit', url: 'https://fake-a.example/jobs/llm-hit' }),
  ])

  const { provider, asked } = fakeProvider()
  const res = await runPipeline({ profileId, useLlm: false }, [source], provider)
  expect(res.llmScored).toBe(0)
  expect(asked).toEqual([])

  const score = scoreOf('llm-hit')
  expect(score.llmScore).toBe(91)
  expect(score.finalScore).toBe(91)
  expect(score.llmModel).toBe('fake-model')
})

it('keeps the keyword score when the provider throws', async () => {
  const source = fake('fake-a', async () => [
    posting({
      sourceJobId: 'llm-fail',
      url: 'https://fake-a.example/jobs/llm-fail',
      title: 'Platform Engineer',
      description: 'TypeScript, Node, SQL and some Drizzle.',
    }),
  ])
  const provider: ScoringProvider = {
    model: 'fake-model',
    scoreJob: async () => {
      throw new Error('connection refused')
    },
  }

  const res = await runPipeline({ profileId, useLlm: true }, [source], provider)
  expect(res.llmScored).toBe(0)
  expect(res.errors).toEqual([{ source: 'llm', message: 'https://fake-a.example/jobs/llm-fail: connection refused' }])

  const score = scoreOf('llm-fail')
  expect(score.llmScore).toBeNull()
  expect(score.finalScore).toBe(score.keywordScore)
})

it("keyword-scores every profile, not just the run's", async () => {
  const other = db.select().from(searchProfiles).where(eq(searchProfiles.name, 'minimal')).get()!
  const source = fake('fake-a', async () => [
    posting({
      sourceJobId: 'cross-1',
      url: 'https://fake-a.example/jobs/cross-1',
      title: 'Fullstack Engineer',
    }),
  ])

  const res = await runPipeline({ profileId, useLlm: false }, [source])
  // The result keeps counting jobs, not rows written.
  expect(res.fetched).toBe(1)

  const job = db.select().from(jobs).where(eq(jobs.sourceJobId, 'cross-1')).get()!
  const rows = db.select().from(jobScores).where(eq(jobScores.jobId, job.id)).all()
  // Every profile in the DB, not a hardcoded pair: another suite may have left one behind.
  const all = db
    .select()
    .from(searchProfiles)
    .all()
    .map(p => p.id)
  expect(rows.map(r => r.profileId).sort()).toEqual([...all].sort())
  expect(all).toContain(other.id)
})

it("does not erase another profile's paid-for LLM verdict", async () => {
  const other = db.select().from(searchProfiles).where(eq(searchProfiles.name, 'minimal')).get()!
  const source = fake('fake-a', async () => [
    posting({
      sourceJobId: 'cross-llm',
      url: 'https://fake-a.example/jobs/cross-llm',
      title: 'Data Platform Engineer',
      description: 'TypeScript, Node and SQL.',
    }),
  ])

  // A run under `default` attaches a verdict to its own row...
  const { provider } = fakeProvider()
  await runPipeline({ profileId, useLlm: true }, [source], provider)
  const before = scoreOf('cross-llm')
  expect(before.llmScore).toBe(91)

  // ...and a run driven by another profile writes that row again. Without the
  // (profileId, contentHash) carry-forward this is where the verdict would be nulled.
  await runPipeline({ profileId: other.id, useLlm: false }, [source])
  const after = scoreOf('cross-llm')
  expect(after.llmScore).toBe(91)
  expect(after.llmModel).toBe('fake-model')
  expect(after.llmPromptVersion).toBe(PROMPT_VERSION)
  expect(after.finalScore).toBe(91)
})

// Two sources, one posting, one verdict — but two job rows, and both must carry it now rather
// than the twin waiting for the next run to pick it up out of `prior`.
it('gives every row of one contentHash the verdict it paid for, in the same run', async () => {
  const same = {
    title: 'Site Reliability Engineer',
    company: 'Alpine Fintech AG',
    location: 'Zürich',
    description: 'TypeScript, Node and SQL at scale.',
  }
  const a = fake('fake-a', async () => [
    posting({ ...same, source: 'fake-a', sourceJobId: 'fan-1', url: 'https://fake-a.example/jobs/fan-1' }),
  ])
  const b = fake('fake-b', async () => [
    posting({ ...same, source: 'fake-b', sourceJobId: 'fan-1', url: 'https://fake-b.example/jobs/fan-1' }),
  ])

  const { provider, asked } = fakeProvider()
  const res = await runPipeline({ profileId, useLlm: true }, [a, b], provider)
  expect(asked).toEqual(['Site Reliability Engineer'])
  expect(res.llmScored).toBe(1)

  const rows = db.select().from(jobs).where(eq(jobs.sourceJobId, 'fan-1')).all()
  expect(rows).toHaveLength(2)
  for (const r of rows) {
    const score = db
      .select()
      .from(jobScores)
      .where(eq(jobScores.jobId, r.id))
      .all()
      .find(s => s.profileId === profileId)!
    expect(score.llmScore).toBe(91)
    expect(score.finalScore).toBe(91)
  }
})

// The progress callback is what the NDJSON route streams; a missing event is a run that looks hung.
it('reports one source event per enabled source, then the llm and write phases', async () => {
  // Its own title and description: a hash another test already had judged would be carried forward
  // and never reach the provider, so no `llm` event would be emitted.
  const hit = posting({
    sourceJobId: 'prog-1',
    url: 'https://fake-a.example/jobs/prog-1',
    title: 'Progress Reporting Engineer',
    description: 'TypeScript, Node and SQL on a streaming API.',
  })
  const a = fake('fake-a', async () => [hit])
  const b = fake('fake-b', async () => [])
  const { provider } = fakeProvider()

  const seen: Progress[] = []
  await runPipeline({ profileId, useLlm: true }, [a, b], provider, p => seen.push(p))

  expect(seen.filter(p => p.phase === 'source')).toEqual([
    { phase: 'source', name: 'fake-a', index: 1, total: 2 },
    { phase: 'source', name: 'fake-b', index: 2, total: 2 },
  ])
  expect(seen.filter(p => p.phase === 'llm')).toEqual([{ phase: 'llm', done: 0, total: 1, strong: 0 }])
  // Last, because the transaction is synchronous and nothing can be reported from inside it.
  expect(seen.at(-1)).toEqual({ phase: 'write' })
})

it('rejects an unknown profile', async () => {
  await expect(runPipeline({ profileId: 999_999, useLlm: false })).rejects.toThrow('No profile 999999')
})

it('queries only the sources the run names', async () => {
  const a = fake('fake-a', async () => [posting({ sourceJobId: 'sel-a' })])
  const b = fake('fake-b', async () => [posting({ source: 'fake-b', sourceJobId: 'sel-b' })])

  // Omitted = every enabled source; named = exactly those, and an unknown name selects nothing
  // rather than throwing. An un-aborted signal must leave the run as if it had none.
  const all = await runPipeline({ profileId, useLlm: false }, [a, b], null, undefined, new AbortController().signal)
  expect(all.sourcesQueried).toEqual(['fake-a', 'fake-b'])
  expect(all.stopped).toBeUndefined()

  const one = await runPipeline({ profileId, useLlm: false, sources: ['fake-b'] }, [a, b])
  expect(one.sourcesQueried).toEqual(['fake-b'])

  const none = await runPipeline({ profileId, useLlm: false, sources: ['gone'] }, [a, b])
  expect(none.sourcesQueried).toEqual([])
})

/**
 * A seek is ~50 s and free, but it is still the wrong thing to be stuck in after picking the wrong
 * profile. It stops the same way a scoring pass does: the board loop breaks, everything already
 * fetched falls through to the same write, and the run row records the boards it actually reached
 * rather than the ones it was handed.
 */
it('stops between boards, stores what the reached ones returned, and records only those', async () => {
  const ac = new AbortController()
  const first = fake('fake-a', async () => {
    ac.abort()
    return [posting({ sourceJobId: 'stop-1', url: 'https://fake-a.example/jobs/stop-1' })]
  })
  const never = fake('fake-b', async () => {
    throw new Error('a board past the stop must not be searched')
  })

  const res = await runPipeline({ profileId, useLlm: false }, [first, never], null, undefined, ac.signal)

  expect(res.stopped).toBe(true)
  expect(res.errors).toEqual([])
  // `sourcesQueried` is pushed as the loop reaches each board, so it is the record of what
  // happened rather than of what was asked for — which is what the run row keeps forever.
  expect(res.sourcesQueried).toEqual(['fake-a'])
  expect(res.inserted).toBe(1)
  expect(db.select().from(jobs).where(eq(jobs.sourceJobId, 'stop-1')).get()).toBeTruthy()
})
