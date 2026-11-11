import { getJob } from '../../core/queries'
import { idParamSchema, jobDetailQuerySchema } from '../../core/types'

export default defineEventHandler(async event => {
  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)
  const { profileId } = await getValidatedQuery(event, jobDetailQuerySchema.parse)
  const job = getJob(id, profileId)
  if (!job) throw createError({ statusCode: 404, statusMessage: `No job ${id}` })
  return job
})
