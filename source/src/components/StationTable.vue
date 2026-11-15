<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import StationRow from './StationRow.vue'
import ColumnWidths from './ColumnWidths.vue'
import type { Station } from '../parsers/types'
import { classify, initialState, type Playability } from '../helpers/classify'
import { historyKey } from '../helpers/safeUrl'
import { own } from '../helpers/history'
import { COLUMNS, GRID, MIN_COL, clampCol } from '../composables/usePreferences'
import { nextSelection } from '../helpers/text'
import type { ResultGroup } from '../composables/useSearch'

const props = defineProps<{
  stations: Station[]
  columns: Record<string, boolean>
  widths: Record<string, number>
  playingUrl: string | null
  states: Record<string, Playability>       // what this session saw, keyed by stream URL
  lastPlayed: Record<string, number>        // epoch ms, keyed by `historyKey` of the stream URL
  selected: string[]                        // station ids; the parent owns this
  /** Search results, grouped by list. When set, the table is a finder: no
   *  selection, no reordering, and a header above each group. */
  groups?: ResultGroup[]
  /** Extra facts for a row, keyed by station id (the directory's codec etc). */
  details?: Record<string, string>
  /** Label for the per-row action in search mode; absent means Edit. */
  actionLabel?: string
  /** Station ids whose action is unavailable because they are already saved. */
  actionDone?: Record<string, string>
  /** The current list cannot be written in its own format: no editing controls. */
  readOnly?: boolean
  /** Changes when the table is showing something else — another list, another
   *  search — and drawing starts again from the first batch. */
  windowKey?: string
}>()
const emit = defineEmits<{
  (e: 'play', s: Station): void
  (e: 'width', key: string, value: number): void
  (e: 'update:selected', ids: string[]): void
  (e: 'edit', s: Station): void
  (e: 'move', s: Station, delta: number): void
  (e: 'action', s: Station, anchor: HTMLElement): void
  (e: 'openGroup', key: string): void
}>()

/* One list decides the header, the colgroup AND the cells (StationRow reads
 * the same array), so they cannot disagree. A hidden cell is display:none,
 * which removes it from its row — a colgroup that still carried it would shift
 * every later cell into the wrong width slot. */
const searching = computed(() => Array.isArray(props.groups))
/** Selection, position and reordering belong to a list, not to a set of
 *  results drawn from several. Hiding the columns is what makes that unambiguous. */
const isVisible = (key: string) => {
  if (key === 'select') return !searching.value && !props.readOnly
  if (key === 'index') return !searching.value && props.columns.index !== false
  if (key === 'station' || key === 'actions') return true
  return props.columns[key] !== false
}
const grid = computed(() => GRID.filter(isVisible))

/** Header text: each column's own label, and a short one for the position. */
const LABELS: Record<string, string> = {
  ...Object.fromEntries(COLUMNS.map((c) => [c.key, c.label])),
  index: '#', station: 'Station'
}

/**
 * What a row's address says, worked out once per station: every render of
 * the table — a tick of a checkbox, a change of what is playing, the minute
 * clock — otherwise parsed each row's address three to five times. Stations
 * are replaced, never changed in place, so a station object is its own key.
 */
const derived = new WeakMap<Station, { key: string; verdict: Playability }>()
const derive = (s: Station) => {
  let d = derived.get(s)
  if (!d) derived.set(s, d = { key: historyKey(s.url), verdict: classify(s) })
  return d
}
/** When this device last played the station, if it ever has. */
const playedAt = (s: Station): number | undefined => own(props.lastPlayed, derive(s).key)
/**
 * The verdict a row shows, decided here for every row there is — a list's, a
 * search result's, a directory's. What the session saw comes first; failing
 * that, the address itself and whether the device has played it before.
 */
const stateOf = (s: Station): Playability =>
  own(props.states, s.url) ?? initialState(s, playedAt(s) !== undefined, derive(s).verdict)

/** Ticks once a minute so "Just now" becomes "1 min ago" without waiting for
 *  something else to re-render the row. */
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined
onMounted(() => { clock = setInterval(() => { now.value = Date.now() }, 60_000) })
onBeforeUnmount(() => clearInterval(clock))
/** The clock is handed only to rows that draw a relative time, so the minute
 *  tick re-renders those and not every row in the list. */
const showsPlayed = computed(() => grid.value.includes('played'))
const clockFor = (s: Station) => (showsPlayed.value && playedAt(s) ? now.value : 0)

/* selection is owned by the parent; this component only proposes changes */
const selectedSet = computed(() => new Set(props.selected))
const allChecked = computed(() => props.stations.length > 0 && props.stations.every((s) => selectedSet.value.has(s.id)))
const someChecked = computed(() => !allChecked.value && props.stations.some((s) => selectedSet.value.has(s.id)))
const toggleAll = (checked: boolean) =>
  emit('update:selected', nextSelection(checked, someChecked.value, props.stations.map((s) => s.id)))
const toggleOne = (id: string, checked: boolean) => {
  const next = new Set(selectedSet.value)
  checked ? next.add(id) : next.delete(id)
  emit('update:selected', [...next])
}

/* ---- drawn in batches ----------------------------------------------------
   A list may hold thousands of stations, and the first letter of a search
   matches nearly all of them. Each row is a component; mounting every one at
   once was the largest single cost in the app. The first batch is drawn, the
   next as the end of it scrolls into view, and "Show all" is there for the
   keyboard and for the browser's own find, which can only see what is drawn. */
const BATCH = 200
const limit = ref(BATCH)
watch(() => props.windowKey, () => { limit.value = BATCH })
const total = computed(() => (searching.value
  ? (props.groups ?? []).reduce((n, g) => n + g.stations.length, 0)
  : props.stations.length))
const shownStations = computed(() => props.stations.slice(0, limit.value))
/** Whole groups while the budget lasts, then the head of the one it runs out in. */
const shownGroups = computed(() => {
  let budget = limit.value
  const out: ResultGroup[] = []
  for (const g of props.groups ?? []) {
    if (budget <= 0) break
    out.push(g.stations.length <= budget ? g : { ...g, stations: g.stations.slice(0, budget) })
    budget -= g.stations.length
  }
  return out
})
const more = computed(() => Math.max(0, total.value - limit.value))
const showAll = () => { limit.value = Infinity }
const sentinel = ref<HTMLElement | null>(null)
let watcher: IntersectionObserver | undefined
watch(sentinel, (el) => {
  watcher?.disconnect()
  watcher = undefined
  if (!el || typeof IntersectionObserver !== 'function') return
  watcher = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) limit.value += BATCH
  }, { rootMargin: '600px 0px' })
  watcher.observe(el)
})
onBeforeUnmount(() => watcher?.disconnect())

/* header edge: drag, or arrow keys — a header grip is not otherwise reachable */
let dragKey = ''
let startX = 0
let startW = 0
const onGripDown = (key: string, e: PointerEvent) => {
  dragKey = key; startX = e.clientX
  startW = (e.target as HTMLElement).closest('th')!.getBoundingClientRect().width
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  e.preventDefault()
}
const onGripMove = (e: PointerEvent) => { if (dragKey) emit('width', dragKey, clampCol(startW + (e.clientX - startX))) }
const onGripUp = () => { dragKey = '' }
const onGripKey = (key: string, e: KeyboardEvent) => {
  const step = e.shiftKey ? 32 : 8
  const w = props.widths[key] ?? MIN_COL
  if (e.key === 'ArrowLeft') { emit('width', key, clampCol(w - step)); e.preventDefault() }
  if (e.key === 'ArrowRight') { emit('width', key, clampCol(w + step)); e.preventDefault() }
  if (e.key === 'Home') { emit('width', key, 0); e.preventDefault() } // 0 = reset to default
}
</script>

<template>
  <table :style="{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }">
    <ColumnWidths :grid="grid" :widths="widths" />
    <thead>
      <tr>
        <template v-for="g in grid" :key="g">
          <th v-if="g === 'select'" :style="{ padding: '0 12px 8px', textAlign: 'left' }">
            <input type="checkbox" aria-label="Select all stations" :checked="allChecked"
                   :indeterminate="someChecked" @change="toggleAll(($event.target as HTMLInputElement).checked)">
          </th>
          <th v-else-if="g === 'actions'" />
          <th v-else :style="{ position: 'relative', padding: '0 12px 8px', textAlign: g === 'index' ? 'right' : 'left' }">
            {{ LABELS[g] }}<button
              class="grip" role="separator" aria-orientation="vertical"
              :aria-label="`Resize ${LABELS[g]} column`" tabindex="0"
              @pointerdown="onGripDown(g, $event)" @pointermove="onGripMove" @pointerup="onGripUp"
              @pointercancel="onGripUp" @dblclick="emit('width', g, 0)" @keydown="onGripKey(g, $event)"
            />
          </th>
        </template>
      </tr>
    </thead>
    <tbody v-if="searching">
      <template v-for="g in shownGroups" :key="g.key">
        <tr class="grp">
          <td :colspan="grid.length">
            {{ g.label.toUpperCase() }} <span class="dim">· {{ g.meta }}</span>
            <button v-if="g.file" type="button" class="open"
                    @click="emit('openGroup', g.key)">Open list</button>
          </td>
        </tr>
        <StationRow
          v-for="s in g.stations" :key="s.id"
          :station="s" :grid="grid" :columns="columns" :playing="s.url === playingUrl" :state="stateOf(s)"
          :last-played="playedAt(s)" :now="clockFor(s)" :details="details?.[s.id]"
          finder :action-label="actionLabel ?? 'Edit'" :action-done="actionDone?.[s.id]"
          @play="emit('play', s)" @action="(el) => emit('action', s, el)"
        />
      </template>
    </tbody>
    <tbody v-else>
      <StationRow
        v-for="(s, i) in shownStations" :key="s.id"
        :station="s" :grid="grid" :columns="columns" :playing="s.url === playingUrl" :state="stateOf(s)"
        :last-played="playedAt(s)" :now="clockFor(s)" :position="i + 1" :selected="selectedSet.has(s.id)"
        :first="i === 0" :last="i === stations.length - 1" :read-only="readOnly"
        @play="emit('play', s)" @select="(c) => toggleOne(s.id, c)" @edit="emit('edit', s)"
        @move="(d) => emit('move', s, d)"
      />
    </tbody>
    <tbody v-if="more">
      <tr ref="sentinel" class="more">
        <td :colspan="grid.length">
          {{ total - more }} of {{ total }} shown ·
          <button type="button" @click="showAll">Show all {{ total }}</button>
        </td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
th { font-size: 11.5px; font-weight: 600; color: var(--oc-role-on-surface-variant);
     border-bottom: 1px solid var(--oc-role-outline-variant);
     overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.grp td { font-size: 11.5px; font-weight: 600; letter-spacing: .3px; padding: 14px 12px 6px;
          color: var(--oc-role-on-surface-variant); background: var(--oc-role-background);
          border-bottom: 1px solid var(--oc-role-outline-variant); white-space: nowrap; }
.grp .open { float: right; font-weight: 500; text-decoration: underline; cursor: pointer;
             border: 0; background: none; color: inherit; font-size: 11.5px; }
.grp .open:hover { color: var(--oc-role-primary); }
.dim { color: var(--oc-role-on-surface-variant); }
.more td { padding: 14px 12px; font-size: 12.5px; color: var(--oc-role-on-surface-variant); }
.more button { border: 0; background: none; padding: 0; font: inherit; color: inherit;
               text-decoration: underline; cursor: pointer; }
.grip { position: absolute; top: 0; right: -4px; width: 9px; height: 100%;
        cursor: col-resize; touch-action: none; background: none; border: 0; padding: 0; }
.grip::after { content: ""; position: absolute; top: 2px; bottom: 8px; left: 4px; width: 1px;
               background: var(--oc-role-outline-variant); }
.grip:hover::after, .grip:focus-visible::after { background: var(--oc-role-primary); width: 2px; bottom: 2px; }
</style>
