<script lang="ts">
import { reactive } from 'vue'

/**
 * Logo addresses that would not load (gone, renamed, their host down), for the
 * whole page: once one has failed, no row drawn again, nor the player bar, nor
 * another station sharing a dead favicon asks for it again, and a host that is
 * down does not hold connections for every row. A station given another logo
 * is a new address, tried afresh. All are tried again when the browser comes
 * back online — a dropped connection fails every logo at once — or on reload.
 */
const failedLogos = reactive(new Set<string>())
globalThis.addEventListener?.('online', () => failedLogos.clear())
</script>

<script setup lang="ts">
import { computed } from 'vue'
import type { Station } from '../parsers/types'
import { initials } from '../helpers/text'

/** A station's logo, or its initials on a tile where it has none — or where
 *  its logo will not load. Drawn by the table rows and the player bar, at two
 *  sizes. */
const props = withDefaults(defineProps<{ station: Station; size?: 'row' | 'bar' }>(), { size: 'row' })
const box = computed(() => (props.size === 'bar'
  ? { side: '34px', radius: '6px', font: '13px' }
  : { side: '26px', radius: '5px', font: '11px' }))
const showLogo = computed(() => !!props.station.logo && !failedLogos.has(props.station.logo))
</script>

<template>
  <!-- No referrer: the logo's host need not learn which instance shows it. -->
  <img v-if="showLogo" :src="station.logo" alt="" loading="lazy" referrerpolicy="no-referrer" @error="failedLogos.add(station.logo!)"
       :style="{ width: box.side, height: box.side, borderRadius: box.radius, objectFit: 'cover', flex: 'none' }">
  <span v-else :style="{ width: box.side, height: box.side, borderRadius: box.radius, flex: 'none', display: 'grid',
                         placeItems: 'center', fontSize: box.font, fontWeight: 600,
                         background: 'var(--oc-role-surface-container-highest)',
                         color: 'var(--oc-role-on-surface-variant)' }">{{ initials(station.name) }}</span>
</template>
