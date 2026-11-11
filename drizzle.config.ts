import { defineConfig } from 'drizzle-kit'
import { databasePath } from './server/core/config/env'

export default defineConfig({
  dialect: 'sqlite',
  schema: './server/core/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: databasePath },
})
