import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { databasePath } from '../config/env'
import * as schema from './schema'

mkdirSync(dirname(databasePath), { recursive: true })

const sqlite = new Database(databasePath)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')
// Dev HMR re-imports this module and leaks the previous handle on the WAL file.
sqlite.pragma('busy_timeout = 5000')

/** better-sqlite3 throws SqliteError directly; drizzle sometimes wraps it with `.cause`. */
export const isUniqueViolation = (e: unknown) =>
  (e as { code?: string })?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
  (e as { cause?: { code?: string } })?.cause?.code === 'SQLITE_CONSTRAINT_UNIQUE'

// ponytail: one process-wide connection. Ceiling: single-process only, which is the
// whole product ("runs locally"). Upgrade path: a pool, if that ever stops being true.
export const db = drizzle(sqlite, { schema })
