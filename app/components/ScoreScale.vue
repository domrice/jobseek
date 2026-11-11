<script setup lang="ts">
import { scoreBands } from '~~/server/core/config/rubric'
</script>

<template>
  <!-- Bounds from scoreBands, so the legend can't drift from the badges or the prompt. -->
  <p class="text-xs text-muted tabular-nums">
    Score 0–100, higher is a better match: <span class="text-good">strong {{ scoreBands.strong }}+</span> ·
    <span class="text-warn">possible {{ scoreBands.possible }}–{{ scoreBands.strong - 1 }}</span> ·
    <span class="text-bad">poor 0–{{ scoreBands.possible - 1 }}</span
    >. An untinted score is the keyword fallback — no model has read that posting yet.
  </p>
</template>
