import { createInsertSchema } from 'drizzle-zod'
import { z } from 'zod'
import type { WorkMode } from './db/schema'
import { llmRecommendations, searchProfiles } from './db/schema'
import { cvMaxChars } from './config/rubric'

// --- Table-shaped: derived, never hand-written twice ---

export type SearchProfile = typeof searchProfiles.$inferSelect

const trimmed = z.string().trim()
const keywords = z
  .array(trimmed)
  .transform(k => k.filter(Boolean))
  .optional()
/** A form clears a field by submitting ''. That means null in the DB, never an empty string. */
const blankToNull = (inner: z.ZodType<string>) =>
  z.preprocess(v => (typeof v === 'string' && v.trim() === '' ? null : v), inner.nullable())

/**
 * Body validator for POST/PUT /api/profiles. Derived, then refined: the bare table schema accepts
 * `{name: '', query: ''}`, which the profile form makes reachable by a stray Enter key.
 * PUT gets all of it through `.partial()`.
 */
export const searchProfileInsertSchema = createInsertSchema(searchProfiles)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    name: trimmed.min(1),
    query: trimmed.min(1),
    location: blankToNull(trimmed).optional(),
    // Capped to bound a future LLM prompt, not to bound storage.
    cv: blankToNull(trimmed.max(cvMaxChars)).optional(),
    requiredKeywords: keywords,
    preferredKeywords: keywords,
    excludedKeywords: keywords,
  })
export type SearchProfileInsert = z.infer<typeof searchProfileInsertSchema>

// --- Request-shaped: query params arrive as strings, so coerce here, once ---

/** Route param for every /:id endpoint. */
export const idParamSchema = z.object({ id: z.coerce.number().int().positive() })

/** Also the parameter type of listJobs() — one shape, not a schema plus an interface. */
export const jobListQuerySchema = z.object({
  profileId: z.coerce.number().int().positive(),
  minScore: z.coerce.number().min(0).max(100).optional(),
  source: z.string().min(1).optional(),
  location: z.string().min(1).optional(),
  company: z.string().min(1).optional(),
  postedAfter: z.coerce.date().optional(),
  /** When *we* first saw it. Freshness without the null-postedAt blind spot. */
  firstSeenAfter: z.coerce.date().optional(),
  workMode: z.enum(['remote', 'hybrid', 'onsite']).optional(),
  /**
   * How the row was scored. Every score row has a keyword score, so `keyword` means "keyword only,
   * no verdict yet" — the set the LLM button would still spend on — and `llm` means "judged".
   */
  scored: z.enum(['llm', 'keyword']).optional(),
  /**
   * The model's own hedge, at most. Surfaces verdicts worth a second look — it is negatively
   * correlated with llmScore, so the unsure ones sit where a score sort buries them. A keyword-only
   * row has no confidence at all, so this excludes it rather than treating "no verdict" as zero.
   */
  maxConfidence: z.coerce.number().min(0).max(1).optional(),
  includeDuplicates: z.stringbool().optional(),
  q: z.string().min(1).optional(),
  /**
   * `verdict` is the default: `llmScore DESC` (SQLite sorts NULL last under DESC) then
   * `keywordScore DESC`. A keyword score takes three values on a near-binary profile, so folding it
   * into one `finalScore` sort let 100 > 85 put forty unjudged rows above the first posting the
   * model had read. `score` keeps the old single-key ordering and stays selectable.
   */
  sort: z.enum(['verdict', 'score', 'posted', 'confidence']).default('verdict'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})
export type JobListQuery = z.infer<typeof jobListQuerySchema>

export const jobDetailQuerySchema = z.object({
  profileId: z.coerce.number().int().positive().optional(),
})

/**
 * Whether the model may think before answering. Ollama only; `off` is the default because thinking
 * dominates the clock on a schema-constrained judgement. One definition, used by the env var, the
 * run body and the UI checkbox.
 *
 * Ollama also accepts `low`/`medium`/`high` here and all three were offered until 2026-08-24, when
 * they were measured on both gemma4 tags: one posting, temperature 0, four calls — and `on`, `low`,
 * `medium`, `high` returned **byte-identical** thought and answer, 26B and 31B alike. Three names
 * for one switch, so they are gone. Re-add only against a model measured to honour them.
 */
export const thinkSchema = z.enum(['off', 'on'])
export type ThinkLevel = z.infer<typeof thinkSchema>

/**
 * A provider model tag, chosen per run. Not an enum: the list is whatever the machine has pulled,
 * which only the provider can answer (GET /api/models). Bounded so a body cannot carry prose.
 */
export const modelSchema = z.string().trim().min(1).max(200)

/** Body for POST /api/pipeline/run. Phase 7 passes it straight to runPipeline(). */
export const pipelineRunInputSchema = z.object({
  profileId: z.number().int().positive(),
  useLlm: z.boolean().default(false),
  /** Omitted = whatever LLM_THINK says. The UI sends it explicitly; the CLI does not. */
  think: thinkSchema.optional(),
  /** Omitted = LLM_MODEL. A tag the provider actually holds; validated by the provider's 404. */
  model: modelSchema.optional(),
  /**
   * Which boards to query, by name. Omitted = every enabled source, so the CLI and every existing
   * caller are unchanged. A name the registry does not hold selects nothing rather than erroring:
   * the list comes from GET /api/registry, and a stale one is a smaller problem than a failed run.
   */
  sources: z.array(z.string()).optional(),
})
export type PipelineRunInput = z.infer<typeof pipelineRunInputSchema>

/**
 * Body for POST /api/profiles/:id/rescore, and the second parameter of rescoreProfile(). Keyword
 * rescore is offline and free, so `useLlm` defaults to false: re-judging costs model time.
 */
export const rescoreInputSchema = z.object({
  useLlm: z.boolean().default(false),
  think: thinkSchema.optional(),
  model: modelSchema.optional(),
  /**
   * Tier 2. Present = re-judge only the rows whose existing llmScore falls inside `[min, max]` and
   * whose verdict came from a different (model, thinking) configuration, instead of tier 1's rows
   * with no verdict at all. Thinking counts because the same tag thinking is a different judgement,
   * and on a two-model machine it is the only second opinion the fast tier's own tag can give.
   * That is the whole of the cascade: a fast pass over everything, then a deliberate deep pass over
   * the band where the fast model is not trusted to rank. It is also the only way to re-judge
   * anything — nothing else invalidates a stored verdict.
   *
   * Refined rather than left as a bare tuple, because `[80, 20]` parses fine and selects nothing —
   * which reads as "the band is empty" instead of "the band is backwards".
   */
  band: z
    .tuple([z.number().min(0).max(100), z.number().min(0).max(100)])
    .refine(([min, max]) => min <= max, { message: 'band must be [min, max] with min <= max' })
    .optional(),
})
export type RescoreInput = z.infer<typeof rescoreInputSchema>

// --- Pipeline-shaped: no table matches these ---

/** What every source adapter's search() accepts. */
export interface SearchQuery {
  query: string
  location?: string
}

/**
 * One registry entry per source. Phase 8 implements these; the pipeline only consumes them,
 * and takes an array of them as its second parameter so tests can inject fakes.
 */
export interface JobSource {
  name: string
  enabled: boolean
  /** Pause after this source before querying the next. Already floored by the registry. */
  rateLimitMs: number
  /** ToS/robots verdict, checked by hand before `enabled` was ever set true. */
  tosNote: string
  /** One plain line for the run bar's checkbox — what a non-developer needs to decide. */
  blurb?: string
  search: (query: SearchQuery, seen: Seen) => Promise<SearchResult>
}

/**
 * Does the DB already hold this source's posting? The pipeline builds one closure per source per
 * run, so an adapter can never be asked about another source's ids — and no adapter imports the DB.
 */
export type Seen = (sourceJobId: string) => boolean

/**
 * What `search` returns. `touched` is the sourceJobIds a source saw on a list page and deliberately
 * did *not* fetch a detail page for; the pipeline answers each with one `UPDATE jobs SET lastSeenAt`
 * and nothing else. A touched id must never reach `normalize()`: with no description it would
 * rehash the row and strip its LLM verdict.
 */
export interface SearchResult {
  jobs: RawJob[]
  touched: string[]
}

/** What an adapter returns. Anything the source did not give is null, never guessed. */
export interface RawJob {
  source: string
  sourceJobId: string
  url: string
  title: string
  company: string | null
  location: string | null
  description: string | null
  postedAt: Date | null
}

/** RawJob after normalize.ts. The norm* comparison forms are computed once, here. */
export interface NormalizedJob extends RawJob {
  /** Regex-derived from title + description. null = the posting did not say. */
  workMode: WorkMode | null
  canonicalUrl: string
  contentHash: string
  normTitle: string
  normCompany: string | null
  normLocation: string | null
  normDescription: string | null
}

// ponytail: jobScores.keywordDetail is flatter than this ({ matched, missing, excluded }) because
// that is all the UI shows. The pipeline maps down on write. Ceiling: the required/preferred split
// is not persisted. Upgrade path: widen the column, not this type.
export interface KeywordScore {
  /** 0–100, directly comparable with an LLM score. */
  score: number
  matchedRequired: string[]
  missingRequired: string[]
  matchedPreferred: string[]
  matchedExcluded: string[]
  explanation: string
}

/** Load-bearing Zod: this parses untrusted model JSON. */
export const llmScoreSchema = z.object({
  score: z.number().min(0).max(100),
  recommendation: z.enum(llmRecommendations),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  concerns: z.array(z.string()),
  explanation: z.string(),
  confidence: z.number().min(0).max(1),
})
export type LlmScore = z.infer<typeof llmScoreSchema>

/**
 * What a run reports while it works. A fourth parameter of `runPipeline` and `rescoreProfile`, the
 * same seam `sources` and `provider` already are — core stays framework-free, and the route is the
 * only thing that turns these into bytes. `write` is the last event: the transaction is synchronous.
 */
export type Progress =
  | { phase: 'source'; name: string; index: number; total: number }
  /**
   * `strong` is the pass's yield so far — verdicts at or above `scoreBands.strong`, cumulative,
   * counted where they arrive. A counter, never a row: nothing identifies a posting here, so no
   * client can render a verdict before the transaction that writes it.
   */
  | { phase: 'llm'; done: number; total: number; strong: number }
  | { phase: 'write' }
export type ProgressFn = (p: Progress) => void

/** What rescoreProfile returns. Named because both write UIs render it. */
export interface RescoreResult {
  scored: number
  repaired: number
  llmScored: number
  /**
   * Of those verdicts, the ones at or above `scoreBands.strong`. The answer to what the pass
   * bought, as opposed to what it cost: `llmScored` is the machine's yield and this is the user's.
   * The same figure the `llm` events count up to, taken from the run rather than from the last
   * event a client happened to see, so a stopped pass reports the yield it kept.
   */
  strong: number
  /**
   * A loop broke on the stop signal, so the queue was not finished. Set by the run rather than
   * inferred by the caller: a client that asked to stop knows only that it asked, and a stop that
   * arrives while the write is already running stopped nothing. Absent means the pass ran to the
   * end, which is what a too-late stop truthfully is.
   */
  stopped?: true
  errors: { source: string; message: string }[]
}

export interface PipelineResult {
  runId: number
  profileId: number
  startedAt: Date
  finishedAt: Date
  sourcesQueried: string[]
  /** Jobs normalized and scored this run. Excludes touched rows, which were never re-fetched. */
  fetched: number
  inserted: number
  updated: number
  /** Rows whose detail fetch was skipped because the DB already had them: lastSeenAt only. */
  touched: number
  duplicates: number
  llmScored: number
  /** As on `RescoreResult`. */
  stopped?: true
  errors: { source: string; message: string }[]
}
