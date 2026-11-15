<script setup lang="ts">
import { DEFAULT_COL_WIDTH } from '../composables/usePreferences'

/**
 * The table's `<colgroup>`, on its own so that the widths are read here and
 * nowhere else. Dragging a column edge changes a width dozens of times a
 * second; read by the table, each change re-rendered the table and built a
 * fresh description of every row in it. Read here, it re-renders this.
 *
 * Built from the same `grid` as the header and the rows: a column hidden from
 * one and not the others shifts every later cell into the wrong width.
 */
defineProps<{ grid: readonly string[]; widths: Record<string, number> }>()
</script>

<template>
  <colgroup>
    <col v-for="g in grid" :key="g" :style="g === 'actions' ? {} : { width: `${widths[g] ?? DEFAULT_COL_WIDTH}px` }">
  </colgroup>
</template>
