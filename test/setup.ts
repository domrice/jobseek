import { rmSync } from 'node:fs'

/**
 * One throwaway DB per run, built from the migrations. A fresh file means the schema under test is
 * what `drizzle/` says it is, not whatever the dev DB has drifted to — and nothing a suite does can
 * reach `data/jobseek.db`.
 */
export default async function setup() {
  const path = process.env.DATABASE_PATH
  if (!path || path.includes('jobseek.db')) {
    throw new Error(`Refusing to run tests against ${path ?? '(unset)'} — see vitest.config.ts`)
  }
  // -wal and -shm outlive the file itself; a stale pair resurrects deleted rows.
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true })

  // Dynamic: db/index.ts opens its handle at import time, so DATABASE_PATH must be set first.
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator')
  const { db } = await import('../server/core/db/index')
  migrate(db, { migrationsFolder: './drizzle' })
}
