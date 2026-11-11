import { asc, getTableColumns, sql } from 'drizzle-orm'
import { db } from '../core/db/index'
import { jobScores, searchProfiles } from '../core/db/schema'

// One derived fact: hasScores answers "is the job list empty for this profile", which the dashboard
// needs because listJobs inner-joins job_scores — an unscored profile renders as no rows at all,
// indistinguishable from a too-narrow filter.
//
// EXISTS instead of a max() over a leftJoin+groupBy: an index-only seek on
// job_scores_profile_final_score_idx, not a scan of jobs × profiles rows on every page load.
export default defineEventHandler(() =>
  db
    .select({
      ...getTableColumns(searchProfiles),
      hasScores:
        sql<boolean>`exists (select 1 from ${jobScores} where ${jobScores.profileId} = ${searchProfiles.id})`.mapWith(
          Boolean,
        ),
    })
    .from(searchProfiles)
    .orderBy(asc(searchProfiles.id))
    .all(),
)
