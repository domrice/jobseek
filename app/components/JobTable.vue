<script setup lang="ts">
const props = defineProps<{
  profileId: number
  /** No score row anywhere for this profile, which `listJobs`' inner join makes look like an empty filter. */
  unscored: boolean
}>()
const route = useRoute()
const { filters, set } = useListQuery()

// Keyed, so a finished pass refreshes it by name.
const { data, pending, error } = await useFetch('/api/jobs', {
  key: 'jobs',
  query: computed(() => buildJobQuery({ ...filters.value, profileId: props.profileId })),
})
const items = computed(() => data.value?.items ?? [])
const total = computed(() => data.value?.total ?? 0)
const page = computed(() => filters.value.page)
const pages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const from = computed(() => (total.value ? (page.value - 1) * PAGE_SIZE + 1 : 0))
const to = computed(() => Math.min(page.value * PAGE_SIZE, total.value))

/** The whole filter state: a detail page opened in a new tab rebuilds the list from it. */
const detailLink = (id: number) => ({ path: `/jobs/${id}`, query: { ...route.query, profileId: props.profileId } })
</script>

<template>
  <section class="space-y-6">
    <h2 id="results-heading" class="sr-only">Results</h2>
    <p v-if="error" role="alert" class="text-bad">Could not load jobs: {{ error.message }}</p>

    <!-- The legend is the table's key, inside its box but outside the scroll region so 60rem of
         table cannot pan it away. No `overflow-hidden` here: it would clip the scroll region's
         focus ring (SC 2.4.7). -->
    <div class="rounded border border-line">
      <ScoreScale id="score-legend" class="border-b border-line px-3 py-2" />
      <!-- `min-w-[60rem]` is what makes it scroll rather than crush the fixed columns on a narrow
           window; `tabindex` makes it keyboard-pannable (SC 2.1.1). `contain-paint` stops Chrome
           from widening the *root* scroll area by the table's width. Dormant at the 1024 floor. -->
      <div
        class="contain-paint overflow-x-auto"
        tabindex="0"
        role="region"
        aria-labelledby="results-heading"
        aria-describedby="score-legend"
      >
        <table class="w-full min-w-[60rem] table-fixed text-sm">
          <thead class="bg-surface text-left text-muted">
            <tr>
              <th class="w-24 px-3 py-2 font-normal">Score</th>
              <th class="px-3 py-2 font-normal">Title</th>
              <th class="w-52 px-3 py-2 font-normal">Company</th>
              <th class="w-32 px-3 py-2 font-normal">Location</th>
              <th class="w-32 px-3 py-2 font-normal">Source</th>
              <th class="w-28 px-3 py-2 font-normal">Posted</th>
              <th class="w-10 px-3 py-2 font-normal"><span class="sr-only">Original posting</span></th>
            </tr>
          </thead>
          <tbody :class="pending ? 'opacity-50' : ''">
            <tr v-for="job in items" :key="job.id" class="border-t border-line align-top">
              <td class="px-3 py-2">
                <!-- A `.qualifier`, not a `.chip`: provenance of the number, told apart by lightness
                     alone. Visible abbreviation, full sentence on `title` and the legend above. -->
                <div class="flex items-center gap-1.5">
                  <ScoreBadge :score="job.score.finalScore" :verdict="job.score.llmScore !== null" />
                  <span
                    v-if="job.score.llmScore === null"
                    class="qualifier text-muted"
                    title="Keyword score — no model has read this posting yet"
                    >kw</span
                  >
                  <span v-else class="qualifier text-ink" title="Judged by the local model">llm</span>
                </div>
              </td>
              <td class="px-3 py-2">
                <!-- No line clamp on the row's identifying field (SC 1.4.12): it wraps and the row grows. -->
                <NuxtLink :to="detailLink(job.id)" class="job-link text-accent hover:underline">{{
                  job.title
                }}</NuxtLink>
                <span v-if="job.duplicateOf" class="chip ml-1 border-line text-muted">dup</span>
                <p v-if="job.score.llmRecommendation" class="text-xs text-muted">
                  {{ job.score.llmRecommendation.replace('_', ' ') }}
                  <span
                    v-if="job.score.llmDetail"
                    class="tabular-nums"
                    title="How sure the model was of its own verdict, from 0 to 1"
                  >
                    · confidence {{ job.score.llmDetail.confidence.toFixed(2) }}
                  </span>
                </p>
              </td>
              <td class="truncate px-3 py-2" :title="job.company ?? undefined">{{ dash(job.company) }}</td>
              <td class="px-3 py-2">
                <span class="block truncate" :title="job.location ?? undefined">{{ dash(job.location) }}</span>
                <!-- Absent workMode renders nothing: the source did not say. -->
                <span v-if="job.workMode" class="chip mt-0.5" :class="WORK_MODE[job.workMode].tone">{{
                  WORK_MODE[job.workMode].label
                }}</span>
              </td>
              <!-- Duplicates are hidden by default, so this count is the only place the other boards show. -->
              <td class="truncate px-3 py-2 text-muted" :title="job.sources.join(', ')">
                {{ job.source
                }}<span v-if="job.sources.length > 1">
                  +{{ job.sources.length - 1 }}
                  <span class="sr-only"
                    >other {{ job.sources.length === 2 ? 'board' : 'boards' }} carry this posting:
                    {{ job.sources.join(', ') }}</span
                  ></span
                >
              </td>
              <td class="px-3 py-2 tabular-nums text-muted">{{ fmtDate(job.postedAt) }}</td>
              <!-- Padding on the link, not the cell, so the whole 40×36px cell is the target
                   (SC 2.5.8); `min-h-9` holds 36px now that the mark is an SVG with no line box. -->
              <td>
                <a
                  :href="job.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="flex min-h-9 items-center justify-center px-3 py-2 text-accent"
                  title="Open original"
                >
                  <AppIcon name="external-link" />
                  <span class="sr-only">Open {{ job.title }} on {{ job.source }} (opens in a new tab)</span>
                </a>
              </td>
            </tr>
            <tr v-if="!items.length && !pending">
              <td v-if="unscored" colspan="7" class="px-3 py-8 text-center text-muted">
                This profile has never been scored, so no postings are visible to it yet. Pre-Score above scores
                everything already in the database (<code>npm run pipeline -- --rescore-only</code> does the keyword
                half for free); a pipeline run scores only what it fetches.
              </td>
              <td v-else colspan="7" class="px-3 py-8 text-center text-muted">No jobs match these filters.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- A control for this region, so a <nav> label rather than a heading of its own. -->
    <nav class="flex items-center gap-4 text-sm text-muted" aria-label="Result pages">
      <button class="btn px-2" :disabled="page <= 1" aria-label="Previous page" @click="set({ page: page - 1 })">
        Prev
      </button>
      <span class="tabular-nums" aria-live="polite">showing {{ from }}–{{ to }} of {{ total }}</span>
      <button class="btn px-2" :disabled="page >= pages" aria-label="Next page" @click="set({ page: page + 1 })">
        Next
      </button>
    </nav>
  </section>
</template>
