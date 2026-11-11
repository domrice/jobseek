<script setup lang="ts">
/** Stops the server. The window it was started from stays, showing that the process ended. */
const stopped = ref(false)
const quit = async () => {
  if (stopped.value) return
  if (!confirm('Stop Job Seek? The window will close and the page stops working.')) return
  await $fetch('/api/quit', { method: 'POST' }).catch(() => {})
  stopped.value = true
}
</script>

<template>
  <div class="min-h-screen">
    <!-- Blur, not opaque: titles ghost through bg-bg/90, and an opaque bar reads as no layer. -->
    <header class="sticky top-0 z-10 border-b border-line bg-bg/90 backdrop-blur">
      <div class="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
        <nav aria-label="Main" class="flex items-center gap-6">
          <NuxtLink to="/" class="font-semibold tracking-tight hover:text-accent">Job Seek</NuxtLink>
          <NuxtLink to="/profiles" class="text-sm text-accent hover:underline">Profiles</NuxtLink>
        </nav>
        <!-- Status stays mounted and Exit keeps focus (aria-disabled), so the stop is announced. -->
        <span role="status" class="ml-auto text-sm text-muted">{{ stopped ? 'Stopped. Close this tab.' : '' }}</span>
        <button class="btn" :aria-disabled="stopped" @click="quit">Exit</button>
      </div>
    </header>
    <main class="mx-auto max-w-7xl px-6 py-8">
      <NuxtPage />
    </main>
  </div>
</template>
