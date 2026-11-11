import { asc } from 'drizzle-orm'
import { beforeAll, expect, it } from 'vitest'
import { db } from '../server/core/db/index'
import { searchProfiles } from '../server/core/db/schema'
import { findProfile } from '../scripts/pipeline'
import { seed } from '../scripts/seed'

beforeAll(() => {
  seed()
})

const oldest = () => db.select().from(searchProfiles).orderBy(asc(searchProfiles.id)).all()[0]!

it('defaults to the lowest id', () => {
  expect(findProfile()?.id).toBe(oldest().id)
})

it('resolves an all-digits argument as an id', () => {
  const p = oldest()
  expect(findProfile(String(p.id))?.name).toBe(p.name)
})

it('resolves anything else as a name', () => {
  expect(findProfile('minimal')?.name).toBe('minimal')
})

it('returns undefined for an unknown name or id', () => {
  expect(findProfile('no-such-profile')).toBeUndefined()
  expect(findProfile('999999')).toBeUndefined()
})
