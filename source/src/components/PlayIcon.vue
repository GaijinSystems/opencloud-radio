<script setup lang="ts">
/** The play triangle, or the stop square while something plays. */
withDefaults(defineProps<{ stop: boolean; size?: number }>(), { size: 14 })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path v-if="stop" d="M6.5 6.5h11v11h-11z" />
    <path v-else d="M8 5.2v13.6L19 12z" />
  </svg>
</template>
