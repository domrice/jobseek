import { ndjsonStream } from '../../core/ndjson'
import { runPipeline } from '../../core/pipeline'
import { pipelineRunInputSchema } from '../../core/types'

// NDJSON, not JSON: a run takes minutes, so it reports progress as it goes and the result is the
// last line. Validation stays ahead of the stream, so a bad body is still a plain 400.
export default defineEventHandler(async event => {
  const input = await readValidatedBody(event, pipelineRunInputSchema.parse)
  setResponseHeader(event, 'content-type', 'application/x-ndjson')
  return ndjsonStream((line, signal) => runPipeline(input, undefined, undefined, line, signal))
})
