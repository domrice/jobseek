<script setup lang="ts">
defineProps<{ profileId: number }>()
const { filters, set } = useListQuery()

// The filter's options, off the stored rows — never a hardcoded list.
const { data: sources } = await useFetch('/api/sources')

/**
 * A control bound to one query key. `''` clears it, while a typed `0` survives. The three text
 * boxes share one debounce timer: a shared timer means switching boxes cannot leave a stale write.
 */
let debounce: ReturnType<typeof setTimeout>
const write = (key: keyof Filters, v: string | number) => set({ [key]: v === '' ? undefined : v })
const field = (key: keyof Filters, delayMs = 0) =>
  computed({
    get: () => String(filters.value[key] ?? ''),
    set: (v: string | number) => {
      if (!delayMs) return write(key, v)
      clearTimeout(debounce)
      debounce = setTimeout(write, delayMs, key, v)
    },
  })
const q = field('q', 300)
const location = field('location', 300)
const company = field('company', 300)
const source = field('source')
const workMode = field('workMode')
const scored = field('scored')
const minScore = field('minScore')
const maxConfidence = field('maxConfidence')
const firstSeenDays = field('firstSeenDays')
const postedAfter = field('postedAfter')
const sort = field('sort')
const hideDuplicates = computed({
  get: () => !filters.value.includeDuplicates,
  set: (hide: boolean) => set({ includeDuplicates: hide ? undefined : 'true' }),
})

/**
 * Collapsing is honest only because the summary names every filter narrowing the list, in the
 * labels' own words. Sort is named only off its default: it changes the order, not the contents.
 */
const activeFilters = computed(() => {
  const f = filters.value
  return [
    f.q && `search “${f.q}”`,
    f.source && `source ${f.source}`,
    f.location && `location ${f.location}`,
    f.company && `company ${f.company}`,
    f.workMode && `${WORK_MODE[f.workMode].label} only`,
    f.scored && SCORED[f.scored],
    f.minScore && `score ${f.minScore}+`,
    f.maxConfidence && `confidence up to ${f.maxConfidence}`,
    f.firstSeenDays && `first seen in ${f.firstSeenDays} days`,
    f.postedAfter && `posted after ${f.postedAfter}`,
    f.includeDuplicates && 'duplicates shown',
    f.sort !== 'verdict' && `sorted by ${f.sort}`,
  ].filter(Boolean) as string[]
})
</script>

<template>
  <!-- Every control has a visible label. Five groups by what they narrow — free text, facets,
       thresholds, time, duplicates — 24px between groups, 12px inside, 8px label to control, so a
       group wraps as one item. -->
  <section class="card">
    <!-- Outside the disclosure, so it is reachable from the heading list while the panel is shut. -->
    <h2 class="sr-only">Filters</h2>
    <details class="text-sm">
      <summary class="cursor-pointer text-muted">
        <template v-if="activeFilters.length">Filtering by {{ activeFilters.join(' · ') }}</template>
        <template v-else>Filters — showing every posting</template>
      </summary>
      <div class="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div class="flex flex-wrap items-center gap-3">
          <label class="flex items-center gap-2 text-muted">
            Search
            <input v-model="q" placeholder="title or company" class="w-44" />
          </label>
          <label class="flex items-center gap-2 text-muted">
            Location
            <input v-model="location" class="w-28" />
          </label>
          <label class="flex items-center gap-2 text-muted">
            Company
            <input v-model="company" class="w-28" />
          </label>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <label class="flex items-center gap-2 text-muted">
            Source
            <select v-model="source">
              <option value="">all</option>
              <option v-for="s in sources ?? []" :key="s" :value="s">{{ s }}</option>
            </select>
          </label>
          <label class="flex items-center gap-2 text-muted">
            Work mode
            <select v-model="workMode">
              <option value="">any</option>
              <option v-for="(m, k) in WORK_MODE" :key="k" :value="k">{{ m.label }}</option>
            </select>
          </label>
          <label class="flex items-center gap-2 text-muted">
            Scoring
            <select v-model="scored">
              <option value="">any</option>
              <option v-for="(label, k) in SCORED" :key="k" :value="k">{{ label }}</option>
            </select>
          </label>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <!-- The range lives in the label, where it is stated before anyone overshoots it. -->
          <label class="flex items-center gap-2 text-muted">
            Min score (0–100)
            <input v-model.lazy="minScore" type="number" min="0" max="100" class="w-16" />
          </label>
          <!-- At most: the point is finding the verdicts the model hedged on. -->
          <label
            class="flex items-center gap-2 text-muted"
            title="How sure the model was of its own verdict, from 0 to 1. Postings the model has not judged have no confidence and are excluded."
          >
            Max confidence (0–1)
            <input v-model.lazy="maxConfidence" type="number" min="0" max="1" step="0.05" class="w-16" />
          </label>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <!-- First seen, not posted: postedAt is null for most rows, so filtering on it hides them. -->
          <label class="flex items-center gap-2 text-muted">
            First seen
            <select v-model="firstSeenDays">
              <option value="">any time</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
            </select>
          </label>
          <label class="flex items-center gap-2 text-muted">
            Posted after
            <input v-model.lazy="postedAfter" type="date" />
          </label>
        </div>

        <label class="flex items-center gap-2">
          <input v-model="hideDuplicates" type="checkbox" />
          Hide duplicates
        </label>

        <!-- Reordering and clearing are not narrowing: pushed to their own end of the row. -->
        <div class="ml-auto flex flex-wrap items-center gap-3">
          <label class="flex items-center gap-2 text-muted">
            Sort
            <select v-model="sort">
              <option v-for="(label, k) in SORTS" :key="k" :value="k">{{ label }}</option>
            </select>
          </label>
          <NuxtLink :to="{ query: { profileId } }" class="text-accent hover:underline">Reset</NuxtLink>
        </div>
      </div>
    </details>
  </section>
</template>
