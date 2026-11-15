<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import RadioDialog from './RadioDialog.vue'
import { banner } from '../helpers/styles'
import type { Playlist } from '../parsers/types'
import { parsePlaylist } from '../parsers'
import { safeUrl } from '../helpers/safeUrl'
import { keepServers, serversOf } from '../helpers/stations'
import { isStationListUrl } from '../helpers/playlist'
import { baseName, messageOf, stationBaseName, stripServerSuffix } from '../helpers/text'

/** `parse` is the app's own reader unless a test hands it another. */
const props = withDefaults(defineProps<{ parse?: (text: string, name: string) => Playlist }>(), { parse: parsePlaylist })
const emit = defineEmits<{ (e: 'import', list: Playlist, mode: 'append' | 'new', name: string): void; (e: 'close'): void }>()

const text = ref('')
const filename = ref('')
const sourceUrl = ref('')
const mode = ref<'append' | 'new'>('append')
const newName = ref('')
const combine = ref(false)

/** Parsed once per change of the text; the error is part of the result, not
 *  a side effect written from inside a getter. */
const parsed = computed<{ list: Playlist | null; error: string }>(() => {
  if (!text.value.trim()) return { list: null, error: '' }
  try {
    return { list: props.parse(text.value, filename.value), error: '' }
  } catch (e) {
    return { list: null, error: messageOf(e, 'This file could not be read.') }
  }
})
const rawPreview = computed(() => parsed.value.list)
const error = computed(() => parsed.value.error)

/**
 * A station's own .pls usually lists the same station on several servers —
 * SomaFM names them "… (#1)", "… (#2)". Detect that, because importing four
 * copies of one station is never what the user wanted, and the servers are
 * worth keeping as failover rather than discarding.
 */
const looksLikeOneStation = computed(() => {
  const stations = rawPreview.value?.stations ?? []
  if (stations.length < 2) return false
  const first = stationBaseName(stations[0].name)
  return !!first && stations.every((s) => stationBaseName(s.name) === first)
})
/** Follows the detection — for a pasted playlist as much as a chosen file,
 *  which until 1.1.6 was the only way it was set — until the user decides. */
const combineTouched = ref(false)
watch(looksLikeOneStation, (v) => { if (!combineTouched.value) combine.value = v })

/** When combining, one station carries the rest as backup servers. */
const preview = computed<Playlist | null>(() => {
  const list = rawPreview.value
  if (!list || !combine.value || list.stations.length < 2) return list
  const [first, ...rest] = list.stations
  // Through the gate like every other address (these become `radio-alt`):
  // each once, those that play here first, no more than a station keeps
  // anywhere else — as a pasted playlist is kept. A playlist link among them is
  // no server, and is left out before the ten are chosen.
  const kept = keepServers([first, ...rest].flatMap(serversOf).filter((u) => !isStationListUrl(u)))
  return {
    ...list,
    stations: [{
      ...first,
      name: stripServerSuffix(first.name) || first.name,
      url: kept[0] ?? first.url,
      alternates: kept.slice(1),
      source: safeUrl(sourceUrl.value) // undefined unless https:// or http://
    }]
  }
})

const onFile = async (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  filename.value = file.name
  text.value = await file.text()
  if (!newName.value) newName.value = baseName(file.name)
}
const canImport = computed(() =>
  !!preview.value?.stations.length && (mode.value === 'append' || !!newName.value.trim()))
</script>

<template>
  <RadioDialog title="Import a playlist" @close="emit('close')">
    <div :style="{ display: 'grid', gap: '16px', paddingTop: '12px' }">
      <p :style="{ margin: 0, fontSize: '13px', color: 'var(--oc-role-on-surface-variant)' }">
        M3U, M3U8, PLS or XSPF. Choose a file from this device, or paste the playlist text.
        This is also the way in for a station that only offers a <b>.pls</b> or <b>.m3u</b> link:
        save that link to your computer and import it here, since most sites do not allow the browser to
        fetch it directly. Playlists already in your <b>Radio/</b> folder appear in the list on
        the left without importing.
      </p>
      <input type="file" accept=".m3u,.m3u8,.pls,.xspf,audio/x-mpegurl,audio/x-scpls,application/xspf+xml" @change="onFile">
      <textarea
        v-model="text" rows="7" placeholder="#EXTM3U …" spellcheck="false"
        :style="{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: '12px', padding: '8px',
                  borderRadius: '6px', border: '1px solid var(--oc-role-outline-variant)',
                  background: 'var(--oc-role-surface-container-low)', color: 'inherit' }"
      />
      <p v-if="error" :style="{ margin: 0, ...banner('bad') }">
        {{ error }}
      </p>
      <p v-else-if="rawPreview" :style="{ margin: 0, fontSize: '13px' }">
        {{ rawPreview.stations.length }} entr{{ rawPreview.stations.length === 1 ? 'y' : 'ies' }} found<template v-if="rawPreview.title">
        in “{{ rawPreview.title }}”</template>.
      </p>
      <!-- Several entries: perhaps one station on several servers. -->
      <template v-if="(rawPreview?.stations.length ?? 0) > 1">
        <label :style="{ display: 'flex', gap: '10px', alignItems: 'flex-start', fontSize: '13px' }">
          <input v-model="combine" type="checkbox" :style="{ marginTop: '3px' }" @change="combineTouched = true">
          <span>One station on {{ rawPreview!.stations.length }} servers, not
            {{ rawPreview!.stations.length }} stations.
            <span :style="{ color: 'var(--oc-role-on-surface-variant)' }">
              The extras become backup servers: if one goes down mid-listen the player moves to the
              next without stopping.</span></span>
        </label>
        <div :style="{ fontSize: '12.5px', color: 'var(--oc-role-on-surface-variant)' }">
          <label :style="{ display: 'flex', gap: '8px', alignItems: 'center' }">
            Playlist address (optional, lets the servers be refreshed later)
            <input v-model="sourceUrl" placeholder="https://somafm.com/defcon256.pls"
                   :style="{ flex: 1, padding: '5px 8px', borderRadius: '6px',
                             border: '1px solid var(--oc-role-outline-variant)',
                             background: 'var(--oc-role-surface-container-low)' }">
          </label>
        </div>
      </template>
      <div v-if="preview?.stations.length" :style="{ display: 'grid', gap: '8px' }">
        <label :style="{ display: 'flex', gap: '10px', alignItems: 'center' }">
          <input v-model="mode" type="radio" value="append"> Add to the current list
        </label>
        <label :style="{ display: 'flex', gap: '10px', alignItems: 'center' }">
          <input v-model="mode" type="radio" value="new"> Create a new list named
          <input v-model="newName" :disabled="mode !== 'new'" placeholder="List name"
                 :style="{ padding: '5px 8px', borderRadius: '6px', border: '1px solid var(--oc-role-outline-variant)',
                           background: 'var(--oc-role-surface-container-low)', flex: 1 }">
        </label>
      </div>
    </div>
    <template #footer>
      <oc-button appearance="filled" color-role="primary" :disabled="!canImport"
                 @click="preview && emit('import', preview, mode, newName.trim())">Import</oc-button>
      <oc-button appearance="outline" @click="emit('close')">Cancel</oc-button>
    </template>
  </RadioDialog>
</template>
