<script setup lang="ts">
/**
 * Lucide geometry, inlined: Titillium has no ↗/←. `1em` = the size of the surrounding text,
 * hence no size prop.
 */
const paths = {
  'external-link': ['M15 3h6v6', 'm10 14 11-11', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6'],
  'arrow-left': ['M19 12H5', 'm12 19-7-7 7-7'],
} as const

defineProps<{ name: keyof typeof paths }>()
</script>

<template>
  <!-- Always decorative: every call site is a link that carries its own text or an sr-only name,
       so an icon that announced itself would double it. -->
  <svg
    viewBox="0 0 24 24"
    width="1em"
    height="1em"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
    class="shrink-0"
  >
    <path v-for="d in paths[name]" :key="d" :d="d" />
  </svg>
</template>
