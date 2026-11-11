import { createHash } from 'node:crypto'
import { load } from 'cheerio'
import { legalSuffixes, trackingParams, workModePatterns } from './config/rubric'
import type { WorkMode } from './db/schema'
import type { NormalizedJob, RawJob } from './types'

/** Trim, collapse runs of spaces/tabs per line, collapse blank-line runs, '' → null. */
export function clean(value: string | null | undefined): string | null {
  const out = (value ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return out || null
}

/**
 * HTML → text. Block tags become newlines first, so `<p>a</p><p>b</p>` is two lines and
 * `a<br>b` does not glue into "ab". Entities decode as a side effect of cheerio's parse.
 * Plain text passes through unharmed.
 */
export function htmlToText(value: string | null | undefined): string | null {
  if (!value) return null
  const withBreaks = value.replace(/<\s*(br|\/p|\/li|\/div|\/tr|\/h[1-6])\s*\/?\s*>/gi, '\n')
  return clean(load(withBreaks).text())
}

/**
 * Comparison form: lowercase, diacritics folded ("Zürich" → "zurich"), whitespace collapsed.
 * Punctuation is kept on purpose — Phase 7 matches keywords like "C++" and "CI/CD" against
 * these fields, and stripping symbols would make those unmatchable.
 */
export function compare(value: string | null | undefined): string | null {
  const text = clean(value)
  return (
    text &&
    text
      .normalize('NFKD')
      .replace(/\p{M}+/gu, '')
      .toLowerCase()
  )
}

/** compare() plus repeated removal of trailing legal forms, so "Alpine Fintech AG" === "Alpine Fintech". */
export function compareCompany(value: string | null | undefined): string | null {
  let name = compare(value)
  if (!name) return null
  // A suffix is only cut when something is left in front of it, so a firm called just "AG" keeps it.
  const suffix = new RegExp(`[\\s,.]+(${legalSuffixes.join('|')})$`, 'u')
  for (;;) {
    const next = name
      .replace(/[\s,.()]+$/, '')
      .replace(suffix, '')
      .trim()
    if (!next || next === name) return name
    name = next
  }
}

/**
 * Strip tracking params and fragment, lowercase the host, drop a trailing slash, sort the
 * params that remain so two orderings of the same link hash alike.
 * A URL `new URL` cannot parse is returned as-is: a source handing out junk must not abort a run.
 */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url.trim())
    u.hash = ''
    for (const key of [...u.searchParams.keys()]) {
      if (key.startsWith('utm_') || trackingParams.includes(key.toLowerCase())) u.searchParams.delete(key)
    }
    u.searchParams.sort()
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '')
    return u.toString()
  } catch {
    return url.trim()
  }
}

/** SHA-256 over the comparison forms, '|'-joined. null counts as an empty part, never skipped. */
export function contentHash(parts: (string | null)[]): string {
  return createHash('sha256')
    .update(parts.map(p => p ?? '').join('|'))
    .digest('hex')
}

/** First pattern in rubric order wins — hybrid is listed before remote. No match → null. */
export function detectWorkMode(text: string): WorkMode | null {
  return workModePatterns.find(p => p.pattern.test(text))?.mode ?? null
}

/** The one RawJob → NormalizedJob function. Pure: no DB, no network, no framework. */
export function normalize(raw: RawJob): NormalizedJob {
  const title = clean(raw.title) ?? ''
  const company = clean(raw.company)
  const location = clean(raw.location)
  const description = htmlToText(raw.description)

  const normTitle = compare(title) ?? ''
  const normCompany = compareCompany(company)
  const normLocation = compare(location)
  const normDescription = compare(description)

  return {
    ...raw,
    title,
    company,
    location,
    description,
    // Detected on the cleaned text, not the folded form: "100% vor Ort" and "on-site" keep the
    // punctuation the patterns look for.
    workMode: detectWorkMode(`${title}\n${description ?? ''}`),
    canonicalUrl: canonicalUrl(raw.url),
    contentHash: contentHash([normTitle, normCompany, normLocation, normDescription]),
    normTitle,
    normCompany,
    normLocation,
    normDescription,
  }
}
