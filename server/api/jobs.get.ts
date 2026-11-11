import { listJobs } from '../core/queries'
import { jobListQuerySchema } from '../core/types'

export default defineEventHandler(async event => listJobs(await getValidatedQuery(event, jobListQuerySchema.parse)))
