import { describe, expect, it } from 'vitest'
import { fmtAgo, fmtDate, fmtDuration, shortModel } from '../app/utils/format'

describe('shortModel', () => {
  it('keeps the family and the first size, drops quant and instruct suffixes', () => {
    expect(shortModel('gemma4:31b-it-qat')).toBe('Gemma4:31')
    // The `a4b` active-parameter part must not win over the total size.
    expect(shortModel('gemma4:26b-a4b-it-qat')).toBe('Gemma4:26')
  })

  it('survives tags with no size and names with no tag', () => {
    expect(shortModel('qwen3:latest')).toBe('Qwen3')
    expect(shortModel('gpt-4o')).toBe('Gpt-4o')
  })
})

// Coarse and stepping: the display granularity is the rounding granularity, so a value re-rendered
// every 5 s cannot flicker. Below its own granularity it says nothing rather than inventing one.
describe('fmtDuration', () => {
  it('is absent below a minute', () => {
    expect(fmtDuration(0)).toBeUndefined()
    expect(fmtDuration(59_999)).toBeUndefined()
  })

  it('floors to whole minutes, so elapsed is time actually spent', () => {
    expect(fmtDuration(60_000)).toBe('1 min')
    expect(fmtDuration(11.9 * 60_000)).toBe('11 min')
  })

  it('drops a zero minute part at the hour', () => {
    expect(fmtDuration(60 * 60_000)).toBe('1 h')
    expect(fmtDuration(65 * 60_000)).toBe('1 h 5 min')
  })
})

// The run bar's freshness readout. Pure because `now` is a parameter, which is also what lets the
// caller withhold a clock during SSR.
describe('fmtAgo', () => {
  const t = new Date('2026-09-05T12:00:00Z')
  const at = (ms: number) => fmtAgo(t, t.getTime() + ms)

  it('falls back to the absolute date with no clock, so SSR and hydration agree', () => {
    expect(fmtAgo(t, 0)).toBe(fmtDate(t))
  })

  it('separates two runs on the same day', () => {
    expect(at(10 * 60_000)).toBe('10 minutes ago')
    expect(at(5 * 3_600_000)).toBe('5 hours ago')
  })

  it('says just now below its own granularity rather than 0 minutes ago', () => {
    expect(at(59_999)).toBe('just now')
  })

  it('goes absolute past a week, where the date is the more precise statement', () => {
    expect(at(3 * 86_400_000)).toBe('3 days ago')
    expect(at(8 * 86_400_000)).toBe(fmtDate(t))
  })

  it('renders an absent or future timestamp without inventing one', () => {
    expect(fmtAgo(null, Date.now())).toBe('—')
    expect(at(-60_000)).toBe(fmtDate(t))
  })
})
