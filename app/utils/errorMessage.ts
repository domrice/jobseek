interface ZodIssue {
  path: (string | number)[]
  message: string
}
interface Body {
  name?: string
  message?: string
  statusMessage?: string
}

/**
 * A failed `$fetch` into a readable line. Three shapes have to be handled, because h3's own
 * message is useless for exactly the case a form hits most:
 *  - a route's `createError` (409 duplicate name) → the body's `statusMessage`
 *  - a Zod 400 → h3 says only "Validation Error"; the issues are a JSON *string* in `data.message`
 *    (Zod 4 serializes them there), so which field failed has to be dug out
 *  - anything else (network, non-JSON) → the Error's own message
 */
export function errorMessage(e: unknown): string {
  const data = (e as { data?: Body })?.data
  if (data?.name === 'ZodError' && data.message) {
    try {
      const issues = JSON.parse(data.message) as ZodIssue[]
      const lines = issues.map(i => `${i.path.join('.') || 'body'}: ${i.message}`)
      if (lines.length) return lines.join('; ')
    } catch {
      /* not JSON after all: fall through rather than lose the error entirely */
    }
  }
  return data?.statusMessage ?? (e instanceof Error ? e.message : String(e))
}
