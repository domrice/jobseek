import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { swissPlace } from './ats'
import { listUrl, parseDetail, parseList } from './autoform'

const fixture = (name: string) => readFileSync(new URL(`../../../test/fixtures/${name}`, import.meta.url), 'utf8')
const autoform = { company: 'AutoForm', platform: 'autoform', token: 'careers.autoform.com' } as const

it('builds the bare list url, no query string', () => {
  expect(listUrl(autoform)).toBe('https://careers.autoform.com/en/jobs/job-search/')
})

it('parses cards with their location, keeps foreign ones for the walk', () => {
  const cards = parseList(fixture('autoform-list.html'), autoform)
  expect(cards.map(c => swissPlace(c.location))).toEqual([true, false])
  expect(cards[0]).toEqual({
    sourceJobId: 'careers.autoform.com:5163',
    url: 'https://careers.autoform.com/en/jobs/job-search/advertisement/senior-software-engineer-m-f-80-100-2/',
    page: 'https://careers.autoform.com/en/jobs/job-search/advertisement/senior-software-engineer-m-f-80-100-2/',
    title: '(Senior) Software Engineer (m/f) 80-100%',
    location: 'Switzerland: Zurich',
    postedAt: null,
  })
})

it('takes description and date from the JSON-LD', () => {
  const d = parseDetail(fixture('autoform-detail.html'))
  expect(d.description).toContain('next-generation Application Platform')
  expect(d.postedAt).toEqual(new Date('2026-11-17T07:55'))
  expect(parseDetail('')).toEqual({ description: null, postedAt: null })
})
