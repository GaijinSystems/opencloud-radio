<script setup lang="ts">
import { onMounted, ref } from 'vue'
import RadioDialog from './RadioDialog.vue'
import ColumnChecklist from './ColumnChecklist.vue'
import { THEME_MODES, type Prefs, type ThemeMode } from '../composables/usePreferences'
import { messageOf } from '../helpers/text'

const props = defineProps<{
  prefs: Prefs
  rootFolder: string
  settingsFolder: string
  backupFolder: string
  /** Columns the administrator has switched off for the instance. */
  hiddenColumns?: string[]
  directoryEnabled: boolean
  directoryReportingAllowed: boolean
  /** Whether the instance offers both a light and a dark theme. */
  canChooseTheme: boolean
  listProfiles: () => Promise<string[]>
  /** Resolves to the name the file was given, which may differ from the one typed. */
  saveProfile: (name: string, includeGeometry: boolean) => Promise<string>
  loadProfile: (name: string) => Promise<string>
}>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'reset'): void }>()

const profiles = ref<string[]>([])
const chosen = ref('')
const newName = ref('')
const includeGeometry = ref(true)
const busy = ref(false)
const note = ref('')

const refresh = async () => {
  try {
    profiles.value = await props.listProfiles()
    if (!profiles.value.includes(chosen.value)) chosen.value = profiles.value[0] ?? ''
  } catch (e) {
    // A missing folder is an empty list; anything else is a failure worth a
    // line, not "No saved profiles".
    note.value = messageOf(e, 'Saved profiles could not be listed.')
  }
}
onMounted(refresh)

const save = async () => {
  if (!newName.value.trim()) return
  busy.value = true
  try {
    const used = await props.saveProfile(newName.value.trim(), includeGeometry.value)
    note.value = `Saved as ${props.rootFolder}/${props.settingsFolder}/${used}.ini`
    newName.value = ''
    await refresh()
  } catch (e) {
    note.value = messageOf(e, 'The profile could not be saved.')
  } finally {
    busy.value = false
  }
}
const load = async () => {
  if (!chosen.value) return
  busy.value = true
  try {
    note.value = await props.loadProfile(chosen.value)
  } catch (e) {
    note.value = messageOf(e, 'The profile could not be read.')
  } finally {
    busy.value = false
  }
}
const themes = THEME_MODES.map((m): [ThemeMode, string] => [m, m[0].toUpperCase() + m.slice(1)])
const h3 = { margin: '0 0 10px', fontSize: '12.5px', fontWeight: 600, color: 'var(--oc-role-on-surface-variant)' }
const sect = { padding: '16px 0', borderBottom: '1px solid var(--oc-role-outline-variant)' }
const row = { display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 0', fontSize: '13.5px' }
const exp = { fontSize: '12px', color: 'var(--oc-role-on-surface-variant)', margin: '2px 0 0 25px' }
const input = { padding: '5px 8px', borderRadius: '6px', border: '1px solid var(--oc-role-outline-variant)',
                background: 'var(--oc-role-surface-container)', minWidth: '160px' }
</script>

<template>
  <RadioDialog title="Radio preferences" @close="emit('close')">
    <section :style="sect">
      <h3 :style="h3">Station list columns</h3>
      <div :style="{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }">
        <ColumnChecklist :columns="prefs.columns" :hidden="hiddenColumns" :row-style="row"
                         @toggle="(k, v) => (prefs.columns[k] = v)" />
      </div>
      <p :style="{ ...exp, marginLeft: 0 }">The same choices as the Columns menu above the list. Drag the right edge
        of a column heading to change its width; double-click the edge to reset it.</p>
    </section>

    <section :style="sect">
      <h3 :style="h3">Playback</h3>
      <label :style="row"><input v-model="prefs.resume" type="checkbox"> Start the last station when I open Radio</label>
      <div :style="row"><span :style="{ flex: 1 }">Reconnect attempts before giving up</span>
        <select v-model.number="prefs.retries" :style="input">
          <!-- A profile or storage may hold a value outside the offered few; show it rather than a blank. -->
          <option v-if="![0, 3, 5, 10].includes(prefs.retries)" :value="prefs.retries">{{ prefs.retries }}</option>
          <option :value="0">0 — do not retry</option>
          <option :value="3">3</option><option :value="5">5</option><option :value="10">10</option>
        </select></div>
      <label :style="row"><input v-model="prefs.metadata" type="checkbox"> Show track titles where the station provides them</label>
      <p :style="exp">From the station's now-playing address if it has one, from its server, or from the
        stream itself. Reading the stream costs a few seconds of extra audio every half minute.</p>
    </section>

    <section :style="sect">
      <h3 :style="h3">Spectrum</h3>
      <label :style="row"><input v-model="prefs.analyser" type="checkbox"> Show the spectrum while a station plays</label>
      <p :style="exp">Stations that allow it are analysed directly. The rest show indicative movement while playing,
        and a flat line when stopped.</p>
    </section>

    <section v-if="props.directoryEnabled" :style="sect">
      <h3 :style="h3">Online directory</h3>
      <label :style="row"><input v-model="prefs.directoryHttpsOnly" type="checkbox">
        Show only https stations in directory results</label>
      <p :style="exp">Many stations in the directory are http-only, and a browser cannot play those.</p>
      <template v-if="props.directoryReportingAllowed">
        <label :style="row"><input v-model="prefs.directoryReportClicks" type="checkbox">
          Tell the directory when I play one of its stations</label>
        <p :style="exp">Helps rank stations for everyone. Sends the station's id and your IP address to
          radio-browser.info, and nothing else. Off unless you turn it on.</p>
      </template>
      <p :style="{ ...exp, marginLeft: 0 }">Searching the directory sends what you type to
        radio-browser.info, a community-run service. Your station lists are never sent.</p>
    </section>

    <section :style="sect">
      <h3 :style="h3">Appearance</h3>
      <div :style="row"><span :style="{ flex: 1 }">Theme</span>
        <div :style="{ display: 'flex', gap: '2px', padding: '2px', borderRadius: '8px',
                       border: '1px solid var(--oc-role-outline-variant)' }">
          <button
            v-for="[value, label] in themes" :key="value" type="button" :aria-pressed="prefs.theme === value"
            :disabled="!canChooseTheme && value !== 'system'"
            :style="{ padding: '4px 12px', borderRadius: '6px', border: 0, font: 'inherit',
                      cursor: !canChooseTheme && value !== 'system' ? 'default' : 'pointer',
                      opacity: !canChooseTheme && value !== 'system' ? 0.45 : 1,
                      background: prefs.theme === value ? 'var(--oc-role-secondary-container)' : 'transparent',
                      color: prefs.theme === value ? 'var(--oc-role-on-secondary-container)' : 'inherit',
                      fontWeight: prefs.theme === value ? 600 : 400 }"
            @click="prefs.theme = value"
          >{{ label }}</button>
        </div></div>
      <p :style="{ ...exp, marginLeft: 0 }">
        <template v-if="canChooseTheme">Applies to Radio only; the rest of OpenCloud keeps its own setting,
          and System follows it.</template>
        <template v-else>Your OpenCloud offers one theme, so there is nothing to choose between here.</template>
      </p>
    </section>

    <section :style="sect">
      <h3 :style="h3">Settings profiles</h3>
      <div :style="row"><span :style="{ flex: 1 }">Load settings saved earlier</span>
        <select v-model="chosen" :disabled="!profiles.length" :style="input" aria-label="Saved profiles">
          <option v-if="!profiles.length" value="">No saved profiles</option>
          <option v-for="p in profiles" :key="p" :value="p">{{ p }}</option>
        </select>
        <oc-button appearance="outline" :disabled="!chosen || busy" @click="load">Load</oc-button></div>
      <div :style="row"><span :style="{ flex: 1 }">Save these settings as</span>
        <input v-model="newName" :style="input" placeholder="laptop" aria-label="Profile name" @keydown.enter="save">
        <oc-button appearance="outline" :disabled="!newName.trim() || busy" @click="save">Save</oc-button></div>
      <label :style="row"><input v-model="includeGeometry" type="checkbox"> Include column widths and list width</label>
      <p :style="{ ...exp, marginLeft: 0 }">Profiles are files in <b>{{ rootFolder }}/{{ settingsFolder }}/</b>. Nothing is applied until you
        load one, so a profile made on another machine never changes this one by itself.</p>
      <p v-if="note" :style="{ ...exp, marginLeft: 0, color: 'var(--oc-role-on-surface)' }">{{ note }}</p>
    </section>

    <section :style="{ ...sect, borderBottom: 0 }">
      <h3 :style="h3">Storage</h3>
      <p :style="{ margin: 0, fontSize: '13.5px' }">Station lists live in <b>{{ rootFolder }}/</b> in your personal space.
        The folder is set by your administrator.</p>
      <p :style="{ ...exp, marginLeft: 0 }">Before a list is changed in any way, a copy of it is saved to
        <b>{{ rootFolder }}/{{ backupFolder }}/</b>.</p>
      <div :style="row"><span :style="{ flex: 1 }">Copies to keep of each list</span>
        <select v-model.number="prefs.backupKeep" :style="input">
          <!-- A profile or storage may hold a value outside the offered few; show it rather than a blank. -->
          <option v-if="![1, 3, 5, 10, 25].includes(prefs.backupKeep)" :value="prefs.backupKeep">{{ prefs.backupKeep }}</option>
          <option :value="1">1</option><option :value="3">3</option><option :value="5">5</option>
          <option :value="10">10</option><option :value="25">25</option>
        </select></div>
      <p :style="exp">Older copies are removed once a new one is made. It cannot be set to none: a
        change is never made without a copy first, so the most recent one is always kept.</p>
    </section>

    <template #footer>
      <oc-button appearance="outline" @click="emit('reset')">Reset to defaults</oc-button>
      <span :style="{ flex: 1 }" />
      <oc-button appearance="filled" color-role="primary" @click="emit('close')">Done</oc-button>
    </template>
  </RadioDialog>
</template>
