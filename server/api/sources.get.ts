import { listSources } from '../core/queries'

// The source filter's options. Derived from the stored rows rather than the registry, so it can
// never offer a source with nothing behind it.
export default defineEventHandler(() => listSources())
