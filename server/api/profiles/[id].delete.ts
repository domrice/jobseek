import { eq } from 'drizzle-orm'
import { db } from '../../core/db/index'
import { searchProfiles } from '../../core/db/schema'
import { idParamSchema } from '../../core/types'

// job_scores and pipeline_runs cascade; jobs are shared across profiles and stay.
export default defineEventHandler(async event => {
  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)
  const row = db.delete(searchProfiles).where(eq(searchProfiles.id, id)).returning().get()
  if (!row) throw createError({ statusCode: 404, statusMessage: `No profile ${id}` })
  return row
})
