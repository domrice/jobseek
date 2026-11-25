import { load } from 'cheerio'
import type { Employer } from '../config/employers'
import type { SearchQuery, SearchResult, Seen } from '../types'
import { searchPagedBoards, type PagedCard } from './ats'
import { toDate } from './board'
import { jobPostingLd } from './jsonld'

export const name = 'autoform'

/**
 * AutoForm's own TYPO3 careers site. robots.txt disallows `/*?`, so the filtered search URL is out;
 * the bare list page carries every posting with its location, and the posting page's JSON-LD the
 * description and date (the cards have none).
 *
 * ponytail: one list page. Ceiling: postings past the first page, if the list ever paginates (2
 * postings, no pager on 2026-11-18). Upgrade path: `?page=` is robots-allowed — raise `max`.
 */
export function listUrl({ token }: Employer): string {
  return `https://${token}/en/jobs/job-search/`
}

export function parseList(html: string, { token }: Employer): PagedCard[] {
  const $ = load(html)
  return $('.jobs-list-item')
    .toArray()
    .flatMap(el => {
      const card = $(el)
      const a = card.find('.card-title a')
      const id = card.attr('id')?.replace('jobuid-', '')
      const href = a.attr('href')
      if (!id || !href) return []
      const url = new URL(href, `https://${token}`).toString()
      // `<strong>Switzerland:</strong> Zurich`, one span per location.
      const places = card.find('.fa-map-marker-alt').parent().find('span').toArray()
      return [
        {
          sourceJobId: `${token}:${id}`,
          url,
          page: url,
          title: a.text().trim(),
          location: places.map(s => $(s).text().trim()).join('; ') || null,
          postedAt: null,
        },
      ]
    })
}

export function parseDetail(html: string) {
  const ld = jobPostingLd(html)
  return { description: ld?.description || null, postedAt: toDate(ld?.datePosted) }
}

export const search = (_query: SearchQuery, seen: Seen): Promise<SearchResult> =>
  searchPagedBoards(name, seen, listUrl, parseList, parseDetail, 0, 1)
