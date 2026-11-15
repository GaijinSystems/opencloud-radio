<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { SearchScope } from '../composables/useSearch'
import { useDismiss } from '../composables/useDismiss'
import { popupPanel, panelDivider } from '../helpers/styles'
import { anyRelays } from '../helpers/relays'

/** Set once as the app starts, before this is drawn. */
const relayed = anyRelays()

const props = defineProps<{
  modelValue: string
  scope: SearchScope
  directoryEnabled: boolean
  httpsOnly: boolean
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  (e: 'update:scope', v: SearchScope): void
  (e: 'update:httpsOnly', v: boolean): void
}>()

const input = ref<HTMLInputElement | null>(null)
const root = ref<HTMLElement | null>(null)
const open = ref(false)

const scopes = computed(() => {
  const s: Array<[SearchScope, string]> = [['list', 'This list'], ['all', 'All lists']]
  if (props.directoryEnabled) s.push(['directory', 'Online directory'])
  return s
})
const label = computed(() => scopes.value.find(([v]) => v === props.scope)?.[1] ?? 'All lists')

// `/` focuses, as in every reader and file manager. Ctrl+F is left alone: it
// is how people search the page for real, and taking it is hostile.
const onKey = (e: KeyboardEvent) => {
  // The cheap tests first: this runs for every key pressed anywhere.
  if (e.key !== '/' || e.ctrlKey || e.metaKey) return
  const target = e.target as HTMLElement | null
  if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
  // Not while a dialog is up: the field is behind it, and focusing it there
  // left the dialog open over a search box the user could not see typing into.
  if (document.querySelector('[aria-modal="true"]')) return
  e.preventDefault()
  input.value?.focus()
}
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
// Escape belongs to the field here: it clears the search.
useDismiss(root, open, { escape: false })

const onFieldKey = (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return
  emit('update:modelValue', '')
  input.value?.blur()
}
const pick = (s: SearchScope) => {
  emit('update:scope', s)
  open.value = false
  input.value?.focus()
}
</script>

<template>
  <div ref="root" :style="{ position: 'relative', flex: 'none' }">
    <div
      :style="{ display: 'flex', alignItems: 'center', gap: '8px', height: '34px', width: '290px',
                padding: '0 8px 0 10px', borderRadius: '8px',
                border: `1px solid var(--oc-role-${modelValue ? 'primary' : 'outline-variant'})`,
                background: 'var(--oc-role-surface-container-low)' }"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
           :style="{ flex: 'none', color: 'var(--oc-role-on-surface-variant)' }">
        <path d="M10.5 3a7.5 7.5 0 015.9 12.1l4.3 4.3-1.4 1.4-4.3-4.3A7.5 7.5 0 1110.5 3zm0 2a5.5 5.5 0 100 11 5.5 5.5 0 000-11z" />
      </svg>
      <input
        ref="input" :value="modelValue" aria-label="Search stations" placeholder="Search stations"
        :style="{ flex: 1, minWidth: 0, border: 0, background: 'none', outline: 'none', font: 'inherit',
                  color: 'inherit' }"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        @keydown="onFieldKey"
      >
      <button
        type="button" aria-haspopup="menu" :aria-expanded="open"
        :style="{ display: 'flex', alignItems: 'center', gap: '4px', flex: 'none', border: 0,
                  cursor: 'pointer', font: 'inherit', fontSize: '11.5px', padding: '3px 8px',
                  borderRadius: '999px', whiteSpace: 'nowrap',
                  background: 'var(--oc-role-secondary-container)',
                  color: 'var(--oc-role-on-secondary-container)' }"
        @click.stop="open = !open"
      >
        {{ label }}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 15.5L5.5 9 7 7.6l5 5 5-5L18.5 9z" />
        </svg>
      </button>
    </div>

    <div
      v-if="open" role="menu"
      :style="{ ...popupPanel, position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 30, width: '232px',
                padding: '6px' }"
    >
      <label
        v-for="[value, text] in scopes" :key="value" role="menuitemradio" :aria-checked="scope === value"
        :style="{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 8px',
                  borderRadius: '6px', fontSize: '13.5px', cursor: 'pointer' }"
      >
        <input type="radio" :checked="scope === value" :style="{ accentColor: 'var(--oc-role-primary)' }"
               @change="pick(value)">
        {{ text }}
      </label>
      <template v-if="directoryEnabled && scope === 'directory'">
        <hr :style="panelDivider">
        <label :style="{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 8px',
                         fontSize: '13px', cursor: 'pointer' }">
          <input type="checkbox" :checked="httpsOnly" :style="{ accentColor: 'var(--oc-role-primary)' }"
                 @change="emit('update:httpsOnly', ($event.target as HTMLInputElement).checked)">
          https only
        </label>
        <p :style="{ margin: '0 8px 6px 34px', fontSize: '11.5px',
                     color: 'var(--oc-role-on-surface-variant)' }">
          Many directory stations are http-only and cannot play in a browser.<template v-if="relayed">
          Those your administrator relays are kept.</template>
        </p>
      </template>
    </div>
  </div>
</template>
