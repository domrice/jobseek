import { defineConfig } from 'vitest/config'

// seed() deletes every job unconditionally, and data/jobseek.db holds real postings that cannot be
// re-fetched once they expire. Tests get their own file. Setting DATABASE_PATH here beats a later
// .env, because process.loadEnvFile does not override an already-set variable.
// Set on process.env too: this file and globalSetup run in the Vitest main process, `env` only
// reaches the workers.
const DATABASE_PATH = './data/test.db'
process.env.DATABASE_PATH = DATABASE_PATH

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'server/**/*.test.ts'],
    // fileParallelism off: three suites call seed(), which wipes the one shared test DB.
    fileParallelism: false,
    env: { DATABASE_PATH },
    globalSetup: ['./test/setup.ts'],
  },
})
