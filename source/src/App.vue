<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue'
import PlayerBar from './components/PlayerBar.vue'
import StationTable from './components/StationTable.vue'
import ColumnsMenu from './components/ColumnsMenu.vue'
import StationForm from './components/StationForm.vue'
import ImportDialog from './components/ImportDialog.vue'
import PreferencesDialog from './components/PreferencesDialog.vue'
import ListDialog from './components/ListDialog.vue'
import SearchField from './components/SearchField.vue'
import AddToList from './components/AddToList.vue'
import BackupServersDialog from './components/BackupServersDialog.vue'
import { findBackupServers, type Found } from './helpers/backupServers'
import { useThemeStore } from '@opencloud-eu/web-pkg'
import { useSearch, type ResultGroup } from './composables/useSearch'
import { useDirectory } from './composables/useDirectory'
import { toStation, describeResult, uuidOf, type DirectoryStation } from './helpers/directory'
import { usePreferences, clampRail, clampCol, toProfile, fromProfile,
         MIN_RAIL, MAX_RAIL, DEFAULT_RAIL, DEFAULT_WIDTHS, DEFAULT_COL_WIDTH } from './composables/usePreferences'
import { usePlayer } from './composables/usePlayer'
import { useFollow } from './composables/useFollow'
import { useSpectrum } from './composables/useSpectrum'
import { useNowPlaying } from './composables/useNowPlaying'
import { usePlaylists, BackupError, ConflictError, isWritable, type ListFile } from './composables/usePlaylists'
import { classifyUrl, failedState, playsHere, type Playability } from './helpers/classify'
import { bodyView, emptyMessage, MIN_DIRECTORY_QUERY } from './helpers/view'
import { applyThemeTo, pickTheme, canChooseTheme as offersChoice } from './helpers/theme'
import { parseIni, serializeIni } from './parsers/ini'
import { readConfig } from './config'
import { setRelays } from './helpers/relays'
import { readPlaylistServers } from './helpers/resolve'
import { Refused, HTTP_REASON } from './helpers/fetch'
import { isHlsUrl, isPlaylistUrl, isStationListUrl } from './helpers/playlist'
import { baseName, messageOf } from './helpers/text'
import { banner } from './helpers/styles'
import { sanitizeStation, historyKey } from './helpers/safeUrl'
import { readHistory } from './helpers/history'
import { keepServers, mergeStations, refreshedServers, sameServers, serversOf, streamTaken } from './helpers/stations'
import { nextId, type Playlist, type Station } from './parsers/types'

const props = defineProps<{ applicationConfig?: Record<string, unknown> }>()
const config = readConfig(props.applicationConfig)
// Before anything judges or opens an address: the relays decide which http ones play here.
setRelays(config.relays)

const { prefs, reset: resetPrefs, resetColumns, destroy: destroyPrefs } = usePreferences({ backupKeep: config.backupKeep, retries: config.reconnectAttempts })
/** The spectrum is on only when the administrator allows it AND the user wants it. */
const analysing = computed(() => prefs.analyser && config.analyserEnabled)
/** Columns the administrator has switched off for the instance. */
const hiddenColumns = config.showLogos ? [] : ['logo']
const player = usePlayer(config, {
  wantAnalyser: () => analysing.value,
  showArtwork: () => columns.value.logo !== false,
  attempts: () => prefs.retries,
  applyGain: (volume, muted, el) => scope.applyVolume(volume, muted, el),
  // The level is the preference itself: one owner, so nothing to keep in step.
  level: { volume: toRef(prefs, 'volume'), muted: toRef(prefs, 'muted') },
  // Every server failed: the playlist is the authority on which exist today.
  // This is the one place playback is allowed to change a file: a station's
  // own playlist said its servers moved, and only the current list is written.
  refreshServers: async (s) => {
    if (!s.source) return []
    // Servers this page can play first; an https station is never moved onto
    // http servers a secure page cannot play. A playlist this page may not
    // read is `Refused`, which the player says in its own error line.
    const listed = await readPlaylistServers(s.source, config.maxPlaylistDepth)
    const fresh = refreshedServers(s, listed)
    // The same servers in the same order is not news: saving it rewrote the
    // file unchanged and spent a backup on it every time a station went down.
    const same = sameServers(fresh, serversOf(s))
    // Saved only with a first server that plays here: one that does not would
    // mark the row as blocked and disable its button. The store refuses it
    // for a read-only list, and when that server is already another row's.
    if (fresh.length && !same && playsHere(fresh[0]) && lists.current.value.stations.some((x) => x.id === s.id) &&
        lists.updateStation(s.id, { url: fresh[0], alternates: fresh.slice(1) })) {
      flash(`Refreshed the server list for ${s.name} — ${fresh.length} found.`)
    }
    return fresh
  }
})
const scope = useSpectrum()
const nowPlaying = useNowPlaying()
const lists = usePlaylists(config, {
  keepBackups: () => prefs.backupKeep,
  // Every edit to the open list schedules its own save; this is where a
  // failure of one is said.
  onSaveError: (e) => {
    // The list is untouched in this case, and saying so matters: the banner
    // otherwise reads as "your edit is lost" when in fact nothing was written.
    if (e instanceof BackupError) { flash(`${e.message} Your changes are still here.`, 'bad'); return }
    if (e instanceof ConflictError) {
      // Until the list is re-read its etag is stale and every later save would
      // fail the same way; reload now so the next edit lands.
      flash(`${e.message} Reloaded the list.`, 'bad')
      void lists.reload().catch(() => undefined)
      return
    }
    flash('This list could not be saved.', 'bad')
  }
})
const directory = useDirectory(config)

const search = useSearch({
  files: () => lists.files.value,
  currentFile: () => lists.currentFile.value,
  currentStations: () => lists.current.value.stations,
  readList: async (file) => (await lists.readList(file)).stations
})

/* ---- session and device state, keyed by stream URL (ids change on every parse)
   `states` holds only what this session has SEEN of a station — that it played,
   or that it failed. What a row shows when nothing has been seen is worked out
   where it is drawn (`verdictOf`), from the address and the device's history;
   seeding it here at some of the ways a station can come on screen left the
   others — search results, an import, a reload after a conflict — without.

   `lastPlayed` is what the device keeps. Its keys are stream addresses with
   credentials and query replaced by a hash of them (`historyKey`): some
   relays carry a token there, and device storage outlives a logout. */
const states = ref<Record<string, Playability>>({})
const LAST_KEY = 'radio.lastPlayed'
const storedHistory = (() => { try { return localStorage.getItem(LAST_KEY) } catch { return null } })()
const lastPlayed = ref<Record<string, number>>(readHistory(storedHistory))
// What was stored before 1.2.0 held full addresses. Reading them redacted is
// not enough: they are replaced now, not at whenever something next plays.
try {
  if (storedHistory !== null && storedHistory !== JSON.stringify(lastPlayed.value)) {
    localStorage.setItem(LAST_KEY, JSON.stringify(lastPlayed.value))
  }
} catch { /* device without storage */ }
const rememberPlayed = (address: string) => {
  const url = historyKey(address)
  // A reconnect is not a new listen; skip the sort-and-write when the
  // most recent entry is already this station.
  const top = Object.entries(lastPlayed.value).sort((a, b) => b[1] - a[1])[0]
  if (top && top[0] === url && Date.now() - top[1] < 5 * 60000) return
  const next = { ...lastPlayed.value, [url]: Date.now() }
  // keep it bounded: a device that has played 500 stations does not need the 501st
  const keys = Object.keys(next).sort((a, b) => next[b] - next[a]).slice(0, 500)
  lastPlayed.value = Object.fromEntries(keys.map((k) => [k, next[k]]))
  try { localStorage.setItem(LAST_KEY, JSON.stringify(lastPlayed.value)) } catch { /* device without storage */ }
}

const listLabel = (f: ListFile) => baseName(f.name)
const selection = ref<string[]>([])
/**
 * Most of what this banner says is "that worked" — added, moved, refreshed.
 * It was drawn in the error colours regardless, so a success read as a
 * failure. The tone is part of the message now, and only a real failure is
 * red.
 */
const notice = ref<{ text: string; tone: 'ok' | 'bad' } | null>(null)
let noticeTimer: ReturnType<typeof setTimeout> | undefined
const flash = (text: string, tone: 'ok' | 'bad' = 'ok') => {
  const entry = { text, tone }
  notice.value = entry
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => { if (notice.value === entry) notice.value = null }, 6000)
}
/** Anything thrown: the message if there is one, and always the red tone. */
const flashError = (e: unknown, fallback: string) => flash(messageOf(e, fallback), 'bad')

type Dialog =
  | { kind: 'none' } | { kind: 'station'; station: Station | null } | { kind: 'import' }
  | { kind: 'prefs' } | { kind: 'list'; mode: 'create' | 'rename' | 'delete' } | { kind: 'move' } | { kind: 'servers' }
const dialog = ref<Dialog>({ kind: 'none' })
/** A directory result whose "Add to list" chose "New list…": added once the list exists. */
const pendingAdd = ref<Station | null>(null)
const close = () => { dialog.value = { kind: 'none' }; pendingAdd.value = null }

/* ---- theme: Radio's own, over the OpenCloud one. Applied to this app's root
   element exactly as the shell applies its theme to the page — one inline
   `--oc-role-*` custom property per design token — so it inherits into every
   component inside and touches nothing outside. Until 1.1.6 this set a
   `data-theme` attribute on <html>, which the shell never reads; the control
   did nothing and the assumption was marked "verify on first live run". ---- */
const themeStore = useThemeStore()
let themed: string[] = []
const applyTheme = () => {
  const el = root.value
  if (!el) return
  const chosen = prefs.theme === 'system' ? null : pickTheme(themeStore.availableThemes, prefs.theme) ?? null
  themed = applyThemeTo(el, chosen, themed)
  scope.repaint() // the canvas caches the role colours it draws with
}
watch(() => prefs.theme, applyTheme)
const canChooseTheme = computed(() => offersChoice(themeStore.availableThemes))

/* ---- spectrum: attaches only to an element that is actually playing -------- */
player.onElementPlaying((el, cors) => {
  if (analysing.value) scope.onPlaying(el, cors)
  // Order matters: set the graph's level first, then release the element to
  // full volume, or a quiet setting would blip loud for a frame.
  player.handOverLevel()
})
// The station's address too: when the player takes up its row again under a
// new address (see `follow`), what is remembered goes with it.
watch([() => player.state.value, () => player.station.value?.url], ([state]) => {
  const s = player.station.value
  if (state === 'playing' && s) {
    states.value = { ...states.value, [s.url]: 'ready' }
    rememberPlayed(s.url)
    prefs.lastStation = historyKey(s.url)
    return
  }
  scope.setIdle()
  if (state === 'failed' && s) states.value = { ...states.value, [s.url]: failedState(s) }
})
/**
 * Track titles, as a consequence of three things rather than a reaction to
 * one: something is playing, on this server, and titles are wanted (allowed
 * by the administrator AND chosen by the user). When any of them changes the
 * lookup is put right — started, moved to the server a failover chose, or
 * stopped. As a reaction to the `playing` event alone, switching titles on
 * mid-play did nothing until the next station, and a failover went on asking
 * a server that was no longer the one playing.
 */
const titlesOn = computed(() => prefs.metadata && config.metadataEnabled)
// The station's address and now-playing address, not the station object: a
// rename of the playing row is not a reason to blank the title and ask again.
watch([() => player.state.value, () => player.currentServer.value, titlesOn,
  () => player.station.value?.url, () => player.station.value?.nowPlaying], ([state, server, on]) => {
  const s = player.station.value
  if (on && s && state === 'playing') nowPlaying.start(s, server || s.url)
  else nowPlaying.stop()
})
// The lock screen and the OS media controls say what is playing too.
watch(() => nowPlaying.track.value, (t) => player.showTrack(t))
// The player stays on the row it is playing, whatever changes the list.
useFollow(player, lists)
// Off: the display goes flat and the graph, if any, keeps carrying the sound.
// On, mid-play: attach to what is playing now rather than waiting for the
// next `playing` event, which may be an hour away.
watch(() => prefs.analyser, (on) => {
  if (!on) { scope.setIdle(); return }
  const { el, cors } = player.current()
  if (config.analyserEnabled && el && player.state.value === 'playing') {
    scope.onPlaying(el, cors)
    player.handOverLevel()
  }
})

/* ---- directory search ------------------------------------------------------
   Local scopes filter on every keystroke; the directory is a network call and
   must not. Two characters minimum, then a pause. */
let dirTimer: ReturnType<typeof setTimeout> | undefined
/** A directory query is waiting out its pause: "searching", not yet "nothing found". */
const dirQueued = ref(false)
watch([() => search.query.value, () => search.scope.value, () => prefs.directoryHttpsOnly], () => {
  clearTimeout(dirTimer)
  dirQueued.value = false
  if (search.scope.value !== 'directory') { directory.clear(); return }
  const q = search.query.value.trim()
  if (q.length < MIN_DIRECTORY_QUERY) { directory.clear(); return }
  dirQueued.value = true
  dirTimer = setTimeout(() => {
    dirQueued.value = false
    void directory.search({ query: q, httpsOnly: prefs.directoryHttpsOnly })
  }, 350)
})

/** Directory rows are converted once each and keyed by the directory's own
 *  stable id. The conversion is remembered per raw result, which keeps its
 *  identity across "Show more", so the rows already on screen keep their
 *  station object and are not re-rendered when a page is appended. */
const converted = new WeakMap<DirectoryStation, Station>()
const dirStations = computed(() => {
  const out = new Map<string, { station: Station; raw: DirectoryStation }>()
  for (const raw of directory.results.value) {
    let station = converted.get(raw)
    if (!station) { station = toStation(raw); converted.set(raw, station) }
    if (!station.url) continue // nothing playable survived the URL gate
    out.set(station.id, { station, raw })
  }
  return out
})

/** Which of the results are already saved, and where. Best-effort: only lists
 *  that have been read for an All-lists search are consulted (whole lists,
 *  not just the matching rows), and Add refuses a duplicate anyway. */
const alreadySaved = computed<Record<string, string>>(() => {
  const byUrl = new Map<string, string>()
  for (const file of lists.files.value) {
    for (const s of search.stationsOf(file)) {
      byUrl.set(s.url, listLabel(file))
      if (s.source) byUrl.set(s.source, listLabel(file))
    }
  }
  const out: Record<string, string> = {}
  for (const [id, { station }] of dirStations.value) {
    const hit = byUrl.get(station.url) ?? (station.source ? byUrl.get(station.source) : undefined)
    if (hit) out[id] = hit
  }
  return out
})

const directoryDetails = computed<Record<string, string>>(() => {
  const out: Record<string, string> = {}
  for (const [id, { raw }] of dirStations.value) out[id] = describeResult(raw)
  return out
})

/** What the table renders: the current list, or grouped search results. */
const resultGroups = computed<ResultGroup[]>(() => {
  if (!search.active.value) return []
  if (search.scope.value !== 'directory') return search.localGroups.value
  const stations = [...dirStations.value.values()].map((v) => v.station)
  if (!stations.length) return []
  return [{
    key: 'directory',
    label: 'Online directory',
    meta: `${stations.length} result${stations.length === 1 ? '' : 's'} · most played first`,
    stations
  }]
})

/* ---- resizable list divider ---------------------------------------------- */
/** The divider's width while it is dragged; the preference takes it on release.
 *  A width set any other way — Reset, a profile — is followed from here. */
const railWidth = ref(clampRail(prefs.railWidth))
watch(() => prefs.railWidth, (w) => { railWidth.value = clampRail(w) })
const rail = ref<HTMLElement | null>(null)
let dragging = false
const onSplitDown = (e: PointerEvent) => { dragging = true; (e.target as HTMLElement).setPointerCapture(e.pointerId) }
const onSplitMove = (e: PointerEvent) => {
  if (dragging && rail.value) railWidth.value = clampRail(e.clientX - rail.value.getBoundingClientRect().left)
}
const onSplitUp = () => { if (dragging) { dragging = false; prefs.railWidth = railWidth.value } }
const setRail = (w: number) => { railWidth.value = clampRail(w); prefs.railWidth = railWidth.value }
const onSplitKey = (e: KeyboardEvent) => {
  const step = e.shiftKey ? 40 : 8
  if (e.key === 'ArrowLeft') { setRail(railWidth.value - step); e.preventDefault() }
  if (e.key === 'ArrowRight') { setRail(railWidth.value + step); e.preventDefault() }
  if (e.key === 'Home') { setRail(DEFAULT_RAIL); e.preventDefault() }
}

/* ---- container size, not window size: the shell sidebar toggles silently ---- */
let observer: ResizeObserver | undefined
const root = ref<HTMLElement | null>(null)
const narrow = ref(false)

/**
 * The debounce is 800 ms and the save behind it is several requests. Moving
 * to another OpenCloud app is a route change and the page lives on, so the
 * unmount flush completes; closing the tab or reloading is what could lose the
 * edit, and the browser's own prompt is the one reliable way to ask first.
 */

const onBeforeUnload = (e: BeforeUnloadEvent) => {
  if (!lists.isDirty()) return
  e.preventDefault()
  e.returnValue = '' // still needed for the prompt in some browsers
}

onMounted(async () => {
  window.addEventListener('beforeunload', onBeforeUnload)
  applyTheme()
  observer = new ResizeObserver(([entry]) => {
    narrow.value = entry.contentRect.width < 700
    railWidth.value = clampRail(railWidth.value, entry.contentRect.width)
  })
  if (root.value) observer.observe(root.value)

  try {
    let files = await lists.listFiles()
    if (!files.length) {
      // First launch: there must always be somewhere to put a station, whether
      // or not the administrator configured defaults.
      await lists.createList('Favourites', config.defaultStations.map((s) => sanitizeStation({ ...s, id: nextId() })))
      files = lists.files.value
    }
    const first = files.find((f) => f.name === prefs.lastList) ?? files[0]
    if (first) await openList(first)
    // Resume needs a gesture in most browsers; select the station so one tap plays it.
    if (prefs.resume && prefs.lastStation) {
      // Compared redacted on both sides: a value stored before 1.2.0 is a full address.
      const last = historyKey(prefs.lastStation)
      const s = lists.current.value.stations.find((x) => historyKey(x.url) === last)
      if (s) player.station.value = s
    }
  } catch { /* lists.status carries the message */ }
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
  observer?.disconnect()
  clearTimeout(dirTimer)
  clearTimeout(noticeTimer)
  void lists.flush().catch(() => undefined)
  destroyPrefs()
  player.destroy()
  scope.destroy()
  nowPlaying.stop()
  // Nothing to restore for the theme: it lives on this component's own root,
  // which is going with it.
})

/* ---- lists ---------------------------------------------------------------- */
/** Resolves to whether `file` is now the open list. A caller that goes on to
 *  edit must check: carrying on after a failed open edited the PREVIOUS list. */
const openList = async (file: ListFile): Promise<boolean> => {
  try {
    // False when a later click superseded this one; that call does the rest.
    if (!await lists.open(file)) return false
  } catch {
    return false // lists.status carries the message; nothing else to do here
  }
  prefs.lastList = file.name
  selection.value = []
  search.clear() // results were about the old list; keeping them would mislead
  return true
}

// A station removed through the edit form, or by a reload after a conflict,
// must not linger in the selection: the bulk bar would count stations that no
// longer exist.
watch(() => lists.current.value.stations, (stations) => {
  const live = new Set(stations.map((s) => s.id))
  if (selection.value.some((id) => !live.has(id))) {
    selection.value = selection.value.filter((id) => live.has(id))
  }
})
const convertList = async () => {
  const file = lists.currentFile.value
  if (!file) return
  try {
    const created = await lists.convertList(file)
    await openList(created)
    flash(`Saved as ${created.name}. ${file.name} is unchanged.`)
  } catch (e) {
    flashError(e, 'The list could not be converted.')
  }
}

const onListConfirm = async (value: string) => {
  const d = dialog.value
  try {
    if (d.kind === 'list' && d.mode === 'create') {
      const created = await lists.createList(value)
      const opened = await openList(created)
      const carried = pendingAdd.value
      if (carried && !opened) {
        // The list exists but is not the one on screen; adding now would put
        // the station in whichever list is.
        pendingAdd.value = null
        await lists.appendTo(created, [carried])
        flash(`Created ${listLabel(created)} and added ${carried.name}.`)
      } else if (carried) {
        pendingAdd.value = null
        lists.addStation({ ...carried, id: nextId() })
        await lists.flush()
        flash(`Created ${listLabel(created)} and added ${carried.name}.`)
      }
    }
    if (d.kind === 'list' && d.mode === 'rename' && lists.currentFile.value) {
      await openList(await lists.renameList(lists.currentFile.value, value))
    }
    if (d.kind === 'list' && d.mode === 'delete' && lists.currentFile.value) {
      await lists.deleteList(lists.currentFile.value)
      if (lists.files.value[0]) await openList(lists.files.value[0])
    }
    if (d.kind === 'move' && lists.currentFile.value) {
      const target = lists.files.value.find((f) => f.name === value)
      const ids = new Set(selection.value)
      const moving = lists.current.value.stations.filter((s) => ids.has(s.id))
      if (target && moving.length) {
        const { added, duplicates, left, verdicts } = await lists.appendTo(target, moving)
        // Only what the other list now holds leaves this one. A station it had
        // no room for stays here, and stays selected.
        const stayed = new Set(moving.filter((_, i) => verdicts[i] === 'left').map((s) => s.id))
        lists.removeStations(new Set([...ids].filter((id) => !stayed.has(id))))
        selection.value = [...stayed]
        try {
          await lists.flush()
        } catch (e) {
          // The target has them; on the server, so does this list, until its
          // save lands. "Could not be saved" alone would read as "nothing
          // happened", which is the one thing that is not true.
          const why = e instanceof Error ? ` ${e.message}` : ''
          flash(`${added} added to ${listLabel(target)}, but this list could not be saved, ` +
                `so on the server they are still in both lists until it can be.${why}`, 'bad')
          close()
          return
        }
        flash(mergeNote(`${added} moved to ${listLabel(target)}`, { duplicates, left }, 'already there',
          `left here because ${listLabel(target)} is full`), left.length ? 'bad' : 'ok')
      }
    }
    close()
  } catch (e) {
    flashError(e, 'That did not work.')
  }
}

/* ---- stations ---------------------------------------------------------------- */
const playResult = (s: Station) => {
  play(s)
  // Reporting is double-gated: the administrator allows it at all, and the
  // user opts in. Either off means nothing leaves the instance.
  if (config.directoryReportClicks && prefs.directoryReportClicks) {
    const uuid = uuidOf(s)
    if (uuid) directory.reportClick(uuid)
  }
}

const play = (s: Station) => player.toggle(s)
/**
 * Logos are one decision, not three: the administrator may switch them off
 * for the instance (`showLogos`, which also means no `img-src` entry is
 * needed), and the user may switch the column off. Both the table and the
 * player bar follow it, so turning logos off no longer leaves one behind.
 */
const columns = computed(() =>
  config.showLogos ? prefs.columns : { ...prefs.columns, logo: false })

const groups = computed(() => [...new Set(lists.current.value.stations.map((s) => s.group).filter(Boolean))] as string[])

/** Says why and returns true when the open list cannot be edited here. */
const refuseReadOnly = (): boolean => {
  if (lists.readOnly.value) flash('This list is read-only here. Convert it to .m3u8 first.', 'bad')
  return lists.readOnly.value
}

/** Opening the form must always work; if there is no list yet, make one. */
const addStation = async () => {
  if (refuseReadOnly()) return
  if (!lists.currentFile.value) {
    try {
      if (!await openList(await lists.createList('Favourites'))) return
    } catch (e) {
      flashError(e, 'A station list could not be created.')
      return
    }
  }
  dialog.value = { kind: 'station', station: null }
}

const onStationSave = async (raw: Omit<Station, 'id'>) => {
  const d = dialog.value
  let data = raw
  let notRead: Refused | undefined // the playlist link was refused: say why
  let onlyLists = false // it lists only other playlists, none of them read
  // What is said of it, once the station is saved: not before, since a save
  // refused (a duplicate, a read-only list) says so instead.
  let notice: { text: string; tone: 'ok' | 'bad' } | undefined
  const read = isPlaylistUrl(raw.url) && config.maxPlaylistDepth > 0 // whether it was asked for at all
  if (read) {
    // Each once, those that play here first, and no more than a station keeps
    // anywhere else: a StreamTheWorld playlist names up to a hundred.
    let listed: string[] = []
    try {
      listed = await readPlaylistServers(raw.url, config.maxPlaylistDepth)
    } catch (e) {
      if (!(e instanceof Refused)) throw e
      notRead = e
    }
    // A playlist it lists (past the depth followed, or one that gave nothing)
    // is no stream to save: the row would be a playlist link again, and would
    // not play. Left out before the ten are chosen, so none takes a place. An
    // HLS manifest is a stream, if not yet one this player plays.
    const servers = keepServers(listed.filter((u) => !isStationListUrl(u)))
    onlyLists = listed.length > 0 && !servers.length
    if (servers.length) {
      // Keep the servers, and remember the playlist so the list can be
      // refreshed later. This is the whole point of pointing at a .pls.
      data = { ...raw, url: servers[0], alternates: servers.slice(1), source: raw.url }
      const why = whyNotPlayable(servers)
      notice = {
        text: (servers.length > 1
          ? `Saved with ${servers.length} servers — the player moves to the next one if a server goes down.`
          : 'That address was a playlist; the stream inside it was saved.') + (why ? ` ${why}` : ''),
        tone: why ? 'bad' : 'ok'
      }
    }
  }
  // A playlist link not turned into a stream is said, whatever else the
  // address is: an http link from an https page is "blocked" as an address,
  // and its being http is often why it was not read. Where it was refused, or
  // listed only playlists, that is said whatever its extension (`.m3u8` too).
  if (data === raw && (notRead || onlyLists || isStationListUrl(raw.url))) {
    // The station is still saved — losing what was typed helps nobody — but it
    // will not play until the address is replaced. Why it was not read is said
    // only when it is known: a refusal (or an http link from an https page,
    // its host answering over https without it), or nothing usable in what
    // came back. A `.m3u8` may be an HLS stream rather than a station list:
    // refused, the name cannot tell which, so both are said.
    // Read, and known to be a station list, it is not hedged as maybe HLS.
    const hls = isHlsUrl(raw.url) && !onlyLists && !notRead?.linked
    // An http link from an https page that gave nothing over https (no answer
    // in time, say): its being http is still the likeliest reason.
    const httpHere = globalThis.location?.protocol === 'https:' && /^http:/i.test(raw.url)
    const why = notRead ? `it ${notRead.clause}`
      : !read ? 'it was not read: this site is set not to read playlists.'
        : onlyLists ? 'it lists only other playlists, from which no stream was read.'
          : httpHere ? `no stream could be read from it over https.${HTTP_REASON('Its')}`
            : 'no stream could be read from it.'
    const advice = onlyLists
      ? 'Open the link, then a playlist it lists, and copy a stream address from inside that one; or download that file and use Import.'
      : hls
        ? 'If it is an HLS stream rather than a station list, it would not play here in any case: this player does not play HLS yet. ' +
          'If it is a station list, download the file and use Import, or open the link and copy a stream address from inside it.'
        : !notRead?.linked
          ? 'Download the file and use Import, or open the link and copy the stream address from inside it.'
          : notRead.levels === 1
            ? 'Open the link, then the playlist it points to, and copy the stream address from inside that one; or download that file and use Import.'
            : 'Open the link and follow the playlists it leads to, to the last one, and copy the stream address from inside that; or download that file and use Import.'
    notice = { text: `Saved, but ${hls ? 'this may be a playlist link' : 'this is a playlist link'}, and ${why} ${advice}`, tone: 'bad' }
  }
  if (d.kind === 'station' && d.station) {
    const editing = d.station
    // The same rule as adding: two rows with one address would share a
    // verdict, a last-played time and a place in every URL-keyed lookup.
    if (streamTaken(lists.current.value.stations, data.url, editing.id)) {
      flash('Another station in this list already has that stream address.', 'bad')
      return
    }
    if (!lists.updateStation(editing.id, data)) {
      // Read-only says so itself. Otherwise the list was re-read while the
      // form was open and this station's row is a new one.
      if (!refuseReadOnly()) flash('This list was reloaded while the form was open, so the change was not made. Open the station again.', 'bad')
      close()
      return
    }
    // An edited station starts again: what this session saw of the old
    // address, or of this one before the edit, is not about it any more.
    const { [editing.url]: _was, [data.url]: _is, ...rest } = states.value
    states.value = rest
  } else if (!explainUnadded(lists.addStation({ id: nextId(), ...data }), 'this list')) {
    return
  }
  close()
  if (notice) flash(notice.text, notice.tone)
}
/**
 * Why streams read from a playlist will not play here, or '' when the first
 * does (those that play here come first, so a first that does not means none
 * does): http nobody relays, on an https page, or HLS, which this player does
 * not play yet.
 */
const whyNotPlayable = (servers: string[]): string => {
  if (playsHere(servers[0])) return ''
  const one = servers.length === 1
  // HLS first, whatever its scheme: a relay would not make it play. Then http
  // nobody relays, which this app plays on no page.
  const hls = servers.filter(isHlsUrl).length
  const http = servers.filter((u) => !isHlsUrl(u) && /^http:/i.test(u)).length
  if (hls === servers.length) return `${one ? 'It is an HLS stream' : 'They are HLS streams'}, which this player does not play yet.`
  if (http === servers.length) {
    return `${one ? 'It is' : 'They are'} http, which this page may not play: ask your administrator to relay ${one ? 'it' : 'them'}, or find an https address for the station.`
  }
  return `None of them plays here: ${http === 1 ? 'one is' : `${http} are`} http, which this page may not play, and ` +
    `${hls === 1 ? 'one is an HLS stream' : `${hls} are HLS streams`}, which this player does not play yet.`
}
/** What a merge did, as one sentence: what went in, then what did not, and why. */
const mergeNote = (lead: string, m: { duplicates: number; left: unknown[] }, dupes: string, full: string): string =>
  [lead, ...(m.duplicates ? [`${m.duplicates} ${dupes}`] : []), ...(m.left.length ? [`${m.left.length} ${full}`] : [])].join(', ') + '.'
/** Why a station did not go in, said once; true when it did. */
const explainUnadded = (merge: { added: number; duplicates: number }, where: string): boolean => {
  if (merge.added) return true
  if (where === 'this list' && lists.readOnly.value) refuseReadOnly()
  else if (merge.duplicates) flash(`That stream is already in ${where}.`, 'bad')
  else flash(`There is no room for it: a list holds ${config.maxStationsPerList} stations.`, 'bad')
  return false
}
/**
 * A station's playlist and the servers in it. The online directory is asked
 * only where the administrator has enabled it: asking sends the station's name.
 */
const findServers = (s: Station) => findBackupServers(s, {
  depth: config.maxPlaylistDepth,
  directory: config.directoryEnabled,
  directoryHost: config.directoryServers[0] ?? 'de1.api.radio-browser.info'
})
/** "Find backup servers" for the list, applied: one edit per station, one save for all. */
const applyServers = (changes: Array<{ id: string; found: Found }>) => {
  let applied = 0
  for (const { id, found } of changes) {
    if (lists.updateStation(id, { url: found.url, alternates: found.alternates, ...(found.playlist ? { source: found.playlist } : {}) })) applied++
  }
  close()
  const missed = changes.length - applied
  flash(`Updated ${applied} station${applied === 1 ? '' : 's'}` +
    (missed ? `; ${missed} could not be changed (another station has that address).` : '.'), missed ? 'bad' : 'ok')
}
const onStationRemove = () => {
  const d = dialog.value
  if (d.kind === 'station' && d.station) lists.removeStations(new Set([d.station.id]))
  close()
}
const onImport = async (list: Playlist, mode: 'append' | 'new', name: string) => {
  try {
    // One rule for both ways in — the store applies it; this only reports it.
    const report = (m: { added: number; duplicates: number; left: unknown[] }, dupes: string) =>
      flash(mergeNote(`${m.added} added`, m, dupes, `left out to keep the list under ${config.maxStationsPerList}`))
    if (mode === 'new') {
      const merged = mergeStations([], list.stations, config.maxStationsPerList)
      await openList(await lists.createList(name, merged.stations))
      if (merged.duplicates || merged.left.length) report(merged, 'listed twice') // a new list says the rest itself
    } else {
      if (lists.readOnly.value) { flash('This list is read-only here. Import into a new list, or convert it first.', 'bad'); return }
      // With no list open there is nothing to add to; make the one a first launch would have.
      if (!lists.currentFile.value && !await openList(await lists.createList('Favourites'))) return
      const merged = lists.addStations(list.stations.map((s) => ({ ...s, id: nextId() })))
      report(merged, 'already in the list')
    }
    close()
  } catch (e) {
    flashError(e, 'The import did not work.')
  }
}
const move = (s: Station, delta: number) => { lists.moveStation(s.id, delta) }

const removeSelected = () => {
  const n = selection.value.length
  if (!n) return
  // Removing several stations at once is destructive, immediate and has no
  // undo — the file is rewritten. One station is a small enough mistake to
  // retype; several is not, so it is worth one question naming the number.
  const ids = new Set(selection.value)
  if (n > 1) {
    const names: string[] = []
    for (const s of lists.current.value.stations) {
      if (ids.has(s.id) && names.push(s.name) === 3) break
    }
    const shown = names.join(', ') + (n > names.length ? `, and ${n - names.length} more` : '')
    if (!window.confirm(`Remove ${n} stations from this list?\n\n${shown}`)) return
  }
  lists.removeStations(ids)
  selection.value = []
}
const copyAddresses = async () => {
  const ids = new Set(selection.value)
  const text = lists.current.value.stations.filter((s) => ids.has(s.id)).map((s) => s.url).join('\n')
  try {
    await navigator.clipboard.writeText(text)
    flash(`${ids.size} address${ids.size === 1 ? '' : 'es'} copied.`)
  } catch {
    flash('Copying was not allowed here. Turn on the stream address column and copy from the list.', 'bad')
  }
}

/* ---- adding a directory result to a list ----------------------------------- */
const adding = ref<{ station: Station; x: number; y: number } | null>(null)
/**
 * Edit on a local result. A result from the current list is the list's own
 * object, so the form can edit it directly. A result from another list has to
 * be opened in its list first — the editor only writes the current file —
 * so that is what happens: open, find it by address, edit. Until 1.1.1 the
 * form opened on a stale copy and Save changed nothing.
 */
const onResultAction = async (s: Station, anchor: HTMLElement) => {
  if (search.scope.value === 'directory') {
    const r = anchor.getBoundingClientRect()
    adding.value = { station: s, x: r.right, y: r.bottom }
    return
  }
  let target: Station | undefined = lists.current.value.stations.find((x) => x.id === s.id)
  if (!target) {
    const group = search.localGroups.value.find((g) => g.stations.includes(s))
    if (!group?.file) return
    if (!await openList(group.file)) return
    target = lists.current.value.stations.find((x) => x.url === s.url)
  }
  if (!target) return
  if (refuseReadOnly()) return
  dialog.value = { kind: 'station', station: target }
}
const addToList = async (path: string) => {
  const entry = adding.value
  if (!entry) return
  const target = lists.files.value.find((f) => f.path === path)
  if (!target) return
  adding.value = null
  try {
    if (target.path === lists.currentFile.value?.path) {
      if (!explainUnadded(lists.addStation({ ...entry.station, id: nextId() }), 'this list')) return
      await lists.flush()
    } else if (!explainUnadded(await lists.appendTo(target, [entry.station]), 'that list')) {
      return
    }
    flash(`Added to ${listLabel(target)}.`)
  } catch (e) {
    flashError(e, 'The station could not be added.')
  }
}

/* ---- profiles ----------------------------------------------------------------- */
const saveProfile = (name: string, geometry: boolean) =>
  lists.saveProfile(name, serializeIni(toProfile(prefs, geometry), `OpenCloud Radio settings profile "${name.replace(/[\r\n]+/g, ' ')}"\nLoad it from Radio › Preferences › Settings profiles.`))
const loadProfile = async (name: string) => {
  const { applied, version } = fromProfile(parseIni(await lists.readProfile(name)), prefs)
  return applied ? `Loaded ${applied} settings from ${name} (profile version ${version}).` : `${name} contained no settings this version understands.`
}
/** Preferences' "Reset to defaults". The level and the divider follow the
 *  preferences on their own; there is nothing else to tell. */
const resetAll = () => resetPrefs()
const setWidth = (key: string, value: number) => { prefs.widths[key] = value === 0 ? (DEFAULT_WIDTHS[key] ?? DEFAULT_COL_WIDTH) : clampCol(value) }


const resultCount = computed(() =>
  resultGroups.value.reduce((n, g) => n + g.stations.length, 0))

/** What the area below the header shows. One decision, so "the list is empty"
 *  and "the search found nothing" cannot be confused for one another. */
const view = computed(() => bodyView({
  searching: search.active.value,
  hasResults: resultCount.value > 0,
  loading: lists.loading.value,
  hasStations: lists.current.value.stations.length > 0
}))

/** How a result row offers itself: from the directory, to be added to a list
 *  (or marked as already in one), with what the directory knows about it;
 *  from a list, to be edited. */
const resultActions = computed(() => (search.scope.value === 'directory'
  ? { details: directoryDetails.value, actionLabel: 'Add to list', actionDone: alreadySaved.value }
  : {}))

/** What an empty results area says; decided in one tested place. */
const emptyText = computed(() => emptyMessage({
  scope: search.scope.value,
  query: search.query.value,
  directoryProblem: directory.error.value !== 'none' ? directory.message() : '',
  working: directory.busy.value || dirQueued.value || search.loading.value || search.pending.value
}))

const loadMore = () => {
  void directory.search({
    query: search.query.value.trim(),
    // The directory's own count, not what is shown: some rows may have been
    // left out as unplayable here, and the next page starts after all of them.
    offset: directory.fetched.value,
    httpsOnly: prefs.directoryHttpsOnly
  })
}

/** "Open list" on a group header: leave the search and show that list. */
const openGroup = (key: string) => {
  const file = lists.files.value.find((f) => f.path === key)
  if (file) void openList(file)
}

const title = computed(() => lists.current.value.title || (lists.currentFile.value && listLabel(lists.currentFile.value)) || 'Radio')

/** Lists that can receive stations: not this one, and not a format this app does not write. */
const otherLists = computed(() =>
  lists.files.value.filter((f) => f.path !== lists.currentFile.value?.path && isWritable(f)).map((f) => f.name))
const writableLists = computed(() => lists.files.value.filter(isWritable))
const btn = { border: 0, cursor: 'pointer', font: 'inherit', borderRadius: '6px' }
/** A button that reads as a link inside a sentence. */
const linkBtn = { ...btn, background: 'none', color: 'inherit', textDecoration: 'underline', padding: 0 }
/** The banner: a notice from the last action, else the open list's own status. */
const bannerMessage = computed(() => notice.value ?? lists.status.value)
/** No stations, and no selection: one array, so the results table does not see new props on every render. */
const NONE: never[] = []
const playingUrl = computed(() => (player.state.value === 'playing' ? player.station.value?.url ?? null : null))
</script>

<template>
  <!-- The root paints its own background and text colour rather than letting
       the shell's show through. Radio may be on a different theme from the
       rest of OpenCloud, and without this only the parts that set a background
       of their own followed it: the rail, the player bar and the search field
       went dark over a light page, and the player's station name — which has
       no colour of its own — inherited the shell's dark text onto a dark bar.
       Under "System" these resolve to the shell's own values, so it costs
       nothing there. -->
  <main
    ref="root"
    :style="{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
              background: 'var(--oc-role-background)', color: 'var(--oc-role-on-background)' }"
  >
    <div :style="{ display: 'flex', flex: 1, minHeight: 0 }">
      <aside
        v-if="!narrow" ref="rail"
        :style="{ width: `${railWidth}px`, flex: 'none', minWidth: 0, display: 'flex', flexDirection: 'column',
                  minHeight: 0, background: 'var(--oc-role-surface-container-low)' }"
      >
        <h2 :style="{ fontSize: '11.5px', fontWeight: 600, margin: '16px 16px 8px', color: 'var(--oc-role-on-surface-variant)' }">Station lists</h2>
        <button
          v-for="file in lists.files.value" :key="file.path" type="button"
          :style="{ ...btn, display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 14px', margin: '0 8px 2px',
                    textAlign: 'left', width: 'calc(100% - 16px)',
                    background: file.path === lists.currentFile.value?.path ? 'var(--oc-role-secondary-container)' : 'transparent',
                    color: file.path === lists.currentFile.value?.path ? 'var(--oc-role-on-secondary-container)' : 'var(--oc-role-on-surface)',
                    fontWeight: file.path === lists.currentFile.value?.path ? 600 : 400 }"
          @click="openList(file)"
        ><span :style="{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }">{{ listLabel(file) }}</span></button>
        <button type="button" :style="{ ...btn, display: 'flex', gap: '10px', padding: '8px 14px', margin: '4px 8px 2px', textAlign: 'left',
                                        background: 'transparent', color: 'var(--oc-role-on-surface-variant)' }"
                @click="dialog = { kind: 'list', mode: 'create' }">+ New list</button>
        <div :style="{ flex: 1 }" />
        <p :style="{ padding: '12px 16px', fontSize: '12px', color: 'var(--oc-role-on-surface-variant)' }">
          Stored in <b>{{ config.rootFolder }}/</b> in your personal space.</p>
      </aside>

      <div
        v-if="!narrow" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Resize station list"
        :aria-valuenow="railWidth" :aria-valuemin="MIN_RAIL" :aria-valuemax="MAX_RAIL" title="Drag to resize · double-click to reset"
        :style="{ flex: 'none', width: '9px', cursor: 'col-resize', borderLeft: '1px solid var(--oc-role-outline-variant)', touchAction: 'none' }"
        @pointerdown="onSplitDown" @pointermove="onSplitMove" @pointerup="onSplitUp" @pointercancel="onSplitUp"
        @dblclick="setRail(DEFAULT_RAIL)" @keydown="onSplitKey"
      />

      <section :style="{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
                         borderLeft: narrow ? 0 : '1px solid var(--oc-role-outline-variant)', marginLeft: narrow ? 0 : '-1px' }">
        <div :style="{ display: 'flex', alignItems: 'center', gap: '12px', padding: '18px 24px 14px', flexWrap: 'wrap' }">
          <div :style="{ flex: 1, minWidth: '160px' }">
            <!-- Narrow: the rail is gone, and with it "New list"; the select stands in for one and the button for the other. -->
            <div v-if="narrow" :style="{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }">
              <select
                :value="lists.currentFile.value?.path" aria-label="Station list"
                :style="{ font: 'inherit', fontSize: '18px', fontWeight: 600, background: 'none', border: 0, color: 'inherit', minWidth: 0, maxWidth: '100%' }"
                @change="openList(lists.files.value.find((f) => f.path === ($event.target as HTMLSelectElement).value)!)"
              ><option v-for="f in lists.files.value" :key="f.path" :value="f.path">{{ listLabel(f) }}</option></select>
              <button type="button" aria-label="New list"
                      :style="{ ...btn, background: 'none', padding: '2px 6px', flex: 'none', fontSize: '12.5px',
                                textDecoration: 'underline', color: 'var(--oc-role-on-surface-variant)' }"
                      @click="dialog = { kind: 'list', mode: 'create' }">+ New</button>
            </div>
            <h1 v-else :style="{ fontSize: '20px', fontWeight: 600, margin: 0 }">
              {{ search.active.value ? 'Search' : title }}</h1>
            <p v-if="search.active.value"
               :style="{ fontSize: '12.5px', margin: 0, color: 'var(--oc-role-on-surface-variant)' }">
              {{ resultCount }} {{ resultCount === 1 ? 'match' : 'matches' }}<template
                v-if="search.scope.value === 'all'"> in {{ resultGroups.length }} of
                {{ lists.files.value.length }} lists</template>
            </p>
            <p v-else :style="{ fontSize: '12.5px', margin: 0, color: 'var(--oc-role-on-surface-variant)' }">
              {{ lists.current.value.stations.length }} station{{ lists.current.value.stations.length === 1 ? '' : 's' }}
              <template v-if="lists.currentFile.value"> · {{ lists.currentFile.value.name }}
                · <button type="button" :style="linkBtn"
                          @click="dialog = { kind: 'list', mode: 'rename' }">rename</button>
                · <button type="button" :style="linkBtn"
                          @click="dialog = { kind: 'list', mode: 'delete' }">delete</button><template
                  v-if="!lists.readOnly.value && lists.current.value.stations.length">
                · <button type="button" :style="linkBtn"
                          @click="dialog = { kind: 'servers' }">find backup servers</button></template></template>
            </p>
          </div>
          <button
            v-if="search.active.value" type="button"
            :style="{ ...btn, background: 'none', padding: 0, flex: 'none', whiteSpace: 'nowrap',
                      fontSize: '12.5px', textDecoration: 'underline', color: 'var(--oc-role-on-surface)' }"
            @click="search.clear()"
          >Clear search</button>
          <SearchField
            v-model="search.query.value" :scope="search.scope.value"
            :directory-enabled="config.directoryEnabled" :https-only="prefs.directoryHttpsOnly"
            @update:scope="(s) => (search.scope.value = s)"
            @update:https-only="(v) => (prefs.directoryHttpsOnly = v)"
          />
          <ColumnsMenu :columns="prefs.columns" :hidden="hiddenColumns"
                       @toggle="(k, v) => (prefs.columns[k] = v)" @reset="resetColumns" />
          <oc-button appearance="outline" aria-label="Preferences" @click="dialog = { kind: 'prefs' }">⚙</oc-button>
          <oc-button appearance="outline" @click="dialog = { kind: 'import' }">Import</oc-button>
          <oc-button appearance="filled" color-role="primary" @click="addStation">Add station</oc-button>
        </div>

        <p v-if="lists.readOnly.value && !search.active.value" role="note"
           :style="{ margin: '0 24px 10px', ...banner('ok') }">
          This is a {{ lists.currentFile.value?.name.split('.').pop() }} file. Radio plays it but only writes .m3u8, so it cannot be edited here.
          <button type="button" :style="linkBtn"
                  @click="convertList">Save a copy as .m3u8</button></p>

        <!-- What was just done, or failing that what the store has to say about
             the open list; each in its own tone. -->
        <p v-if="bannerMessage" role="status" :style="{ margin: '0 24px 10px', ...banner(bannerMessage.tone) }">
          {{ bannerMessage.text }}</p>

        <div :style="{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 12px' }">
          <!-- No buttons here: Add station and Import are already in the header,
               and repeating them makes the empty list look like a different screen. -->
          <div
            v-if="view === 'no-results'"
            :style="{ height: '100%', display: 'grid', placeItems: 'center', padding: '24px 12px' }"
          >
            <p :style="{ margin: 0, maxWidth: '40ch', textAlign: 'center', fontSize: '15.5px',
                         lineHeight: 1.5, color: 'var(--oc-role-on-surface-variant)' }">
              {{ emptyText }}
            </p>
          </div>

          <div v-else-if="view === 'empty-list'"
               :style="{ height: '100%', display: 'grid', placeItems: 'center', padding: '24px 12px' }">
            <p :style="{ margin: 0, maxWidth: '38ch', textAlign: 'center', fontSize: '15.5px',
                         lineHeight: 1.5, color: 'var(--oc-role-on-surface-variant)' }">
              {{ lists.files.value.length ? 'This list is empty.' : 'No stations yet.' }}
              Add a station or import a playlist to get started.</p>
          </div>
          <!-- Search is a finder: grouped results, no selection, no reordering. -->
          <StationTable
            v-else-if="view === 'results'"
            :stations="NONE" :groups="resultGroups" :columns="columns" :widths="prefs.widths"
            :window-key="`${search.scope.value}:${search.query.value.trim()}`"
            :playing-url="playingUrl"
            :states="states" :last-played="lastPlayed" :selected="NONE"
            v-bind="resultActions"
            @play="playResult" @width="setWidth" @action="onResultAction"
            @open-group="openGroup"
          />
          <StationTable
            v-else
            :stations="lists.current.value.stations" :columns="columns" :widths="prefs.widths"
            :window-key="lists.currentFile.value?.path"
            :playing-url="playingUrl"
            :states="states" :last-played="lastPlayed" :selected="selection" :read-only="lists.readOnly.value"
            @play="play" @width="setWidth" @update:selected="(ids) => (selection = ids)"
            @edit="(s) => (dialog = { kind: 'station', station: s })" @move="move"
          />
        </div>

        <div
          v-if="search.scope.value === 'directory' && resultGroups.length && !directory.exhausted.value"
          :style="{ padding: '10px 24px 18px' }"
        >
          <oc-button appearance="outline" :disabled="directory.busy.value"
                     @click="loadMore">Show {{ config.directoryPageSize }} more</oc-button>
        </div>

        <PlayerBar
          :station="player.station.value" :state="player.state.value" :error="player.error.value"
          :volume="player.volume.value" :muted="player.muted.value"
          :show-scope="analysing" :show-logo="columns.logo !== false" :now-playing="nowPlaying.title.value"
          :server-count="player.serverCount.value" :current-server="player.currentServer.value" :servers="player.servers.value"
          :mount-scope="scope.mount"
          :selection-count="selection.length" :can-move="otherLists.length > 0"
          @toggle="player.toggle()" @volume="player.setVolume" @muted="player.setMuted"
          @move="dialog = { kind: 'move' }" @copy="copyAddresses" @remove="removeSelected"
          @clear="selection = []"
        />
      </section>
    </div>

    <StationForm v-if="dialog.kind === 'station'" :station="dialog.station" :groups="groups" :find-servers="findServers"
                 :reads-playlists="config.maxPlaylistDepth > 0" @save="onStationSave" @remove="onStationRemove" @close="close" />
    <BackupServersDialog v-if="dialog.kind === 'servers'" :stations="lists.current.value.stations" :find-servers="findServers"
                         @apply="applyServers" @close="close" />
    <ImportDialog v-if="dialog.kind === 'import'" @import="onImport" @close="close" />
    <PreferencesDialog v-if="dialog.kind === 'prefs'" :prefs="prefs" :root-folder="config.rootFolder"
                       :settings-folder="config.settingsFolder" :backup-folder="config.backupFolder" :hidden-columns="hiddenColumns"
                       :directory-enabled="config.directoryEnabled" :can-choose-theme="canChooseTheme"
                       :directory-reporting-allowed="config.directoryReportClicks"
                       :list-profiles="lists.listProfiles" :save-profile="saveProfile" :load-profile="loadProfile"
                       @reset="resetAll" @close="close" />
    <ListDialog v-if="dialog.kind === 'list'" :mode="dialog.mode" :current="lists.currentFile.value?.name"
                @confirm="onListConfirm" @close="close" />
    <AddToList
      v-if="adding" :name="adding.station.name" :files="writableLists"
      :current="lists.currentFile.value?.path ?? null" :x="adding.x" :y="adding.y"
      @add="addToList" @new-list="pendingAdd = adding.station; adding = null; dialog = { kind: 'list', mode: 'create' }"
      @close="adding = null"
    />
    <ListDialog v-if="dialog.kind === 'move'" mode="move" :choices="otherLists" :count="selection.length"
                @confirm="onListConfirm" @close="close" />
  </main>
</template>
