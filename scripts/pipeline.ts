import { parseArgs } from 'node:util'
import { asc, eq } from 'drizzle-orm'
import { databasePath } from '../server/core/config/env'
import { db } from '../server/core/db/index'
import { searchProfiles } from '../server/core/db/schema'
import { runPipeline } from '../server/core/pipeline'
import { rescoreProfile } from '../server/core/rescore'
import type { PipelineResult } from '../server/core/types'

const USAGE = `Usage: npm run pipeline [-- --profile <id|name>] [--no-llm] [--rescore-only [--llm]]

  --profile        profile id or name; defaults to the oldest profile (lowest id)
  --no-llm         skip LLM scoring even if LLM_MODEL is set
  --rescore-only   keyword-rescore the stored jobs for this profile; no sources
  --llm            with --rescore-only: also judge with LLM_MODEL — every stored posting that has
                   no verdict yet (seen within LLM_RESCORE_DAYS, posted within
                   LLM_MAX_POSTED_DAYS, capped by LLM_MAX_JOBS). There is no keyword floor, so
                   set LLM_MODEL to the fast model; the deep pass over a score band is the
                   dashboard's Deep-score button and has no flag here.

Exit code is 0 for a completed run, even one with source errors. A single failed
source is not fatal.`

/**
 * Profile lookup for the CLI only — the UI posts an id it just listed, so nothing else needs a
 * name. All-digits means id; anything else is the unique `name` column.
 */
export function findProfile(arg?: string) {
  if (arg === undefined) return db.select().from(searchProfiles).orderBy(asc(searchProfiles.id)).get()
  const where = /^\d+$/.test(arg) ? eq(searchProfiles.id, Number(arg)) : eq(searchProfiles.name, arg)
  return db.select().from(searchProfiles).where(where).get()
}

const dur = (r: PipelineResult) => `${((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000).toFixed(1)}s`

function summary(r: PipelineResult, profileName: string) {
  return [
    `profile   ${profileName} (#${r.profileId})`,
    `sources   ${r.sourcesQueried.join(', ') || '(none enabled)'}`,
    // `touched` is what explains a small `fetched` on a repeat run: cards the DB already had, so
    // only their lastSeenAt moved. Without it a healthy incremental run reads as broken sources.
    `fetched   ${r.fetched}   inserted ${r.inserted}   updated ${r.updated}   touched ${r.touched}   duplicates ${r.duplicates}`,
    `scored    keyword ${r.fetched}   llm ${r.llmScored}`,
    `errors    ${r.errors.length}`,
    ...r.errors.map(e => `  ${e.source}: ${e.message}`),
    `run #${r.runId} took ${dur(r)}`,
  ].join('\n')
}

if (import.meta.main) {
  let args
  try {
    args = parseArgs({
      options: {
        profile: { type: 'string' },
        'no-llm': { type: 'boolean' },
        'rescore-only': { type: 'boolean' },
        llm: { type: 'boolean' },
      },
    })
  } catch (err) {
    console.error(`${(err as Error).message}\n\n${USAGE}`)
    process.exit(1)
  }

  const noLlm = args.values['no-llm'] === true

  // One try for everything, because the first DB touch is findProfile — that is where an
  // unmigrated database surfaces, not in runPipeline.
  try {
    const profile = findProfile(args.values.profile)
    if (!profile) {
      console.error(
        args.values.profile === undefined
          ? `No search profiles in ${databasePath}. Create one at /profiles (npm run dev).`
          : `No profile "${args.values.profile}" in ${databasePath}.`,
      )
      process.exit(1)
    }

    if (args.values['rescore-only'] === true) {
      const res = await rescoreProfile(profile.id, { useLlm: args.values.llm === true })
      console.log(`profile   ${profile.name} (#${profile.id})`)
      console.log(`rescored  ${res.scored}   repaired ${res.repaired}   llm ${res.llmScored}`)
      for (const e of res.errors) console.log(`  ${e.source}: ${e.message}`)
      process.exit(0)
    }

    console.log(summary(await runPipeline({ profileId: profile.id, useLlm: !noLlm }), profile.name))
  } catch (err) {
    const message = (err as Error).message
    console.error(
      /no such table/.test(message) ? `Database ${databasePath} is not migrated. Run: npm run db:migrate` : message,
    )
    process.exit(1)
  }
}
