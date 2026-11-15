<script setup lang="ts">
import { computed } from 'vue'
import type { Station } from '../parsers/types'
import { explain, type Playability } from '../helpers/classify'
import StationLogo from './StationLogo.vue'
import PlayIcon from './PlayIcon.vue'

/**
 * One row, used by both the list and the finder. The cells are decided by
 * `grid`, the same array that built the header and the colgroup, so a column
 * can never be present in one and missing in another — which is how the
 * finder got misaligned when the Position column was on.
 */
const props = defineProps<{
  station: Station
  /** Visible column keys, in DOM order. */
  grid: readonly string[]
  columns: Record<string, boolean>
  /** Whether this row's station is the one playing: a flag, so a change re-renders two rows, not all. */
  playing: boolean
  state: Playability
  lastPlayed?: number
  /** The table's clock, so relative times move without a re-render from elsewhere. */
  now: number
  /** 1-based position; rendered only when `grid` contains `index`. */
  position?: number
  /** Whether the row's checkbox is ticked; rendered only when `grid` contains `select`. */
  selected?: boolean
  /** Extra facts for the State tooltip (the directory's codec etc). */
  details?: string
  /** A search result rather than a row of a list: one action button instead
   *  of move and edit, and no backup-server count. Said, not inferred. */
  finder?: boolean
  /** The finder's one action. */
  actionLabel?: string
  /** Set when the action is unavailable because the station is already saved there. */
  actionDone?: string
  /** List mode: the reorder arrows' limits. */
  first?: boolean
  last?: boolean
  /** No editing controls at all (a .pls or .xspf list). */
  readOnly?: boolean
}>()
const emit = defineEmits<{
  (e: 'play'): void
  (e: 'select', checked: boolean): void
  (e: 'edit'): void
  (e: 'move', delta: number): void
  (e: 'action', anchor: HTMLElement): void
}>()

const show = (key: string) => props.grid.includes(key)
/** `failed` is a past tense, not a verdict: the row stays clickable so a station
 *  that was down for a minute can be retried without reloading the page. */
const unplayable = computed(() => ['blocked', 'unsupported', 'playlist'].includes(props.state))

const badge = computed(() => {
  if (props.playing) return { text: 'Playing', tone: 'live' }
  switch (props.state) {
    case 'blocked': return { text: 'Blocked', tone: 'bad' }
    case 'playlist': return { text: 'Playlist link', tone: 'bad' }
    case 'unsupported': return { text: 'Not supported', tone: 'bad' }
    case 'failed': return { text: 'No response', tone: 'bad' }
    case 'ready': return { text: 'Ready', tone: 'ok' }
    default: return { text: 'Not played yet', tone: 'new' }
  }
})
const ago = (t: number | undefined, now: number) => {
  if (!t) return '—'
  const m = Math.round((now - t) / 60000)
  if (m < 1) return 'Just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'Yesterday' : `${d} days ago`
}
const stateTitle = computed(() => [explain(props.state), props.details].filter(Boolean).join(' — '))
</script>

<template>
  <!-- Styled by class, not inline: a list draws hundreds of these, and every
       inline style object was allocated and compared again on each render. -->
  <tr>
    <td v-if="show('select')">
      <input type="checkbox" :aria-label="`Select ${station.name}`" :checked="!!selected"
             @change="emit('select', ($event.target as HTMLInputElement).checked)">
    </td>
    <td v-if="show('index')" class="num">{{ position }}</td>
    <td>
      <div class="station">
        <button
          type="button" class="play" :class="{ on: playing }"
          :aria-label="`${playing ? 'Stop' : 'Play'} ${station.name}`"
          :disabled="unplayable" :title="explain(state)"
          @click="emit('play')"
        >
          <PlayIcon :stop="playing" />
        </button>
        <StationLogo v-if="columns.logo" :station="station" />
        <span class="name">{{ station.name }}</span>
        <span
          v-if="!finder && station.alternates?.length" class="servers"
          :title="`${station.alternates.length + 1} servers — the player moves to the next if one fails`"
        >{{ station.alternates.length + 1 }} servers</span>
        <a v-if="columns.home && station.homepage" :href="station.homepage" target="_blank" rel="noopener noreferrer"
           :aria-label="`${station.name} homepage`" class="hl">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M10 13a5 5 0 007.1 0l2.8-2.8A5 5 0 0012.8 3L11 4.9l1.4 1.4 1.8-1.8a3 3 0 014.3 4.3l-2.9 2.8a3 3 0 01-4.2 0z" />
          </svg>
        </a>
      </div>
    </td>
    <td v-if="show('network')">{{ station.network || '—' }}</td>
    <td v-if="show('group')">{{ station.group || '—' }}</td>
    <td v-if="show('url')" :title="station.url" class="mono">{{ station.url }}</td>
    <td v-if="show('country')">{{ station.country || '—' }}</td>
    <td v-if="show('language')">{{ station.language || '—' }}</td>
    <td v-if="show('played')">{{ playing ? 'Playing now' : ago(lastPlayed, now) }}</td>
    <td v-if="show('state')">
      <span :title="stateTitle" class="badge" :class="badge.tone">{{ badge.text }}</span>
    </td>
    <td class="actions">
      <template v-if="finder">
        <span v-if="actionDone" class="dim small">in {{ actionDone }}</span>
        <button v-else type="button" class="act" @click="emit('action', ($event.currentTarget as HTMLElement))">
          {{ actionLabel }}
        </button>
      </template>
      <template v-else-if="!readOnly">
        <button type="button" class="act" :aria-label="`Move ${station.name} up`" :disabled="first" @click="emit('move', -1)">▲</button>
        <button type="button" class="act" :aria-label="`Move ${station.name} down`" :disabled="last" @click="emit('move', 1)">▼</button>
        <button type="button" class="act" :aria-label="`Edit ${station.name}`" @click="emit('edit')">Edit</button>
      </template>
    </td>
  </tr>
</template>

<style scoped>
td { padding: 9px 12px; border-bottom: 1px solid var(--oc-role-outline-variant);
     overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.mono { font-family: ui-monospace, monospace; font-size: 11.5px; }
.actions { text-align: right; }
.station { display: flex; align-items: center; gap: 10px; min-width: 0; }
.play { width: 28px; height: 28px; border-radius: 50%; flex: none; display: grid; place-items: center;
        border: 0; cursor: pointer;
        background: var(--oc-role-surface-container-high); color: var(--oc-role-on-surface); }
.play.on { background: var(--oc-role-primary); color: var(--oc-role-on-primary); }
.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.servers { flex: none; font-size: 10.5px; padding: 1px 6px; border-radius: 999px;
           border: 1px solid var(--oc-role-outline-variant); color: var(--oc-role-on-surface-variant); }
.hl { color: var(--oc-role-on-surface-variant); flex: none; opacity: .5; }
.badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px;
         font-size: 11.5px; white-space: nowrap; }
.badge.live { background: var(--oc-role-primary-container); color: var(--oc-role-on-primary-container); }
.badge.bad { background: var(--oc-role-error-container); color: var(--oc-role-on-error-container); }
.badge.ok { border: 1px solid var(--oc-role-outline-variant); color: var(--oc-role-on-surface-variant); }
.badge.new { color: var(--oc-role-on-surface-variant); opacity: .75; }
.small { font-size: 12px; }
tr:hover td { background: var(--oc-role-surface-container); }
tr:hover .hl, .hl:focus-visible { opacity: 1; }
.act { border: 0; background: none; cursor: pointer; color: var(--oc-role-on-surface-variant);
       font: inherit; font-size: 12px; padding: 4px 6px; border-radius: 4px; }
.act:hover:not(:disabled) { background: var(--oc-role-surface-container-high); color: var(--oc-role-on-surface); }
.act:disabled { opacity: .3; cursor: default; }
.dim { color: var(--oc-role-on-surface-variant); }
</style>
