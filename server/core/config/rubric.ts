import type { WorkMode } from '../db/schema'

/**
 * Work-mode patterns, in decision order. First match wins, so hybrid sits before remote:
 * "hybrid, 2 days remote" is hybrid, not remote. No match → null, which means the posting
 * did not say — not on-site.
 *
 * ponytail: a hand-maintained table of regexes over EN/DE/FR, because jobs.ch and jobup.ch
 * mix languages inside one result set. Ceiling: only phrasings listed here are recognised;
 * everything else falls through to null. Upgrade path: add a row.
 */
export const workModePatterns: { mode: WorkMode; pattern: RegExp }[] = [
  {
    mode: 'hybrid',
    pattern:
      /\bhybrid(e|es)?\b|teilweise vor Ort|home ?office (möglich|possible)|\b\d+\s*(days?|Tage?|jours?)\s*(pro Woche |per week |par semaine )?(remote|home ?office|im Büro|vor Ort|au bureau|sur site)/iu,
  },
  {
    mode: 'remote',
    pattern: /\b(fully |100 ?% )?remote\b|\bhome ?office\b|\bHomeoffice\b|télétravail|Fernarbeit/iu,
  },
  {
    mode: 'onsite',
    pattern: /100 ?% vor Ort|\bon[ -]?site\b|\bvor Ort\b|sur (le )?site|présentiel/iu,
  },
]

/**
 * Years of experience, EN/DE/FR. A number only counts within one sentence of an experience word,
 * either side of it. Groups: 1 = from, 2 = to, 3 = '+'. "mehrjährige Erfahrung" has no number → null.
 * Capped at 20, which no posting asks for and every company history exceeds ("80 years of experience
 * make us a competent partner").
 *
 * ponytail: first pattern that matches wins, then its first match. Ceilings: "seit 15 Jahren
 * bringen wir Erfahrung" reads as 15 years; per-skill years ("3 years Python, 5 years Java") keep
 * only the first. Upgrade path: add a row, or move it into the LLM's fast-pass schema.
 */
const YEARS_UPTO_20 = String.raw`(1?\d|20)`
const YEARS_N = String.raw`(?<!\d)${YEARS_UPTO_20}(?:\s*(?:-|–|bis|to|à)\s*${YEARS_UPTO_20})?\s*(\+)?\s*(?:years?|yrs|jahre?n?|ans|anni)(?!\p{L})`
const EXPERIENCE = String.raw`(?:experience|erfahrung|expérience|esperienza)`
const SAME_SENTENCE = String.raw`[^.\n]{0,40}?`
export const yearsPatterns = [
  new RegExp(`${YEARS_N}${SAME_SENTENCE}${EXPERIENCE}`, 'iu'),
  new RegExp(`${EXPERIENCE}${SAME_SENTENCE}${YEARS_N}`, 'iu'),
]

/**
 * Pensum. The title takes any percentage ("Engineer (80-100%)"); the description only a range or one
 * led by a pensum word, so "50% Rabatt" is not a workload. "100% remote" is a work mode and
 * "travel 10–20%" a travel share, never a pensum. Groups: 1 = from, 2 = to.
 */
const PCT_FROM = String.raw`(?<!\d)(\d{2,3})`
const PCT_TO = String.raw`\s*%?\s*(?:-|–|bis|à)\s*(\d{2,3})`
const PCT_END = String.raw`\s*%(?!\s*(?:remote|home|vor ort|on.?site|télétravail))`
export const pensumPatterns = {
  title: new RegExp(`${PCT_FROM}(?:${PCT_TO})?${PCT_END}`, 'iu'),
  description: [
    new RegExp(
      `(?:pensum|beschäftigungsgrad|taux d.activité|workload)[^.\\n]{0,20}?${PCT_FROM}(?:${PCT_TO})?${PCT_END}`,
      'iu',
    ),
    new RegExp(`(?<!(?:travel|reise|déplacement)[^.\\n]{0,20})${PCT_FROM}${PCT_TO}${PCT_END}`, 'iu'),
  ],
}

/**
 * Legal-form suffixes stripped from the company comparison form, so "Alpine Fintech AG" and
 * "Alpine Fintech" hash the same.
 *
 * ponytail: hand-maintained, matched only at the end of the string, and never applied if it
 * would empty the name (a firm literally called "AG" keeps it). Ceiling: a suffix in the
 * middle ("AG Services") survives. Upgrade path: add a row.
 */
export const legalSuffixes = [
  'ag',
  'sa',
  'sarl',
  'sagl',
  'gmbh',
  'kg',
  'ohg',
  'se',
  'ltd',
  'limited',
  'inc',
  'llc',
  'llp',
  'bv',
  'nv',
  'plc',
  'holding',
  'group',
]

/**
 * Keyword scoring points. The raw sum is normalized against what *this* profile could score,
 * so a 2-keyword and a 12-keyword profile both span 0–100. An excluded match is a term in the
 * sum like any other, so its bite shrinks as the profile grows — one excluded hit on a
 * 3-required profile costs more than on a 12-required one.
 */
export const weights = {
  requiredMatch: 10,
  requiredMissing: -6,
  preferredMatch: 4,
  excludedMatch: -12,
  /** Score when a profile lists no keywords at all (the `minimal` seed profile). Neutral, not 0. */
  noKeywords: 50,
}

/**
 * The one score-band table, shared by the prompt, `ScoreBadge`, the deep pass's default band and the
 * eval harness. `strong` is the floor of `strong_match`, `possible` the floor of `possible_match`;
 * `poor_match` is everything below `possible`. Moving either number **changes the prompt text**, so
 * bump `PROMPT_VERSION` — `llm.test.ts` asserts the prompt states these values.
 */
export const scoreBands = { strong: 67, possible: 33 }

/**
 * Synonym groups. Keys and members are `compare()` forms (lowercase, diacritics folded,
 * punctuation kept). Membership is symmetric: `keyword.ts` inverts this into a member → group
 * map, so a profile keyword of `TS` matches a posting saying `TypeScript` and vice versa.
 *
 * ponytail: exact strings, no stemming and no plurals. Ceiling: `kubernetes` matches `k8s` but
 * not `kube`. Upgrade path: add a row.
 */
export const keywordAliases: Record<string, string[]> = {
  typescript: ['ts'],
  javascript: ['js', 'ecmascript'],
  postgresql: ['postgres', 'psql'],
  aws: ['amazon web services'],
  kubernetes: ['k8s'],
  'ci/cd': ['cicd', 'ci / cd', 'continuous integration'],
  node: ['node.js', 'nodejs'],
}

/** Query params that identify a click, not a job. Prefix `utm_` is handled separately. */
export const trackingParams = ['gclid', 'fbclid', 'ref', 'source', 'mc_cid', 'mc_eid', 'msclkid', 'igshid']

/**
 * The CV cap, in characters. It bounds the LLM prompt, not storage — `buildSystem` puts the whole
 * CV in every call of a pass. It lives here rather than inline in `searchProfileInsertSchema`
 * because the profile form's counter has to state the same number the validator enforces, and
 * `types.ts` imports drizzle-zod, so a page cannot read it from there.
 */
export const cvMaxChars = 20_000
