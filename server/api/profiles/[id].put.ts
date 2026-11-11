import { eq } from 'drizzle-orm'
import { db, isUniqueViolation } from '../../core/db/index'
import { searchProfiles } from '../../core/db/schema'
import { idParamSchema, searchProfileInsertSchema } from '../../core/types'

// ponytail: omitted keyword arrays keep their old values (drizzle's .set() only writes the keys
// it is given), so this is a PATCH wearing a PUT's name. Ceiling: a list cannot be cleared by
// omission — send []. Upgrade path: spread the schema defaults into .set().
export default defineEventHandler(async event => {
  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)
  const body = await readValidatedBody(event, searchProfileInsertSchema.partial().parse)
  // drizzle throws on .set({}), so reject an empty body as the 400 it is.
  if (!Object.keys(body).length) throw createError({ statusCode: 400, statusMessage: 'Empty body' })
  try {
    const row = db.update(searchProfiles).set(body).where(eq(searchProfiles.id, id)).returning().get()
    // Inside the try: the catch rethrows anything that is not a unique violation, so this
    // H3Error passes straight through.
    if (!row) throw createError({ statusCode: 404, statusMessage: `No profile ${id}` })
    return row
  } catch (err) {
    if (!isUniqueViolation(err)) throw err
    throw createError({ statusCode: 409, statusMessage: `Profile name "${body.name}" already exists` })
  }
})
