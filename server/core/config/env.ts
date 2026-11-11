import { existsSync } from 'node:fs'
import { thinkSchema } from '../types'

// ponytail: Node's built-in env-file loader instead of dotenv. Ceiling: no variable
// interpolation or multiline values. Upgrade path: add dotenv if either is ever needed.
// Path is relative to cwd — every entry point (CLI, nuxt) runs from the repo root.
if (existsSync('.env')) process.loadEnvFile('.env')

const num = (key: string, fallback: number) => {
  const raw = process.env[key]
  if (!raw) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${key} must be a positive number, got ${raw}`)
  return n
}

export const databasePath = process.env.DATABASE_PATH || './data/jobseek.db'
export const requestTimeoutMs = num('REQUEST_TIMEOUT_MS', 15_000)
/** Floor for per-source rate limits; a source may be slower, never faster. */
export const requestDelayMs = num('REQUEST_DELAY_MS', 2_000)

/** The 31B with thinking measured 84-121s a call; 120s aborted mid-run. Bounded so a hung call can't stall one. */
export const llmTimeoutMs = num('LLM_TIMEOUT_MS', 300_000)
/**
 * Candidates the LLM scores in one run. Uncapped by default: LLM scoring is its own button now, so
 * a long pass is a choice, and the run reports progress while it works instead of looking hung.
 */
export const llmMaxJobs = num('LLM_MAX_JOBS', Infinity)
/**
 * Age cap for an LLM rescore, on `lastSeenAt` and not `firstSeenAt`: a posting first seen 30 days
 * ago but still listed is live, and `lastSeenAt` is the column that says so. Only a rescore needs
 * this — a run only ever scores what it just fetched.
 */
export const llmRescoreDays = num('LLM_RESCORE_DAYS', 30)
/**
 * Age cap on the posting's own `postedAt`, for a run *and* a rescore. A different question from
 * llmRescoreDays: that one asks whether the board still lists the posting, this one asks whether
 * the posting is plausibly still open. A source that dates a listing months back is showing an
 * evergreen recruiter ad or an unfilled role — either way the verdict is not worth the call.
 * Both caps are needed: measured on a 417-row table, every row had been seen within a week
 * (nothing delisted yet) while 66 were dated past 90 days, swissdevjobs' RSS back to 2024.
 */
export const llmMaxPostedDays = num('LLM_MAX_POSTED_DAYS', 90)

const model = process.env.LLM_MODEL

/** Ollama, or null without LLM_MODEL: a fully supported, keyword-only mode. */
export const llm = model
  ? {
      // Ollama's default port, so a local setup needs LLM_MODEL and nothing else.
      baseUrl: (process.env.LLM_BASE_URL || 'http://localhost:11434').replace(/\/$/, ''),
      model,
      // Default for Ollama's `think` field, overridable per run from the UI. `off` because thinking
      // dominates the clock and buys little on a schema-constrained judgement — measured 48s vs 0.4s
      // on qwen3:8b. Parsed here so a typo fails at startup; the mapping lives in `llm/index.ts`.
      think: thinkSchema.parse((process.env.LLM_THINK || 'off').toLowerCase()),
    }
  : null
