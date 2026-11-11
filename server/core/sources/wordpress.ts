import { load } from 'cheerio'
import type { Employer } from '../config/employers'
import type { RawJob } from '../types'
import { searchBoards, swissPlace } from './ats'
import { toDate } from './board'

export const name = 'wordpress'

/**
 * A company's own WordPress site running the WP Job Manager plugin, which exposes its `job_listing`
 * posts on the core REST API. One request per employer, descriptions inline — the greenhouse shape.
 * The token is the site's host.
 *
 * ponytail: no `?per_page=`/`?page=` — robots.txt on these sites commonly disallows `/*?` (layered.ch
 * does), so the default page of 10 is all we read. Ceiling: an employer with more than 10 open jobs
 * loses the oldest. Upgrade path: none that robots allows; check that site's robots before paging.
 */
export function listUrl({ token }: Employer): string {
  return `https://${token}/wp-json/wp/v2/job-listings`
}

interface WpJob {
  id?: number
  date_gmt?: string
  link?: string
  title?: { rendered?: string }
  content?: { rendered?: string }
  meta?: { _job_location?: string; _filled?: number | string }
}

/**
 * `content.rendered` is HTML with the page builder's (WPBakery) shortcodes left in as text —
 * `[vc_row …][vc_column_text]` — so those are cut; normalize()'s htmlToText does the rest. Only `vc_`
 * tags are cut: Tailwind-style class names such as `[li_&]:mb-0` sit in the same markup.
 */
export function parseBoard(json: unknown, employer: Employer): RawJob[] {
  const out: RawJob[] = []
  for (const job of Array.isArray(json) ? (json as WpJob[]) : []) {
    const location = job.meta?._job_location?.trim() || null
    if (job.id === undefined || !job.link || !job.title?.rendered || Number(job.meta?._filled)) continue
    // A site with no location field is still the Swiss employer's own board.
    if (location && !swissPlace(location)) continue
    out.push({
      source: name,
      sourceJobId: `${employer.token}:${job.id}`,
      url: job.link,
      // The title arrives entity-encoded (`&#038;`).
      title: load(job.title.rendered).root().text(),
      company: employer.company,
      location,
      description: job.content?.rendered?.replace(/\[\/?vc_[^\]]*\]/g, '') || null,
      // `date_gmt` carries no zone marker; `date` is site-local time.
      postedAt: job.date_gmt ? toDate(`${job.date_gmt}Z`) : null,
    })
  }
  return out
}

export const search = () => searchBoards('wordpress', listUrl, parseBoard)
