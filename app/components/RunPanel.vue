<script setup lang="ts">
import { scoreBands } from '~~/server/core/config/rubric'
import type { PipelineResult, RescoreResult } from '~~/server/core/types'

const props = defineProps<{ profileId: number; profiles: { id: number; name: string }[] }>()
const { set } = useListQuery()

// What the provider holds plus the tag each pass starts on, from the server because only it knows
// LLM_MODEL and the tags' sizes. An empty list = no LLM configured, so no dropdown.
const { data: modelOptions } = await useFetch('/api/models')
const models = computed(() => modelOptions.value?.models ?? [])
// The boards a run *could* query — not /api/sources, which answers "which boards have rows".
const { data: boards } = await useFetch('/api/registry')
const boardNames = computed(() => boards.value?.map(b => b.name) ?? [])
const { data: lastRun, refresh: refreshLastRun } = await useFetch('/api/runs')

/**
 * The clock `last run` is relative to. 0 until mounted — `fmtAgo` reads it as "no clock" and renders
 * the absolute date, because a relative string rendered against the server's clock and re-rendered
 * against the browser's is a hydration mismatch.
 */
const now = ref(0)
onMounted(() => {
  now.value = Date.now()
  const tick = setInterval(() => (now.value = Date.now()), 30_000)
  onUnmounted(() => clearInterval(tick))
})

/** Writing through `set` is what clears `page` on a scope change. */
const profile = computed({ get: () => props.profileId, set: (id: number) => set({ profileId: id }) })

/**
 * Which boards to query: a per-person preference in localStorage, seeded to every board so the SSR
 * markup is the honest default. The saved list is read after hydration, since a value only the
 * browser holds cannot be part of the render Vue diffs against the server's HTML.
 * ponytail: one list for all profiles. Upgrade path: a column on search_profiles.
 */
const picked = ref<string[]>(boardNames.value)
onMounted(() => {
  const saved = JSON.parse(localStorage.getItem('sources') ?? 'null') as unknown
  // Unknown/removed names are dropped, so a stale list cannot select a board the registry lost.
  if (Array.isArray(saved)) picked.value = saved.filter(n => boardNames.value.includes(n))
})
watch(picked, v => localStorage.setItem('sources', JSON.stringify(v)), { deep: true })
/** State, not `:open="!picked.length"`: it opens itself when the list empties and is the user's after. */
const pickerOpen = ref(false)
watch(picked, v => {
  if (!v.length) pickerOpen.value = true
})

/** Thinking belongs to the deep pass only; the fast tier is defined by being cheap. */
const deepThinking = ref(false)
const fastModel = ref('')
const deepModel = ref('')
watchEffect(() => {
  fastModel.value ||= modelOptions.value?.fast ?? ''
  deepModel.value ||= modelOptions.value?.deep ?? modelOptions.value?.fast ?? ''
})
/** Tier 2 skips rows already judged by this exact (model, thinking) pair, so this selects nothing. */
const deepSameAsFast = computed(() => !!deepModel.value && deepModel.value === fastModel.value && !deepThinking.value)
// Defaults to everything the fast model did not call a poor match.
const bandMin = ref(scoreBands.possible)
const bandMax = ref(100)

/**
 * How much of the stored table this profile's model has read, and how much it still could. Every
 * finished pass refreshes it, which is also how an empty pass says which gate emptied it. The deep
 * half depends on the controls the user is holding, so they travel as a watched `query`; the route
 * counts it only when all four arrive.
 */
const { data: debt, refresh: refreshDebt } = await useFetch(() => `/api/profiles/${props.profileId}/scoring`, {
  query: computed(() =>
    deepModel.value
      ? {
          deepModel: deepModel.value,
          deepThink: deepThinking.value ? 'on' : 'off',
          bandMin: bandMin.value,
          bandMax: bandMax.value,
        }
      : {},
  ),
  watch: [() => props.profileId],
})

type Pass = 'seek' | 'score'
type Outcome = { kind: 'seek'; result: PipelineResult } | { kind: 'score'; result: RescoreResult }
/** Which pass is running; a seek stops between boards, a scoring pass between postings. */
const running = ref<Pass>()
/** The stop was asked for and the run has not answered yet — up to one board or posting plus the write. */
const stopping = ref(false)
const outcome = ref<Outcome>()
const runError = ref<string>()
/** The coarse phase line for the live region. */
const progress = ref<string>()
/** The instrument, outside the live region: count, yield, clocks, and how full the rule is (0–1). */
const live = ref<{ reading?: EtaReading; fraction?: number; strong?: number }>({})
let eta = createEta()
let clock: ReturnType<typeof setInterval> | undefined

/**
 * One wrapper for every pass. The `running` guard is what makes `aria-disabled` safe on the run
 * buttons: they stay focusable (SC 2.4.3) and the refusal, and the double-submit guard, live here.
 */
const stream = async (kind: Pass, go: () => Promise<Outcome['result']>) => {
  if (running.value) return
  running.value = kind
  runError.value = undefined
  outcome.value = undefined
  // Fresh per pass: its mean holds only within one model and thinking level.
  eta = createEta()
  // Elapsed has to advance between events too — at ~5 s a posting the stream is the slower clock.
  // The display's granularity is minutes, so a 5 s tick only ever redraws a changed value.
  clock = setInterval(() => (live.value.reading = eta()), 5_000)
  try {
    outcome.value = { kind, result: await go() } as Outcome
    await Promise.all([refreshNuxtData('jobs'), refreshLastRun(), refreshDebt()])
    // Re-read beside the row it is read against, or the fresh `startedAt` sits in the future of a
    // 30 s-old clock and `fmtAgo` falls back to the absolute date.
    now.value = Date.now()
  } catch (e) {
    runError.value = errorMessage(e)
  } finally {
    clearInterval(clock)
    running.value = undefined
    stopping.value = false
    progress.value = undefined
    live.value = {}
  }
}

const onEvent = (e: RunEvent<unknown>) => {
  progress.value = progressLabel(e) ?? progress.value
  // Only `llm` feeds the estimator — boards are not uniform units. Both phases fill the rule.
  if (e.phase === 'llm') live.value = { reading: eta(e), fraction: e.done / e.total, strong: e.strong }
  else if (e.phase === 'source') live.value.fraction = e.index / e.total
  else if (e.phase === 'write') {
    // The instrument belongs to the judging phase; through the write it would quote a frozen estimate.
    clearInterval(clock)
    live.value = { fraction: 1 }
  }
}

const seek = (sources: string[]) => {
  // Outside `stream`: inside it the run would be marked started and end by refetching for nothing.
  if (!sources.length) return
  return stream('seek', () =>
    postStream<PipelineResult>('/api/pipeline/run', { profileId: props.profileId, sources }, onEvent),
  )
}

/** Both tiers; `band` is the only difference. Tier 1 passes none and never thinks. */
const score = (model: string, think: boolean, band?: [number, number]) =>
  stream('score', () =>
    postStream<RescoreResult>(
      `/api/profiles/${props.profileId}/rescore`,
      { useLlm: true, think: think ? 'on' : 'off', model: model || undefined, band },
      onEvent,
    ),
  )

/**
 * A POST, never an abort of the fetch: the rescore writes its verdicts after the loop, so aborting
 * would only stop the display while the server spent to the end. The stream stays open and its last
 * line reports what was kept. Its own guard, since this is the one control `running` must not gate.
 */
const stop = async () => {
  if (!running.value || stopping.value) return
  stopping.value = true
  try {
    await $fetch('/api/pipeline/stop', { method: 'POST' })
  } catch (e) {
    // The ask failed, so the pass is still going and the button has to come back.
    stopping.value = false
    runError.value = errorMessage(e)
  }
}

/** `errors` also carries `llm` and `collision`, which name no board — registry membership is the test. */
const runErrors = computed(() => outcome.value?.result.errors ?? [])
const retryable = computed(() => runErrors.value.map(e => e.source).filter(s => boardNames.value.includes(s)))
/**
 * Starting a run unmounts the summary the Retry button lives in, so focus moves to Stop — the
 * control that continues the same operation — instead of falling to `<body>`.
 */
const stopBtn = ref<HTMLButtonElement>()
const retry = (sources: string[]) => {
  seek(sources)
  nextTick(() => stopBtn.value?.focus())
}

const postings = (n: number) => `${n} posting${n === 1 ? '' : 's'}`
const matches = (n: number) => `${n} strong ${n === 1 ? 'match' : 'matches'}`

/** Each clause appears only once it is true; an estimate needs four warm postings in the mean. */
const etaLine = computed(() => {
  const r = live.value.reading
  if (!r) return undefined
  const elapsed = fmtDuration(r.elapsedMs)
  // Clamped to a minute so the tail counts down to `~1 min left`; dropped once a stop is in flight,
  // since what remains is one posting and a write, not the queue the mean was measured against.
  const left = stopping.value || r.remainingMs === undefined ? undefined : fmtDuration(Math.max(r.remainingMs, 60_000))
  return [
    `judged ${r.done} of ${r.total}`,
    live.value.strong && matches(live.value.strong),
    elapsed && `${elapsed} elapsed`,
    left && `~${left} left`,
  ]
    .filter(Boolean)
    .join(' · ')
})

/** `ready` needs a provider, or it would promise a button that judges nothing. */
const debtLine = computed(() => {
  const d = debt.value
  if (running.value || !d?.stored) return undefined
  if (d.judged >= d.stored) return `all ${d.stored} postings judged`
  const head = `judged ${d.judged} of ${d.stored}`
  if (!models.value.length) return head
  return d.ready ? `${head} · ${d.ready} ready to pre-score` : `${head} · the rest are past the age caps`
})
/** A deep pass can only re-judge what the fast one judged, so its denominator is `judged`. */
const deepLine = computed(() => {
  const d = debt.value
  if (running.value || !d?.stored || !models.value.length) return undefined
  if (!d.judged) return 'nothing pre-scored yet — a deep pass re-judges the fast pass’s verdicts'
  if (!d.deep) return undefined
  const head = `deep-judged ${d.deep.judged} of ${d.judged}`
  return d.deep.ready ? `${head} · ${d.deep.ready} ready to deep-score` : `${head} · nothing in this score range`
})
/** The caps themselves are env-side, so they travel in the response. */
const debtTitle = computed(() =>
  debt.value && !debt.value.ready && debt.value.judged < debt.value.stored
    ? `Only postings last seen within ${debt.value.ageCaps.lastSeenDays} days and posted within ${debt.value.ageCaps.postedDays} are judged. Seek Jobs to refresh what the boards still list.`
    : undefined,
)

/** The bottom line holds only live words — a pass in flight, or why Seek is refusing. */
const readoutOn = computed(() => !!running.value || !boardNames.value.length || !picked.value.length)

/** The summary's answer to "what did that buy me"; the diagnostics sit in the disclosure below it. */
const headline = computed(() => {
  const o = outcome.value
  if (!o) return []
  if (o.kind === 'score') {
    const n = o.result.llmScored
    // Kept, not merely judged: the flag comes from the run, so a stop that arrived during the
    // write reports the completed pass it was.
    if (o.result.stopped) return [n ? `${postings(n)} judged and kept` : 'stopped before any posting was judged']
    return [n ? `from ${postings(n)} judged` : 'no posting was judged']
  }
  const r = o.result
  const parts = [
    r.inserted && `${postings(r.inserted)} new`,
    r.updated && `${r.updated} updated`,
    r.llmScored && `${r.llmScored} judged by the model`,
  ].filter(Boolean) as string[]
  if (r.stopped) return parts.length ? [...parts, 'stopped early'] : ['Stopped before anything new was stored']
  return parts.length ? parts : ['Nothing new — every posting the boards listed was already stored']
})

/**
 * A scoring pass's yield, stated even at zero. The link is `scored=llm` *and* `minScore` — the
 * floor alone runs on `finalScore` and would sweep in every keyword-only 100 — and carries nothing
 * else of the filter state, since the count was taken over the whole pass.
 */
const strongYield = computed(() => {
  if (outcome.value?.kind !== 'score') return undefined
  const n = outcome.value.result.strong
  return {
    text: n ? matches(n) : 'No strong matches',
    to: n ? { query: { profileId: props.profileId, scored: 'llm', minScore: scoreBands.strong } } : undefined,
  }
})
</script>

<template>
  <!-- The cascade: seek, pre-score, deep-score, in the order of the work and of cost. Each stage
       row is button · settings · standing state, one grid so a long state clause wraps inside its
       own `20rem` column instead of under the controls. Every h2 on the dashboard is sr-only. -->
  <section class="card relative bg-surface">
    <h2 class="sr-only">Seek and score</h2>
    <!-- The progress rule: the bar's own bottom border, filling. Determinate, because both phases
         know their denominator. `aria-hidden`: the readout says the same in words. -->
    <div
      v-if="running && live.fraction !== undefined"
      aria-hidden="true"
      class="absolute inset-x-0 -bottom-px h-px overflow-hidden"
    >
      <div
        class="h-full bg-accent transition-[width] duration-500 ease-control motion-reduce:transition-none"
        :style="{ width: `${live.fraction * 100}%` }"
      />
    </div>

    <div class="grid grid-cols-[max-content_minmax(0,1fr)_minmax(0,20rem)] items-center gap-x-6 gap-y-3">
      <!-- One width (`min-w-32`) and one style for all three stage buttons: the order carries the
           sequence, the state clauses carry the choice. -->
      <div class="flex flex-wrap items-center gap-3">
        <button class="btn min-w-32" :aria-disabled="!!running || !picked.length" @click="seek(picked)">
          Seek Jobs
        </button>
        <!-- Beside the button that started the pass, so it is one tab stop away. "Stop", not
             "Cancel": nothing already paid for is discarded. -->
        <button
          v-if="running"
          ref="stopBtn"
          class="btn"
          :aria-disabled="stopping"
          :title="
            running === 'seek'
              ? 'Stops after the board being searched now. Every posting already fetched is kept.'
              : 'Stops after the posting being judged now. Every verdict already produced is kept.'
          "
          @click="stop"
        >
          Stop
        </button>
      </div>

      <!-- Settings labels share one right-aligned width and the selects share `w-36`, so the three
           stages' settings read as one column. -->
      <label class="flex items-center gap-2 text-sm text-muted">
        <span class="w-24 text-right">Profile</span>
        <select v-model="profile" class="w-36">
          <option v-for="p in profiles" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </label>

      <p v-if="lastRun" class="justify-self-end text-sm text-muted tabular-nums">
        last run
        <time :datetime="new Date(lastRun.startedAt).toISOString()" :title="fmtStamp(lastRun.startedAt)">{{
          fmtAgo(lastRun.startedAt, now)
        }}</time>
        <span v-if="lastRun.errors.length" class="text-warn">· {{ lastRun.errors.length }} source error(s)</span>
      </p>

      <!-- The h2 makes the picker reachable from the heading list while the disclosure is shut. -->
      <h2 class="sr-only">Boards</h2>
      <details
        :open="pickerOpen"
        class="col-span-3 text-sm"
        @toggle="pickerOpen = ($event.target as HTMLDetailsElement).open"
      >
        <summary class="cursor-pointer text-muted tabular-nums">
          Search on {{ picked.length }} of {{ boardNames.length }} boards
        </summary>
        <!-- Intrinsic grid, no breakpoints (DESIGN.md, The Desktop-Only Rule): three columns at
             1440, two at 1024, one under 400% zoom. -->
        <div class="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(20rem,100%),1fr))] gap-2">
          <label v-for="b in boards" :key="b.name" class="flex items-start gap-2">
            <input v-model="picked" type="checkbox" :value="b.name" class="mt-1" />
            <span>
              {{ b.name }}
              <span v-if="b.blurb" class="block text-xs text-muted">{{ b.blurb }}</span>
            </span>
          </label>
        </div>
      </details>

      <!-- The fence: everything below it spends model time. -->
      <div class="col-span-3 border-t border-line" />

      <!-- Pre-score never thinks: the fast tier has no such control, which is what makes it fast. -->
      <button class="btn min-w-32" :aria-disabled="!!running" @click="score(fastModel, false)">Pre-Score</button>
      <!-- Labelled by the tier, not the tag: a select named by its own current value says nothing
           about which pass it feeds. The full tag stays on :title. -->
      <label v-if="models.length" class="flex items-center gap-2 text-sm text-muted">
        <span class="w-24 text-right">Fast model</span>
        <select v-model="fastModel" class="w-36" :title="fastModel">
          <option v-for="m in models" :key="m" :value="m">{{ shortModel(m) }}</option>
        </select>
      </label>
      <!-- A standing property of the database, not an event, so it stays out of the live region. -->
      <p v-if="debtLine" class="justify-self-end text-sm text-muted tabular-nums" :title="debtTitle">
        {{ debtLine }}
      </p>

      <div class="col-span-3 border-t border-line" />

      <button
        class="btn min-w-32"
        :aria-disabled="!!running"
        @click="score(deepModel, deepThinking, [bandMin, bandMax])"
      >
        Deep-Score
      </button>
      <!-- Two groups, 8px inside / 24px between: model + Thinking are the configuration tier 2
           judges under; the score range is which rows. This cell is the grid's `1fr`, so the groups
           wrap at a narrow window and the state column does not move. -->
      <div class="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div class="flex flex-wrap items-center gap-3">
          <label v-if="models.length" class="flex items-center gap-2 text-sm text-muted">
            <span class="w-24 text-right">Deep model</span>
            <select
              v-model="deepModel"
              class="w-36"
              :title="deepModel"
              :aria-describedby="deepSameAsFast ? 'deep-same' : undefined"
            >
              <option v-for="m in models" :key="m" :value="m">{{ shortModel(m) }}</option>
            </select>
          </label>
          <!-- A checkbox, not an effort dropdown: low/medium/high measured byte-identical to `on`. -->
          <label class="flex items-center gap-2 text-sm">
            <input
              v-model="deepThinking"
              type="checkbox"
              :aria-describedby="deepSameAsFast ? 'deep-same' : undefined"
            />
            Thinking
          </label>
        </div>

        <!-- The range is on the *fast* pass's scores. Each input carries its own sr-only name; one
             <label> around both would name only the first. -->
        <span class="flex items-center gap-1 text-sm text-muted">
          Re-judge scores
          <label>
            <span class="sr-only">Lowest score to re-judge</span>
            <input v-model.number="bandMin" type="number" min="0" max="100" class="w-16" />
          </label>
          <span aria-hidden="true">–</span>
          <label>
            <span class="sr-only">Highest score to re-judge</span>
            <input v-model.number="bandMax" type="number" min="0" max="100" class="w-16" />
          </label>
        </span>
      </div>

      <!-- The one thing sayable before a deep pass spends. It replaces the count, which would be a
           guaranteed `0 of N`. `aria-describedby` on the two causing controls rather than a live
           region: it is a property of the configuration, not an event. -->
      <p v-if="deepSameAsFast" id="deep-same" class="justify-self-end text-xs text-warn">
        Same model as the fast pass, Thinking off — no posting in this range would be judged any differently, so nothing
        would be re-judged.
      </p>
      <p v-else-if="deepLine" class="justify-self-end text-sm text-muted tabular-nums">{{ deepLine }}</p>
    </div>

    <!-- The live readout: full width, only while there is something live to say, so it grows
         without moving any control above it. -->
    <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm tabular-nums" :class="readoutOn ? 'mt-3' : ''">
      <!-- Unconditional `role="status"` (SC 4.1.3): a live region must exist before its text changes.
           Clipped, not removed, while the instrument beside it is showing the same count, and
           un-clipped for a stop, whose promise the counter is not making. -->
      <span role="status" :class="{ 'sr-only': etaLine && !stopping }">
        <span v-if="stopping" class="text-accent">
          stopping after this {{ running === 'seek' ? 'board' : 'posting' }} — everything already
          {{ running === 'seek' ? 'fetched' : 'judged' }} is kept
        </span>
        <span v-else-if="running" class="text-accent">{{ progress ?? 'starting…' }}</span>
        <!-- Why Seek is inert. In the live region so unticking the last board is announced. -->
        <span v-else-if="!boardNames.length" class="text-bad"
          >No boards available — the registry could not be read.</span
        >
        <span v-else-if="!picked.length" class="text-warn">Pick at least one board above to seek.</span>
      </span>
      <!-- Outside the live region: a figure that steps every few seconds would be hundreds of
           announcements. The middot is a `::before`, decoration the screen reader never reaches. -->
      <span
        v-if="etaLine"
        class="text-accent"
        :class="stopping ? `before:mr-2 before:text-line before:content-['·']` : ''"
        >{{ etaLine }}</span
      >
    </div>
  </section>

  <section v-if="outcome || runError">
    <!-- Outside the live region, which would otherwise prefix "Run result" to every announcement. -->
    <h2 class="sr-only">Run result</h2>
    <!-- A finished run is polite, a failed one interrupts. -->
    <div :role="runError ? 'alert' : 'status'" class="card text-sm">
      <p v-if="runError" class="text-bad">Failed: {{ runError }}</p>
      <!-- A list, so the clauses are not read as one string; separators are `::before`. -->
      <ul v-else class="flex flex-wrap tabular-nums">
        <li v-if="strongYield">
          <NuxtLink v-if="strongYield.to" :to="strongYield.to" class="text-accent hover:underline">{{
            strongYield.text
          }}</NuxtLink>
          <template v-else>{{ strongYield.text }}</template>
        </li>
        <li
          v-for="h in headline"
          :key="h"
          class="before:mx-2 before:text-line before:content-['·'] first:before:content-none"
        >
          {{ h }}
        </li>
      </ul>
      <!-- A failed board is the one diagnostic that is news, and the one with a move attached.
           `py-1` lifts accent text to the 24px target floor. No `aria-disabled`: starting a run
           unmounts these, and `stream`'s guard covers clicks that land before the render. -->
      <ul v-if="runErrors.length" class="mt-2 space-y-1 text-warn">
        <li v-for="e in runErrors" :key="e.source + e.message">
          {{ e.source }}: {{ e.message }}
          <button
            v-if="retryable.includes(e.source)"
            class="ml-2 py-1 text-accent hover:underline"
            :aria-label="`Retry ${e.source}`"
            @click="retry([e.source])"
          >
            Retry
          </button>
        </li>
        <!-- Only above two: at two the per-board links are the shorter path. -->
        <li v-if="retryable.length > 2">
          <button class="py-1 text-accent hover:underline" @click="retry(retryable)">
            Retry all {{ retryable.length }} boards
          </button>
        </li>
      </ul>
    </div>

    <!-- Outside the live region (opening it would be announced in full), closed by default. -->
    <details v-if="outcome" class="mt-2 text-sm text-muted">
      <summary class="cursor-pointer">Run details</summary>
      <p v-if="outcome.kind === 'seek'" class="mt-2 tabular-nums">
        Searched {{ outcome.result.sourcesQueried.join(', ') }} — {{ outcome.result.fetched }} postings read ·
        {{ outcome.result.inserted }} new · {{ outcome.result.updated }} updated ·
        <span title="Already stored and unchanged. Only their last-seen date was refreshed."
          >{{ outcome.result.touched }} unchanged</span
        >
        ·
        <span title="The same posting was already stored from another board, so it was linked, not stored twice."
          >{{ outcome.result.duplicates }} duplicates</span
        >
        · {{ outcome.result.fetched }} keyword-scored · {{ outcome.result.llmScored }} judged by the model
      </p>
      <!-- A rescore keyword-scores the whole table too, so both counts are reported. -->
      <p v-else class="mt-2 tabular-nums">
        {{ outcome.result.scored }} keyword-scored · {{ outcome.result.llmScored }} judged by the model<template
          v-if="outcome.result.repaired"
        >
          ·
          <span
            title="The stored text fingerprint of these postings was out of date and has been recomputed. Their verdicts were kept."
            >{{ outcome.result.repaired }} fingerprints refreshed</span
          ></template
        >
      </p>
    </details>
  </section>
</template>
