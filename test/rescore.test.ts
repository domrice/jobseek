import { and, eq, isNotNull } from 'drizzle-orm'
import { beforeAll, expect, it } from 'vitest'
import { llmRescoreDays } from '../server/core/config/env'
import { scoreBands } from '../server/core/config/rubric'
import { db } from '../server/core/db/index'
import { jobScores, jobs, searchProfiles } from '../server/core/db/schema'
import { listJobs, scoringDebt } from '../server/core/queries'
import { rescoreProfile } from '../server/core/rescore'
import { normalize } from '../server/core/normalize'
import { jobListQuerySchema } from '../server/core/types'
import { seed } from '../scripts/seed'
import type { NormalizedJob, ThinkLevel } from '../server/core/types'

let fresh: number
let defaultId: number

beforeAll(() => {
  seed()
  defaultId = db.select().from(searchProfiles).where(eq(searchProfiles.name, 'default')).get()!.id
  // Created here, not seeded: seed() owns only its own profile names, and this is the case the
  // whole feature exists for — a profile that never ran the pipeline.
  // Not owned by seed(), so it survives the wipe and would collide on the next run.
  db.delete(searchProfiles).where(eq(searchProfiles.name, 'rescore-fixture')).run()
  fresh = db
    .insert(searchProfiles)
    .values({ name: 'rescore-fixture', query: 'engineer', requiredKeywords: ['TypeScript'] })
    .returning({ id: searchProfiles.id })
    .get().id
})

const countJobs = () => db.select().from(jobs).all().length
const rowsFor = (profileId: number) => db.select().from(jobScores).where(eq(jobScores.profileId, profileId)).all()
const list = (profileId: number) => listJobs(jobListQuerySchema.parse({ profileId }))

it('gives a scoreless profile a row per job, and makes the corpus visible to it', async () => {
  expect(rowsFor(fresh)).toHaveLength(0)
  expect(list(fresh).total).toBe(0)

  const res = await rescoreProfile(fresh)
  expect(res).toMatchObject({ scored: countJobs(), repaired: 0, llmScored: 0 })
  expect(rowsFor(fresh)).toHaveLength(countJobs())
  expect(list(fresh).total).toBeGreaterThan(0)
})

it('carries an existing LLM verdict forward', async () => {
  const before = db
    .select()
    .from(jobScores)
    .where(and(eq(jobScores.profileId, defaultId), isNotNull(jobScores.llmScore)))
    .all()
  expect(before.length).toBeGreaterThan(0)

  await rescoreProfile(defaultId)

  for (const b of before) {
    const after = row(b.jobId, defaultId)
    expect(after.llmScore).toBe(b.llmScore)
    expect(after.llmModel).toBe(b.llmModel)
    expect(after.llmPromptVersion).toBe(b.llmPromptVersion)
    // finalScore is recomputed, and with a verdict present it is the verdict.
    expect(after.finalScore).toBe(b.llmScore)
  }
})

it('is idempotent', async () => {
  const first = rowsFor(fresh).map(r => ({ ...r, scoredAt: null }))
  const res = await rescoreProfile(fresh)
  expect(res.scored).toBe(countJobs())
  // scoredAt is a fresh clock every pass; everything else must be identical.
  expect(rowsFor(fresh).map(r => ({ ...r, scoredAt: null }))).toEqual(first)
})

it('repairs a job whose stored hash predates a normalize change, keeping its LLM verdict', async () => {
  // A job that already carries a verdict, so the re-keying is actually exercised.
  const victim = db
    .select()
    .from(jobScores)
    .where(and(eq(jobScores.profileId, defaultId), isNotNull(jobScores.llmScore)))
    .all()[0]!
  const good = db.select().from(jobs).where(eq(jobs.id, victim.jobId)).get()!.contentHash
  db.update(jobs).set({ contentHash: 'stale-hash-from-an-older-normalize' }).where(eq(jobs.id, victim.jobId)).run()
  db.update(jobScores)
    .set({ contentHash: 'stale-hash-from-an-older-normalize' })
    .where(eq(jobScores.jobId, victim.jobId))
    .run()

  const res = await rescoreProfile(fresh)
  expect(res).toMatchObject({ scored: countJobs(), repaired: 1 })
  expect(db.select().from(jobs).where(eq(jobs.id, victim.jobId)).get()!.contentHash).toBe(good)
  // Every profile's row re-keyed, not just the rescored one.
  const after = db.select().from(jobScores).where(eq(jobScores.jobId, victim.jobId)).all()
  expect(after.every(r => r.contentHash === good)).toBe(true)
  // The verdict survives the re-key: the content did not change, only the hash function did.
  const verdict = after.find(r => r.profileId === defaultId)!
  expect(verdict.llmScore).toBe(victim.llmScore)
  expect(verdict.llmModel).toBe(victim.llmModel)
  // A second pass has nothing left to repair.
  expect((await rescoreProfile(fresh)).repaired).toBe(0)
})

it('rejects an unknown profile', async () => {
  await expect(rescoreProfile(999_999)).rejects.toThrow('No profile 999999')
})

// --- LLM rescore ---------------------------------------------------------------------------
//
// Its own fixture, because the assertions are about *which* jobs get called. Note they are all
// fixture-local — `called` also carries the seeded corpus, since the keyword score gates nothing,
// so an exact count here would assert the size of seed.ts.

const verdict = {
  score: 88,
  recommendation: 'strong_match' as const,
  strengths: ['zzquux'],
  gaps: [],
  concerns: [],
  explanation: 'fits',
  confidence: 0.9,
}

/**
 * `think` is half of tier 2's identity, not decoration: the deep pass re-judges a band row only
 * when its (model, thinking) pair differs from the verdict's, so a fake that omitted it made every
 * band row look unjudged and a repeat pass look expensive.
 */
const fakeProvider = (model = 'fake-model', score = verdict.score, think: ThinkLevel = 'off') => {
  const called: string[] = []
  return {
    called,
    model,
    think,
    scoreJob: async ({ job }: { job: NormalizedJob }) => {
      called.push(job.sourceJobId)
      return { ...verdict, score }
    },
  }
}

/** How often the fixture's twin was asked for — `called` also holds the seeded corpus. */
const timesAsked = (called: string[], id: string) => called.filter(c => c === id).length

/**
 * Tier 1 judges only what carries no verdict — nothing else invalidates one, a profile edit
 * included. So a test that needs it to spend again has to clear the verdicts first. finalScore is
 * left stale on purpose: buildScoreRow recomputes it on the next write.
 */
const unjudge = (profileId: number) =>
  db
    .update(jobScores)
    .set({ llmScore: null, llmScoredAt: null, llmModel: null })
    .where(eq(jobScores.profileId, profileId))
    .run()

const posting = (sourceJobId: string, source: string) => ({
  source,
  sourceJobId,
  url: `https://${source}.example/jobs/${sourceJobId}`,
  title: 'zzquux engineer',
  company: 'Zzquux AG',
  location: 'Zürich',
  description: 'We need zzquux experience.',
  postedAt: null,
})

let llmProfile: number
let twinA: number
let twinB: number
let ancient: number
let stale: number

const insertJob = (raw: Parameters<typeof normalize>[0], lastSeenAt: Date) => {
  const j = normalize(raw)
  return db
    .insert(jobs)
    .values({ ...j, firstSeenAt: lastSeenAt, lastSeenAt })
    .returning({ id: jobs.id })
    .get().id
}

const row = (jobId: number, profileId: number) =>
  db
    .select()
    .from(jobScores)
    .where(and(eq(jobScores.jobId, jobId), eq(jobScores.profileId, profileId)))
    .get()!

beforeAll(() => {
  db.delete(searchProfiles).where(eq(searchProfiles.name, 'rescore-llm-fixture')).run()
  llmProfile = db
    .insert(searchProfiles)
    .values({ name: 'rescore-llm-fixture', query: 'zzquux', requiredKeywords: ['zzquux'] })
    .returning({ id: searchProfiles.id })
    .get().id

  const now = new Date()
  // Same posting from two sources: identical text, so one contentHash across two job rows.
  twinA = insertJob(posting('twin-a', 'fake-a'), now)
  twinB = insertJob(posting('twin-a', 'fake-b'), now)
  // Same keyword, but stopped being listed long ago — outside LLM_RESCORE_DAYS.
  ancient = insertJob(
    { ...posting('ancient', 'fake-a'), description: 'Old zzquux role.' },
    new Date(now.getTime() - 400 * 86_400_000),
  )
  // Still listed this week, but the source dates it 200 days back — outside LLM_MAX_POSTED_DAYS.
  // The other cap cannot catch this one, which is the whole reason it exists.
  stale = insertJob(
    {
      ...posting('stale', 'fake-a'),
      description: 'Evergreen zzquux ad.',
      postedAt: new Date(now.getTime() - 200 * 86_400_000),
    },
    now,
  )
})

it('calls once per contentHash, skips jobs outside either age cap, and fans the verdict out', async () => {
  const provider = fakeProvider()
  const res = await rescoreProfile(llmProfile, { useLlm: true }, provider)

  expect(res.errors).toEqual([])
  // One call for the two twin rows, which share a contentHash — never the 400-day-old row or the
  // one the board dates 200 days back, whatever their keyword scores.
  expect(timesAsked(provider.called, 'twin-a')).toBe(1)
  expect(provider.called).not.toContain('ancient')
  expect(provider.called).not.toContain('stale')

  for (const id of [twinA, twinB]) {
    const r = row(id, llmProfile)
    expect(r.llmScore).toBe(88)
    expect(r.finalScore).toBe(88)
    expect(r.llmModel).toBe('fake-model')
    expect(r.llmScoredAt).toBeInstanceOf(Date)
  }
  // Scored on keywords like everything else, just never judged.
  for (const id of [ancient, stale]) {
    expect(row(id, llmProfile).llmScore).toBeNull()
    expect(row(id, llmProfile).keywordScore).toBeGreaterThan(0)
  }
})

it('does not re-spend on a posting that already has a verdict', async () => {
  const quiet = fakeProvider()
  expect((await rescoreProfile(llmProfile, { useLlm: true }, quiet)).llmScored).toBe(0)
  expect(quiet.called).toEqual([])

  // A CV or keyword edit would change nothing here — the verdict's own absence is the only gate.
  db.update(searchProfiles).set({ query: 'zzquux again' }).where(eq(searchProfiles.id, llmProfile)).run()
  const edited = fakeProvider()
  expect((await rescoreProfile(llmProfile, { useLlm: true }, edited)).llmScored).toBe(0)
  expect(edited.called).toEqual([])

  unjudge(llmProfile)

  const again = fakeProvider()
  expect((await rescoreProfile(llmProfile, { useLlm: true }, again)).llmScored).toBeGreaterThan(0)
  expect(timesAsked(again.called, 'twin-a')).toBe(1)
})

it('keeps the verdict through a keyword-only rescore', async () => {
  const before = row(twinA, llmProfile)
  const res = await rescoreProfile(llmProfile)
  expect(res.llmScored).toBe(0)
  const after = row(twinA, llmProfile)
  expect(after.llmScore).toBe(before.llmScore)
  expect(after.llmScoredAt).toEqual(before.llmScoredAt)
  expect(after.llmModel).toBe('fake-model')
})

it('reports a provider failure without losing the keyword scores', async () => {
  // Its own posting rather than unjudge(): the twins keep their verdict, which is what lets the
  // last assertion check that a failed call writes nothing instead of clearing.
  const doomed = insertJob({ ...posting('doomed', 'fake-a'), description: 'Another zzquux role.' }, new Date())
  const res = await rescoreProfile(
    llmProfile,
    { useLlm: true },
    {
      model: 'broken',
      scoreJob: async () => {
        throw new Error('connection refused')
      },
    },
  )
  expect(res.llmScored).toBe(0)
  expect(res.scored).toBe(countJobs())
  // One error per attempted job, not one for the run: a failure costs that job's verdict only.
  expect(res.errors.length).toBeGreaterThan(0)
  for (const e of res.errors) expect(e.message).toContain('connection refused')
  // The old verdict is still there — a failed call writes nothing, it does not clear.
  expect(row(twinA, llmProfile).llmScore).toBe(88)
  expect(row(doomed, llmProfile).llmScore).toBeNull()
  expect(row(doomed, llmProfile).keywordScore).toBeGreaterThan(0)
  expect(row(ancient, llmProfile).keywordScore).toBeGreaterThan(0)
})

// Tier 2, and last in the file: it leaves the fixture carrying a different model's verdict, which
// the tests above assert on. The band *replaces* tier 1's unjudged test rather than joining it —
// every row a deep pass targets carries a verdict the fast tier wrote seconds ago.
it('re-judges only the band, only for a model that did not write the verdict', async () => {
  unjudge(llmProfile)
  const fast = fakeProvider('fast-model', 55)
  await rescoreProfile(llmProfile, { useLlm: true }, fast)
  expect(row(twinA, llmProfile).llmScore).toBe(55)
  expect(row(twinA, llmProfile).llmModel).toBe('fast-model')

  // 55 is inside [40, 100]: the deep model re-judges it, once for the two twin rows, and the
  // verdict is fanned out to both.
  const deep = fakeProvider('deep-model', 88)
  expect((await rescoreProfile(llmProfile, { useLlm: true, band: [40, 100] }, deep)).llmScored).toBeGreaterThan(0)
  expect(timesAsked(deep.called, 'twin-a')).toBe(1)
  for (const id of [twinA, twinB]) {
    expect(row(id, llmProfile).llmScore).toBe(88)
    expect(row(id, llmProfile).llmModel).toBe('deep-model')
  }

  // Idempotent: every band row now carries this model's own verdict, so a repeat spends nothing.
  const twice = fakeProvider('deep-model', 88)
  expect((await rescoreProfile(llmProfile, { useLlm: true, band: [40, 100] }, twice)).llmScored).toBe(0)
  expect(twice.called).toEqual([])

  // Outside the band, nothing is spent — 88 is not in [0, 10].
  const outside = fakeProvider('other-model', 7)
  expect((await rescoreProfile(llmProfile, { useLlm: true, band: [0, 10] }, outside)).llmScored).toBe(0)
  expect(outside.called).not.toContain('twin-a')
  expect(row(twinA, llmProfile).llmScore).toBe(88)

  // The footgun, pinned deliberately: "different model" is the only test, so a deep pass run with
  // the *fast* model after a deep pass has already landed will re-judge the band downwards. There
  // is no notion of which model is better in the code, and inventing a tier ranking to guard one
  // misclick would be more config than the misclick costs — clicking again with the deep model
  // repairs it.
  const misfire = fakeProvider('fast-model', 1)
  expect((await rescoreProfile(llmProfile, { useLlm: true, band: [40, 100] }, misfire)).llmScored).toBeGreaterThan(0)
  expect(row(twinA, llmProfile).llmScore).toBe(1)
})

// The other half of tier 2's identity. Without it a machine holding one model has no deep tier at
// all, and the two-model case cannot buy the cheapest second opinion there is: the fast tag
// thinking. `llmThink` is what makes that a different configuration rather than the same one.
it('counts thinking as part of the configuration a deep pass re-judges against', async () => {
  unjudge(llmProfile)
  const fast = fakeProvider('one-model', 55, 'off')
  await rescoreProfile(llmProfile, { useLlm: true }, fast)
  expect(row(twinA, llmProfile).llmThink).toBe('off')

  // Same tag, thinking on: a different judgement, so the band is re-judged.
  const thinking = fakeProvider('one-model', 88, 'on')
  const res = await rescoreProfile(llmProfile, { useLlm: true, band: [40, 100] }, thinking)
  expect(res.llmScored).toBeGreaterThan(0)
  expect(row(twinA, llmProfile).llmScore).toBe(88)
  expect(row(twinA, llmProfile).llmThink).toBe('on')

  // And a repeat of *that* configuration is free, exactly as a repeat with a different tag is.
  const again = fakeProvider('one-model', 3, 'on')
  expect((await rescoreProfile(llmProfile, { useLlm: true, band: [40, 100] }, again)).llmScored).toBe(0)
  expect(again.called).toEqual([])
  expect(row(twinA, llmProfile).llmScore).toBe(88)
})

// The age caps gate both tiers, before either one's own test.
it('applies the lastSeenAt cap on both tiers', async () => {
  unjudge(llmProfile)
  await rescoreProfile(llmProfile, { useLlm: true }, fakeProvider('fast-model', 55))
  db.update(jobs)
    .set({ lastSeenAt: new Date(Date.now() - (llmRescoreDays + 1) * 86_400_000) })
    .run()
  const deep = fakeProvider('deep', 88)
  expect((await rescoreProfile(llmProfile, { useLlm: true, band: [0, 100] }, deep)).llmScored).toBe(0)
  unjudge(llmProfile)
  const fast = fakeProvider()
  expect((await rescoreProfile(llmProfile, { useLlm: true }, fast)).llmScored).toBe(0)
  expect([...deep.called, ...fast.called]).toEqual([])
})

/**
 * The stop is cooperative and its whole promise is that nothing paid for is thrown away. A
 * client-side abort could not make that promise: the verdicts live in a Map until one transaction
 * after the loop, so cutting the connection would stop the display and let the pass spend to the
 * end and write everything anyway. So the loop breaks, falls through to the same write, and the
 * rows it did judge are on disk when it returns.
 */
it('stops between postings, keeps every verdict already paid for, and says it stopped', async () => {
  // The cap test above pushed every row past lastSeenAt; this one needs a non-empty queue.
  db.update(jobs).set({ lastSeenAt: new Date() }).run()
  unjudge(llmProfile)
  const ac = new AbortController()
  const provider = fakeProvider('stop-model', 71)
  // Abort after the first posting has been judged, so there is both something kept and something
  // skipped — a stop that keeps everything or nothing proves neither half.
  const one = {
    ...provider,
    scoreJob: async (a: { job: NormalizedJob }) => {
      const r = await provider.scoreJob(a)
      ac.abort()
      return r
    },
  }
  const res = await rescoreProfile(llmProfile, { useLlm: true }, one, undefined, ac.signal)

  expect(res.stopped).toBe(true)
  expect(res.llmScored).toBe(1)
  expect(res.errors).toEqual([])
  // Written, not merely counted: the transaction runs after the break.
  const judged = db
    .select()
    .from(jobScores)
    .where(eq(jobScores.profileId, llmProfile))
    .all()
    .filter(r => r.llmModel === 'stop-model')
  // One *call*, which the fan-out may land on more than one row: twins across two boards share a
  // contentHash and are one judgement between them. So the unit asserted is the hash, not the row.
  expect(new Set(judged.map(r => r.contentHash)).size).toBe(1)
  expect(judged.every(r => r.llmScore === 71)).toBe(true)
  // Keyword scoring still covered the whole table — the break is in the LLM loop, not the pass.
  expect(res.scored).toBeGreaterThan(1)

  // And the rest is still unjudged, so running again picks up exactly where the stop left off:
  // tier 1's "no verdict yet" clause is what makes a stopped pass resumable at no extra cost.
  const again = fakeProvider('stop-model', 71)
  const rest = await rescoreProfile(llmProfile, { useLlm: true }, again)
  expect(rest.stopped).toBeUndefined()
  expect(rest.llmScored).toBeGreaterThan(0)
  expect(again.called).not.toContain(provider.called[0])
})

/**
 * The resting readout states the same fact a pass reports, before the pass — which means one
 * predicate implemented twice: tier 1's candidate filter in TypeScript, and the same gates in SQL
 * for a page that must not rebuild the whole work map on every load. This is the drift test.
 * Counted in postings, not rows: the twins are one call and therefore one unit here too.
 */
it('states the same eligible count at rest that a pass reports after it', async () => {
  db.update(jobs).set({ lastSeenAt: new Date() }).run()
  unjudge(llmProfile)

  const before = scoringDebt(llmProfile)
  expect(before.judged).toBe(0)
  expect(before.stored).toBeGreaterThan(before.ready)
  // No deep configuration asked for, no half-answer about one.
  expect(before.deep).toBeUndefined()

  // An un-aborted signal must leave the pass as if it had none.
  const { signal } = new AbortController()
  const res = await rescoreProfile(llmProfile, { useLlm: true }, fakeProvider(), undefined, signal)
  expect(res.stopped).toBeUndefined()
  expect(before.ready).toBe(res.llmScored)

  // And afterwards the debt is paid: what the pass judged is what the readout now counts as judged,
  // with nothing left ready — which is what makes a second click free and says so before it.
  const after = scoringDebt(llmProfile)
  expect(after.judged).toBe(res.llmScored)
  expect(after.ready).toBe(0)
  expect(after.stored).toBe(before.stored)
})

/**
 * The same drift test for tier 2, and it is a second implementation of a harder predicate: the deep
 * selection is not a standing property of the table but a function of the model, the thinking level
 * and the score range the user currently has set, so the SQL has to mirror `rescoreProfile`'s band
 * clause including its null-safe configuration comparison. Counted in postings, like everything
 * else the two sides report.
 */
it('states the same deep selection at rest that a deep pass reports after it', async () => {
  db.update(jobs).set({ lastSeenAt: new Date() }).run()
  unjudge(llmProfile)

  // A fast pass first: tier 2 can only re-judge what tier 1 judged, which is the whole reason the
  // resting line quotes the fast tier's numerator as its own denominator.
  const fast = await rescoreProfile(llmProfile, { useLlm: true }, fakeProvider('fast-model', 80))
  expect(fast.llmScored).toBeGreaterThan(0)

  const band = [scoreBands.possible, 100] as [number, number]
  const cfg = { model: 'deep-model', think: 'off' as const, min: band[0], max: band[1] }
  const before = scoringDebt(llmProfile, cfg)
  // Nothing was produced by this configuration yet, and every fast verdict in the band awaits it.
  expect(before.deep).toEqual({ judged: 0, ready: fast.llmScored })
  expect(before.judged).toBe(fast.llmScored)

  const deep = await rescoreProfile(llmProfile, { useLlm: true, band }, fakeProvider('deep-model', 80))
  expect(before.deep!.ready).toBe(deep.llmScored)

  // And a second identical pass is free, which the readout says before the click rather than after:
  // the configuration that produced every band row is now the selected one.
  const after = scoringDebt(llmProfile, cfg)
  expect(after.deep).toEqual({ judged: deep.llmScored, ready: 0 })
  const again = await rescoreProfile(llmProfile, { useLlm: true, band }, fakeProvider('deep-model', 80))
  expect(again.llmScored).toBe(0)

  // A range past every verdict selects nothing, and says so with the pool still full — the third of
  // the states `llm-judged 0` could not tell apart.
  const outside = scoringDebt(llmProfile, { ...cfg, min: 0, max: 1 })
  expect(outside.deep).toEqual({ judged: deep.llmScored, ready: 0 })
})

/**
 * The yield a pass reports is what it bought, not what it cost, so it is counted against the one
 * band table the prompt, the badge and the deep pass's floor all read. A provider one point under
 * the floor judges everything and buys nothing; at the floor every verdict counts.
 */
it('counts the yield by scoreBands, not by calls made', async () => {
  unjudge(llmProfile)
  const weak = await rescoreProfile(llmProfile, { useLlm: true }, fakeProvider('weak', scoreBands.strong - 1))
  expect(weak.llmScored).toBeGreaterThan(0)
  expect(weak.strong).toBe(0)

  unjudge(llmProfile)
  const strong = await rescoreProfile(llmProfile, { useLlm: true }, fakeProvider('strong', scoreBands.strong))
  expect(strong.llmScored).toBeGreaterThan(0)
  expect(strong.strong).toBe(strong.llmScored)
})
