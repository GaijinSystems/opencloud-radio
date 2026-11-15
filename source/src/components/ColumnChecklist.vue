<script setup lang="ts">
import { COLUMNS } from '../composables/usePreferences'

/**
 * The column checkboxes, once. The Columns menu and Preferences both show this
 * list and each used to render it by hand — including the disabled "Station"
 * row that stands in as the parent of the logo and homepage toggles — so the
 * 1.1.4 `showLogos` fix had to be made in two places.
 */
withDefaults(defineProps<{
  columns: Record<string, boolean>
  /** Columns the administrator has switched off for the instance. */
  hidden?: string[]
  /** Style of one row, from the surrounding menu or dialog. */
  rowStyle?: Record<string, string | number>
  /** Left padding of the two rows nested under Station, in px. */
  indent?: number
}>(), { hidden: () => [], rowStyle: () => ({}), indent: 26 })
const emit = defineEmits<{ (e: 'toggle', key: string, value: boolean): void }>()
</script>

<template>
  <template v-for="c in COLUMNS" :key="c.key">
    <label v-if="c.key === 'logo'" :style="{ ...rowStyle, opacity: 0.55 }">
      <input type="checkbox" checked disabled> Station
    </label>
    <label
      v-if="!hidden.includes(c.key)"
      :style="c.key === 'logo' || c.key === 'home' ? { ...rowStyle, paddingLeft: `${indent}px` } : rowStyle"
    >
      <input
        type="checkbox" :checked="columns[c.key]"
        @change="emit('toggle', c.key, ($event.target as HTMLInputElement).checked)"
      >
      {{ c.label }}
    </label>
  </template>
</template>
