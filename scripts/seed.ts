import { createInterface } from 'node:readline/promises'
import { count, inArray } from 'drizzle-orm'
import { databasePath } from '../server/core/config/env'
import { db } from '../server/core/db/index'
import { resolveDuplicates } from '../server/core/dedupe'
import { compare, compareCompany, contentHash } from '../server/core/normalize'
import { matchesTerm } from '../server/core/score/keyword'
import { jobScores, jobs, pipelineRuns, searchProfiles } from '../server/core/db/schema'
import type { WorkMode } from '../server/core/db/schema'
import type { LlmScore, SearchProfileInsert } from '../server/core/types'

/** Fixed clock: reruns produce byte-identical rows, so a UI diff is a real diff. */
const BASE = new Date('2026-08-01T09:00:00Z')
const day = 86_400_000
const daysAgo = (n: number) => new Date(BASE.getTime() - n * day)

/** The real Phase 6 hash, over the real comparison forms. */
const hash = (j: SeedJob) =>
  contentHash([compare(j.title), compareCompany(j.company), compare(j.location), compare(j.description)])

const HOST: Record<string, string> = {
  'jobs.ch': 'www.jobs.ch',
  'jobup.ch': 'www.jobup.ch',
  'indeed.ch': 'ch.indeed.com',
  linkedin: 'www.linkedin.com',
  'swissdevjobs.ch': 'swissdevjobs.ch',
}

export const profiles: SearchProfileInsert[] = [
  {
    name: 'default',
    query: 'typescript engineer',
    location: 'Zürich',
    remoteOnly: false,
    requiredKeywords: ['TypeScript', 'Node', 'SQL'],
    preferredKeywords: ['Vue', 'Drizzle', 'Playwright'],
    excludedKeywords: ['Java', 'internship'],
  },
  // No keywords at all — a profile a user can really create, and the case that makes
  // every keywordDetail array empty.
  { name: 'minimal', query: 'engineer', location: null, remoteOnly: true },
]

interface SeedJob {
  source: string
  sourceJobId: string
  title: string
  company: string | null
  location: string | null
  description: string
  postedAt: Date | null
  /** Phase 6 derives this from the text; the seed states it. undefined → null in the DB. */
  workMode?: WorkMode
  /** Keyword score for the `default` profile. Explicit, so 0 and 100 are reachable. */
  score: number
  llm?: LlmScore
}

const long = (text: string, min: number) => text.repeat(Math.ceil(min / text.length))

const edgeCases: SeedJob[] = [
  {
    source: 'indeed.ch',
    sourceJobId: 'relative-date',
    title: 'Backend Engineer',
    company: 'Helvetia Data AG',
    location: 'Bern',
    description: 'TypeScript and Node with SQL. Source only gave "3 days ago", so postedAt is null.',
    postedAt: null,
    score: 74,
  },
  {
    source: 'linkedin',
    sourceJobId: 'no-location',
    title: 'Platform Engineer (Remote)',
    company: 'Nimbus Labs',
    location: null,
    description: 'Fully remote. TypeScript, Node, SQL, some Playwright.',
    postedAt: daysAgo(2),
    workMode: 'remote',
    score: 81,
  },
  {
    source: 'jobs.ch',
    sourceJobId: 'long-company',
    title: 'Software Engineer',
    company: 'Schweizerische Gesellschaft für Angewandte Informatik und Datenverarbeitungssysteme Holding AG',
    location: 'Zürich',
    description: 'TypeScript, Node, SQL, Vue.',
    postedAt: daysAgo(5),
    workMode: 'hybrid',
    score: 88,
  },
  {
    source: 'jobup.ch',
    sourceJobId: 'huge-description',
    title: 'Full Stack Engineer',
    company: 'Lac Systems SA',
    location: 'Genève',
    description: long(
      'We build TypeScript services on Node with SQL storage, Vue on the front end, and Playwright for end-to-end tests. ',
      6000,
    ),
    postedAt: daysAgo(9),
    score: 69,
  },
  // The duplicate pair: identical content on two sources, so the real contentHash collides on
  // its own — no magic hash. duplicateOf is resolved after insert.
  {
    source: 'jobs.ch',
    sourceJobId: 'dupe-origin',
    title: 'Senior TypeScript Engineer',
    company: 'Alpine Fintech AG',
    location: 'Zürich',
    description: 'TypeScript, Node, SQL, Drizzle. Posted to several boards at once.',
    postedAt: daysAgo(6),
    score: 91,
  },
  {
    source: 'linkedin',
    sourceJobId: 'dupe-copy',
    title: 'Senior TypeScript Engineer',
    company: 'Alpine Fintech AG',
    location: 'Zürich',
    description: 'TypeScript, Node, SQL, Drizzle. Posted to several boards at once.',
    postedAt: daysAgo(6),
    score: 91,
  },
  {
    source: 'indeed.ch',
    sourceJobId: 'missing-required',
    title: 'Ruby Developer',
    company: 'Rheintal Software GmbH',
    location: 'St. Gallen',
    description: 'Ruby on Rails shop. No TypeScript, no Node, no SQL — Mongo only.',
    postedAt: daysAgo(11),
    score: 12,
  },
  {
    source: 'swissdevjobs.ch',
    sourceJobId: 'floor',
    title: 'Java Internship',
    company: 'Kantonal IT',
    location: 'Luzern',
    description: 'Java internship, on-site. Nothing this profile asked for.',
    postedAt: daysAgo(30),
    workMode: 'onsite',
    score: 0,
  },
  {
    source: 'jobs.ch',
    sourceJobId: 'ceiling',
    title: 'Lead TypeScript Engineer',
    company: 'Limmat Robotics AG',
    location: 'Zürich',
    description: 'TypeScript, Node, SQL, Vue, Drizzle, Playwright. Every keyword in the profile.',
    postedAt: daysAgo(1),
    score: 100,
  },
  {
    source: 'jobup.ch',
    sourceJobId: 'llm-strong',
    title: 'Staff Engineer, Data Platform',
    company: 'Léman Analytics SA',
    location: 'Lausanne',
    description: 'TypeScript, Node, SQL at scale. Vue dashboards.',
    postedAt: daysAgo(3),
    score: 84,
    llm: {
      score: 93,
      recommendation: 'strong_match',
      strengths: ['Depth in TypeScript and Node', 'Owns the SQL data model'],
      gaps: ['No Playwright mentioned'],
      concerns: [],
      explanation: 'Covers every required skill and most preferred ones; scope matches a senior profile.',
      confidence: 0.86,
    },
  },
  {
    source: 'swissdevjobs.ch',
    sourceJobId: 'llm-possible',
    title: 'Software Engineer, Integrations',
    company: 'Basel Health Tech',
    location: 'Basel',
    description: 'Node services, SQL, some Python. TypeScript being introduced.',
    postedAt: daysAgo(7),
    score: 61,
    llm: {
      score: 58,
      recommendation: 'possible_match',
      strengths: ['Node and SQL are core to the role'],
      gaps: ['TypeScript adoption is described as in progress'],
      concerns: ['Integration work may be narrower than the profile implies'],
      explanation: 'Required skills are present but TypeScript is aspirational rather than established.',
      confidence: 0.54,
    },
  },
  {
    source: 'indeed.ch',
    sourceJobId: 'llm-poor',
    title: 'IT Support Specialist',
    company: 'Aargau Services AG',
    location: 'Aarau',
    description: 'Helpdesk, Windows, some SQL reporting. No development.',
    postedAt: daysAgo(14),
    score: 22,
    llm: {
      score: 9,
      recommendation: 'poor_match',
      strengths: ['Some SQL exposure'],
      gaps: ['No software development', 'No TypeScript or Node'],
      concerns: ['Support role, not engineering'],
      explanation: 'Only incidental overlap; the role is not a development position.',
      confidence: 0.91,
    },
  },
]

const FILLER_TITLES = [
  'Frontend Engineer',
  'Backend Engineer',
  'DevOps Engineer',
  'Data Engineer',
  'Full Stack Developer',
]
const FILLER_COMPANIES = ['Zug Logic AG', 'Ticino Cloud SA', 'Winterthur Digital', 'Vaud Payments SA']
const FILLER_LOCATIONS = ['Zürich', 'Bern', 'Basel', 'Lausanne', 'Zug']
const FILLER_STACKS = [
  'TypeScript, Node and SQL, with Vue on the front end.',
  'Node and SQL. TypeScript optional.',
  'TypeScript and SQL, Playwright for tests.',
  'Node, SQL, Drizzle. Some Java in legacy services.',
]
const SOURCES = Object.keys(HOST)

const filler: SeedJob[] = Array.from({ length: 20 }, (_, i) => ({
  source: SOURCES[i % SOURCES.length],
  sourceJobId: `filler-${i}`,
  title: FILLER_TITLES[i % FILLER_TITLES.length],
  company: FILLER_COMPANIES[i % FILLER_COMPANIES.length],
  location: FILLER_LOCATIONS[i % FILLER_LOCATIONS.length],
  description: `${FILLER_TITLES[i % FILLER_TITLES.length]} role. ${FILLER_STACKS[i % FILLER_STACKS.length]}`,
  postedAt: daysAgo(i * 3),
  // Every fourth filler row says nothing about work mode — the majority state in real data.
  workMode: (['remote', 'hybrid', 'onsite', undefined] as const)[i % 4],
  score: 25 + ((i * 7) % 70),
}))

const seedJobs: SeedJob[] = [...edgeCases, ...filler]

type Keywords = Pick<SearchProfileInsert, 'requiredKeywords' | 'preferredKeywords' | 'excludedKeywords'>

const keywordDetail = (p: Keywords, text: string) => {
  const required = (p.requiredKeywords ?? []) as string[]
  const preferred = (p.preferredKeywords ?? []) as string[]
  const excluded = (p.excludedKeywords ?? []) as string[]
  const t = compare(text)
  return {
    matched: [...required, ...preferred].filter(k => matchesTerm(t, k)),
    missing: required.filter(k => !matchesTerm(t, k)),
    excluded: excluded.filter(k => matchesTerm(t, k)),
  }
}

const explain = (d: { matched: string[]; missing: string[]; excluded: string[] }) =>
  [
    d.matched.length ? `matched ${d.matched.join(', ')}` : 'no profile keywords matched',
    d.missing.length ? `missing required ${d.missing.join(', ')}` : null,
    d.excluded.length ? `excluded terms present: ${d.excluded.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('; ')

export const seed = () =>
  db.transaction(tx => {
    // Child-first: job_scores and pipeline_runs cascade, but jobs.duplicateOf is a
    // self-FK with no cascade and foreign_keys is ON.
    tx.delete(jobScores).run()
    tx.delete(pipelineRuns).run()
    tx.update(jobs).set({ duplicateOf: null }).run()
    tx.delete(jobs).run()
    // Seed owns only the profiles it authors. One created in the UI is user data and survives.
    tx.delete(searchProfiles)
      .where(
        inArray(
          searchProfiles.name,
          profiles.map(p => p.name),
        ),
      )
      .run()

    const insertedProfiles = tx.insert(searchProfiles).values(profiles).returning().all()

    const insertedJobs = tx
      .insert(jobs)
      .values(
        seedJobs.map(j => ({
          source: j.source,
          sourceJobId: j.sourceJobId,
          url: `https://${HOST[j.source]}/jobs/${j.sourceJobId}`,
          canonicalUrl: `https://${HOST[j.source]}/jobs/${j.sourceJobId}`,
          title: j.title,
          company: j.company,
          location: j.location,
          description: j.description,
          postedAt: j.postedAt,
          workMode: j.workMode ?? null,
          firstSeenAt: BASE,
          lastSeenAt: BASE,
          contentHash: hash(j),
        })),
      )
      .returning({ id: jobs.id, contentHash: jobs.contentHash })
      .all()

    resolveDuplicates(
      tx,
      insertedJobs.map(r => r.contentHash),
    )

    const scoreRows = insertedProfiles.flatMap(profile =>
      seedJobs.map((j, i) => {
        const detail = keywordDetail(profile, `${j.title} ${j.description}`)
        // The `minimal` profile has no keywords to score with, so it gets a flatter spread.
        const keywordScore = profile.name === 'default' ? j.score : Math.round(j.score / 2)
        const llm = profile.name === 'default' ? j.llm : undefined
        return {
          jobId: insertedJobs[i].id,
          profileId: profile.id,
          contentHash: insertedJobs[i].contentHash,
          keywordScore,
          keywordDetail: detail,
          llmScore: llm?.score ?? null,
          llmRecommendation: llm?.recommendation ?? null,
          llmDetail: llm
            ? { strengths: llm.strengths, gaps: llm.gaps, concerns: llm.concerns, confidence: llm.confidence }
            : null,
          llmModel: llm ? 'claude-sonnet-5' : null,
          // Alternated, so the detail page renders both states of the `thinking` qualifier the
          // deep pass now selects on — an edge case in the same sense as the null postedAt and the
          // 6000-character description, not filler.
          llmThink: llm ? (i % 2 ? 'on' : 'off') : null,
          llmPromptVersion: llm ? 'v1' : null,
          llmScoredAt: llm ? BASE : null,
          finalScore: llm?.score ?? keywordScore,
          explanation: llm?.explanation ?? explain(detail),
          scoredAt: BASE,
        }
      }),
    )
    tx.insert(jobScores).values(scoreRows).run()

    const defaultProfile = insertedProfiles[0]
    tx.insert(pipelineRuns)
      .values([
        {
          profileId: defaultProfile.id,
          startedAt: daysAgo(7),
          finishedAt: new Date(daysAgo(7).getTime() + 42_000),
          summary: {
            sourcesQueried: SOURCES,
            fetched: 31,
            inserted: 31,
            updated: 0,
            duplicates: 1,
            llmScored: 0,
          },
        },
        {
          profileId: defaultProfile.id,
          startedAt: daysAgo(1),
          finishedAt: new Date(daysAgo(1).getTime() + 61_000),
          summary: { sourcesQueried: SOURCES, fetched: 24, inserted: 0, updated: 24, duplicates: 1 },
          errors: [
            { source: 'indeed.ch', message: 'Security Check' },
            { source: 'linkedin', message: 'HTTP 429 from jobs-guest endpoint' },
          ],
        },
        // Still running: the UI's unknown state.
        { profileId: defaultProfile.id, startedAt: BASE, finishedAt: null, summary: null },
      ])
      .run()

    return { profiles: insertedProfiles.length, jobs: insertedJobs.length, scores: scoreRows.length, runs: 3 }
  })

/**
 * Run directly, this destroys every job, score and run in the target DB — and an expired posting
 * cannot be re-fetched from its source, so the loss is permanent. Tests import `seed()` and never
 * reach this branch. `--force` for scripted use.
 */
if (import.meta.main) {
  const counts = {
    jobs: db.select({ n: count() }).from(jobs).get()!.n,
    scores: db.select({ n: count() }).from(jobScores).get()!.n,
    runs: db.select({ n: count() }).from(pipelineRuns).get()!.n,
  }
  const owned = profiles.map(p => p.name)
  const kept = db
    .select({ name: searchProfiles.name })
    .from(searchProfiles)
    .all()
    .map(p => p.name)
    .filter(name => !owned.includes(name))

  if (!process.argv.includes('--force')) {
    console.log(`Seeding ${databasePath}`)
    console.log(
      `  deletes ${counts.jobs} jobs, ${counts.scores} scores, ${counts.runs} runs — expired postings cannot be re-fetched`,
    )
    console.log(`  replaces profiles: ${owned.join(', ')}`)
    console.log(`  keeps profiles: ${kept.join(', ') || '(none)'}`)
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const answer = await rl.question('Continue? [y/N] ')
    rl.close()
    if (answer.trim().toLowerCase() !== 'y') {
      console.log('aborted')
      process.exit(1)
    }
  }
  console.log('seeded', seed())
}
