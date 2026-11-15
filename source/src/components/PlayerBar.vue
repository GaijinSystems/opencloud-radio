<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Station } from '../parsers/types'
import { isActiveState, type PlayerState } from '../composables/usePlayer'
import StationLogo from './StationLogo.vue'
import PlayIcon from './PlayIcon.vue'

const props = defineProps<{
  station: Station | null
  state: PlayerState
  error: string
  volume: number
  muted: boolean
  showScope: boolean
  /** Follows the Station logo column: a station without one shows a blank
   *  tile, which is most of them unless the user has filled logos in. */
  showLogo: boolean
  nowPlaying: string
  serverCount: number
  currentServer: string
  /** The servers the player moves between, in order. */
  servers: string[]
  mountScope: (el: HTMLCanvasElement | null) => void
  /** Bulk selection lives here so it can cover the scope instead of moving the page. */
  selectionCount: number
  canMove: boolean
}>()
const emit = defineEmits<{
  (e: 'toggle'): void
  (e: 'volume', v: number): void
  (e: 'muted', v: boolean): void
  (e: 'move'): void
  (e: 'copy'): void
  (e: 'remove'): void
  (e: 'clear'): void
}>()

const canvas = ref<HTMLCanvasElement | null>(null)
onMounted(() => props.mountScope(canvas.value))
watch(canvas, (el) => props.mountScope(el))
onBeforeUnmount(() => props.mountScope(null))

const label = computed(() => (isActiveState(props.state) ? 'Stop' : 'Play'))
const status = computed(() => {
  switch (props.state) {
    case 'connecting': return 'Connecting…'
    case 'reconnecting': return 'Reconnecting…'
    case 'resume': return 'Tap to resume'
    case 'failed': return props.error
    default: return ''
  }
})
/**
 * Muting parks the slider at zero without touching the stored level, so
 * unmuting returns to exactly where it was. Moving the slider is a statement
 * about how loud you want it, which only makes sense unmuted — so it unmutes.
 */
const onSlider = (v: number) => {
  if (props.muted) emit('muted', false)
  emit('volume', v)
}

const serverLabel = computed(() => {
  const i = props.servers.indexOf(props.currentServer)
  return i === -1 ? 1 : i + 1
})
</script>

<template>
  <div :style="{ flex: 'none', borderTop: '1px solid var(--oc-role-outline-variant)',
                 background: 'var(--oc-role-surface-container)' }">
    <div
      v-if="showScope || selectionCount"
      :style="{ position: 'relative', height: '84px', padding: '12px 18px 0',
                borderBottom: '1px solid var(--oc-role-outline-variant)' }"
    >
      <canvas
        v-show="showScope" ref="canvas" aria-hidden="true"
        :style="{ display: 'block', width: '100%', height: '72px' }"
      />
      <Transition name="sel">
        <div
          v-if="selectionCount" class="selbar" role="toolbar" aria-label="Selected stations"
          :style="{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
                    gap: '8px', padding: '0 18px', flexWrap: 'wrap',
                    color: 'var(--oc-role-on-secondary-container)' }"
        >
          <span :style="{ fontSize: '13px', fontWeight: 500 }">
            {{ selectionCount }} {{ selectionCount === 1 ? 'station' : 'stations' }} selected
          </span>
          <span :style="{ flex: 1 }" />
          <oc-button appearance="outline" :disabled="!canMove" @click="emit('move')">Move to list…</oc-button>
          <oc-button appearance="outline" @click="emit('copy')">Copy addresses</oc-button>
          <oc-button appearance="outline" @click="emit('remove')">Remove</oc-button>
          <oc-button appearance="raw" @click="emit('clear')">Clear</oc-button>
        </div>
      </Transition>
    </div>

    <div :style="{ height: '56px', display: 'flex', alignItems: 'center', gap: '14px', padding: '0 18px' }">
      <button
        type="button" :aria-label="label" :disabled="!station"
        :style="{ width: '36px', height: '36px', borderRadius: '50%', flex: 'none', display: 'grid',
                  placeItems: 'center', border: 0, cursor: station ? 'pointer' : 'default',
                  opacity: station ? 1 : 0.5,
                  background: 'var(--oc-role-primary)', color: 'var(--oc-role-on-primary)' }"
        @click="emit('toggle')"
      >
        <PlayIcon :stop="label === 'Stop'" :size="16" />
      </button>

      <StationLogo v-if="showLogo && station" :station="station" size="bar" />

      <div :style="{ flex: 1, minWidth: 0 }">
        <template v-if="station">
          <b>{{ station.name }}</b>
          <span v-if="station.network" :style="{ color: 'var(--oc-role-on-surface-variant)' }"> · {{ station.network }}</span>
          <div :style="{ fontSize: '12px', color: 'var(--oc-role-on-surface-variant)', overflow: 'hidden',
                         textOverflow: 'ellipsis', whiteSpace: 'nowrap' }">
            {{ status || nowPlaying || (state === 'playing' ? 'Track information is not available for this station' : '') }}<template
              v-if="serverCount > 1 && (state === 'playing' || state === 'reconnecting')">
              <span :title="currentServer"> · server {{ serverLabel }} of {{ serverCount }}</span>
            </template>
          </div>
        </template>
        <span v-else :style="{ color: 'var(--oc-role-on-surface-variant)' }">Choose a station to start listening</span>
      </div>

      <div :style="{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--oc-role-on-surface-variant)' }">
        <button type="button" :aria-label="muted ? 'Unmute' : 'Mute'"
                :style="{ border: 0, background: 'none', cursor: 'pointer', color: 'inherit' }"
                @click="emit('muted', !muted)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M4 9h3.5L12 5v14l-4.5-4H4z" />
            <path v-if="!muted" d="M15 9.2a4 4 0 010 5.6l1.4 1.4a6 6 0 000-8.4z" />
          </svg>
        </button>
        <input
          type="range" min="0" max="100" :value="Math.round((muted ? 0 : volume) * 100)"
          aria-label="Volume" :style="{ width: '88px', accentColor: 'var(--oc-role-primary)' }"
          @input="onSlider(Number(($event.target as HTMLInputElement).value) / 100)"
        >
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Covers the scope rather than displacing it, so selecting a station never
   moves the list out from under the pointer. Slightly translucent, so the
   analyser stays legible behind it and the strip does not appear to vanish. */
.selbar {
  background: color-mix(in srgb, var(--oc-role-secondary-container) 88%, transparent);
  backdrop-filter: blur(2px);
}
@supports not (background: color-mix(in srgb, red 50%, transparent)) {
  .selbar { background: var(--oc-role-secondary-container); }
}
.sel-enter-active, .sel-leave-active { transition: opacity .12s ease; }
.sel-enter-from, .sel-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .sel-enter-active, .sel-leave-active { transition: none; }
}
</style>
