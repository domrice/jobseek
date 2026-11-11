import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { parseBoard } from './wordpress'

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../test/fixtures/${name}`, import.meta.url), 'utf8')) as unknown
const layered = { company: 'LAYERED', platform: 'wordpress', token: 'layered.ch' } as const

it('keeps open Swiss postings and drops filled, foreign and linkless ones', () => {
  const jobs = parseBoard(fixture('wordpress-jobs.json'), layered)
  expect(jobs.map(j => j.sourceJobId)).toEqual(['layered.ch:2215', 'layered.ch:1690'])
  expect(jobs[0]).toEqual({
    source: 'wordpress',
    sourceJobId: 'layered.ch:2215',
    url: 'https://layered.ch/job/robotics-control-systems-engineer-robot-control-motion-systems-integration/',
    title: 'Robotics Control & Systems Engineer (Robot Control, Motion & Systems Integration)',
    company: 'LAYERED',
    location: 'Lupfig, Switzerland',
    description: expect.stringContaining('<h1>Robotics Control &amp; Systems Engineer</h1>'),
    postedAt: new Date('2026-07-27T13:35:22.000Z'),
  })
})

it('keeps a posting with no location', () => {
  const [job] = parseBoard([{ id: 1, link: 'https://layered.ch/job/x/', title: { rendered: 'X' } }], layered)
  expect(job!.location).toBeNull()
})

it('cuts the page-builder shortcodes but not bracketed class names', () => {
  const [first] = parseBoard(fixture('wordpress-jobs.json'), layered)
  expect(first!.description).not.toContain('vc_')
  expect(first!.description).toContain('[li_&amp;]:mb-0')
})

it('degrades to no jobs instead of throwing', () => {
  expect(parseBoard({ code: 'rest_no_route' }, layered)).toEqual([])
  expect(parseBoard([{}], layered)).toEqual([])
})
