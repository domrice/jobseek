import { requestDelayMs } from '../config/env'
import type { JobSource } from '../types'
import * as ashby from './ashby'
import * as eightfold from './eightfold'
import * as greenhouse from './greenhouse'
import * as jobsch from './jobsch'
import * as jobscout24 from './jobscout24'
import * as lever from './lever'
import * as michaelpage from './michaelpage'
import * as onlyfy from './onlyfy'
import * as recruitee from './recruitee'
import * as swissdevjobs from './swissdevjobs'
import * as workable from './workable'
import * as workday from './workday'
import * as wordpress from './wordpress'
import * as zuerijobs from './zuerijobs'

/**
 * Per-source rate-limit floor, applied here and not in the pipeline: `rateLimitMs` on a registry
 * entry is the truth the pipeline obeys verbatim, which is what lets a test source declare 0 and
 * run instantly.
 */
const rateLimitMs = Math.max(2000, requestDelayMs)

/** An adapter module, enabled at the floor rate. */
const board = ({ name, search }: Pick<JobSource, 'name' | 'search'>, blurb: string, tosNote: string): JobSource => ({
  name,
  search,
  enabled: true,
  blurb,
  rateLimitMs,
  tosNote,
})

/** A source whose robots.txt or ToS forbids us. Code kept, never queried. */
const blocked = (name: string, tosNote: string): JobSource => ({
  name,
  enabled: false,
  rateLimitMs,
  tosNote,
  search: () => Promise.reject(new Error(`${name} is disabled: ${tosNote}`)),
})

/**
 * The allowlist. Adding an entry is the only way a source is ever queried — there is no runtime
 * robots.txt parser, so `tosNote` is the record of a hand check.
 */
export const registry: JobSource[] = [
  board(
    jobscout24,
    'General Swiss job board, all industries',
    'robots.txt allows /en/jobs/ and /en/job/ (only /de/apply/, /app/, /companies/ and friends ' +
      'are disallowed); no Crawl-delay given, so the 2000ms floor stands. Server-rendered HTML, ' +
      'no private API, no token.',
  ),
  board(
    zuerijobs,
    'Zurich region, all industries',
    'robots.txt disallows only /rss/ and asks Crawl-delay: 1, which the 2000ms floor already ' +
      'exceeds; /jobs and /jobs/{id}-{slug} are allowed. Server-rendered HTML — `q` filters in ' +
      'the served markup and `page` is real 1-indexed pagination — no private API, no token.',
  ),
  board(
    michaelpage,
    'Recruitment agency — finance, engineering, management',
    'robots.txt disallows /*/search/, /job-apply/, the ' +
      'salary/contract/brand/item_per_pages facet queries and the deep facet paths */jobs/*/*/*/ ' +
      '(while explicitly allowing */browse/jobs/*/*/*/); /jobs?search=&location=&page= and ' +
      '/job-detail/ are not disallowed. No Crawl-delay for * (bingbot gets 1s), so the 2000ms ' +
      'floor stands.',
  ),
  board(
    swissdevjobs,
    'Software and IT jobs only',
    'robots.txt disallows only /apply-for-this-role-by-clicking-here/, ' +
      '/admin/, /wp-content/, a few asset paths and *.txt/*.php/*.sql-style extensions; /rss is ' +
      'allowed for * (the one /api/ rule is scoped to Meta-ExternalAgent). No Crawl-delay, so the ' +
      '2000ms floor stands.',
  ),
  board(
    jobsch,
    'The largest Swiss job board, all industries',
    'robots.txt disallows /api/ and /api_proxy/ (so the private search ' +
      'API stays off limits), /*?*feat= (so no facet parameter is ever sent — the home-office ' +
      'facet is one, which is why remoteOnly is dropped), the login/register/application paths, ' +
      'and /en/vacancies/detail/*/*/* — three segments, while a posting is ' +
      '/en/vacancies/detail/{uuid}/ with one, so the detail pages are allowed. /en/vacancies/ ' +
      'itself is allowed; the Disallow: / is scoped to SemrushBot, not *. No Crawl-delay, so the ' +
      '2000ms floor stands.',
  ),
  board(
    greenhouse,
    'Career pages of tracked employers (Greenhouse ATS)',
    'Not a board but an ATS: boards-api.greenhouse.io is a ' +
      'first-party public API that Greenhouse documents so its customers can build their own ' +
      'career sites on it, and reads need no authentication — reading it is the intended use, a ' +
      'cleaner footing than the HTML parsing every other adapter here does. Note this is NOT the ' +
      'my.greenhouse.io job-seeker product: that one is login-gated (401/302 to /users/sign_in) ' +
      'and its User Agreement 2(z) forbids "spiders, robots, crawlers", so its cross-board ' +
      'location search is off limits and the employer list is hand-curated instead.',
  ),
  board(
    lever,
    'Career pages of tracked employers (Lever ATS)',
    'Same kind as greenhouse: api.lever.co/v0/postings/{token} is the ' +
      'public postings API behind every jobs.lever.co board, no authentication for reads.',
  ),
  board(
    ashby,
    'Career pages of tracked employers (Ashby ATS)',
    'Same kind as greenhouse: api.ashbyhq.com/posting-api/job-board/' +
      '{token} is the public board API behind every jobs.ashbyhq.com page, no authentication for ' +
      'reads.',
  ),
  board(
    recruitee,
    'Career pages of tracked employers (Recruitee ATS)',
    'Same kind as greenhouse: every {token}.recruitee.com careers ' +
      'site serves its own board at /api/offers/, no authentication. robots.txt on those ' +
      'subdomains disallows only /v/ (the preview path).',
  ),
  board(
    workable,
    'Career pages of tracked employers (Workable ATS)',
    'Same kind as greenhouse: apply.workable.com/api/v1/widget/' +
      'accounts/{token}?details=true is the endpoint the public board widget itself calls, no ' +
      'authentication.',
  ),
  board(
    workday,
    'Career pages of tracked large employers (Workday ATS)',
    '/wday/cxs/{tenant}/{site}/jobs is the undocumented JSON API the ' +
      'public myworkdayjobs.com careers page itself calls, no authentication. robots.txt is per ' +
      'tenant, so each is checked beside its employers.ts entry. Pages are paced at the floor ' +
      'because Workday throttles fast paging.',
  ),
  board(
    wordpress,
    'Career pages of tracked small employers (WordPress sites)',
    '/wp-json/wp/v2/job-listings is the WordPress core REST API serving ' +
      'the WP Job Manager plugin posts the site itself publishes, no authentication. robots.txt is ' +
      'per site, so each is checked beside its employers.ts entry; no query string is ever sent, ' +
      'since sites commonly disallow /*?.',
  ),
  board(
    onlyfy,
    'Career pages of tracked employers (onlyfy ATS)',
    '{token}.onlyfy.jobs robots.txt disallows only /recruiter/ and ' +
      '/change_language and asks Crawl-delay: 1, which the 2000ms floor exceeds; /en?page= and ' +
      '/job/show/{id}/full (the ad the public posting page embeds) are allowed. Server-rendered ' +
      'HTML, no API, no token.',
  ),
  board(
    eightfold,
    'Career pages of tracked employers (Eightfold ATS)',
    '{host} robots.txt disallows / but explicitly allows /careers and /api/pcsx, the JSON API ' +
      'the public careers page itself calls (search + position_details), no authentication. ' +
      'jobs.on.com links no terms of use, only a privacy policy and imprint. Login-gated paths ' +
      '(apply, notifications) are not touched.',
  ),
  blocked(
    'indeed.ch',
    'robots.txt disallows /rss (the planned access path) and, decisively, ch.indeed.com answers 403 ' +
      'to a plain UA-identified GET of /jobs at all. Getting in would mean evading bot protection.',
  ),
  blocked(
    'linkedin',
    'Three independent verdicts, any one of them decisive. ' +
      '(1) robots.txt names "Disallow: /jobs-guest/" outright — that is the guest endpoint — ' +
      'alongside /jobs?runSearch*, /api/jobPostings/jobs* and /voyager/api, and there is no ' +
      'User-agent: * block at all, only named crawlers: an allowlist we are not on. Its preamble ' +
      'reads "The use of robots or other automated means to access LinkedIn without the express ' +
      'permission of LinkedIn is strictly prohibited". The guest endpoint needs no auth, which is ' +
      'not the same as being allowed. (2) The credentialed route (session cookie against the ' +
      'internal Voyager API) violates User Agreement 8.2 twice over — "scrape or copy the ' +
      'Services" and "use bots or other unauthorized automated methods to access the Services" — ' +
      'and is reported to get the borrowed account restricted within days. (3) Applying via ' +
      'whitelist-crawl@linkedin.com does not help: the grant confines use "solely to search ' +
      'indexing for display in a publicly available search engine on the Internet", and a local ' +
      'single-user app is not that. There is also no official read/search jobs API at any price — ' +
      'the Job Posting API is partner-gated publishing, closed to new partners. The postings we ' +
      'want originate in each employer ATS anyway, which employers.ts reads directly.',
  ),
]
