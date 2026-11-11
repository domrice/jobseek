import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

// Dynamic: config/env.ts reads REQUEST_TIMEOUT_MS at import time, so it must be set first.
vi.stubEnv('REQUEST_TIMEOUT_MS', '100')
const { httpGet } = await import('../server/core/http')

const server = createServer((req, res) => {
  if (req.url === '/ok') return res.end(req.headers['user-agent'])
  if (req.url === '/404') return res.writeHead(404).end()
  // /slow: never responds, so the timeout is the only thing that can end it
})
let base: string

beforeAll(async () => {
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>(r => server.close(() => r())))

it('returns the response and sends a user-agent', async () => {
  const res = await httpGet(`${base}/ok`)
  expect(await res.text()).toMatch(/^jobseek\//)
})

it('throws on non-2xx instead of returning it', async () => {
  await expect(httpGet(`${base}/404`)).rejects.toThrow('404')
})

it('gives up after the timeout', async () => {
  await expect(httpGet(`${base}/slow`)).rejects.toThrow()
})
