import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { db } from '../server/core/db/index'

migrate(db, { migrationsFolder: './drizzle' })
console.log('migrations applied')
