import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { parseDetail, parseList } from './onlyfy'

const fixture = (name: string) => readFileSync(new URL(`../../../test/fixtures/${name}`, import.meta.url), 'utf8')
const leica = { company: 'Leica Geosystems', platform: 'onlyfy', token: 'leica-geosystems-ag' } as const

it('parses cards, drops the href tail, keeps foreign cards for the walk', () => {
  const cards = parseList(fixture('onlyfy-list.html'), leica)
  expect(cards.map(c => c.location)).toEqual(['Ulm', 'Heerbrugg', 'Zürich'])
  expect(cards[1]).toEqual({
    sourceJobId: 'leica-geosystems-ag:19xvd3qq89bm8677pv1rlnv2h2sv29u',
    url: 'https://leica-geosystems-ag.onlyfy.jobs/job/show/19xvd3qq89bm8677pv1rlnv2h2sv29u/full?lang=en',
    page: 'https://leica-geosystems-ag.onlyfy.jobs/en/job/19xvd3qq89bm8677pv1rlnv2h2sv29u',
    title: 'Software Compliance Engineer (m/w/d)',
    location: 'Heerbrugg',
    postedAt: new Date('2026-09-03T00:00:00.000Z'),
  })
})

it('parses the ad body without its script and style', () => {
  const { description } = parseDetail(fixture('onlyfy-detail.html'))
  expect(description).toContain('Own the surveying software product roadmap')
  expect(description).toContain('<div class="city">Heerbrugg</div>')
  expect(description).not.toMatch(/dataLayer|font-size|Enable JavaScript/)
})

it('degrades to all-nulls instead of throwing', () => {
  expect(parseDetail('')).toEqual({ description: null })
  expect(parseList('<html>', leica)).toEqual([])
})
