import { load } from 'cheerio'
import type { Employer } from '../config/employers'
import type { RawJob } from '../types'
import { searchHtmlBoards, swissPlace } from './ats'
import { toDate } from './board'

export const name = 'zoho'

/**
 * A Zoho Recruit career site; the token is `{host}/jobs/{portal}`. robots.txt there disallows all but
 * `/jobs/*` and a few portal paths — the `/recruit/v2/public/` API the embed script calls included —
 * so the page itself is read: it server-renders every posting, plain-text description and all, as
 * JSON in `<input id="jobs">`. One request, no detail fetch.
 */
export function listUrl({ token }: Employer): string {
  return `https://${token}`
}

interface ZrJob {
  id: string
  Posting_Title?: string
  City?: string | null
  /** Unset is the literal `-Select-`, so it is tested but never displayed. */
  State?: string | null
  Country?: string | null
  Job_Description?: string | null
  Date_Opened?: string | null
}

export function parseBoard(html: string, employer: Employer): RawJob[] {
  const jobs = JSON.parse(load(html)('input#jobs').attr('value') || '[]') as ZrJob[]
  return jobs
    .filter(j => j.Posting_Title && [j.City, j.State, j.Country].some(swissPlace))
    .map(j => ({
      source: name,
      sourceJobId: `${employer.token}:${j.id}`,
      url: `https://${employer.token}/${j.id}`,
      title: j.Posting_Title!.trim(),
      company: employer.company,
      location: j.City?.trim() || null,
      description: j.Job_Description || null,
      postedAt: toDate(j.Date_Opened),
    }))
}

export const search = () => searchHtmlBoards(name, listUrl, parseBoard)
