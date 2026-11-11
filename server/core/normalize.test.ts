import { expect, it } from 'vitest'
import {
  canonicalUrl,
  clean,
  compare,
  compareCompany,
  contentHash,
  detectWorkMode,
  htmlToText,
  normalize,
} from './normalize'
import type { RawJob } from './types'

// --- clean ---

it('collapses whitespace and turns empty strings into null', () => {
  expect(clean('  Senior   Engineer \t')).toBe('Senior Engineer')
  expect(clean('a\r\n\n\n\nb')).toBe('a\n\nb')
  expect(clean('   ')).toBeNull()
  expect(clean('')).toBeNull()
  expect(clean(null)).toBeNull()
})

// --- htmlToText ---

it('turns HTML into text without gluing blocks together', () => {
  expect(htmlToText('<p>Line one</p><p>Line two</p>')).toBe('Line one\nLine two')
  expect(htmlToText('one<br>two')).toBe('one\ntwo')
  expect(htmlToText('<ul><li>a</li><li>b</li></ul>')).toBe('a\nb')
})

it('decodes entities and leaves plain text alone', () => {
  expect(htmlToText('R&amp;D &ndash; Z&uuml;rich')).toBe('R&D – Zürich')
  expect(htmlToText('TypeScript, Node and SQL.')).toBe('TypeScript, Node and SQL.')
})

// --- compare ---

it('folds case and diacritics but keeps punctuation for keyword matching', () => {
  expect(compare('Zürich')).toBe('zurich')
  expect(compare('Genève')).toBe('geneve')
  expect(compare('C++ and CI/CD')).toBe('c++ and ci/cd')
  expect(compare(null)).toBeNull()
})

it('strips legal suffixes from companies, but never the whole name', () => {
  expect(compareCompany('Alpine Fintech AG')).toBe('alpine fintech')
  expect(compareCompany('Lac Systems SA')).toBe('lac systems')
  expect(compareCompany('Rheintal Software GmbH')).toBe('rheintal software')
  expect(compareCompany('Nimbus Labs')).toBe('nimbus labs')
  // Repeated suffixes come off one at a time.
  expect(compareCompany('Helvetia Holding AG')).toBe('helvetia')
  // A firm called only by a legal form keeps it.
  expect(compareCompany('AG')).toBe('ag')
})

// --- canonicalUrl ---

it('strips tracking params, fragments and trailing slashes, and lowercases the host', () => {
  expect(canonicalUrl('https://WWW.Jobs.CH/en/vacancies/detail/123/#apply')).toBe(
    'https://www.jobs.ch/en/vacancies/detail/123',
  )
  expect(canonicalUrl('https://www.jobs.ch/job?id=7&utm_source=x&gclid=y&ref=z&source=q')).toBe(
    'https://www.jobs.ch/job?id=7',
  )
  // Param order must not change the hash-relevant string.
  expect(canonicalUrl('https://x.ch/j?b=2&a=1')).toBe(canonicalUrl('https://x.ch/j?a=1&b=2'))
  // Root slash stays; a junk URL comes back untouched rather than throwing.
  expect(canonicalUrl('https://x.ch/')).toBe('https://x.ch/')
  expect(canonicalUrl('  not a url  ')).toBe('not a url')
})

// --- contentHash ---

it('hashes deterministically over the comparison forms', () => {
  const parts = ['senior engineer', 'alpine fintech', 'zurich', 'typescript']
  expect(contentHash(parts)).toBe(contentHash([...parts]))
  expect(contentHash(parts)).toHaveLength(64)
  // null is an empty part, not a skipped one: these two must differ.
  expect(contentHash(['a', null, 'b', null])).not.toBe(contentHash(['a', 'b', null, null]))
  expect(contentHash(parts)).not.toBe(contentHash(['staff engineer', ...parts.slice(1)]))
})

it('gives the same hash to the same job posted with a different legal-form spelling', () => {
  const raw = (company: string): RawJob => ({
    source: 's',
    sourceJobId: '1',
    url: 'https://x.ch/1',
    title: 'Senior TypeScript Engineer',
    company,
    location: 'Zürich',
    description: 'TypeScript, Node, SQL.',
    postedAt: null,
  })
  expect(normalize(raw('Alpine Fintech Ltd.')).contentHash).toBe(normalize(raw('Alpine Fintech Ltd')).contentHash)
  expect(normalize(raw('Alpine Fintech AG')).contentHash).not.toBe(normalize(raw('Limmat Robotics AG')).contentHash)
})

// --- detectWorkMode ---

it('prefers hybrid over remote when both are mentioned', () => {
  expect(detectWorkMode('Hybrid, 2 days remote per week')).toBe('hybrid')
  expect(detectWorkMode('Teilweise vor Ort, teilweise Homeoffice')).toBe('hybrid')
  expect(detectWorkMode('3 jours par semaine au bureau')).toBe('hybrid')
})

it('detects remote and onsite in EN, DE and FR', () => {
  expect(detectWorkMode('Fully remote role')).toBe('remote')
  expect(detectWorkMode('Homeoffice möglich')).toBe('hybrid') // "möglich" is the hybrid phrasing
  expect(detectWorkMode('100% Homeoffice')).toBe('remote')
  expect(detectWorkMode('Télétravail complet')).toBe('remote')
  expect(detectWorkMode('100% vor Ort')).toBe('onsite')
  expect(detectWorkMode('On-site in Basel')).toBe('onsite')
  expect(detectWorkMode('Poste en présentiel')).toBe('onsite')
})

it('returns null when the posting says nothing about work mode', () => {
  expect(detectWorkMode('Backend Engineer. TypeScript, Node, SQL.')).toBeNull()
})

// --- normalize ---

it('normalizes a raw job end to end', () => {
  const job = normalize({
    source: 'jobs.ch',
    sourceJobId: '42',
    url: 'https://WWW.Jobs.CH/en/vacancies/detail/42/?utm_campaign=mail#top',
    title: '  Senior   Engineer  ',
    company: 'Alpine Fintech AG',
    location: '  Zürich ',
    description: '<p>TypeScript &amp; Node.</p><p>Hybrid, 2 days remote.</p>',
    postedAt: null,
  })

  expect(job.title).toBe('Senior Engineer')
  expect(job.description).toBe('TypeScript & Node.\nHybrid, 2 days remote.')
  expect(job.canonicalUrl).toBe('https://www.jobs.ch/en/vacancies/detail/42')
  expect(job.normTitle).toBe('senior engineer')
  expect(job.normCompany).toBe('alpine fintech')
  expect(job.normLocation).toBe('zurich')
  expect(job.workMode).toBe('hybrid')
  expect(job.contentHash).toBe(contentHash(['senior engineer', 'alpine fintech', 'zurich', job.normDescription]))
})

it('keeps empty fields as null', () => {
  const job = normalize({
    source: 'linkedin',
    sourceJobId: '99',
    url: 'https://www.linkedin.com/jobs/view/99/',
    title: 'Platform Engineer',
    company: '   ',
    location: '',
    description: null,
    postedAt: null,
  })

  expect(job.canonicalUrl).toBe('https://www.linkedin.com/jobs/view/99')
  expect(job.company).toBeNull()
  expect(job.location).toBeNull()
  expect(job.normCompany).toBeNull()
  expect(job.normDescription).toBeNull()
  expect(job.workMode).toBeNull()
})
