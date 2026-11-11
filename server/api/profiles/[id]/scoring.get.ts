import { z } from 'zod'
import { llmMaxPostedDays, llmRescoreDays } from '../../../core/config/env'
import { scoringDebt } from '../../../core/queries'
import { idParamSchema, thinkSchema } from '../../../core/types'

// Own route, not a `/api/profiles` field: a `jobs` scan, needed for the selected profile only. The
// caps travel in the response because a page cannot import `config/env.ts`. Deep params: all four or none.
const query = z
  .object({
    deepModel: z.string().min(1),
    deepThink: thinkSchema,
    bandMin: z.coerce.number().min(0).max(100),
    bandMax: z.coerce.number().min(0).max(100),
  })
  .partial()

export default defineEventHandler(async event => {
  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)
  const q = await getValidatedQuery(event, query.parse)
  const deep =
    q.deepModel && q.deepThink && q.bandMin !== undefined && q.bandMax !== undefined
      ? { model: q.deepModel, think: q.deepThink, min: q.bandMin, max: q.bandMax }
      : undefined
  return {
    ...scoringDebt(id, deep),
    ageCaps: { lastSeenDays: llmRescoreDays, postedDays: llmMaxPostedDays },
  }
})
