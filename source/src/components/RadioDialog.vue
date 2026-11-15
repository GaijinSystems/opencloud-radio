<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'

const props = defineProps<{ title: string; width?: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const panel = ref<HTMLElement | null>(null)

const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') emit('close') }
/**
 * Close only when the press STARTED on the backdrop. A `click` alone fires on
 * the backdrop when a text selection begun inside the panel is released
 * outside it, which closed the Import dialog with the pasted playlist in it.
 */
let pressedBackdrop = false
const onBackdropDown = (e: PointerEvent) => { pressedBackdrop = e.target === e.currentTarget }
const onBackdropClick = (e: MouseEvent) => {
  if (pressedBackdrop && e.target === e.currentTarget) emit('close')
  pressedBackdrop = false
}
onMounted(() => {
  document.addEventListener('keydown', onKey)
  panel.value?.querySelector<HTMLElement>('input, select, button')?.focus()
})
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <div
    :style="{ position: 'fixed', inset: 0, zIndex: 40, display: 'grid', placeItems: 'center',
              padding: '24px', background: 'rgba(0,0,0,.45)' }"
    @pointerdown="onBackdropDown" @click="onBackdropClick"
  >
    <div
      ref="panel" role="dialog" aria-modal="true" :aria-label="props.title"
      :style="{ width: props.width ?? '560px', maxWidth: '100%', maxHeight: '86vh', display: 'flex',
                flexDirection: 'column', borderRadius: '14px',
                background: 'var(--oc-role-surface-container-low)',
                border: '1px solid var(--oc-role-outline-variant)',
                boxShadow: '0 2px 10px rgba(0,0,0,.25)' }"
    >
      <header :style="{ display: 'flex', alignItems: 'center', gap: '10px', padding: '16px 20px',
                        borderBottom: '1px solid var(--oc-role-outline-variant)' }">
        <h2 :style="{ margin: 0, fontSize: '17px', fontWeight: 600, flex: 1 }">{{ props.title }}</h2>
        <oc-button appearance="raw" aria-label="Close" @click="emit('close')">✕</oc-button>
      </header>
      <div :style="{ overflow: 'auto', padding: '4px 20px 18px', minHeight: 0 }">
        <slot />
      </div>
      <footer v-if="$slots.footer"
              :style="{ display: 'flex', gap: '8px', padding: '14px 20px',
                        borderTop: '1px solid var(--oc-role-outline-variant)' }">
        <slot name="footer" />
      </footer>
    </div>
  </div>
</template>
