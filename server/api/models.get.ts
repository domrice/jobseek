import { listModels } from '../core/llm'

// The run bar's two model dropdowns: the tags the machine holds, plus which one each pass starts
// on. Empty `models` = no provider configured, which the UI renders as no dropdown at all. Like
// /api/sources the options are what the machine has, never a hardcoded list — and the defaults are
// here rather than in the page because only the server knows LLM_MODEL and the tags' sizes.
export default defineEventHandler(() => listModels())
