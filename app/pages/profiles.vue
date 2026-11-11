<script setup lang="ts">
import type { SearchProfile } from '~~/server/core/types'
import { cvMaxChars } from '~~/server/core/config/rubric'

useHead({ title: 'Search profiles · Job Seek' })

const route = useRoute()
const router = useRouter()

const { data: profiles, refresh } = await useFetch('/api/profiles')

/** `?id=new` is the create form, `?id=<n>` edits that profile, absent is the list alone. */
const editing = computed(() => route.query.id as string | undefined)
const selected = computed(() => profiles.value?.find(p => String(p.id) === editing.value))
const open = computed(() => editing.value === 'new' || !!selected.value)

/**
 * ponytail: keyword lists are one comma-separated input each, so a keyword containing a comma
 * cannot be entered. Ceiling: commas are separators, never content. Upgrade path: one input per
 * term with add/remove, which is a lot of markup for a case no real keyword hits.
 */
const list = (s: string) =>
  s
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)

const blank = () => ({
  name: '',
  query: '',
  location: '',
  remoteOnly: false,
  requiredKeywords: '',
  preferredKeywords: '',
  excludedKeywords: '',
  cv: '',
})

const form = ref(blank())

/**
 * The cap is on the *trimmed* string, because `searchProfileInsertSchema` trims before it measures.
 * A counter that disagreed with the validator by the length of a trailing newline would be worse
 * than none: it would say the field is fine and the save would 400.
 */
const cvCount = computed(() => form.value.cv.trim().length)
const cvOver = computed(() => cvCount.value > cvMaxChars)
const saving = ref(false)
const saveError = ref<string>()
const saved = ref(false)

// The form is filled from the row already in `profiles` — no second fetch for data we hold.
// Watched rather than computed: it is edited locally, so it cannot be derived state.
watch(
  [editing, profiles],
  () => {
    saveError.value = undefined
    saved.value = false
    const p = selected.value
    form.value = p
      ? {
          name: p.name,
          query: p.query,
          location: p.location ?? '',
          remoteOnly: p.remoteOnly,
          requiredKeywords: p.requiredKeywords.join(', '),
          preferredKeywords: p.preferredKeywords.join(', '),
          excludedKeywords: p.excludedKeywords.join(', '),
          cv: p.cv ?? '',
        }
      : blank()
  },
  { immediate: true },
)

const save = async () => {
  if (saving.value) return
  saving.value = true
  saveError.value = undefined
  saved.value = false
  // '' for location and cv is cleared, not empty — the route turns it into null.
  const body = {
    ...form.value,
    requiredKeywords: list(form.value.requiredKeywords),
    preferredKeywords: list(form.value.preferredKeywords),
    excludedKeywords: list(form.value.excludedKeywords),
  }
  try {
    // Explicit generic: inferring the route type here blows TS's comparison depth.
    const id = selected.value?.id
    const row = await $fetch<SearchProfile>(id ? `/api/profiles/${id}` : '/api/profiles', {
      method: id ? 'PUT' : 'POST',
      body,
    })
    await refresh()
    saved.value = true
    if (!id) await router.replace({ query: { id: row.id } })
  } catch (e) {
    saveError.value = errorMessage(e)
  } finally {
    saving.value = false
  }
}

// Narrowed to what it uses: a row off the wire has ISO strings where SearchProfile has Dates.
const remove = async (p: Pick<SearchProfile, 'id' | 'name'>) => {
  // Scores and run history for this profile cascade; the jobs themselves are shared and stay.
  if (!confirm(`Delete "${p.name}"? Its scores and run history go with it. Jobs are kept.`)) return
  try {
    await $fetch(`/api/profiles/${p.id}`, { method: 'DELETE' })
    await refresh()
    if (String(p.id) === editing.value) await router.replace({ query: {} })
  } catch (e) {
    saveError.value = errorMessage(e)
  }
}

/**
 * The Keywords cell, in words. Empty lists are dropped rather than rendered as `0 required`: the
 * cell is a summary, and a zero is the absence of the thing it would be naming.
 */
const keywordLines = (p: { requiredKeywords: string[]; preferredKeywords: string[]; excludedKeywords: string[] }) =>
  (['required', 'preferred', 'excluded'] as const).flatMap(k => {
    const n = p[`${k}Keywords` as const].length
    return n ? `${n} ${k}` : []
  })

// replace, not push: opening a form should not fill the back stack.
const openForm = (id: number | 'new') => router.replace({ query: { id } })
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between gap-3">
      <h1 class="text-xl font-semibold">Search profiles</h1>
      <button class="btn-accent" @click="openForm('new')">New profile</button>
    </div>

    <section>
      <h2 class="sr-only">Existing profiles</h2>
      <div class="overflow-x-auto rounded border border-line">
        <table class="w-full table-fixed text-sm">
          <thead class="bg-surface text-left text-muted">
            <tr>
              <th class="w-40 px-3 py-2 font-normal">Name</th>
              <th class="w-48 px-3 py-2 font-normal">Query</th>
              <th class="w-32 px-3 py-2 font-normal">Location</th>
              <th class="w-20 px-3 py-2 font-normal">Remote</th>
              <th class="w-32 px-3 py-2 font-normal">Keywords</th>
              <th class="w-16 px-3 py-2 font-normal">CV</th>
              <th class="w-28 px-3 py-2 font-normal"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in profiles" :key="p.id" class="border-t border-line align-top">
              <td class="truncate px-3 py-2" :title="p.name">{{ p.name }}</td>
              <td class="truncate px-3 py-2" :title="p.query">{{ p.query }}</td>
              <td class="truncate px-3 py-2" :title="p.location ?? undefined">{{ dash(p.location) }}</td>
              <td class="px-3 py-2">{{ p.remoteOnly ? 'yes' : '—' }}</td>
              <!-- Words, not ordered counts; empty lists omitted. -->
              <td class="px-3 py-2 text-muted">
                <span v-if="!keywordLines(p).length">—</span>
                <span v-for="l in keywordLines(p)" :key="l" class="block tabular-nums">{{ l }}</span>
              </td>
              <td class="px-3 py-2">{{ p.cv ? 'yes' : '—' }}</td>
              <td class="px-3 py-2">
                <button class="py-1 text-accent hover:underline" @click="openForm(p.id)">Edit</button>
                <button
                  class="ml-3 py-1 text-bad hover:underline"
                  :aria-label="`Delete profile ${p.name}`"
                  @click="remove(p)"
                >
                  Delete
                </button>
              </td>
            </tr>
            <tr v-if="!profiles?.length">
              <td colspan="7" class="px-3 py-8 text-center text-muted">No profiles yet.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="open" class="card space-y-4">
      <h2 class="font-semibold">{{ selected ? `Edit “${selected.name}”` : 'New profile' }}</h2>

      <div class="flex flex-wrap items-end gap-4">
        <div class="space-y-1">
          <label for="p-name" class="block text-sm text-muted">Name</label>
          <input id="p-name" v-model="form.name" class="w-48" />
        </div>
        <div class="space-y-1">
          <label for="p-query" class="block text-sm text-muted">Search query</label>
          <input id="p-query" v-model="form.query" class="w-64" />
        </div>
        <div class="space-y-1">
          <label for="p-location" class="block text-sm text-muted">Location</label>
          <input id="p-location" v-model="form.location" class="w-40" />
        </div>
        <label class="flex items-center gap-2 text-sm"
          ><input v-model="form.remoteOnly" type="checkbox" /> Remote only</label
        >
      </div>
      <p class="text-xs text-muted">
        <strong>Location</strong> narrows the search itself on jobs.ch and michaelpage.ch; every other board ignores it
        and returns its whole result set. <strong>Remote only</strong> is ignored by every board. Both are still read by
        the model when it scores a posting against your CV, so they shape the verdict even where they do not narrow the
        search — and the job list's own Location and Work mode filters narrow what you see, whatever the board did.
      </p>

      <div class="space-y-3">
        <div class="space-y-1">
          <label for="p-required" class="block text-sm text-muted">Required keywords (comma separated)</label>
          <input id="p-required" v-model="form.requiredKeywords" class="w-full" />
        </div>
        <div class="space-y-1">
          <label for="p-preferred" class="block text-sm text-muted">Preferred keywords</label>
          <input id="p-preferred" v-model="form.preferredKeywords" class="w-full" />
        </div>
        <div class="space-y-1">
          <label for="p-excluded" class="block text-sm text-muted">Excluded keywords</label>
          <input id="p-excluded" v-model="form.excludedKeywords" class="w-full" />
        </div>
      </div>

      <div class="space-y-1">
        <label for="p-cv" class="block text-sm text-muted">CV (markdown)</label>
        <textarea
          id="p-cv"
          v-model="form.cv"
          rows="16"
          class="w-full font-mono"
          aria-describedby="p-cv-note p-cv-count"
          placeholder="## Experience&#10;### Title, Company — 2021–2024&#10;- what you did&#10;&#10;## Education&#10;## Skills&#10;## Publications"
        />
        <div class="flex flex-wrap items-baseline justify-between gap-3 text-xs">
          <p id="p-cv-note" class="text-muted">
            Stored verbatim. Read by the LLM prompt as the candidate context; keyword scoring ignores it.
          </p>
          <p id="p-cv-count" :class="cvOver ? 'text-bad' : 'text-muted'" class="tabular-nums whitespace-nowrap">
            {{ cvCount.toLocaleString('de-CH') }} / {{ cvMaxChars.toLocaleString('de-CH') }} characters{{
              cvOver ? ' — over the cap' : ''
            }}
          </p>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <button class="btn-accent" :aria-disabled="saving" @click="save">
          {{ saving ? 'Saving…' : selected ? 'Save changes' : 'Create profile' }}
        </button>
        <NuxtLink :to="{ query: {} }" class="text-sm text-accent hover:underline">Close</NuxtLink>
        <span role="status" class="text-sm text-good">{{ saved ? 'Saved.' : '' }}</span>
      </div>

      <p v-if="saveError" role="alert" class="text-sm text-bad">{{ saveError }}</p>
    </section>
  </div>
</template>
