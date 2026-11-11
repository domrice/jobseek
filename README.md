<div align="center">

<img src="public/favicon.svg" width="112" alt="Job Seek">

# Job Seek

**Swiss job boards → SQLite → scored against your CV. Local only.**

[![Node](https://img.shields.io/badge/node-%E2%89%A5%2026-fa934e?style=flat-square&logo=nodedotjs&logoColor=white&labelColor=121417)](https://nodejs.org)
[![Nuxt 4](https://img.shields.io/badge/Nuxt-4-fa934e?style=flat-square&logo=nuxtdotjs&logoColor=white&labelColor=121417)](https://nuxt.com)
[![SQLite](https://img.shields.io/badge/SQLite-Drizzle-fa934e?style=flat-square&logo=sqlite&logoColor=white&labelColor=121417)](https://orm.drizzle.team)
[![Ollama](https://img.shields.io/badge/LLM-Ollama%20-fa934e?style=flat-square&logo=ollama&logoColor=white&labelColor=121417)](https://ollama.com)

</div>

No deployment, accounts, telemetry or cloud. Fetches postings, deduplicates, scores them against a
search profile with keywords and, optionally, a local LLM.

## Setup

Needs [Node ≥ 26](https://nodejs.org); [Ollama](https://ollama.com) recommended (without it,
scoring is keyword-only).

```bash
git clone https://github.com/domrice/jobseek && cd jobseek
./setup.sh        # Windows: .\setup.bat
```

Installs dependencies, creates `data/jobseek.db`, and if Ollama is present pulls
`gemma4:26b-a4b-it-qat` (fast) and `gemma4:31b-it-qat` (deep, ~20 GB) and sets `LLM_MODEL` in
`.env`. Safe to re-run.

Start: `./start.command` (or double-click; on macOS drag `JobSeek.app` to the Dock). Windows:
`npm run dev`. Opens http://localhost:3000.

## Use

1. `/profiles` → **New profile**: name, query, keywords, CV (markdown, read only by the LLM).
2. `/` → pick profile, tick boards → **Seek Jobs** (keyword-only).
3. **Pre-Score** judges unjudged postings with the fast model; **Deep-Score** re-judges a score band
   with the deep model.
4. Filter by **First seen** — most postings carry no publication date.

Re-running is safe: postings are updated, never duplicated or deleted.

Per posting on a 36 GB M3 Max: fast ~6 s (think on ~35–46 s), deep ~28 s (think on ~85–126 s).

## Sources

Hand-checked allowlist in [registry.ts](server/core/sources/registry.ts), each with a `tosNote`;
2 s floor between requests.

- **Boards:** jobs.ch · jobscout24.ch · züri.jobs · michaelpage.ch · swissdevjobs.ch
- **Employer career pages** (list in [employers.ts](server/core/config/employers.ts), filtered to
  Switzerland): greenhouse · lever · ashby · recruitee · workable · workday · onlyfy · wordpress

Easy to extend: an employer on a supported career-page system is one line in `employers.ts`, and a
new board is one adapter file plus a registry entry.

## CLI

```bash
npm run pipeline                          # oldest profile, LLM if configured
npm run pipeline -- --profile default     # id or name
npm run pipeline -- --no-llm              # keyword only
npm run pipeline -- --rescore-only [--llm] # rescore stored jobs, no network
npm test                                  # vitest, own data/test.db
npm run typecheck
npm run db:generate && npm run db:migrate # after a schema change
npm run db:seed                           # fixture data — DESTRUCTIVE (-- --force skips prompt)
```

Run from the repo root (`.env` and `DATABASE_PATH` resolve against it). Exit `1` only for bad
arguments, unknown profile, unmigrated DB or broken LLM config. Env variables and defaults:
`server/core/config/env.ts`.

Weekly cron:

```cron
0 8 * * 0 cd /path/to/jobseek && /usr/local/bin/npm run pipeline >> logs/pipeline.log 2>&1
```

After changing an adapter, run `npm run pipeline -- --no-llm` twice: first `errors 0`, second
`inserted 0`.
