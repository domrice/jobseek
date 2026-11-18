import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { swissPlace } from './ats'
import { listUrl, parseDetail, parseList } from './breezy'

const fixture = (name: string) => readFileSync(new URL(`../../../test/fixtures/${name}`, import.meta.url), 'utf8')
const verity = { company: 'Verity', platform: 'breezy', token: 'verity-ag' } as const

it('builds the json feed url', () => {
  expect(listUrl(verity)).toBe('https://verity-ag.breezy.hr/json')
})

it('parses positions with the country appended, so the Swiss test sees it; drops the open application', () => {
  const cards = parseList(fixture('breezy-list.json'), verity)
  expect(cards.map(c => swissPlace(c.location))).toEqual([false, true])
  expect(cards.map(c => c.title)).not.toContain('Spontaneous Application')
  expect(cards[1]).toEqual({
    sourceJobId: 'verity-ag:c6c557e511c6',
    url: 'https://verity-ag.breezy.hr/p/c6c557e511c6-senior-electronics-engineer-team-lead',
    page: 'https://verity-ag.breezy.hr/p/c6c557e511c6-senior-electronics-engineer-team-lead',
    title: 'Senior Electronics Engineer & Team Lead',
    location: 'Zürich, ZH, Switzerland',
    postedAt: new Date('2026-11-10T09:12:00.000Z'),
  })
})

it('reads the description from the JobPosting, not the WebSite block', () => {
  expect(parseDetail(fixture('breezy-detail.html')).description).toContain('zero-error warehousing')
  expect(parseDetail('')).toEqual({ description: null })
})
