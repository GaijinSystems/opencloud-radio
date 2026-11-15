<script setup lang="ts">
import { computed, ref } from 'vue'
import RadioDialog from './RadioDialog.vue'
import { dialogInput } from '../helpers/styles'
import { baseName } from '../helpers/text'

const props = defineProps<{
  mode: 'create' | 'rename' | 'delete' | 'move'
  current?: string
  choices?: string[]
  count?: number
}>()
const emit = defineEmits<{ (e: 'confirm', value: string): void; (e: 'close'): void }>()

const value = ref(props.mode === 'rename' ? baseName(props.current ?? '') : '')
const title = computed(() => ({
  create: 'New station list', rename: 'Rename list', delete: 'Delete list',
  move: `Move ${props.count} station${props.count === 1 ? '' : 's'} to`
})[props.mode])
const ok = computed(() => props.mode === 'delete' || !!value.value.trim())
</script>

<template>
  <RadioDialog :title="title" width="420px" @close="emit('close')">
    <div :style="{ paddingTop: '12px', display: 'grid', gap: '10px', fontSize: '13.5px' }">
      <template v-if="mode === 'delete'">
        <p :style="{ margin: 0 }">Delete <b>{{ current }}</b>? The file is removed from your space. Stations in it are not
          recoverable from here.</p>
      </template>
      <template v-else-if="mode === 'move'">
        <select v-model="value" :style="dialogInput" aria-label="Destination list">
          <option value="" disabled>Choose a list</option>
          <option v-for="c in choices" :key="c" :value="c">{{ baseName(c) }}</option>
        </select>
        <p :style="{ margin: 0, fontSize: '12.5px', color: 'var(--oc-role-on-surface-variant)' }">
          Stations are added to the other list and removed from this one. Duplicates are skipped.</p>
      </template>
      <template v-else>
        <input v-model="value" :style="dialogInput" placeholder="List name" @keydown.enter="ok && emit('confirm', value.trim())">
        <p :style="{ margin: 0, fontSize: '12.5px', color: 'var(--oc-role-on-surface-variant)' }">
          Saved as a .m3u8 file in your Radio folder.</p>
      </template>
    </div>
    <template #footer>
      <oc-button appearance="filled" color-role="primary" :disabled="!ok" @click="emit('confirm', value.trim())">
        {{ mode === 'delete' ? 'Delete' : mode === 'move' ? 'Move' : mode === 'rename' ? 'Rename' : 'Create' }}
      </oc-button>
      <oc-button appearance="outline" @click="emit('close')">Cancel</oc-button>
    </template>
  </RadioDialog>
</template>
