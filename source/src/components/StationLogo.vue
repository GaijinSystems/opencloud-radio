<script setup lang="ts">
import { computed } from 'vue'
import type { Station } from '../parsers/types'
import { initials } from '../helpers/text'

/** A station's logo, or its initials on a tile where it has none. Drawn by the
 *  table rows and the player bar, at two sizes. */
const props = withDefaults(defineProps<{ station: Station; size?: 'row' | 'bar' }>(), { size: 'row' })
const box = computed(() => (props.size === 'bar'
  ? { side: '34px', radius: '6px', font: '13px' }
  : { side: '26px', radius: '5px', font: '11px' }))
</script>

<template>
  <!-- No referrer: the logo's host need not learn which instance shows it. -->
  <img v-if="station.logo" :src="station.logo" alt="" loading="lazy" referrerpolicy="no-referrer"
       :style="{ width: box.side, height: box.side, borderRadius: box.radius, objectFit: 'cover', flex: 'none' }">
  <span v-else :style="{ width: box.side, height: box.side, borderRadius: box.radius, flex: 'none', display: 'grid',
                         placeItems: 'center', fontSize: box.font, fontWeight: 600,
                         background: 'var(--oc-role-surface-container-highest)',
                         color: 'var(--oc-role-on-surface-variant)' }">{{ initials(station.name) }}</span>
</template>
