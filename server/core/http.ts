import { requestTimeoutMs } from './config/env'

const USER_AGENT = 'jobseek/0.1 (personal job search; reisach@arch.ethz.ch)'

/** Native fetch plus a timeout, a UA, and a non-2xx throw. That is the whole HTTP layer. */
export async function httpGet(url: string): Promise<Response> {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(requestTimeoutMs),
  })
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`)
  return res
}

/** Same three guarantees for every POST: Ollama and the Workday list endpoint. */
export async function httpPostJson<T>(
  url: string,
  body: unknown,
  { timeout = requestTimeoutMs }: { timeout?: number } = {},
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'user-agent': USER_AGENT, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  })
  // The provider's own error body is the only useful diagnostic when a model name is wrong.
  if (!res.ok) throw new Error(`POST ${url} -> ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`)
  return res.json() as Promise<T>
}
