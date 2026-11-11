import { desc } from 'drizzle-orm'
import { db } from '../core/db/index'
import { pipelineRuns } from '../core/db/schema'

// A row with finishedAt null is a run still in progress, not a failure.
export default defineEventHandler(() =>
  db.select().from(pipelineRuns).orderBy(desc(pipelineRuns.startedAt)).limit(1).get(),
)
