import { scoreBands } from '../config/rubric'
import type { NormalizedJob, SearchProfile } from '../types'

/**
 * Stored on every score row as `llmPromptVersion`. Bump it whenever the text below changes
 * meaningfully — otherwise two rows scored by different prompts are indistinguishable.
 */
export const PROMPT_VERSION = 'v6'

// ponytail: a fixed character cap instead of a token count. Ceiling: a very long posting loses
// its tail, which is usually boilerplate. Upgrade path: raise the cap, or chunk and summarise.
export const MAX_DESCRIPTION = 10_000

const RULES = `You assess how well a single job posting fits one candidate.

Rules:
- Use only evidence present in the candidate profile and the job description. Nothing else.
- Never assume a skill the candidate has not stated. An unmentioned skill is a gap, not a pass.
- Distinguish required from preferred. A missing required skill weighs far more than a missing
  preferred one, and a missing preferred one is barely a gap at all.
- German and English are never a gap. A required French or Italian is a gap, and a concern if the
  requirement is strict. Never invent a language requirement the posting does not state.
- "score" is 0-100 and must agree with "recommendation": strong_match is ${scoreBands.strong}-100,
  possible_match ${scoreBands.possible}-${scoreBands.strong - 1}, poor_match 0-${scoreBands.possible - 1}.
- "confidence" is 0-1 and reflects how much the description actually told you. A thin or
  truncated posting means low confidence, whatever the score.
- "explanation" is at most three sentences, concrete, no marketing language.
- Reply with valid JSON matching the requested schema. No prose, no markdown, no code fence.`

const list = (label: string, items: string[]) => (items.length ? `${label}: ${items.join(', ')}` : null)
const join = (lines: (string | null)[]) => lines.filter(l => l !== null).join('\n')

/**
 * Rules and candidate — everything that does not change during a run.
 *
 * Pure, and byte-identical for every job scored against one profile. Keep it that way: Ollama's
 * KV cache reuses the shared token prefix across the scoring loop, worth ~5× on prompt eval for
 * calls after the first. Anything job-specific slipped in here breaks that for every later job.
 */
export function buildSystem(profile: SearchProfile): string {
  return join([
    RULES,
    '',
    '## Candidate profile',
    `Searching for: ${profile.query}`,
    list('Required skills', profile.requiredKeywords),
    list('Preferred skills', profile.preferredKeywords),
    list('Ruled out', profile.excludedKeywords),
    profile.location ? `Preferred location: ${profile.location}` : null,
    profile.remoteOnly ? 'Wants remote work only.' : null,
    '',
    '## Candidate CV',
    // Markdown, verbatim. It is the only place the candidate's actual experience appears.
    profile.cv?.trim() || '(The candidate provided no CV. Score on the profile alone and keep confidence low.)',
  ])
}

/** The one posting under judgement. Pure. No keyword data (see CLAUDE.md). */
export function buildUser(job: NormalizedJob): string {
  const description = job.description ?? ''
  return join([
    '## Job posting',
    `Title: ${job.title}`,
    `Company: ${job.company ?? 'not stated'}`,
    `Location: ${job.location ?? 'not stated'}`,
    `Work mode: ${job.workMode ?? 'not stated'}`,
    '',
    description.slice(0, MAX_DESCRIPTION) || '(The posting had no description. Keep confidence low.)',
    description.length > MAX_DESCRIPTION ? '\n(Description truncated.)' : null,
  ])
}
