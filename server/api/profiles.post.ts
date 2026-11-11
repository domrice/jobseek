import { db, isUniqueViolation } from '../core/db/index'
import { searchProfiles } from '../core/db/schema'
import { searchProfileInsertSchema } from '../core/types'

export default defineEventHandler(async event => {
  const body = await readValidatedBody(event, searchProfileInsertSchema.parse)
  try {
    return db.insert(searchProfiles).values(body).returning().get()
  } catch (err) {
    if (!isUniqueViolation(err)) throw err
    throw createError({ statusCode: 409, statusMessage: `Profile name "${body.name}" already exists` })
  }
})
