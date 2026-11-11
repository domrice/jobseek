import { keywordAliases, weights } from '../config/rubric'
import { compare } from '../normalize'
import type { KeywordScore, NormalizedJob, SearchProfile } from '../types'

const WORDISH = '\\p{L}\\p{N}_'
const wordish = new RegExp(`[${WORDISH}]`, 'u')
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** member → every form in its group. Built once, at import, so the table stays one-directional. */
const groups = new Map<string, string[]>()
for (const [key, aliases] of Object.entries(keywordAliases)) {
  const group = [key, ...aliases]
  for (const member of group) groups.set(member, group)
}

const cache = new Map<string, RegExp>()

/**
 * One alternation over a term and its aliases, each guarded only on the sides where its own
 * edge character is word-ish. `\b` is a `\w`/non-`\w` transition, so `/\bc\+\+\b/` can never
 * match "c++ developer" — after `+` it demands a word char. Punctuation is already a boundary
 * against text, so those sides need no guard:
 *
 *   "go"    → (?<![\p{L}\p{N}_])go(?![\p{L}\p{N}_])   cannot match "Google"
 *   "c++"   → (?<![\p{L}\p{N}_])c\+\+                 no right guard
 *   "ci/cd" → (?<!…)ci\/cd(?!…)                       slash is interior, harmless
 *   ".net"  → \.net(?!…)                              no left guard, so "asp.net" matches
 *
 * No `i` flag: the term and the text are both compare()-folded already, and folding twice only
 * costs time and re-introduces Unicode-casing surprises.
 *
 * ponytail: a term ending in punctuation has no right guard, so "c+" would also match inside
 * "c++". Ceiling: no realistic keyword is a punctuation-prefix of another. Upgrade path: guard
 * with a negative lookahead over the same punctuation class.
 */
function termRegex(term: string): RegExp {
  const hit = cache.get(term)
  if (hit) return hit
  const body = (groups.get(term) ?? [term])
    .map(form => {
      // Both ends exist: every alias is a non-empty literal and every term is a truthy compare().
      const left = wordish.test(form.at(0)!) ? `(?<![${WORDISH}])` : ''
      const right = wordish.test(form.at(-1)!) ? `(?![${WORDISH}])` : ''
      return `${left}${escapeRe(form)}${right}`
    })
    .join('|')
  const re = new RegExp(body, 'u')
  cache.set(term, re)
  return re
}

/** `text` must be a compare() form; `keyword` is the profile's own spelling. */
export function matchesTerm(text: string, keyword: string): boolean {
  const term = compare(keyword)
  return term ? termRegex(term).test(text) : false
}

type Keywords = Pick<SearchProfile, 'requiredKeywords' | 'preferredKeywords' | 'excludedKeywords'>
type Text = Pick<NormalizedJob, 'normTitle' | 'normDescription'>

/**
 * ponytail: deliberately duplicates the prose shape of `explain()` in scripts/seed.ts rather
 * than sharing it — the seed's scores are hand-authored fixtures and must not move when the
 * scorer changes. Ceiling: the two can drift. Upgrade path: none wanted.
 */
const explain = (s: Omit<KeywordScore, 'score' | 'explanation'>) =>
  [
    [...s.matchedRequired, ...s.matchedPreferred].length
      ? `matched ${[...s.matchedRequired, ...s.matchedPreferred].join(', ')}`
      : 'no profile keywords matched',
    s.missingRequired.length ? `missing required ${s.missingRequired.join(', ')}` : null,
    s.matchedExcluded.length ? `excluded terms present: ${s.matchedExcluded.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('; ')

/** Pure and deterministic: same profile + same job → same object. No clock, no DB, no network. */
export function scoreKeywords(profile: Keywords, job: Text): KeywordScore {
  // Title first, so a description-less posting still scores; '\n' so no term spans the seam.
  const text = `${job.normTitle}\n${job.normDescription ?? ''}`

  const { requiredKeywords: required, preferredKeywords: preferred, excludedKeywords: excluded } = profile

  // The profile's own spellings are kept, not the alias that fired — the user reads back what
  // they typed.
  const matchedRequired = required.filter(k => matchesTerm(text, k))
  const missingRequired = required.filter(k => !matchesTerm(text, k))
  const matchedPreferred = preferred.filter(k => matchesTerm(text, k))
  const matchedExcluded = excluded.filter(k => matchesTerm(text, k))

  const raw =
    matchedRequired.length * weights.requiredMatch +
    missingRequired.length * weights.requiredMissing +
    matchedPreferred.length * weights.preferredMatch +
    matchedExcluded.length * weights.excludedMatch
  const floor = required.length * weights.requiredMissing + excluded.length * weights.excludedMatch
  const ceiling = required.length * weights.requiredMatch + preferred.length * weights.preferredMatch
  const span = ceiling - floor

  // span is 0 only when all three lists are empty; an excluded-only profile still spans
  // (no exclusions hit → 100, all hit → 0).
  const fit = span > 0 ? (raw - floor) / span : weights.noKeywords / 100
  const score = Math.round(fit * 100)

  const detail = { matchedRequired, missingRequired, matchedPreferred, matchedExcluded }
  return { score, ...detail, explanation: explain(detail) }
}
