# Job Seek

Local Nuxt app: searches Swiss job boards, stores postings in SQLite, deduplicates, scores them against search profiles (keywords, optionally a local LLM via Ollama), and displays results.

## Constraints

- Runs locally: no deployment, no accounts, no separate backend.
- Works fully without an LLM (keyword-only). Ollama is optional; it is the only LLM provider, because the CV is personal data.
- Pipeline runs from the UI and the CLI and is safe to rerun. Nothing is ever pruned.
- Out of scope: application tracking, notifications, resume tailoring, embeddings.

## Stack and layout

Node · Nuxt 4 · Vue 3 · TypeScript 5.x (not 7: breaks `vue-tsc`) · Tailwind 4 (CSS-first) · SQLite via better-sqlite3 · Drizzle + drizzle-zod · Zod 4 · Cheerio · Vitest. Use Node, not Bun.

- `app/` — UI. `app/utils/` and `app/components/` are auto-imported.
- `server/api/` — thin routes. Every file there becomes a route, so no helpers.
- `server/core/` — framework-free core (no `h3`, `nitropack`, `#imports`): `pipeline.ts`, `rescore.ts`, `normalize.ts`, `dedupe.ts`, `queries.ts`, `score/`, `llm/`, `sources/`.
- `server/core/config/rubric.ts` — the single config file (weights, keyword aliases, work-mode patterns, score bands, …).
- `scripts/` — CLI and seed. `drizzle/` — migrations.

## Commands

```bash
npm ci                   # install (rebuild better-sqlite3 by hand after: ignore-scripts is on)
npm run dev              # dev server
npm run pipeline         # fetch + score, no server needed
npm run pipeline -- --profile default --no-llm
npm run pipeline -- --rescore-only [--llm]   # score stored jobs, fetch nothing
npm run db:generate      # migration from schema
npm run db:migrate
npm run db:seed          # wipe + fixture data (-- --force skips the prompt)
npm test
```

Config via `.env`: `LLM_MODEL` (an Ollama library tag, e.g. `gemma4:31b-it-qat`; unset = keyword-only), `LLM_BASE_URL`, `LLM_THINK`, `LLM_TIMEOUT_MS`, `LLM_MAX_JOBS`, `LLM_MAX_POSTED_DAYS` (90), `LLM_RESCORE_DAYS` (30), `DATABASE_PATH`.

## Core rules

- **One entry point.** API routes and the CLI wrap `runPipeline(input, sources, provider, onProgress, signal)` and `rescoreProfile(id, input, provider, onProgress, signal)`. Tests pass sources and fake providers as arguments — no DI, no `fetch` mocks.
- **Scores live in `job_scores`, per (job × profile)**, never on `jobs`. Every run keyword-scores every profile; the job list inner-joins scores.
- **Idempotency is in the DB**: `UNIQUE(source, sourceJobId)`, `UNIQUE(canonicalUrl)`, upserts. Earliest-seen = lowest `jobs.id`.
- **`normalize.ts` is the only `RawJob → NormalizedJob` path** and is pure. Comparison forms fold case and diacritics but keep punctuation (`C++`). `contentHash` = SHA-256 of normalized title|company|location|description.
- **Never guess data**: unparseable dates → `null`. Timestamps are `timestamp_ms` integers. Freshness filters use `firstSeenAt`, not `postedAt`. Location is never scored.
- **Known jobs aren't refetched**: adapters receive a `seen` check that gates only the detail fetch; skipped cards just bump `lastSeenAt`.
- **All async work (incl. LLM) finishes before the DB transaction** — better-sqlite3 transactions can't `await`.
- **Validate every request** with Zod (`getValidatedQuery`, `readValidatedBody`, …). Routes import core by relative path (`../core/queries`).
- `app/utils/jobQuery.ts` is the only builder of `/api/jobs` params.

## LLM scoring

- `getProvider()` returns `null` without `LLM_MODEL`; the keyword path needs no guard. `server/plugins/ollama.ts` starts Ollama with the app if needed.
- Calls go through `httpPostJson` (`/api/chat` with a JSON-schema `format`), sequential, one per `contentHash`.
- A verdict is never invalidated; an unchanged `contentHash` carries it forward. UI runs are keyword-only; LLM scoring is two dashboard buttons: **Pre-Score** (fast model, unjudged rows) and **Deep-Score** (another model/think setting, re-judges a score band).
- Prompt: `buildSystem(profile)` is constant per run, `buildUser(job)` holds the posting and must contain no keyword data. Bump `PROMPT_VERSION` on meaningful prompt changes.
- Streaming: `/api/pipeline/run` and `/api/profiles/:id/rescore` stream NDJSON progress; stop via `POST /api/pipeline/stop` (loops `break`, so paid work is still saved).

## Sources

Hand-checked allowlist in `server/core/sources/registry.ts`. Before adding a board: read its ToS and robots.txt, record the verdict in `tosNote`, set a rate limit. Disqualified boards stay as `enabled: false`. Use the helpers in `sources/board.ts` (pagination, throttled detail fetch) and `sources/jsonld.ts` (JSON-LD). Verify that query parameters actually filter by diffing two unrelated queries. Drop paid/recommended placements.

## Tests

- Tests use `./data/test.db`, never `data/jobseek.db`; `seed()` wipes jobs, scores and runs.
- `scripts/seed.ts` is the UI's edge-case fixture set — add cases, don't remove them.
- `fileParallelism: false` stays (suites share the test DB).

## Dependencies

`.npmrc` enforces `min-release-age=7`, `save-exact`, `ignore-scripts` — don't bypass. New deps need a reason: stdlib first, then an installed dep.

## Frontend

- Desktop only (≥1024px), dark only, no breakpoints. Tokens in `app/assets/css/main.css`; no shadows or gradients.
- Filter state lives in the route query only.
- Dates via `fmtDate` / `fmtAgo`; errors via `errorMessage()`.
- Controls busy with their own action use `aria-disabled` + a handler guard, not `:disabled`.
- Pass `$fetch` result types as the generic, never as an annotation.
