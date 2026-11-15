<script setup lang="ts">
import { ref } from 'vue'
import { useDismiss } from '../composables/useDismiss'
import { popupPanel } from '../helpers/styles'
import ColumnChecklist from './ColumnChecklist.vue'

defineProps<{ columns: Record<string, boolean>; hidden?: string[] }>()
const emit = defineEmits<{ (e: 'toggle', key: string, value: boolean): void; (e: 'reset'): void }>()
const open = ref(false)
const root = ref<HTMLElement | null>(null)

useDismiss(root, open)
</script>

<template>
  <div ref="root" :style="{ position: 'relative' }">
    <oc-button appearance="outline" :aria-expanded="open" @click="open = !open">
      Columns
    </oc-button>
    <div
      v-if="open"
      :style="{ ...popupPanel, position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 20,
                width: '262px', padding: '8px' }"
    >
      <h3 :style="{ margin: '6px 8px 4px', fontSize: '12px',
                    color: 'var(--oc-role-on-surface-variant)' }">Show these columns</h3>
      <ColumnChecklist
        :columns="columns" :hidden="hidden" :indent="34"
        :row-style="{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 8px',
                      borderRadius: '6px', fontSize: '13.5px' }"
        @toggle="(k, v) => emit('toggle', k, v)"
      />
      <div :style="{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px',
                     marginTop: '4px', fontSize: '11.5px',
                     borderTop: '1px solid var(--oc-role-outline-variant)',
                     color: 'var(--oc-role-on-surface-variant)' }">
        Saved on this device
        <button
          type="button"
          :style="{ marginLeft: 'auto', textDecoration: 'underline', border: 0,
                    background: 'none', cursor: 'pointer', color: 'inherit' }"
          @click="emit('reset')"
        >Reset columns</button>
      </div>
    </div>
  </div>
</template>
