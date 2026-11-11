import { z } from 'zod'
import { llm, llmTimeoutMs } from '../config/env'
import { httpGet, httpPostJson } from '../http'
import { llmScoreSchema } from '../types'
import type { LlmScore, NormalizedJob, SearchProfile, ThinkLevel } from '../types'
import { buildSystem, buildUser } from './prompt'

export { PROMPT_VERSION } from './prompt'

export interface ScoringProvider {
  /** Written to `job_scores.llmModel`, so a rescore with a different model is visible. */
  readonly model: string
  /**
   * Written to `job_scores.llmThink`. The deep pass selects on the (model, think) pair, so this
   * has to travel with the tag rather than being read back off the run's input — it is a property
   * of the provider that produced the verdict, exactly as `model` is.
   */
  readonly think: ThinkLevel
  scoreJob: (input: { profile: SearchProfile; job: NormalizedJob }) => Promise<LlmScore>
}

/** The only place a `ThinkLevel` becomes Ollama's `think` field. `on` = let the model decide. */
const thinkField = { off: false, on: true } as const

/** Derived schema for Ollama's `format` field. `$schema` is not accepted there. */
const { $schema: _, ...jsonSchema } = z.toJSONSchema(llmScoreSchema)

/**
 * Model output is untrusted text. A fence is the one deviation small local models make often
 * enough to be worth handling; anything else is an error, not something to repair.
 */
export function parseLlmResponse(text: string): LlmScore {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch {
    throw new Error(`LLM returned non-JSON: ${stripped.slice(0, 200)}`)
  }
  const result = llmScoreSchema.safeParse(parsed)
  if (!result.success) throw new Error(`LLM JSON failed validation: ${z.prettifyError(result.error)}`)
  return result.data
}

/** Ollama's native chat API. `format` takes a JSON schema, which is stricter than its /v1 shim. */
const ollama = (baseUrl: string, model: string, level: ThinkLevel): ScoringProvider => ({
  model,
  think: level,
  async scoreJob({ profile, job }) {
    const res = await httpPostJson<{ message?: { content?: string } }>(
      `${baseUrl}/api/chat`,
      {
        model,
        // System holds everything constant for the run, the posting goes last. Ollama's KV cache
        // keys on the token prefix, not on this role boundary — measured identical either way —
        // so what earns the ~5× on later calls is the ordering, not the split.
        messages: [
          { role: 'system', content: buildSystem(profile) },
          { role: 'user', content: buildUser(job) },
        ],
        stream: false,
        // Load-bearing, not a tweak: left on, a reasoning model spends its whole budget thinking
        // before the schema-constrained answer — 31.7s to 68.6s on Qwen3-32B over 32 real postings,
        // for a *worse* ranking. LLM_THINK and the run bar re-enable it.
        //
        // A model without a thinking mode does NOT ignore this field: Ollama 0.32.9 answers `true`
        // with a 400 `"<model>" does not support thinking`. That is a property of the *packaging*,
        // not the weights — the gemma4 library tags advertise `thinking` and work here; the hf.co
        // GGUF re-uploads of the same weights 400 (CLAUDE.md). `off` sends `think: false`, which
        // every model accepts.
        think: thinkField[level],
        format: jsonSchema,
        options: {
          // Scoring must be reproducible: the same posting twice should not move the number.
          // Google's gemma-4 card recommends 1.0 with top_p 0.95 / top_k 64 — measured on 32 real
          // postings and rejected: ρ 0.89, mid-band separation 10 → 8, 13% slower, no gain.
          // At temperature 0 top_p and top_k are inert, which is why they are absent rather than set.
          temperature: 0,
          // Explicit, because Ollama silently truncates a prompt past num_ctx and its default is
          // small — losing the tail of a CV without a word is exactly the kind of guessing this
          // codebase refuses to do. The prompt is bounded by the `cv` cap in searchProfileInsertSchema
          // plus MAX_DESCRIPTION; at ~4 chars/token this holds both with room to spare. Raising
          // either cap past ~48k chars of combined input means raising this too.
          num_ctx: 16_384,
        },
      },
      { timeout: llmTimeoutMs },
    )
    return parseLlmResponse(res.message?.content ?? '')
  },
})

/** null means no LLM_MODEL, which is a supported mode, not a failure. */
export function getProvider(think: ThinkLevel = llm?.think ?? 'off', model?: string): ScoringProvider | null {
  return llm && ollama(llm.baseUrl, model || llm.model, think)
}

/**
 * The run bar's dropdowns (`models`, sorted by name) and their defaults. `fast` is LLM_MODEL when
 * Ollama holds it; `deep` the largest *other* tag by size, null when only one tag exists — never
 * the fast tag, or Deep-Score is a no-op.
 */
export async function listModels() {
  if (!llm) return { models: [], fast: null, deep: null }
  const held = await tags(llm.baseUrl)
  // Ollama down still leaves LLM_MODEL selectable, so a run stays possible.
  const models = held.length ? held.map(t => t.name).sort() : [llm.model]
  // LLM_MODEL only when Ollama actually holds it. A tag it lacks is its own 404, and the
  // dropdown must show what a click will really send rather than a name that would 404 on press.
  const fast = (models.includes(llm.model) ? llm.model : models[0]) ?? null
  const deep = held.filter(t => t.name !== fast).sort((a, b) => b.size - a.size)[0]?.name ?? null
  return { models, fast, deep }
}

/** Ollama's own tag list with sizes; empty when it is down. */
async function tags(baseUrl: string): Promise<{ name: string; size: number }[]> {
  try {
    const res = await httpGet(`${baseUrl}/api/tags`)
    const { models } = (await res.json()) as { models: { name: string; size: number }[] }
    return models
  } catch {
    return []
  }
}
