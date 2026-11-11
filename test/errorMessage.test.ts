import { expect, it } from 'vitest'
import { errorMessage } from '../app/utils/errorMessage'

/** Verbatim from `POST /api/profiles` with `{"name":"   ","query":"x"}` (h3 + Zod 4). */
const zod400 = Object.assign(new Error('[POST] "/api/profiles": 400 Validation Error'), {
  data: {
    name: 'ZodError',
    message: JSON.stringify([
      {
        origin: 'string',
        code: 'too_small',
        path: ['name'],
        message: 'Too small: expected string to have >=1 characters',
      },
    ]),
  },
})

/** Verbatim from a duplicate-name POST. */
const conflict = Object.assign(new Error('[POST] "/api/profiles": 409'), {
  data: { statusCode: 409, statusMessage: 'Profile name "tmp" already exists' },
})

it('names the field a Zod 400 rejected', () => {
  expect(errorMessage(zod400)).toBe('name: Too small: expected string to have >=1 characters')
})

it("prefers the route's own message over h3's wrapper", () => {
  expect(errorMessage(conflict)).toBe('Profile name "tmp" already exists')
})

it('falls back instead of losing the error', () => {
  expect(errorMessage(new Error('offline'))).toBe('offline')
  expect(errorMessage('nope')).toBe('nope')
  // A ZodError whose message is not JSON must not swallow itself.
  const broken = Object.assign(new Error('boom'), { data: { name: 'ZodError', message: '<html>' } })
  expect(errorMessage(broken)).toBe('boom')
})
