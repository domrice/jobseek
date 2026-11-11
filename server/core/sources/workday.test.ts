import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { endpoints, parseDetail, parseList, swissFacets } from './workday'

const fixture = (name: string) => readFileSync(new URL(`../../../test/fixtures/${name}`, import.meta.url), 'utf8')
const roche = { company: 'Roche', platform: 'workday', token: 'roche.wd3/roche-ext' } as const

it('builds the endpoints from tenant.wdN/site and picks the Swiss facet', () => {
  expect(endpoints(roche.token)).toEqual({
    api: 'https://roche.wd3.myworkdayjobs.com/wday/cxs/roche/roche-ext',
    page: 'https://roche.wd3.myworkdayjobs.com/roche-ext',
  })
  const json = JSON.parse(fixture('workday-list.json'))
  // The country facet wins; never the region facet with its `Zurich`.
  expect(swissFacets(json)).toEqual({ locationCountry: ['187134fccb084a0ea9b4b95f23890dbe'] })
  // Without it (Roche), the Swiss cities.
  json.facets[1].values.pop()
  expect(swissFacets(json)).toEqual({
    locations: ['3543744a0e67010b8e1b9bd75b7637a4', '3543744a0e67011e608a24f75b767ea5'],
  })
  expect(swissFacets({ facets: [] })).toBeNull()
  expect(swissFacets(null)).toBeNull()
})

it('parses cards, keeps the posting id and drops "2 Locations"', () => {
  const cards = parseList(JSON.parse(fixture('workday-list.json')), roche)
  expect(cards.map(c => c.sourceJobId)).toEqual([
    'roche.wd3/roche-ext:PhD-Clinical-Science-Fellow--Neuroscience-_202608-121188',
    'roche.wd3/roche-ext:Global-Supply-Chain-Process-Architect---Planning---Regulatory-Compliance_202606-115874-1',
  ])
  expect(cards[0]).toEqual({
    sourceJobId: 'roche.wd3/roche-ext:PhD-Clinical-Science-Fellow--Neuroscience-_202608-121188',
    url: 'https://roche.wd3.myworkdayjobs.com/wday/cxs/roche/roche-ext/job/Welwyn/PhD-Clinical-Science-Fellow--Neuroscience-_202608-121188',
    page: 'https://roche.wd3.myworkdayjobs.com/roche-ext/job/Welwyn/PhD-Clinical-Science-Fellow--Neuroscience-_202608-121188',
    title: 'PhD Clinical Science Fellow (Neuroscience)',
    location: 'Welwyn',
  })
  expect(cards[1]!.location).toBeNull()
})

it('parses the detail and shows the Swiss site of a multi-site posting', () => {
  expect(parseDetail(fixture('workday-detail.json'))).toEqual({
    description: '<p>At Roche you can show up as yourself.</p><ul><li>Python</li></ul>',
    location: 'Basel',
    postedAt: new Date('2026-09-29T00:00:00.000Z'),
  })
})

it('degrades to all-nulls instead of throwing', () => {
  const empty = { description: null, location: null, postedAt: null }
  expect(parseDetail('<html>')).toEqual(empty)
  expect(parseDetail('{}')).toEqual(empty)
  expect(parseList({}, roche)).toEqual([])
})
