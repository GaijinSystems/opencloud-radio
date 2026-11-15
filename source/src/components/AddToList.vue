<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { ListFile } from '../composables/usePlaylists'
import { baseName } from '../helpers/text'
import { popupPanel, panelDivider } from '../helpers/styles'

const props = defineProps<{ name: string; files: ListFile[]; current: string | null; x: number; y: number }>()
const emit = defineEmits<{ (e: 'add', path: string): void; (e: 'newList'): void; (e: 'close'): void }>()

const chosen = ref(props.current ?? props.files[0]?.path ?? '')
const root = ref<HTMLElement | null>(null)

/**
 * `pointerdown`, not `click`, and bound a task later. The click that opens
 * this popup is still bubbling while Vue mounts it, so a `click` listener
 * bound in `onMounted` catches that same click, sees a target outside the
 * popup and closes it again — it appears not to open at all. A pointerdown
 * for the opening interaction has already happened by then, so it cannot be
 * caught the same way; the deferred binding is belt and braces for browsers
 * that synthesise a click without one.
 */
const onDoc = (e: Event) => {
  if (root.value && !root.value.contains(e.target as Node)) emit('close')
}
let bound = false
let bindTimer: ReturnType<typeof setTimeout> | undefined
const bind = () => { bound = true; document.addEventListener('pointerdown', onDoc) }
const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape') emit('close')
  if (e.key === 'Enter' && chosen.value) emit('add', chosen.value)
}
onMounted(() => {
  bindTimer = setTimeout(bind)
  document.addEventListener('keydown', onKey)
  root.value?.querySelector<HTMLElement>('input')?.focus()
})
onBeforeUnmount(() => {
  clearTimeout(bindTimer)
  if (bound) document.removeEventListener('pointerdown', onDoc)
  document.removeEventListener('keydown', onKey)
})
const label = (f: ListFile) => baseName(f.name)
</script>

<template>
  <div
    ref="root" role="dialog" :aria-label="`Add ${name} to a list`"
    :style="{ position: 'fixed', left: `${Math.max(8, x - 240)}px`, top: `${y + 8}px`, zIndex: 50,
              width: '260px', padding: '8px', ...popupPanel }"
    @click.stop
  >
    <p :style="{ margin: '4px 8px 8px', fontSize: '12px', color: 'var(--oc-role-on-surface-variant)' }">
      Add <b :style="{ color: 'var(--oc-role-on-surface)' }">{{ name }}</b> to
    </p>
    <label
      v-for="f in files" :key="f.path"
      :style="{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 8px',
                borderRadius: '6px', fontSize: '13.5px', cursor: 'pointer' }"
    >
      <input v-model="chosen" type="radio" :value="f.path" :style="{ accentColor: 'var(--oc-role-primary)' }">
      <span :style="{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }">{{ label(f) }}</span>
    </label>
    <hr :style="panelDivider">
    <div :style="{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px' }">
      <oc-button appearance="raw" @click="emit('newList')">New list…</oc-button>
      <span :style="{ flex: 1 }" />
      <oc-button appearance="filled" color-role="primary" :disabled="!chosen" @click="emit('add', chosen)">
        Add
      </oc-button>
    </div>
  </div>
</template>
