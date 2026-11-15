<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import RadioDialog from './RadioDialog.vue'
import type { Found } from '../helpers/backupServers'
import { Refused } from '../helpers/fetch'
import { banner, dialogInput } from '../helpers/styles'
import type { Station } from '../parsers/types'
import { safeUrl, safeUrls, oneLine } from '../helpers/safeUrl'
import { classifyUrl, explain, type Playability } from '../helpers/classify'
import { isAsxUrl } from '../helpers/playlist'

const props = withDefaults(defineProps<{
  station?: Station | null
  groups: string[]
  /** Looks for the station's playlist and the servers in it; absent, the button is not offered. */
  findServers?: (s: Station) => Promise<Found | null>
  /** Whether saving reads a playlist link (the administrator's `maxPlaylistDepth` above 0). */
  readsPlaylists?: boolean
}>(), { readsPlaylists: true })
const emit = defineEmits<{
  (e: 'save', station: Omit<Station, 'id'>): void
  (e: 'remove'): void
  (e: 'close'): void
}>()

const form = reactive({
  url: props.station?.url ?? '',
  name: props.station?.name ?? '',
  group: props.station?.group ?? '',
  network: props.station?.network ?? '',
  homepage: props.station?.homepage ?? '',
  logo: props.station?.logo ?? '',
  country: props.station?.country ?? '',
  language: props.station?.language ?? '',
  alternates: (props.station?.alternates ?? []).join('\n'),
  source: props.station?.source ?? '',
  nowPlaying: props.station?.nowPlaying ?? ''
})

/** The address as it would be saved: what is validated is what is emitted. */
const cleanUrl = computed(() => safeUrl(form.url))
const urlState = computed<Playability | null>(() => {
  const url = form.url.trim()
  return url ? classifyUrl(url) : null
})
const urlNote = computed(() => {
  if (!urlState.value) return ''
  if (!cleanUrl.value) return 'This is not a web address.'
  // In the form, a playlist link is what saving reads: said as that, not as a
  // row's "use Import" — where this site reads them, and for the kinds read
  // (an ASX file is not).
  if (urlState.value === 'playlist' && props.readsPlaylists && !isAsxUrl(form.url)) {
    return 'This is a playlist link: saving reads it and keeps the servers it lists, where its host allows. If it cannot be read, download it and use Import.'
  }
  return explain(urlState.value)
})
/** A playlist link is the single most common thing to paste, so it is a note,
 *  not an error: saving still tries to read it, and only then gives up. */
const isPlaylistLink = computed(() => urlState.value === 'playlist')
const homepageBad = computed(() => !!form.homepage.trim() && !safeUrl(form.homepage))
const logoBad = computed(() => !!form.logo.trim() && !safeUrl(form.logo, ['https:']))
const nowPlayingBad = computed(() => !!form.nowPlaying.trim() && !safeUrl(form.nowPlaying, ['https:']))
const canSave = computed(() =>
  !!cleanUrl.value && !!form.name.trim() && !homepageBad.value && !logoBad.value && !nowPlayingBad.value)

const fields: Array<{ label: string; key: keyof typeof form; placeholder?: string }> = [
  { label: 'Name', key: 'name' }, { label: 'Group', key: 'group' },
  { label: 'Network', key: 'network', placeholder: 'Broadcaster or station family' },
  { label: 'Homepage', key: 'homepage', placeholder: 'https://' },
  { label: 'Logo address', key: 'logo', placeholder: 'https://' },
  { label: 'Country', key: 'country' }, { label: 'Language', key: 'language' }
]

/* ---- finding the station's other servers ---------------------------------- */
const finding = ref(false)
const findNote = ref('')
const find = async () => {
  if (!props.findServers || !cleanUrl.value) return
  finding.value = true
  findNote.value = ''
  try {
    const found = await props.findServers({
      ...(props.station ?? {}), id: props.station?.id ?? '', name: form.name || cleanUrl.value, url: cleanUrl.value,
      alternates: safeUrls(form.alternates.split('\n')), source: safeUrl(form.source) || undefined
    })
    if (!found) {
      findNote.value = 'No playlist listing other servers was found for this station.'
      return
    }
    form.url = found.url
    form.alternates = found.alternates.join('\n')
    if (found.playlist) form.source = found.playlist
    const said: string[] = []
    if (found.converted) {
      said.push(`${found.converted === 1 ? 'An address was' : `${found.converted} addresses were`} your relay's; ` +
        'the station\'s own is put back, and it still plays from the relay.')
    }
    if (found.added) said.push(`Found ${found.added} more server${found.added === 1 ? '' : 's'} in ${found.playlist}.`)
    else if (found.playlist) said.push(`${found.playlist} lists no servers this station does not already have; it is kept as the playlist address.`)
    if (found.unread) said.push(`Not every source could be checked: ${found.unread.message.replace(/^(The|A) /, (m) => m.toLowerCase())}`)
    if (found.added || found.converted) said.push('Save to keep the changes.')
    findNote.value = said.join(' ')
  } catch (e) {
    if (!(e instanceof Refused)) throw e
    findNote.value = e.message // could not look, which is not "nothing there"
  } finally {
    finding.value = false
  }
}

const save = () => {
  if (!canSave.value) return
  emit('save', {
    // The value that passed `canSave`, not the raw field: they differ when the
    // address holds a space, which `safeUrl` encodes and `oneLine` keeps.
    url: cleanUrl.value!,
    name: oneLine(form.name),
    group: oneLine(form.group) || undefined,
    network: oneLine(form.network) || undefined,
    homepage: safeUrl(form.homepage),
    logo: safeUrl(form.logo, ['https:']),
    country: oneLine(form.country) || undefined,
    language: oneLine(form.language) || undefined,
    alternates: safeUrls(form.alternates.split('\n')),
    source: safeUrl(form.source) || undefined,
    nowPlaying: safeUrl(form.nowPlaying, ['https:']) || undefined
  })
}
const label = { fontSize: '12.5px', color: 'var(--oc-role-on-surface-variant)', display: 'block', marginBottom: '5px' }
</script>

<template>
  <RadioDialog :title="station ? 'Edit station' : 'Add station'" @close="emit('close')">
    <div :style="{ display: 'grid', gap: '16px', paddingTop: '12px' }">
      <p
        v-if="urlNote"
        :style="{ margin: 0, ...banner(isPlaylistLink ? 'ok' : 'bad') }"
      >{{ urlNote }}</p>

      <div>
        <label for="st-url" :style="label">Stream address</label>
        <input id="st-url" v-model="form.url" :style="dialogInput" placeholder="https://" @keydown.enter="save">
        <p :style="{ ...label, marginTop: '5px', marginBottom: 0 }">
          {{ readsPlaylists ? 'A direct stream, or a .pls or .m3u link: saving reads the servers it lists.' : 'A direct stream.' }}
        </p>
      </div>

      <div :style="{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }">
        <div v-for="f in fields" :key="f.key" :style="f.key === 'name' ? { gridColumn: '1 / -1' } : {}">
          <label :for="`st-${f.key}`" :style="label">{{ f.label }}</label>
          <input
            :id="`st-${f.key}`" v-model="form[f.key]" :style="dialogInput" :placeholder="f.placeholder"
            :list="f.key === 'group' ? 'st-groups' : undefined" @keydown.enter="save"
          >
          <p v-if="f.key === 'homepage' && homepageBad" :style="{ ...label, color: 'var(--oc-role-error)', marginTop: '5px' }">
            Needs to start with https:// or http://
          </p>
          <p v-if="f.key === 'logo' && logoBad" :style="{ ...label, color: 'var(--oc-role-error)', marginTop: '5px' }">
            Logos must be https:// images
          </p>
        </div>
        <datalist id="st-groups"><option v-for="g in groups" :key="g" :value="g" /></datalist>
      </div>

      <div>
        <label for="st-alt" :style="label">Backup servers, one per line</label>
        <textarea
          id="st-alt" v-model="form.alternates" rows="3" spellcheck="false"
          :style="{ ...dialogInput, fontFamily: 'ui-monospace, monospace', fontSize: '12px' }"
          placeholder="https://ice6.somafm.com/defcon-256-mp3"
        />
        <p :style="{ ...label, marginTop: '5px', marginBottom: 0 }">
          Tried in order when the one above stops responding, without interrupting you for longer
          than it takes to connect.
        </p>
        <div v-if="findServers" :style="{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px' }">
          <oc-button appearance="outline" :disabled="!cleanUrl || finding" @click="find">
            {{ finding ? 'Looking…' : 'Find backup servers' }}
          </oc-button>
          <span v-if="findNote" role="status" :style="{ ...label, margin: 0 }">{{ findNote }}</span>
        </div>
      </div>

      <div>
        <label for="st-source" :style="label">Playlist address</label>
        <input id="st-source" v-model="form.source" :style="dialogInput" placeholder="https://…/station.pls">
        <p :style="{ ...label, marginTop: '5px', marginBottom: 0 }">
          Optional. If every server fails, this file is read again to pick up the current list.
        </p>
      </div>

      <div>
        <label for="st-nowplaying" :style="label">Now-playing address</label>
        <input id="st-nowplaying" v-model="form.nowPlaying" :style="dialogInput"
               placeholder="https://cadence.nprstations.org/api/cadence/widget/…">
        <p v-if="nowPlayingBad" :style="{ ...label, color: 'var(--oc-role-error)', marginTop: '5px' }">
          Needs to start with https://
        </p>
        <p :style="{ ...label, marginTop: '5px', marginBottom: 0 }">
          Optional. Most stations need none: titles are read from the stream, the server, or
          the station's host (AzuraCast, Radio.co, Triton, Zeno.FM). For one that shows none,
          give the address it publishes them at — NPR's Cadence for public radio, an Icecast or
          SHOUTcast status page, a SomaFM song feed.
        </p>
        <details :style="{ ...label, marginTop: '6px', marginBottom: 0 }">
          <summary :style="{ cursor: 'pointer' }">How do I find it for a public radio station?</summary>
          <ol :style="{ margin: '6px 0 0', paddingLeft: '18px', lineHeight: 1.5 }">
            <li>Open the station's website and view the page source (Ctrl+U, or ⌥⌘U on a Mac).</li>
            <li>Search for <code>data-stream-channel-id</code>. Beside the stream's name is an id
              such as <code>2edfb643-4010-4f9e-a6f8-78b08d5dbc2d</code>.</li>
            <li>Paste <code>https://cadence.nprstations.org/api/cadence/widget/</code>, then the id,
              then <code>?show_song=true</code>.</li>
          </ol>
          <p :style="{ margin: '6px 0 0' }">Or ask your administrator: <code>scripts/find-nowplaying.mjs</code>
            in the app's source prints the address for a station's website or call letters. Radio
            cannot look it up itself, because station websites do not let other sites read them.</p>
        </details>
      </div>
    </div>
    <template #footer>
      <oc-button appearance="filled" color-role="primary" :disabled="!canSave" @click="save">
        {{ station ? 'Save changes' : 'Add station' }}
      </oc-button>
      <oc-button appearance="outline" @click="emit('close')">Cancel</oc-button>
      <span :style="{ flex: 1 }" />
      <oc-button v-if="station" appearance="outline" @click="emit('remove')">Remove</oc-button>
    </template>
  </RadioDialog>
</template>
