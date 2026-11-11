<script setup lang="ts">
useHead({ title: 'Jobs · Job Seek' })

const { data: profiles } = await useFetch('/api/profiles', { key: 'profiles' })
const { filters } = useListQuery()
const profileId = computed(() => filters.value.profileId || profiles.value?.[0]?.id)
/** No score row anywhere for this profile — free from /api/profiles, no extra request. */
const unscored = computed(() => !profiles.value?.find(p => p.id === profileId.value)?.hasScores)
</script>

<template>
  <div class="space-y-6">
    <!-- Real and invisible: the heading list needs a top level, and a visible "Jobs" would repeat
         the tab title over a page whose first element is the run bar. -->
    <h1 class="sr-only">Jobs</h1>

    <p v-if="!profileId" class="text-muted">
      No search profiles yet.
      <NuxtLink to="/profiles?id=new" class="text-accent hover:underline">Create one</NuxtLink>
      or run <code>npm run db:seed</code>.
    </p>

    <template v-else>
      <RunPanel :profile-id="profileId" :profiles="profiles ?? []" />
      <JobFilters :profile-id="profileId" />
      <JobTable :profile-id="profileId" :unscored="unscored" />
    </template>
  </div>
</template>
