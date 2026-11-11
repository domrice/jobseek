const DATE = new Intl.DateTimeFormat('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })

/** Timestamps arrive as Date in the SSR payload and as an ISO string after client nav. */
export const fmtDate = (v: Date | string | null | undefined) => (v ? DATE.format(new Date(v)) : '—')

/**
 * Work mode is shown as a badge in the list and in the detail header — one mapping, two
 * call sites. A null workMode renders nothing at all: the posting did not say, and an
 * "unknown" chip on most rows would be noise.
 */
export const WORK_MODE = {
  remote: { label: 'remote', tone: 'border-good/40 text-good' },
  hybrid: { label: 'hybrid', tone: 'border-accent/40 text-accent' },
  onsite: { label: 'on-site', tone: 'border-line text-muted' },
} as const

/**
 * `gemma4:31b-it-qat` → `Gemma4:31`. Family capitalised, first size in the tag kept, quant and
 * instruct suffixes dropped — the dropdown is 200px wide and the full tag is on its `title`.
 *
 * ponytail: no tag parsing beyond the first `\d+b`. Ceiling: two builds of one size collapse to
 * the same label (`31b-it-qat` and `31b-q8`). Upgrade path: fall back to the raw tag on collision.
 */
export const shortModel = (m: string) => {
  const [family = m, tag = ''] = m.split(':')
  const size = tag.match(/\d+(?:\.\d+)?(?=b)/i)?.[0]
  return family.charAt(0).toUpperCase() + family.slice(1) + (size ? `:${size}` : '')
}

/** null must never reach the screen as "null". */
export const dash = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? '—' : v)

const MINUTE = 60_000

/**
 * Coarse on purpose: `12 min`, `1 h 5 min`. A long scoring pass re-renders its elapsed time and its
 * remaining estimate every few seconds, and a value flickering between 11 and 12 minutes teaches
 * the reader to ignore it — so the display granularity *is* the rounding granularity, and it steps.
 *
 * It floors rather than rounding, which makes elapsed the time actually spent and the remaining
 * estimate a figure that only ever counts down. Below one minute it has nothing to say and returns
 * `undefined` — the same reflex as `dash()`: state the absence, do not invent a precision.
 */
export const fmtDuration = (ms: number) => {
  const min = Math.floor(ms / MINUTE)
  if (min < 1) return undefined
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`
}

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * `fmtDate`'s sibling for the one readout whose whole point is freshness: the run bar's `last run`.
 * Day/month/year cannot separate this morning's run from one ten minutes ago, and on an app run
 * several times a day that is every distinction the line exists to make.
 *
 * Relative up to a week, absolute beyond it — `2 months ago` is a vaguer statement of a date the
 * reader could have had exactly, and past a few days freshness stops being the question. Below a
 * minute it says `just now`: `0 minutes ago` is the same flicker `fmtDuration` refuses.
 *
 * `now` is a parameter, not `Date.now()`, for two reasons. It keeps the function pure and testable
 * the way the rest of this file is, and it lets the caller withhold a clock during SSR — a relative
 * string rendered against the server's clock and re-rendered against the browser's is a hydration
 * mismatch. `now === 0` (the pre-mount value) returns the absolute date, so the first paint is the
 * old readout and the relative form arrives with the client's own clock.
 */
export const fmtAgo = (v: Date | string | null | undefined, now: number) => {
  if (!v) return '—'
  const ms = now ? now - new Date(v).getTime() : NaN
  if (!(ms >= 0) || ms >= 7 * DAY) return fmtDate(v)
  if (ms < MINUTE) return 'just now'
  if (ms < HOUR) return RELATIVE.format(-Math.floor(ms / MINUTE), 'minute')
  if (ms < DAY) return RELATIVE.format(-Math.floor(ms / HOUR), 'hour')
  return RELATIVE.format(-Math.floor(ms / DAY), 'day')
}

/** The absolute timestamp the relative form replaces, for `:title`. To the minute — the precision
 *  `fmtAgo` gives up. */
const STAMP = new Intl.DateTimeFormat('de-CH', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})
export const fmtStamp = (v: Date | string | null | undefined) => (v ? STAMP.format(new Date(v)) : '—')
