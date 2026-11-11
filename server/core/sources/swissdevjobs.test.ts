import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { parseList } from './swissdevjobs'

const fixture = (name: string) => readFileSync(new URL(`../../../test/fixtures/${name}`, import.meta.url), 'utf8')

it('parses items, dedupes a repeated link and keeps utm out of the id', () => {
  const jobs = parseList(fixture('swissdevjobs-rss.xml'))
  expect(jobs.map(j => j.sourceJobId)).toEqual([
    'ONZACK-AG-Senior-Platform-Engineer-80-100',
    'Lakeside-Analytics-GmbH-DevOps-at-Scale-Engineer',
    'Werkstudent-Frontend',
  ])
  expect(jobs[0]).toEqual({
    source: 'swissdevjobs',
    sourceJobId: 'ONZACK-AG-Senior-Platform-Engineer-80-100',
    url: 'https://swissdevjobs.ch/jobs/ONZACK-AG-Senior-Platform-Engineer-80-100?utm_source=our_rss_feed&utm_medium=our_rss_feed',
    title: 'Senior Platform Engineer (80%-100%)',
    company: 'ONZACK AG',
    location: null,
    description: expect.stringContaining('<b>Requirements:</b>'),
    postedAt: new Date('2026-08-03T20:36:43.000Z'),
  })
})

// Title format is `<Role> @ <Company> [CHF x - y]`: the bracket is not part of the company, and a
// role carrying its own " @ " must not be split at the wrong one.
it('splits the title on the last " @ " and strips the salary bracket', () => {
  const jobs = parseList(fixture('swissdevjobs-rss.xml'))
  expect(jobs[1].title).toBe('DevOps @ Scale Engineer')
  expect(jobs[1].company).toBe('Lakeside Analytics GmbH')
})

// Degradation: no " @ " and an unparseable date. Both are null, never guessed, never a throw.
it('leaves an unsplittable title and a relative date alone', () => {
  const bare = parseList(fixture('swissdevjobs-rss.xml'))[2]
  expect(bare.title).toBe('Werkstudent Frontend')
  expect(bare.company).toBeNull()
  expect(bare.postedAt).toBeNull()
  expect(parseList('<rss><channel></channel></rss>')).toEqual([])
})
