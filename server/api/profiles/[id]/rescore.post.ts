import { ndjsonStream } from '../../../core/ndjson'
import { rescoreProfile } from '../../../core/rescore'
import { idParamSchema, rescoreInputSchema } from '../../../core/types'

// NDJSON like POST /api/pipeline/run: an LLM rescore is uncapped, so it reports progress instead
// of blocking silently. The keyword-only path is fast enough that it just emits `write` and `done`.
export default defineEventHandler(async event => {
  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)
  // A bodiless POST is valid and means the offline keyword pass — both dashboard buttons always
  // send a body, so this is the shape a bare curl gets.
  const input = await readValidatedBody(event, b => rescoreInputSchema.parse(b ?? {}))
  setResponseHeader(event, 'content-type', 'application/x-ndjson')
  return ndjsonStream((line, signal) => rescoreProfile(id, input, undefined, line, signal))
})
