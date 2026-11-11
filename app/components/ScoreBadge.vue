<script setup lang="ts">
import { scoreBands } from '~~/server/core/config/rubric'

const { score, size = 'sm', verdict } = defineProps<{ score: number | null; size?: 'sm' | 'lg'; verdict: boolean }>()

// A band tone is a claim the model made. `verdict: false` renders the number in the existing
// null treatment instead: a keyword score is documented as a fallback and a cap tiebreak, not a
// band, so it must not paint the column green — the Verdict Reservation Rule.
// Three bands from `scoreBands`, the constant the prompt states.
const tone = computed(() =>
  score === null || !verdict
    ? 'text-muted border-line'
    : score >= scoreBands.strong
      ? 'text-good border-good/40 bg-good/10'
      : score >= scoreBands.possible
        ? 'text-warn border-warn/40 bg-warn/10'
        : 'text-bad border-bad/40 bg-bad/10',
)
</script>

<template>
  <!-- A bare integer visually (the legend gives the scale); the aria-label carries "/100" and provenance. -->
  <span
    class="inline-flex items-center justify-center rounded border font-semibold tabular-nums"
    :class="[tone, size === 'lg' ? 'text-3xl px-3 py-1 min-w-20' : 'text-xs px-1.5 py-0.5 min-w-10']"
    :aria-label="
      score === null
        ? 'Not scored'
        : `${Math.round(score)} out of 100, ${verdict ? 'judged by the model' : 'keyword score only'}`
    "
  >
    {{ score === null ? '—' : Math.round(score) }}
  </span>
</template>
