import { spawn, type ChildProcess } from 'node:child_process'
import { llm } from '../core/config/env'

/**
 * Start the Ollama daemon with the app, so `/api/models` lists the machine's real tags on first load.
 * Daemon only, no model warm-up (one resident model on 36GB). Not for `npm run pipeline`/cron: a
 * headless run that finds no daemon should fail loudly.
 */
export default defineNitroPlugin(nitro => {
  // Without LLM_MODEL there is nothing to start.
  if (!llm) return

  // Set only if we spawned it: an Ollama the user was already running is theirs, and Exit leaves it up.
  let owned: ChildProcess | undefined

  const stop = () => {
    owned?.kill()
    owned = undefined
  }

  // Signals reach `close` through Nitro's graceful shutdown (`preview`) or the process group (`nuxt
  // dev`). `exit` is for `/api/quit`, whose `process.exit(0)` skips `close`.
  nitro.hooks.hook('close', stop)
  process.on('exit', stop)

  // Not awaited: boot must not wait on a subprocess. A slow start leaves `/api/models` on its fallback.
  void fetch(`${llm.baseUrl}/api/tags`, { signal: AbortSignal.timeout(1_000) })
    .then(
      r => r.ok,
      () => false,
    )
    .then(up => {
      if (up) return
      // `ignore`, not `inherit`: Ollama's server log would interleave with Nuxt's. Not detached: our child.
      owned = spawn('ollama', ['serve'], { stdio: 'ignore' })
      // A missing binary surfaces here rather than as a throw, since spawn is asynchronous.
      owned.on('error', () => {
        owned = undefined
        console.warn('[ollama] not started: no `ollama` on PATH. The app runs without it; scoring is unavailable.')
      })
    })
})
