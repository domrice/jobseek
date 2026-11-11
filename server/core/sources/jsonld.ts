import { load } from 'cheerio'

/** The fields every adapter reads off a JSON-LD JobPosting. Anything else is ignored. */
export interface JobPostingLd {
  title?: string
  description?: string
  datePosted?: string
  /** jobs.ch carries the posting id here, and the absolute posting URL in `url`. */
  identifier?: { value?: string }
  url?: string
  hiringOrganization?: { name?: string }
  /** jobs.ch detail pages put the city in `addressRegion` and leave `addressLocality` out. */
  jobLocation?: { address?: { addressLocality?: string; addressRegion?: string } }
}

/**
 * Every JSON-LD `JobPosting` on a page: the ones sitting directly in a block (it is often an array —
 * JobPosting + BreadcrumbList/WebPage, so both shapes are walked), then the ones nested as
 * `ItemList.itemListElement[].item`, which is how jobs.ch ships a page of result cards.
 *
 * Directly-placed postings come first, and that order is load-bearing: `jobPostingLd` takes the
 * first, so a detail page that grows a "similar jobs" `ItemList` still yields the page's own posting
 * and not a card stub.
 *
 * Control characters are stripped before parsing: michaelpage embeds raw newlines *inside* JSON
 * strings and strict `JSON.parse` rejects those ("Invalid control character at ... char 645").
 * They only ever sit in the description, which normalize() collapses anyway.
 */
export function jobPostingsLd(html: string): JobPostingLd[] {
  const $ = load(html)
  const direct: JobPostingLd[] = []
  const listed: JobPostingLd[] = []
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    let parsed: unknown
    try {
      parsed = JSON.parse(
        $(el)
          .text()
          .replace(/[\u0000-\u001F]/g, ' '),
      )
    } catch {
      continue
    }
    for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
      const typed = node as { '@type'?: string; itemListElement?: { item?: { '@type'?: string } }[] }
      if (typed?.['@type'] === 'JobPosting') direct.push(node as JobPostingLd)
      if (typed?.['@type'] === 'ItemList' && Array.isArray(typed.itemListElement)) {
        for (const li of typed.itemListElement) {
          if (li?.item?.['@type'] === 'JobPosting') listed.push(li.item as JobPostingLd)
        }
      }
    }
  }
  return [...direct, ...listed]
}

/** First JSON-LD `JobPosting` on a page, or null. */
export function jobPostingLd(html: string): JobPostingLd | null {
  return jobPostingsLd(html)[0] ?? null
}
