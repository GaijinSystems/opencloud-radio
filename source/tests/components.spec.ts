import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { mount, buttonNamed } from './support/mount'
import ColumnChecklist from '../src/components/ColumnChecklist.vue'
import ColumnsMenu from '../src/components/ColumnsMenu.vue'
import StationTable from '../src/components/StationTable.vue'
import StationRow from '../src/components/StationRow.vue'
import PreferencesDialog from '../src/components/PreferencesDialog.vue'
import SearchField from '../src/components/SearchField.vue'
import ListDialog from '../src/components/ListDialog.vue'
import StationForm from '../src/components/StationForm.vue'
import PlayerBar from '../src/components/PlayerBar.vue'
import RadioDialog from '../src/components/RadioDialog.vue'
import ImportDialog from '../src/components/ImportDialog.vue'
import { applyThemeTo, themeVars } from '../src/helpers/theme'
import { historyKey } from '../src/helpers/safeUrl'
import type { Station } from '../src/parsers/types'

/**
 * These components carry decisions of their own — which cells a row draws,
 * whether a dialog closes, what a picker offers — and until 1.1.8 none of
 * them had a test. The theme regression in 1.1.6 was exactly the kind of
 * thing that gap lets through: the helper was proved correct in isolation
 * while the page it produced was never looked at.
 */

const station = (over: Partial<Station> = {}): Station =>
  ({ id: 's1', name: 'Groove Salad', url: 'https://ice.example/gs', ...over })

const tableProps = (over: Record<string, unknown> = {}) => ({
  stations: [station()], columns: { logo: false, home: false, network: true, group: true, played: true, state: true },
  widths: {}, playingUrl: null, states: {}, lastPlayed: {}, selected: [], ...over
})

describe('ColumnChecklist', () => {
  it('draws the disabled Station parent once and hides what the instance turned off', () => {
    const host = mount(ColumnChecklist, { columns: { logo: true, home: true, network: true }, hidden: ['logo'] })
    const boxes = [...host.querySelectorAll('input[type=checkbox]')] as HTMLInputElement[]
    expect(boxes.filter((b) => b.disabled)).toHaveLength(1)          // the Station stand-in
    expect(host.textContent).not.toContain('Station logo')            // hidden for the instance
    expect(host.textContent).toContain('Homepage link')
  })

  it('reports which column was toggled, and to what', async () => {
    const seen: Array<[string, boolean]> = []
    const host = mount(ColumnChecklist, {
      columns: { network: true }, onToggle: (k: string, v: boolean) => seen.push([k, v])
    })
    const network = [...host.querySelectorAll('input[type=checkbox]')]
      .find((b) => b.parentElement?.textContent?.includes('Network')) as HTMLInputElement
    network.checked = false
    network.dispatchEvent(new Event('change'))
    await nextTick()
    expect(seen).toEqual([['network', false]])
  })
})

describe('ColumnsMenu', () => {
  it('opens, and closes again on a click anywhere else — a menu left open covers the table', async () => {
    const host = mount(ColumnsMenu, { columns: { network: true } })
    const opener = host.querySelector('button') as HTMLButtonElement
    expect(host.textContent).not.toContain('Show these columns')
    opener.click(); await nextTick()
    expect(host.textContent).toContain('Show these columns')
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(host.textContent).not.toContain('Show these columns')
  })

  it('escape closes it too', async () => {
    const host = mount(ColumnsMenu, { columns: {} })
    ;(host.querySelector('button') as HTMLButtonElement).click(); await nextTick()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(host.textContent).not.toContain('Show these columns')
  })

  it('hides a column the instance switched off, the same as Preferences does', async () => {
    const host = mount(ColumnsMenu, { columns: { logo: true }, hidden: ['logo'] })
    ;(host.querySelector('button') as HTMLButtonElement).click(); await nextTick()
    expect(host.textContent).not.toContain('Station logo')
  })
})

describe('StationRow', () => {
  it('draws only the cells the grid names', () => {
    const host = mount(StationRow, {
      station: station({ network: 'SomaFM' }), grid: ['station', 'network', 'actions'],
      columns: {}, playing: false, state: 'untested', now: Date.now()
    })
    expect(host.textContent).toContain('SomaFM')
    expect(host.querySelectorAll('td')).toHaveLength(3)
  })

  it('a station that cannot play in a browser has its play button disabled', () => {
    const host = mount(StationRow, {
      station: station({ url: 'http://insecure.example/s' }), grid: ['station', 'state', 'actions'],
      columns: {}, playing: false, state: 'blocked', now: Date.now()
    })
    expect((host.querySelector('button') as HTMLButtonElement).disabled).toBe(true)
    expect(host.textContent).toContain('Blocked')
  })

  it('shows the backup-server count only in a list, never in results', () => {
    const props = {
      station: station({ alternates: ['https://b/1', 'https://c/1'] }),
      grid: ['station', 'actions'], columns: {}, playing: false, state: 'untested', now: Date.now()
    }
    expect(mount(StationRow, props).textContent).toContain('3 servers')
    expect(mount(StationRow, { ...props, finder: true, actionLabel: 'Add to list' }).textContent).not.toContain('3 servers')
  })
})

describe('StationTable', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('relative times move on their own, without another render to prompt them', async () => {
    const host = mount(StationTable, tableProps({ lastPlayed: { 'https://ice.example/gs': Date.now() } }))
    expect(host.textContent).toContain('Just now')
    await vi.advanceTimersByTimeAsync(60_000)
    await nextTick()
    expect(host.textContent).toContain('1 min ago')
  })

  it('a result set offers no selection and no reordering: both belong to a list', () => {
    const list = mount(StationTable, tableProps())
    expect(list.querySelectorAll('input[type=checkbox]').length).toBeGreaterThan(0)
    const found = mount(StationTable, tableProps({
      stations: [], groups: [{ key: 'k', label: 'Rock', meta: '1 match', stations: [station()] }], actionLabel: 'Edit'
    }))
    expect(found.querySelectorAll('input[type=checkbox]')).toHaveLength(0)
    expect(found.textContent).toContain('ROCK')
  })

  it('a long list is drawn a batch at a time, and all of it on request', async () => {
    const many = Array.from({ length: 450 }, (_, i) => station({ id: `s${i}`, name: `Station ${i}`, url: `https://a/${i}` }))
    const host = mount(StationTable, tableProps({ stations: many }))
    expect(host.querySelectorAll('tbody tr:not(.more)')).toHaveLength(200)
    expect(host.textContent).toContain('200 of 450 shown')
    const all = buttonNamed(host, 'Show all 450')
    all.click(); await nextTick()
    expect(host.querySelectorAll('tbody tr:not(.more)')).toHaveLength(450)
    expect(host.textContent).not.toContain('shown ·')
    // Select-all still means the whole list, drawn or not.
    const seen: string[][] = []
    const again = mount(StationTable, tableProps({ stations: many, 'onUpdate:selected': (ids: string[]) => seen.push(ids) }))
    const box = again.querySelector('input[aria-label="Select all stations"]') as HTMLInputElement
    box.checked = true; box.dispatchEvent(new Event('change'))
    expect(seen[0]).toHaveLength(450)
  })

  it('the next batch is drawn when the end of the last one scrolls into view', async () => {
    let seen: ((entries: Array<{ isIntersecting: boolean }>) => void) | undefined
    const observed: Element[] = []
    const disconnected: number[] = []
    ;(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
      constructor(cb: typeof seen) { seen = cb }
      observe(el: Element) { observed.push(el) }
      disconnect() { disconnected.push(1) }
    }
    try {
      const many = Array.from({ length: 450 }, (_, i) => station({ id: `s${i}`, url: `https://a/${i}` }))
      const host = mount(StationTable, tableProps({ stations: many }))
      await nextTick()
      expect(observed[0]?.classList.contains('more')).toBe(true)  // it watches the "N of M shown" row
      seen!([{ isIntersecting: false }]); await nextTick()
      expect(host.querySelectorAll('tbody tr:not(.more)')).toHaveLength(200)
      seen!([{ isIntersecting: true }]); await nextTick()
      expect(host.querySelectorAll('tbody tr:not(.more)')).toHaveLength(400)
      seen!([{ isIntersecting: true }]); await nextTick()
      expect(host.querySelectorAll('tbody tr:not(.more)')).toHaveLength(450)
      expect(host.querySelector('tr.more')).toBeNull()             // all drawn: the row goes…
      expect(disconnected.length).toBeGreaterThan(0)              // …and so does its observer
    } finally {
      delete (globalThis as unknown as { IntersectionObserver?: unknown }).IntersectionObserver
    }
  })

  it('results are drawn in batches across their groups, a group cut where the batch ends', () => {
    const group = (k: string, n: number) => ({ key: k, label: k, meta: '', stations:
      Array.from({ length: n }, (_, i) => station({ id: `${k}${i}`, name: `${k} ${i}`, url: `https://${k}/${i}` })) })
    const host = mount(StationTable, tableProps({ stations: [], actionLabel: 'Edit', groups: [group('a', 150), group('b', 150), group('c', 10)] }))
    expect(host.querySelectorAll('tbody tr:not(.grp):not(.more)')).toHaveLength(200)
    expect(host.textContent).toContain('B ·')
    expect(host.textContent).not.toContain('C ·')
    expect(host.textContent).toContain('200 of 310 shown')
  })

  it('a width being dragged re-renders the column definitions, not the table', async () => {
    const { reactive } = await import('vue')
    const widths = reactive<Record<string, number>>({ station: 300 })
    let tableUpdates = 0
    const host = mount(StationTable, tableProps({
      stations: Array.from({ length: 50 }, (_, i) => station({ id: `s${i}`, url: `https://a/${i}` })),
      widths, onVnodeUpdated: () => { tableUpdates++ }
    }))
    widths.station = 420
    await nextTick()
    expect([...host.querySelectorAll('col')].map((c) => (c as HTMLElement).style.width)).toContain('420px')
    expect(tableUpdates).toBe(0)
  })

  it('a read-only list shows no editing controls at all', () => {
    const host = mount(StationTable, tableProps({ readOnly: true }))
    expect(host.querySelectorAll('input[type=checkbox]')).toHaveLength(0)
    expect(host.textContent).not.toContain('Edit')
  })
})

describe('the verdict a row shows is decided where it is drawn', () => {
  it('a station this device has played reads Ready wherever the row comes from, with nothing seeded', () => {
    const played = { 'https://ice.example/gs': Date.now() - 3 * 60_000 }
    const list = mount(StationTable, tableProps({ lastPlayed: played }))
    expect(list.textContent).toContain('Ready')
    const found = mount(StationTable, tableProps({
      stations: [], lastPlayed: played, actionLabel: 'Edit',
      groups: [{ key: 'k', label: 'Rock', meta: '1 match', stations: [station()] }]
    }))
    expect(found.textContent).toContain('Ready') // a search result was "Not played yet" beside "3 min ago"
    expect(mount(StationTable, tableProps()).textContent).toContain('Not played yet')
  })

  it('what the session saw comes first, and history is found under the key the device stores', () => {
    const s = station({ url: 'https://user:pw@ice.example/gs?token=abc' })
    const played = { [historyKey(s.url)]: Date.now() }
    const host = mount(StationTable, tableProps({ stations: [s], lastPlayed: played }))
    expect(host.textContent).toContain('Ready')
    // The same path under another token is another address, with no history of its own.
    const other = station({ url: 'https://ice.example/gs?token=xyz' })
    expect(mount(StationTable, tableProps({ stations: [other], lastPlayed: played })).textContent).toContain('Not played yet')
    const failed = mount(StationTable, tableProps({ stations: [s], states: { [s.url]: 'failed' }, lastPlayed: played }))
    expect(failed.textContent).toContain('No response')
  })

  it('an address that is the name of something every object has is just an address', () => {
    const odd = station({ url: 'constructor' })
    const host = mount(StationTable, tableProps({ stations: [odd] }))
    expect(host.textContent).toContain('No response') // `failed`: not a URL. Not a function from Object.prototype.
    expect(host.textContent).not.toContain('ago')     // and never played: not "NaN days ago" from an inherited value
  })
})

describe('PreferencesDialog', () => {
  const props = {
    prefs: { columns: {}, widths: {}, railWidth: 268, theme: 'system', resume: true, retries: 5, backupKeep: 5,
             metadata: false, analyser: true, directoryReportClicks: false, directoryHttpsOnly: false,
             volume: 0.72, muted: false, lastList: '', lastStation: '' },
    rootFolder: 'Radio', settingsFolder: 'Settings', backupFolder: 'Backups',
    directoryEnabled: false, directoryReportingAllowed: false, canChooseTheme: true,
    listProfiles: async () => [], saveProfile: async () => {}, loadProfile: async () => ''
  }

  it('offers "do not retry", which the code always accepted but the picker could not reach', () => {
    const host = mount(PreferencesDialog, props)
    const values = [...host.querySelectorAll('option')].map((o) => (o as HTMLOptionElement).value)
    expect(values).toContain('0')
  })

  it('an instance with one theme cannot be asked for another', () => {
    const one = mount(PreferencesDialog, { ...props, canChooseTheme: false })
    const themeButtons = [...one.querySelectorAll('button')].filter((b) => ['Light', 'Dark'].includes(b.textContent!.trim()))
    expect(themeButtons).toHaveLength(2)
    expect(themeButtons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true)
    expect(one.textContent).toContain('offers one theme')
  })

  it('names the folders the administrator actually configured', () => {
    const host = mount(PreferencesDialog, { ...props, rootFolder: 'Stations', backupFolder: 'Copies' })
    expect(host.textContent).toContain('Stations/Copies/')
  })
})

describe('SearchField', () => {
  it('slash focuses the field, as in every reader and file manager', () => {
    const host = mount(SearchField, { modelValue: '', scope: 'all', directoryEnabled: false, httpsOnly: false })
    const input = host.querySelector('input') as HTMLInputElement
    expect(document.activeElement).not.toBe(input)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }))
    expect(document.activeElement).toBe(input)
  })

  it('leaves slash alone while a dialog is up', () => {
    const host = mount(SearchField, { modelValue: '', scope: 'all', directoryEnabled: false, httpsOnly: false })
    const modal = document.createElement('div'); modal.setAttribute('aria-modal', 'true'); document.body.appendChild(modal)
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }))
      expect(document.activeElement).not.toBe(host.querySelector('input'))
    } finally { modal.remove() }
  })

  it('escape clears rather than merely blurring', () => {
    const seen: string[] = []
    const host = mount(SearchField, {
      modelValue: 'jazz', scope: 'all', directoryEnabled: false, httpsOnly: false,
      'onUpdate:modelValue': (v: string) => seen.push(v)
    })
    const input = host.querySelector('input') as HTMLInputElement
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(seen).toEqual([''])
  })

  it('offers the directory only where the instance has enabled it', async () => {
    // The menu renders a tick after the click; asserting before it had drawn
    // made the "not offered" half true whatever the setting was.
    const off = mount(SearchField, { modelValue: '', scope: 'all', directoryEnabled: false, httpsOnly: false })
    ;(off.querySelector('button') as HTMLButtonElement).click(); await nextTick()
    expect(off.querySelector('[role=menu]')!.textContent).toContain('All lists')
    expect(off.textContent).not.toContain('Online directory')

    const on = mount(SearchField, { modelValue: '', scope: 'all', directoryEnabled: true, httpsOnly: false })
    ;(on.querySelector('button') as HTMLButtonElement).click(); await nextTick()
    expect(on.textContent).toContain('Online directory')
  })
})

describe('ListDialog', () => {
  it('a delete names the file and does not ask for a value', async () => {
    const seen: string[] = []
    const host = mount(ListDialog, { mode: 'delete', current: 'Favourites.m3u8', onConfirm: (v: string) => seen.push(v) })
    expect(host.textContent).toContain('Favourites.m3u8')
    expect(host.querySelector('input')).toBeNull()
    const del = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Delete') as HTMLButtonElement
    del.click(); await nextTick()
    expect(seen).toEqual([''])
  })

  it('a rename starts from the current name without its extension', () => {
    const host = mount(ListDialog, { mode: 'rename', current: 'Late Night.m3u8' })
    expect((host.querySelector('input') as HTMLInputElement).value).toBe('Late Night')
  })
})

describe('StationForm', () => {
  it('will not save an address that is not one', () => {
    const host = mount(StationForm, { station: null, groups: [] })
    const save = buttonNamed(host, 'Add station')
    expect(save.disabled).toBe(true)
  })

  it('refuses to save at all while the homepage is not a web address', async () => {
    const saved: Array<Record<string, unknown>> = []
    const host = mount(StationForm, {
      station: { id: 'x', name: 'S', url: 'https://a/1', homepage: 'javascript:alert(1)' },
      groups: [], onSave: (s: Record<string, unknown>) => saved.push(s)
    })
    const save = buttonNamed(host, 'Save changes')
    expect(save.disabled).toBe(true)
    expect(host.textContent).toContain('https:// or http://')
    save.click(); await nextTick()
    expect(saved).toHaveLength(0) // the parse-time gate is for files; here it never gets that far
  })

  it('saves a station once the address is one, carrying the fields through', async () => {
    const saved: Array<Record<string, unknown>> = []
    const host = mount(StationForm, {
      station: { id: 'x', name: 'S', url: 'https://a/1', homepage: 'https://example.org' },
      groups: [], onSave: (s: Record<string, unknown>) => saved.push(s)
    })
    const save = buttonNamed(host, 'Save changes')
    expect(save.disabled).toBe(false)
    save.click(); await nextTick()
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ url: 'https://a/1', name: 'S', homepage: 'https://example.org' })
  })

  it("keeps a now-playing address, https only, and refuses one that is not", async () => {
    const saved: Array<Record<string, unknown>> = []
    const at = 'https://cadence.nprstations.org/api/cadence/widget/2edfb643-4010-4f9e-a6f8-78b08d5dbc2d?show_song=true'
    const host = mount(StationForm, { station: { id: 'x', name: 'KCUR', url: 'https://kcur.streamguys1.com/kcur-website-icy' },
      groups: [], onSave: (s: Record<string, unknown>) => saved.push(s) })
    const field = host.querySelector('#st-nowplaying') as HTMLInputElement
    field.value = 'http://plain.example/np'; field.dispatchEvent(new Event('input')); await nextTick()
    expect(buttonNamed(host, 'Save changes').disabled).toBe(true)
    expect(host.textContent).toContain('Needs to start with https://')
    field.value = at; field.dispatchEvent(new Event('input')); await nextTick()
    buttonNamed(host, 'Save changes').click(); await nextTick()
    expect(saved[0].nowPlaying).toBe(at)
  })

  it('emits the address it validated, not the raw field', async () => {
    const saved: Array<Record<string, unknown>> = []
    const host = mount(StationForm, {
      station: { id: 'x', name: 'S', url: 'https://a/with space' },
      groups: [], onSave: (s: Record<string, unknown>) => saved.push(s)
    })
    const save = buttonNamed(host, 'Save changes')
    save.click(); await nextTick()
    expect(saved[0].url).toBe('https://a/with%20space') // what `safeUrl` passed, byte for byte
  })
})

describe('PlayerBar', () => {
  const props = {
    station: station(), state: 'idle', error: '', volume: 0.5, muted: false, showScope: false, showLogo: false,
    nowPlaying: '', serverCount: 1, currentServer: '', servers: [] as string[], mountScope: () => {}, selectionCount: 0, canMove: false
  }

  it('the button says Stop only while something is actually running', () => {
    expect(mount(PlayerBar, props).querySelector('button')!.getAttribute('aria-label')).toBe('Play')
    expect(mount(PlayerBar, { ...props, state: 'playing' }).querySelector('button')!.getAttribute('aria-label')).toBe('Stop')
    // `resume` is a paused player asking for a gesture; that tap must play.
    expect(mount(PlayerBar, { ...props, state: 'resume' }).querySelector('button')!.getAttribute('aria-label')).toBe('Play')
  })

  it('muting parks the slider at zero without losing the level', () => {
    const host = mount(PlayerBar, { ...props, muted: true })
    expect((host.querySelector('input[type=range]') as HTMLInputElement).value).toBe('0')
  })

  it('moving the slider while muted unmutes, because that is what moving it means', async () => {
    const events: string[] = []
    const host = mount(PlayerBar, {
      ...props, muted: true,
      onMuted: (v: boolean) => events.push(`muted:${v}`), onVolume: (v: number) => events.push(`volume:${v}`)
    })
    const slider = host.querySelector('input[type=range]') as HTMLInputElement
    slider.value = '40'
    slider.dispatchEvent(new Event('input'))
    await nextTick()
    expect(events).toEqual(['muted:false', 'volume:0.4'])
  })

  it('says which server is in use only when there is more than one', () => {
    const many = mount(PlayerBar, {
      ...props, state: 'playing', serverCount: 3, servers: ['https://a/1', 'https://b/1', 'https://c/1'],
      station: station({ alternates: ['https://b/1', 'https://c/1'] }), currentServer: 'https://b/1'
    })
    expect(many.textContent).toContain('server 2 of 3')
    expect(mount(PlayerBar, { ...props, state: 'playing' }).textContent).not.toContain('server 1 of')
  })
})

describe('RadioDialog', () => {
  it('escape closes', () => {
    let closed = 0
    mount(RadioDialog, { title: 'T', onClose: () => closed++ })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(closed).toBe(1)
  })

  it('a selection begun inside and released on the backdrop does not close it', async () => {
    let closed = 0
    const host = mount(RadioDialog, { title: 'T', onClose: () => closed++ })
    const backdrop = host.firstElementChild as HTMLElement
    const panel = backdrop.querySelector('[role=dialog]') as HTMLElement

    panel.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(closed).toBe(0) // the press started inside; this is a drag, not a dismissal

    backdrop.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(closed).toBe(1)
  })
})

describe('the station form on a playlist link', () => {
  const noteFor = async (url: string, more: Record<string, unknown> = {}) => {
    const host = mount(StationForm, { station: { id: 'x', name: 'X', url }, groups: [], ...more })
    await nextTick()
    return host.textContent ?? ''
  }
  it('says saving reads it, where this site reads playlists', async () => {
    expect(await noteFor('https://x.example/live.pls')).toContain('saving reads it and keeps the servers it lists')
  })
  it('says to use Import where this site does not, or for an ASX file it never reads', async () => {
    expect(await noteFor('https://x.example/live.pls', { readsPlaylists: false })).toContain('Use Import to read it')
    expect(await noteFor('https://x.example/live.asx')).toContain('Use Import to read it')
  })
})

describe('ImportDialog', () => {
  /** The "one station on several servers" box. */
  const combineBox = (host: HTMLElement) => [...host.querySelectorAll('input[type=checkbox]')].find(
    (b) => b.parentElement?.textContent?.includes('servers')) as HTMLInputElement
  const parse = (text: string) => ({
    stations: text.trim().split('\n').map((l, i) => ({ id: `i${i}`, name: l.split('|')[0], url: l.split('|')[1] })),
    trailing: []
  })
  const paste = async (host: HTMLElement, text: string) => {
    const area = host.querySelector('textarea') as HTMLTextAreaElement
    area.value = text
    area.dispatchEvent(new Event('input'))
    await nextTick()
  }

  it('recognises one station on several servers in pasted text, not only in a chosen file', async () => {
    const host = mount(ImportDialog, { parse })
    await paste(host, 'Groove Salad (#1)|https://a/1\nGroove Salad (#2)|https://b/1')
    const combine = combineBox(host)
    expect(combine.checked).toBe(true)
  })

  it('leaves a genuine multi-station list alone', async () => {
    const host = mount(ImportDialog, { parse })
    await paste(host, 'Groove Salad|https://a/1\nDrone Zone|https://b/1')
    const combine = combineBox(host)
    expect(combine.checked).toBe(false)
  })

  it('stops following the detection once the user has had their say', async () => {
    const host = mount(ImportDialog, { parse })
    await paste(host, 'Groove Salad (#1)|https://a/1\nGroove Salad (#2)|https://b/1')
    const combine = combineBox(host)
    combine.checked = false
    combine.dispatchEvent(new Event('change'))
    await nextTick()
    await paste(host, 'Drone Zone (#1)|https://a/2\nDrone Zone (#2)|https://b/2')
    expect(combine.checked).toBe(false) // still the user's answer, not the detector's
  })
  it('combined, a playlist link among the servers takes none of the ten places', async () => {
    let imported: { stations: Array<{ url: string; alternates?: string[] }> } | undefined
    const host = mount(ImportDialog, { parse, onImport: (list: typeof imported) => { imported = list } })
    const lines = [...Array.from({ length: 10 }, (_, i) => `KCUR (#${i + 1})|https://l.example/${i}.pls`), 'KCUR (#11)|http://s.example/live']
    await paste(host, lines.join('\n'))
    expect(combineBox(host).checked).toBe(true)
    buttonNamed(host, 'Import')!.click()
    await nextTick()
    expect(imported?.stations).toHaveLength(1)
    expect(imported!.stations[0].url).toBe('http://s.example/live')
    expect(imported!.stations[0].alternates ?? []).toEqual([])
  })
})

describe('the theme is put on an element, and taken off it', () => {
  const light = { isDark: false, designTokens: { roles: { primary: '#fff', surface: '#fafafa', onSurface: '#111' } } }
  const dark = { isDark: true, designTokens: { roles: { primary: '#000', surface: '#111', onSurface: '#eee' } } }

  it('paints the properties the page itself is drawn from', () => {
    const el = document.createElement('div')
    const set = applyThemeTo(el, dark)
    expect(el.style.getPropertyValue('--oc-role-primary')).toBe('#000')
    // The two that decide the page. Without these the list area kept the
    // shell's background while the rail and player bar went dark.
    expect(el.style.getPropertyValue('--oc-role-background')).toBe('#111')
    expect(el.style.getPropertyValue('--oc-role-on-background')).toBe('#eee')
    expect(set).toEqual(Object.keys(themeVars(dark)))
  })

  it('takes off exactly what it put on, and nothing else', () => {
    const el = document.createElement('div')
    el.style.setProperty('--oc-role-primary', 'theirs')
    el.style.setProperty('--not-ours', 'keep me')
    const set = applyThemeTo(el, light, [])
    applyThemeTo(el, null, set)
    expect(el.style.getPropertyValue('--oc-role-primary')).toBe('')   // handed back to :root
    expect(el.style.getPropertyValue('--not-ours')).toBe('keep me')
  })

  it('switching themes leaves nothing of the previous one behind', () => {
    const el = document.createElement('div')
    const odd = { isDark: true, designTokens: { roles: { primary: '#000', tertiary: '#abc' } } }
    const first = applyThemeTo(el, odd, [])
    expect(el.style.getPropertyValue('--oc-role-tertiary')).toBe('#abc')
    applyThemeTo(el, light, first)
    expect(el.style.getPropertyValue('--oc-role-tertiary')).toBe('') // light names no tertiary
    expect(el.style.getPropertyValue('--oc-role-primary')).toBe('#fff')
  })
})
