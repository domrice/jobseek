import { load } from 'cheerio'
import { httpGet } from '../http'
import type { RawJob, SearchResult } from '../types'
import { toDate } from './board'

const BASE = 'https://swissdevjobs.ch'
export const name = 'swissdevjobs'

/**
 * The feed is the adapter: `<description>` already carries the full posting as HTML (byte-identical
 * to `content:encoded` across all 176 items, so only one of them is read), which is why this source
 * has no detail step and no `parseDetail`.
 *
 * Title format is `<Role> @ <Company> [CHF x - y]`. The bracket is stripped — salary has no column,
 * and the description repeats it in its first line anyway. The split is on the *last* ` @ `, since
 * a role can hold one ("Full-Stack Entwickler/in @ …" cannot, but "DevOps @ Scale" could) and the
 * company is always last. No ` @ ` means no company: null, never a guess.
 *
 * The id is the link's own path segment, not `<guid>`: both carry `?utm_source=our_rss_feed`, and
 * the pathname is what keeps that out of the identity key. (canonicalUrl strips utm_ separately, but
 * the id is a UNIQUE column and must not depend on that.)
 */
export function parseList(xml: string): RawJob[] {
  // xmlMode: cheerio parses XML with the same API, so RSS costs no new dependency.
  const $ = load(xml, { xmlMode: true })
  const out = new Map<string, RawJob>()
  for (const el of $('item').toArray()) {
    const item = $(el)
    const href = item.find('link').first().text().trim()
    const raw = item.find('title').first().text().trim()
    if (!href || !raw) continue
    const url = new URL(href, BASE)
    const sourceJobId = url.pathname.split('/').filter(Boolean).pop()
    if (!sourceJobId || out.has(sourceJobId)) continue

    const stripped = raw.replace(/\s*\[[^\]]*\]\s*$/, '').trim()
    const at = stripped.lastIndexOf(' @ ')

    out.set(sourceJobId, {
      source: name,
      sourceJobId,
      url: url.toString(),
      title: (at === -1 ? stripped : stripped.slice(0, at)).trim(),
      company: at === -1 ? null : stripped.slice(at + 3).trim() || null,
      // The feed carries no location field at all — a display column stays empty, never invented.
      location: null,
      // Raw HTML; normalize() owns htmlToText, exactly as the JSON-LD adapters leave it.
      description: item.find('description').first().text().trim() || null,
      postedAt: toDate(item.find('pubDate').first().text().trim()),
    })
  }
  return [...out.values()]
}

/**
 * The whole board in one request. There are no query parameters at all — no `q`, no page, nothing
 * to diff — so the parameter check the other adapters need does not apply here: the feed is either
 * all of it or none of it. Keyword scoring does the filtering, as it does for michaelpage's browse
 * rows.
 *
 * ponytail: `query`, `location` and `remoteOnly` are dropped because the feed has nowhere to put
 * them. Ceiling: ~176 IT/dev postings countrywide on every run, most of them irrelevant to a
 * non-dev profile. Upgrade path: none worth taking — one request for the board is the whole point.
 *
 * No detail step, so nothing to skip: `seen` is not taken and `touched` is always empty. Re-parsing
 * is free and the description is inline, so every run rehashes the same content and the
 * contentHash — and with it every LLM verdict — stays put.
 */
export async function search(): Promise<SearchResult> {
  return { jobs: parseList(await (await httpGet(`${BASE}/rss`)).text()), touched: [] }
}
