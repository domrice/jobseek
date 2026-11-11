<script setup lang="ts">
const route = useRoute()
const router = useRouter()
const profileId = Number(route.query.profileId) || undefined

/**
 * Back through history when there is history: Nuxt's default scrollBehavior returns the saved
 * position on a back navigation, so the list comes back scrolled where it was. A directly-opened
 * URL has nothing behind it, so the link rebuilds the list from the query it was given instead.
 */
const listTo = computed(() => ({ path: '/', query: route.query }))
// A plain <a> rather than a NuxtLink: the handler has to decide between back() and push(), and
// NuxtLink's own click handler would run alongside this one in an order nothing guarantees. The
// href keeps middle-click and copy-link working.
const listHref = computed(() => router.resolve(listTo.value).href)
const goBack = (e: MouseEvent) => {
  e.preventDefault()
  if (window.history.state?.back) router.back()
  else router.push(listTo.value)
}

const { data: job, error } = await useFetch(`/api/jobs/${route.params.id}`, { query: { profileId } })
// useFetch does not throw, so the route's 404 has to be re-raised to keep the status honest.
if (error.value)
  throw createError({ statusCode: error.value.statusCode ?? 500, statusMessage: 'Job not found', fatal: true })

// SC 2.4.2: the tab has to say *which* posting. Triage means several of these open at once, and
// `Job Seek` five times over identifies none of them. The company is what disambiguates two
// same-titled postings, and the brand comes last because a tab strip truncates from the right.
useHead({ title: () => [job.value?.title, job.value?.company, 'Job Seek'].filter(Boolean).join(' \u00b7 ') })

const score = computed(() => job.value?.score)
const kw = computed(() => score.value?.keywordDetail)
const noKeywords = computed(
  () => kw.value && !kw.value.matched.length && !kw.value.missing.length && !kw.value.excluded.length,
)
</script>

<template>
  <article v-if="job" class="space-y-8">
    <a :href="listHref" class="inline-flex items-center gap-1 text-sm text-accent hover:underline" @click="goBack"
      ><AppIcon name="arrow-left" />Back</a
    >

    <header class="max-w-prose space-y-2">
      <h1 class="text-xl font-semibold">{{ job.title }}</h1>
      <p class="flex flex-wrap items-center gap-2 text-muted">
        <span>
          {{ dash(job.company) }} · {{ dash(job.location) }} · {{ job.source }} · posted {{ fmtDate(job.postedAt) }}
        </span>
        <!-- No badge when the posting did not state a work mode. -->
        <span v-if="job.workMode" class="chip" :class="WORK_MODE[job.workMode].tone">{{
          WORK_MODE[job.workMode].label
        }}</span>
      </p>
      <!-- The mark trails the label: an external-link icon annotates where the link goes, and a
           box-and-arrow leading a phrase reads as a bullet instead. -->
      <a
        :href="job.url"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-1 text-sm text-accent hover:underline"
      >
        Original posting<AppIcon name="external-link" />
      </a>
    </header>

    <!-- Duplicate: the copy is kept, never deleted, so it gets a page of its own. -->
    <p v-if="job.duplicate" class="card bg-surface text-sm">
      Duplicate of a posting on <strong>{{ job.duplicate.source }}</strong> —
      <NuxtLink :to="{ path: `/jobs/${job.duplicate.id}`, query: route.query }" class="text-accent hover:underline">
        {{ job.duplicate.title }}
      </NuxtLink>
    </p>

    <section class="card space-y-6">
      <h2 class="text-base font-semibold">Match</h2>
      <p v-if="!score" class="text-sm text-muted">
        Not scored for this profile. <strong>Pre-Score</strong> on the dashboard judges everything already stored.
      </p>
      <template v-else>
        <!-- Badge, caption and scale are one readout, so they take the 8px within-group step rather
             than the section's 24px between-group one. -->
        <div class="space-y-2">
          <div class="flex flex-wrap items-center gap-6">
            <div class="flex items-center gap-3">
              <ScoreBadge :score="score.finalScore" size="lg" :verdict="score.llmScore !== null" />
              <!-- No verdict: say what the number is, not what it means. -->
              <span class="text-sm text-muted">
                {{ score.llmRecommendation?.replace('_', ' ') ?? 'keyword score · no model verdict yet' }}
              </span>
            </div>
            <!-- llmScore null is the default state: no LLM row, no empty box. The score itself is in
               the badge already; what it does not say is how sure the model was, and which one.
               Spaced, not dot-separated: either half can be absent and a dangling '·' would show. -->
            <p v-if="score.llmScore !== null" class="flex items-center gap-6 text-sm text-muted tabular-nums">
              <span v-if="score.llmDetail" title="How sure the model was of its own verdict, from 0 to 1"
                >confidence {{ score.llmDetail.confidence.toFixed(2) }} of 1</span
              >
              <!-- The tag alone named nothing: `Gemma4:31` is a family, a size and a build with no
                 word saying which, sitting on a line beside two other unlabelled numbers. -->
              <span v-if="score.llmModel" :title="`${score.llmModel} ${score.llmPromptVersion}`">
                judged by {{ shortModel(score.llmModel) }}
                <!-- Deep pass keys on (model, think); shown only when on. -->
                <span v-if="score.llmThink === 'on'" class="qualifier align-middle">thinking</span>
              </span>
            </p>
          </div>
          <!-- The scale the 30px badge is read against. Same component as the table's legend, because
             a reader arriving here from a bookmark has not seen that one — and two wordings of one
             scale is worse than one wording twice. It sits under the badge row rather than above it:
             the badge and its caption are the answer, this is the ruler. -->
          <ScoreScale />
        </div>

        <!-- Lead at 16px only when a model wrote it; a keyword-composed explanation stays Body,
             since setting it large would assert a judgement nothing made. -->
        <p
          v-if="score.explanation"
          class="max-w-prose"
          :class="score.llmScore !== null ? 'text-base leading-relaxed' : 'text-sm text-muted'"
        >
          {{ score.explanation }}
        </p>

        <!-- Sentences, not tokens: one column at prose measure. -->
        <dl v-if="score.llmDetail" class="max-w-prose space-y-4 text-sm">
          <div
            v-for="row in [
              { label: 'Strengths', items: score.llmDetail.strengths },
              { label: 'Gaps', items: score.llmDetail.gaps },
              { label: 'Concerns', items: score.llmDetail.concerns },
            ]"
            :key="row.label"
            class="flex flex-wrap items-baseline gap-x-2"
          >
            <dt class="text-xs text-muted" :class="row.items.length ? 'mb-1 basis-full' : ''">{{ row.label }}</dt>
            <dd>
              <span v-if="!row.items.length" class="text-muted">—</span>
              <ul v-else class="list-disc space-y-1 pl-4 leading-relaxed">
                <li v-for="i in row.items" :key="i">{{ i }}</li>
              </ul>
            </dd>
          </div>
        </dl>

        <!-- The keyword detail is the offline fallback's working, not the judgement, so it comes
             last and stays at Body/Label. Its grid *is* still the intrinsic three-column one — a
             keyword is a short token, so tiling is the right form for it, and 48rem gives three
             14rem tracks exactly. No breakpoint; DESIGN.md, The Desktop-Only Rule. -->
        <div v-if="noKeywords" class="text-sm text-muted">No keywords in this profile.</div>
        <dl v-else class="grid max-w-3xl grid-cols-[repeat(auto-fit,minmax(min(14rem,100%),1fr))] gap-3 text-sm">
          <div
            v-for="row in [
              { label: 'Matched', items: kw!.matched, tone: 'border-accent/40 text-accent' },
              { label: 'Missing required', items: kw!.missing, tone: 'border-line text-muted' },
              { label: 'Excluded present', items: kw!.excluded, tone: 'border-bad/40 text-bad' },
            ]"
            :key="row.label"
          >
            <dt class="mb-1 text-xs text-muted">{{ row.label }}</dt>
            <dd class="flex flex-wrap gap-1">
              <span v-if="!row.items.length" class="text-muted">—</span>
              <span v-for="k in row.items" :key="k" class="rounded border px-1.5 py-0.5" :class="row.tone">{{
                k
              }}</span>
            </dd>
          </div>
        </dl>
      </template>
    </section>

    <!-- 6000 chars is a seeded case: wrap and scroll, do not clamp. -->
    <section>
      <h2 class="mb-2 text-base font-semibold">Description</h2>
      <p v-if="job.description" class="max-w-prose whitespace-pre-line wrap-break-word text-sm leading-relaxed">
        {{ job.description }}
      </p>
      <p v-else class="text-sm text-muted">No description from this source.</p>
    </section>
  </article>
</template>
