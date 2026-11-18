import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { listUrl, parseBoard } from './zoho'

const fixture = (name: string) => readFileSync(new URL(`../../../test/fixtures/${name}`, import.meta.url), 'utf8')
const fp = { company: 'F&P Robotics', platform: 'zoho', token: 'fp-robotics.zohorecruit.com/jobs/Career-Site' } as const

it('builds the career site url', () => {
  expect(listUrl(fp)).toBe('https://fp-robotics.zohorecruit.com/jobs/Career-Site')
})

it('reads the entity-encoded jobs input, keeps Swiss postings by state or country', () => {
  // Glattbrugg is not on the city list; State and Country carry it. Munich is dropped.
  expect(parseBoard(fixture('zoho-career-site.html'), fp)).toEqual([
    {
      source: 'zoho',
      sourceJobId: 'fp-robotics.zohorecruit.com/jobs/Career-Site:657358000006581038',
      url: 'https://fp-robotics.zohorecruit.com/jobs/Career-Site/657358000006581038',
      title: 'Software Engineer Robotics 80-100%',
      company: 'F&P Robotics',
      location: 'Glattbrugg',
      description: 'Build the next generation of intelligent robots. At F&P Robotics, we develop service robots.',
      postedAt: new Date('2026-11-02'),
    },
  ])
})

it('degrades to empty without the input', () => {
  expect(parseBoard('<html></html>', fp)).toEqual([])
})
