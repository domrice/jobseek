import { setTimeout as sleep } from 'node:timers/promises'
import { employers } from '../config/employers'
import type { Employer } from '../config/employers'
import { requestDelayMs } from '../config/env'
import { httpGet } from '../http'
import { compare } from '../normalize'
import type { RawJob, SearchResult } from '../types'

/**
 * What every ATS adapter shares. The three board platforms differ only in their URL and their JSON
 * field names — the Swiss test and the per-employer walk are identical, so they live here once
 * rather than three times, the same reason `jsonld.ts` exists.
 */

/**
 * Country names in all four national languages plus English, and the cities big enough to be written
 * without one. These boards are global — one employer ships 822 postings — so without this filter a
 * single company would outweigh the rest of the table and the app would be storing jobs in Denver.
 *
 * This is a *fetch-time* filter, not a scoring rule, which is why it is here and not in `rubric.ts`:
 * location is never scored, and nothing downstream should learn to read it.
 *
 * ponytail: a hand-written city list, tested against the `compare()`-folded string so `Zürich`,
 * `Zurich` and `ZÜRICH` are one case. Ceiling: a posting in a town not on the list, written without
 * a country, is dropped silently. Upgrade path: none cheap — a real gazetteer is a dependency and a
 * network call, both out of scope. The country names carry the common case; every board checked
 * writes at least `Switzerland` on remote roles.
 */
const SWISS =
  /\b(switzerland|schweiz|suisse|svizzera|swiss|zurich|geneva|geneve|genf|ginevra|basel|basle|bale|bern|berne|lausanne|lugano|winterthur|st gallen|st\. gallen|sankt gallen|zug|lucerne|luzern|neuchatel|fribourg|freiburg|biel|bienne|thun|sion|chur|schlieren|rotkreuz|kaiseraugst|yverdon|renens|ecublens|wallisellen|opfikon|baar|cham|allschwil|dubendorf|kloten|rapperswil|vevey|montreux|locarno|bellinzona|heerbrugg)\b/

/** Does this one string name a Swiss place? Folded first, so diacritics and case do not matter. */
export function swissPlace(value: string | null | undefined): boolean {
  const folded = compare(value)
  return folded !== null && SWISS.test(folded)
}

/**
 * Walk one platform's employers, one request each, and flatten what the adapter parses.
 *
 * Which place strings an adapter tests with `swissPlace` is a per-platform judgement and deliberately
 * not decided here — Ashby's `secondaryLocations` are the *job's* other locations and belong in the
 * test, while Greenhouse's `offices` are the *company's* and do not. Passing the wrong ones is how 15
 * of 187 rows once came back from Lisbon and Warsaw.
 *
 * Throttled here rather than by the pipeline — the pipeline sleeps only *between* sources, so a
 * source making N requests must pace itself. A single employer's failure — a dead token, or a 200
 * that is not JSON — is swallowed: it must not cost the other boards. All of them failing is a
 * different thing — that is the source being broken — so it throws and the pipeline records it in
 * `pipeline_runs.errors` instead of quietly storing nothing.
 *
 * `eachEmployer` is that walk and failure rule; `searchBoards` is the one-request body for platforms
 * that return descriptions inline, so its `touched` is always empty — no detail fetch for `seen` to gate.
 */
export async function eachEmployer(
  platform: Employer['platform'],
  one: (employer: Employer) => Promise<SearchResult>,
): Promise<SearchResult> {
  const boards = employers.filter(e => e.platform === platform)
  const result: SearchResult = { jobs: [], touched: [] }
  let failed = 0

  for (const employer of boards) {
    try {
      const r = await one(employer)
      result.jobs.push(...r.jobs)
      result.touched.push(...r.touched)
    } catch {
      failed++
    }
  }
  if (boards.length && failed === boards.length) {
    throw new Error(`all ${failed} ${platform} boards failed`)
  }

  return result
}

export function searchBoards(
  platform: Employer['platform'],
  listUrl: (employer: Employer) => string,
  parseBoard: (json: unknown, employer: Employer) => RawJob[],
): Promise<SearchResult> {
  return eachEmployer(platform, async employer => {
    await sleep(requestDelayMs)
    return { jobs: parseBoard(await (await httpGet(listUrl(employer))).json(), employer), touched: [] }
  })
}
