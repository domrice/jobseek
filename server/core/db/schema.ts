import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { index, integer, primaryKey, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'
import type { ThinkLevel } from '../types'

const now = () => new Date()
const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' })
/** JSON text column, typed. SQLite has no JSON type; drizzle does the (de)serialization. */
const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>()

export const searchProfiles = sqliteTable('search_profiles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  query: text('query').notNull(),
  location: text('location'),
  remoteOnly: integer('remote_only', { mode: 'boolean' }).notNull().default(false),
  requiredKeywords: json<string[]>('required_keywords').notNull().default([]),
  preferredKeywords: json<string[]>('preferred_keywords').notNull().default([]),
  excludedKeywords: json<string[]>('excluded_keywords').notNull().default([]),
  /** Candidate side of the match, markdown. Read only by the LLM prompt. */
  cv: text('cv'),
  createdAt: timestamp('created_at').notNull().$defaultFn(now),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
})

export type WorkMode = 'remote' | 'hybrid' | 'onsite'

export const jobs = sqliteTable(
  'jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    source: text('source').notNull(),
    sourceJobId: text('source_job_id').notNull(),
    url: text('url').notNull(),
    canonicalUrl: text('canonical_url').notNull(),
    title: text('title').notNull(),
    company: text('company'),
    location: text('location'),
    description: text('description'),
    /** null when the source gave a relative date ("3 days ago"). Never guessed. */
    postedAt: timestamp('posted_at'),
    /**
     * Derived in normalize.ts from the title + description.
     * null means the posting did not say — not on-site.
     */
    workMode: text('work_mode').$type<WorkMode>(),
    firstSeenAt: timestamp('first_seen_at').notNull().$defaultFn(now),
    lastSeenAt: timestamp('last_seen_at').notNull().$defaultFn(now),
    contentHash: text('content_hash').notNull(),
    /** Earliest-seen job this one duplicates. Cross-source duplicates are kept, never deleted. */
    duplicateOf: integer('duplicate_of').references((): AnySQLiteColumn => jobs.id),
    createdAt: timestamp('created_at').notNull().$defaultFn(now),
    updatedAt: timestamp('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
  },
  t => [
    unique('jobs_source_source_job_id_unique').on(t.source, t.sourceJobId),
    unique('jobs_canonical_url_unique').on(t.canonicalUrl),
    index('jobs_content_hash_idx').on(t.contentHash),
    index('jobs_posted_at_idx').on(t.postedAt),
    index('jobs_duplicate_of_idx').on(t.duplicateOf),
  ],
)

export const llmRecommendations = ['strong_match', 'possible_match', 'poor_match'] as const
type LlmRecommendation =(typeof llmRecommendations)[number]

export const jobScores = sqliteTable(
  'job_scores',
  {
    jobId: integer('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    profileId: integer('profile_id')
      .notNull()
      .references(() => searchProfiles.id, { onDelete: 'cascade' }),
    /** The job's contentHash when scored. Matches current hash → skip rescoring. */
    contentHash: text('content_hash').notNull(),
    keywordScore: real('keyword_score').notNull(),
    keywordDetail: json<{ matched: string[]; missing: string[]; excluded: string[] }>('keyword_detail').notNull(),
    llmScore: real('llm_score'),
    llmRecommendation: text('llm_recommendation').$type<LlmRecommendation>(),
    llmDetail: json<{ strengths: string[]; gaps: string[]; concerns: string[]; confidence: number }>('llm_detail'),
    llmModel: text('llm_model'),
    /**
     * Whether the verdict was produced with thinking on. Together with `llmModel` it is the whole
     * of what identifies a judgement's *configuration*, which is what the deep pass selects
     * against: the same tag with thinking on is a different judgement, and without this column it
     * was indistinguishable from the fast pass's own and therefore unselectable. Null on rows
     * written before the column existed, read as `off` — the default every one of them ran under.
     */
    llmThink: text('llm_think').$type<ThinkLevel>(),
    llmPromptVersion: text('llm_prompt_version'),
    /**
     * When *the verdict* was produced — the only column that answers that. `scoredAt` cannot: a
     * keyword rescore, and any run touching any profile, rewrites it. Read for the record, not as a
     * gate: `llmScore` being null is what makes a row a tier-1 candidate.
     */
    llmScoredAt: timestamp('llm_scored_at'),
    finalScore: real('final_score').notNull(),
    explanation: text('explanation'),
    scoredAt: timestamp('scored_at').notNull().$defaultFn(now),
  },
  t => [
    primaryKey({ columns: [t.jobId, t.profileId] }),
    index('job_scores_profile_final_score_idx').on(t.profileId, t.finalScore),
  ],
)

export const pipelineRuns = sqliteTable('pipeline_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  profileId: integer('profile_id')
    .notNull()
    .references(() => searchProfiles.id, { onDelete: 'cascade' }),
  startedAt: timestamp('started_at').notNull().$defaultFn(now),
  finishedAt: timestamp('finished_at'),
  summary: json<Record<string, number | string[]>>('summary'),
  errors: json<{ source: string; message: string }[]>('errors').notNull().default([]),
})
