import { stopRuns } from '../../core/ndjson'

// Bodiless: aborts every open run; each run's own stream reports what it kept.
export default defineEventHandler(() => ({ stopped: stopRuns() }))
