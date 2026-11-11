import { registry } from '../core/sources/registry'

// Which boards a run *could* query, with one plain line each — the run bar's checkboxes. Distinct
// from GET /api/sources, which lists the boards that already have stored rows (a filter's options).
export default defineEventHandler(() => registry.filter(s => s.enabled).map(({ name, blurb }) => ({ name, blurb })))
