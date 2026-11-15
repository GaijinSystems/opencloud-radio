import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from './support/mount'
import AddToList from '../src/components/AddToList.vue'
import { useSearch, matches } from '../src/composables/useSearch'
import { parseM3u, serializeM3u } from '../src/parsers/m3u'
import { parseXspf } from '../src/parsers/xspf'
import { safeUrl, redact, historyKey } from '../src/helpers/safeUrl'
import { readHistory } from '../src/helpers/history'
import { parsePlaylist } from '../src/parsers'
import { isDirectoryHost } from '../src/composables/useDirectory'
import { toStation } from '../src/helpers/directory'
import { classify } from '../src/helpers/classify'
import { bodyView, emptyMessage } from '../src/helpers/view'
import { kebab, themeVars, pickTheme, canChooseTheme } from '../src/helpers/theme'
import type { Station } from '../src/parsers/types'
import type { ListFile } from '../src/composables/usePlaylists'
import { usePreferences, DEFAULT_WIDTHS, toProfile, fromProfile } from '../src/composables/usePreferences'
import { readConfig } from '../src/config'

const st = (id: string, name: string, url: string): Station => ({ id, name, url })

describe('the finder and the current list', () => {
  const A: ListFile = { name: 'A.m3u8', path: '/Radio/A.m3u8', etag: '1' }
  const B: ListFile = { name: 'B.m3u8', path: '/Radio/B.m3u8', etag: '1' }
  const current = ref<Station[]>([st('a1', 'Groove Salad', 'https://a/1')])
  const reads: string[] = []
  const search = useSearch({
    files: () => [A, B],
    currentFile: () => A,
    currentStations: () => current.value,
    readList: async (f) => { reads.push(f.path); return [st('b1', 'Groove Other', 'https://b/1')] },
    debounceMs: 0
  })

  it('does not re-read the current list, so result ids are the editor\'s ids', async () => {
    search.scope.value = 'all'
    search.query.value = 'groove'
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))
    expect(reads).toEqual([B.path])
    const groupA = search.localGroups.value.find((g) => g.key === A.path)!
    expect(groupA.stations[0].id).toBe('a1')
  })

  it('sees an edit to the current list without a reload', async () => {
    current.value = [...current.value, st('a2', 'Groove Two', 'https://a/2')]
    await nextTick()
    const groupA = search.localGroups.value.find((g) => g.key === A.path)!
    expect(groupA.stations.map((s) => s.id)).toEqual(['a1', 'a2'])
  })

  it('does no local filtering in directory scope', async () => {
    search.scope.value = 'directory'
    await nextTick()
    expect(search.localGroups.value).toEqual([])
  })
})

describe('logos are https everywhere', () => {
  it('the M3U parser drops an http logo, as the form and the directory already did', async () => {
    const list = parseM3u('#EXTM3U\n#EXTINF:-1 tvg-logo="http://a/l.png" radio-homepage="http://a/",S\nhttps://a/1\n')
    expect(list.stations[0].logo).toBeUndefined()
    expect(list.stations[0].homepage).toBe('http://a/') // homepages may still be http
  })
})

describe('M3U round trip keeps what it did not write', () => {
  const rt = (t: string) => serializeM3u(parseM3u(t))

  it('keeps an unquoted attribute', () => {
    const t = '#EXTM3U\n#EXTINF:-1 group-title=Rock tvg-id="x",Name\nhttps://a/1\n'
    const out = rt(t)
    expect(out).toContain('group-title="Rock"')
    expect(out).toContain('tvg-id="x"')
  })

  it('keeps a tag between #EXTINF and its URL where it was', () => {
    const t = '#EXTM3U\n#EXTINF:-1,Name\n#EXTVLCOPT:network-caching=1000\nhttps://a/1\n'
    expect(rt(t)).toBe(t)
  })

  it('keeps the duration', () => {
    const t = '#EXTM3U\n#EXTINF:120,Name\nhttps://a/1\n'
    expect(rt(t)).toBe(t)
    expect(rt('#EXTM3U\n#EXTINF:-1,Name\nhttps://a/1\n')).toBe('#EXTM3U\n#EXTINF:-1,Name\nhttps://a/1\n')
  })

  it('a backup server typed with a space is written in a form the space-separated field can hold', () => {
    // The form and the importer pass every URL through safeUrl before it is
    // stored; a literal space is encoded there, so the file never carries one.
    // (A space already IN a file's radio-alt is ambiguous by construction and
    // is not recoverable; the fix is to never write one.)
    const alt = safeUrl('https://a/x y.mp3')!
    expect(alt).toBe('https://a/x%20y.mp3')
    const list = { stations: [{ id: '1', name: 'N', url: 'https://a/1', alternates: [alt] }], trailing: [] }
    expect(parseM3u(serializeM3u(list)).stations[0].alternates).toEqual([alt])
  })

  it('still returns the string form when there is nothing to encode', () => {
    expect(safeUrl('https://a')).toBe('https://a') // not normalised to https://a/
  })
})

describe('XSPF', () => {
  it('a playlist with no title of its own has no title', () => {
    const t = '<?xml version="1.0"?><playlist version="1" xmlns="http://xspf.org/ns/0/"><trackList><track><location>https://a/1</location><title>Track One</title></track></trackList></playlist>'
    const l = parseXspf(t)
    expect(l.title).toBeUndefined()
    expect(l.stations[0].name).toBe('Track One')
  })
  it('a playlist title is still read', () => {
    const t = '<playlist xmlns="http://xspf.org/ns/0/"><title>Mine</title><trackList><track><location>https://a/1</location></track></trackList></playlist>'
    expect(parseXspf(t).title).toBe('Mine')
  })
})

describe('the two resets', () => {
  it('resetColumns puts the table back and leaves everything else alone', async () => {
    const { prefs, resetColumns } = usePreferences()
    prefs.columns.url = true
    prefs.widths.url = 400
    prefs.theme = 'dark'
    prefs.backupKeep = 25
    prefs.retries = 0
    prefs.volume = 0.1
    resetColumns()
    expect(prefs.columns.url).toBe(false)
    expect(prefs.widths.url).toBe(DEFAULT_WIDTHS.url)
    // The Columns menu's Reset used to be this, and took the theme, the retry
    // count, the backup count and the volume with it.
    expect(prefs.theme).toBe('dark')
    expect(prefs.backupKeep).toBe(25)
    expect(prefs.retries).toBe(0)
    expect(prefs.volume).toBe(0.1)
  })

  it('reset puts everything back', async () => {
    const { prefs, reset } = usePreferences()
    prefs.theme = 'dark'; prefs.columns.url = true
    reset()
    expect(prefs.theme).toBe('system')
    expect(prefs.columns.url).toBe(false)
  })
})

describe('preferences', () => {
  it('retries: 0 survives a reload', async () => {
    localStorage.setItem('radio.prefs', JSON.stringify({ retries: 0 }))
    const { prefs, destroy } = usePreferences()
    expect(prefs.retries).toBe(0)
    destroy()
    localStorage.removeItem('radio.prefs')
  })
})

describe('reconnect attempts', () => {
  beforeEach(() => localStorage.clear())

  it('starts at the number the instance configures', async () => {
    const { prefs, destroy } = usePreferences({ retries: 9 })
    expect(prefs.retries).toBe(9)
    destroy()
  })

  it("a device's own choice, including zero, outlives the instance value", async () => {
    const first = usePreferences({ retries: 5 })
    first.prefs.retries = 0
    first.save()
    first.destroy()

    const second = usePreferences({ retries: 9 })
    expect(second.prefs.retries).toBe(0)
    second.destroy()
  })

  it('a device that never chose takes the instance value', async () => {
    const first = usePreferences({ retries: 9 })
    first.prefs.theme = 'dark'   // stores prefs without ever naming retries
    first.save()
    first.destroy()

    const second = usePreferences({ retries: 9 })
    expect(second.prefs.retries).toBe(9)
    second.destroy()
  })

  it('is clamped to the same range as the configuration key', async () => {
    expect(readConfig({ reconnectAttempts: -4 }).reconnectAttempts).toBe(0)
    expect(readConfig({ reconnectAttempts: 999 }).reconnectAttempts).toBe(10)
    const { prefs, destroy } = usePreferences({ retries: 999 })
    expect(prefs.retries).toBe(10)
    destroy()
  })
})

describe('how many backups to keep', () => {
  beforeEach(() => localStorage.clear())

  it('starts at the number the instance configures', async () => {
    const { prefs, destroy } = usePreferences({ backupKeep: 12 })
    expect(prefs.backupKeep).toBe(12)
    destroy()
  })

  it('falls back to the shipped default when the instance says nothing', async () => {
    const { prefs, destroy } = usePreferences()
    expect(prefs.backupKeep).toBe(readConfig({}).backupKeep)
    destroy()
  })

  it("a device's own choice outlives a change to the instance default", async () => {
    const first = usePreferences({ backupKeep: 10 })
    first.prefs.backupKeep = 3
    first.save()
    first.destroy()

    // The administrator raises the instance default; this device already chose.
    const second = usePreferences({ backupKeep: 25 })
    expect(second.prefs.backupKeep).toBe(3)
    second.destroy()
  })

  it('a device that never chose takes the instance value', async () => {
    const first = usePreferences({ backupKeep: 10 })
    first.prefs.theme = 'dark'   // stores prefs without ever naming backupKeep
    first.save()
    first.destroy()

    const second = usePreferences({ backupKeep: 10 })
    expect(second.prefs.backupKeep).toBe(10)
    second.destroy()
  })

  it('is clamped on both sides, wherever the number comes from', async () => {
    expect(readConfig({ backupKeep: 0 }).backupKeep).toBe(1)
    expect(readConfig({ backupKeep: 9999 }).backupKeep).toBe(50)
    expect(readConfig({ backupKeep: 'lots' }).backupKeep).toBe(readConfig({}).backupKeep)
    const { prefs, destroy } = usePreferences({ backupKeep: 0 })
    expect(prefs.backupKeep).toBe(1)
    destroy()
  })

  it('travels in a settings profile', async () => {
    const one = usePreferences({ backupKeep: 5 })
    one.prefs.backupKeep = 10
    const ini = toProfile(one.prefs, false)
    expect(ini.backups.keep).toBe('10')

    const two = usePreferences({ backupKeep: 5 })
    fromProfile(ini, two.prefs)
    expect(two.prefs.backupKeep).toBe(10)
    one.destroy(); two.destroy()
  })
})

describe('directory hardening', () => {
  it('accepts only hostnames inside the service', () => {
    expect(isDirectoryHost('de1.api.radio-browser.info')).toBe(true)
    expect(isDirectoryHost('fi1.api.radio-browser.info')).toBe(true)
    expect(isDirectoryHost('evil.example')).toBe(false)
    expect(isDirectoryHost('api.radio-browser.info.evil.example')).toBe(false)
    expect(isDirectoryHost('de1.api.radio-browser.info/x?')).toBe(false)
    expect(isDirectoryHost(null)).toBe(false)
  })
  it('url_resolved goes through the same gate as every other URL', () => {
    const base = {
      stationuuid: 'u', name: 'N', url: 'https://x/s.pls', url_resolved: 'javascript:alert(1)',
      homepage: '', favicon: '', tags: '', country: '', countrycode: '', language: '', codec: '',
      bitrate: 0, lastchecktime_iso8601: '', ssl_error: 0
    }
    const s = toStation(base)
    expect(s.url).toBe('https://x/s.pls') // fell back to the playlist address, which classify names
    expect(classify(s)).toBe('playlist')
    expect(s.id).toBe('dir:u') // stable across pages of results
  })
})

describe('redaction', () => {
  it('drops credentials and query from a logged address', () => {
    expect(redact('https://user:pw@relay.example:8000/stream?token=abc')).toBe('https://relay.example:8000/stream')
    expect(redact('not a url?x=1')).toBe('not a url')
  })
})

describe('what the results area shows', () => {
  // The 1.1.1 report: four directory matches counted in the header, and
  // "This list is empty" underneath them. The open list was empty, and the
  // empty-list branch came before the results branch in the template.
  it('shows results even when the open list is empty', () => {
    expect(bodyView({ searching: true, hasResults: true, loading: false, hasStations: false })).toBe('results')
  })
  it('still says so when a search really found nothing', () => {
    expect(bodyView({ searching: true, hasResults: false, loading: false, hasStations: false })).toBe('no-results')
    expect(bodyView({ searching: true, hasResults: false, loading: false, hasStations: true })).toBe('no-results')
  })
  it('offers the empty-list prompt only when not searching', () => {
    expect(bodyView({ searching: false, hasResults: false, loading: false, hasStations: false })).toBe('empty-list')
    expect(bodyView({ searching: false, hasResults: false, loading: true, hasStations: false })).toBe('list')
  })
  it('shows the list otherwise', () => {
    expect(bodyView({ searching: false, hasResults: false, loading: false, hasStations: true })).toBe('list')
  })
})

describe('the add-to-list popup', () => {
  // It appeared not to open at all: the click that opened it was still
  // bubbling when Vue mounted it, and the outside-click listener bound in
  // onMounted caught that same click and closed it again.
  const show = async () => {
    const open = ref(true)
    const host = mount(defineComponent({
      setup: () => () => open.value
        ? h(AddToList, {
            name: 'S', files: [{ name: 'A.m3u8', path: '/Radio/A.m3u8' }],
            current: null, x: 10, y: 10, onClose: () => { open.value = false }
          })
        : null
    }))
    await nextTick()
    return { open, host }
  }

  it('is not closed by a stray click, only by a press outside it', async () => {
    const { open } = await show()
    await new Promise((r) => setTimeout(r, 0)) // the listener binds a task later
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(open.value).toBe(true)
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    await nextTick()
    expect(open.value).toBe(false)
  })

  it('binds nothing until after the opening interaction has finished', async () => {
    const { open } = await show()
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    await nextTick()
    expect(open.value).toBe(true) // same task as the mount: not listening yet
  })
})


describe('the theme, applied as the shell applies its own', () => {
  const light = { isDark: false, label: 'Light', designTokens: { roles: { primary: '#00677f', onSurfaceVariant: '#444', surfaceContainer: '#eee', surface: '#fafafa', onSurface: '#111' } } }
  const dark = { isDark: true, label: 'Dark', designTokens: { roles: { primary: '#7fd', chrome: '#000' } } }

  it('turns each role token into the custom property the design system reads', () => {
    expect(kebab('onSurfaceVariant')).toBe('on-surface-variant')
    expect(kebab('primary')).toBe('primary')
    const vars = themeVars(light)
    expect(vars['--oc-role-primary']).toBe('#00677f')
    expect(vars['--oc-role-on-surface-variant']).toBe('#444')
  })

  it('fills in chrome from surfaceContainer when a theme does not name it, as the shell does', () => {
    expect(themeVars(light)['--oc-role-chrome']).toBe('#eee')
    expect(themeVars(light)['--oc-role-on-chrome']).toBe('#111')
    expect(themeVars(dark)['--oc-role-chrome']).toBe('#000') // named, so kept
    expect(themeVars(dark)['--oc-role-on-chrome']).toBeUndefined()
  })

  it('picks by mode, and knows when there is nothing to pick between', () => {
    expect(pickTheme([light, dark], 'dark')).toBe(dark)
    expect(pickTheme([light, dark], 'light')).toBe(light)
    expect(pickTheme([light], 'dark')).toBeUndefined()
    expect(canChooseTheme([light, dark])).toBe(true)
    expect(canChooseTheme([light])).toBe(false)
    expect(canChooseTheme([])).toBe(false)
  })

  it('fills background from surface when a theme names no background', () => {
    // Radio's override is a child of :root, so a role it does not set inherits
    // the OTHER theme's value rather than a neutral default. These two decide
    // the page itself, which is what made a mixed theme look half-applied.
    const vars = themeVars(light)
    expect(vars['--oc-role-background']).toBe('#fafafa')      // from surface
    expect(vars['--oc-role-on-background']).toBe('#111')      // from onSurface
  })

  it('leaves a background the theme does name alone', () => {
    const named = { isDark: true, designTokens: { roles: { background: '#000', surface: '#222', onBackground: '#eee', onSurface: '#ddd' } } }
    const vars = themeVars(named)
    expect(vars['--oc-role-background']).toBe('#000')
    expect(vars['--oc-role-on-background']).toBe('#eee')
  })

  it('carries nothing that is not a string', () => {
    const odd = { isDark: false, designTokens: { roles: { primary: '#000', bad: 42 as unknown as string } } }
    expect(Object.keys(themeVars(odd))).toEqual(['--oc-role-primary'])
  })
})

describe('configuration corners', () => {
  it('a directory mirror may carry a port', async () => {
    expect(readConfig({ directoryServers: ['radio.example.org:8443', 'https://plain.example.org/x'] }).directoryServers)
      .toEqual(['radio.example.org:8443', 'plain.example.org'])
    expect(readConfig({ directoryServers: ['bad host', 'a:b'] }).directoryServers).toEqual([])
  })

  it('a profile clamps retries with the same bounds as everything else', async () => {
    localStorage.clear()
    const { prefs, destroy } = usePreferences()
    fromProfile({ playback: { retries: '99' } }, prefs)
    expect(prefs.retries).toBe(10)
    fromProfile({ playback: { retries: '-3' } }, prefs)
    expect(prefs.retries).toBe(0)
    destroy()
  })
})

describe('what the device remembers of stream addresses', () => {
  it('is kept without credentials or tokens, and old entries are brought across', () => {
    const tokened = 'https://user:pw@relay.example:8000/s?token=abc'
    const key = historyKey(tokened)
    expect(key).toMatch(/^https:\/\/relay\.example:8000\/s#[0-9a-z]+$/)
    expect(key).not.toContain('abc')
    expect(key).not.toContain('pw')
    expect(historyKey(key)).toBe(key)                        // a stored key comes back as it went in
    expect(historyKey('https://plain.example/x')).toBe('https://plain.example/x')
    // Written out as text: in an object literal `__proto__` is not a key at all.
    const old = `{"${key}":300,` +                          // already migrated, and later…
      `"${tokened}":100,` +                                  // …than the old spelling of the same address
      '"https://relay.example:8000/s?token=other":50,' +     // another token: another address
      '"https://plain.example/x":200,' +
      '"https://bad.example/y":"yesterday",' +               // not a time
      '"__proto__":5}'
    expect(Object.keys(JSON.parse(old))).toContain('__proto__')
    const history = readHistory(old)
    expect(history[key]).toBe(300)
    expect(history['https://plain.example/x']).toBe(200)
    expect(Object.keys(history)).toHaveLength(3)
    expect(JSON.stringify(history)).not.toMatch(/token|pw@/)
    // The hostile key is not kept, and nothing reaches Object.prototype through it.
    expect(Object.keys(history)).not.toContain('__proto__')
    expect(Object.getPrototypeOf(history)).toBe(Object.prototype)
    expect(readHistory('not json')).toEqual({})
    expect(readHistory(null)).toEqual({})
  })

  it('keeps apart two stations told apart only by their query', () => {
    expect(historyKey('https://host/stream?sid=1')).not.toBe(historyKey('https://host/stream?sid=2'))
  })
})

describe('typing into the search', () => {
  it('works the results out when the typing pauses, not at every key', async () => {
    vi.useFakeTimers()
    try {
      const file: ListFile = { name: 'A.m3u8', path: '/Radio/A.m3u8' }
      const search = useSearch({
        files: () => [file], currentFile: () => file,
        currentStations: () => [st('1', 'Groove Salad', 'https://a/1'), st('2', 'Drone Zone', 'https://a/2')],
        readList: async () => []
      })
      search.scope.value = 'list'
      search.query.value = 'g'
      expect(search.pending.value).toBe(true)   // "searching", not "nothing found"
      expect(search.localGroups.value).toEqual([])
      search.query.value = 'gr'
      await vi.advanceTimersByTimeAsync(100)
      expect(search.localGroups.value).toEqual([]) // still typing
      await vi.advanceTimersByTimeAsync(100)
      expect(search.pending.value).toBe(false)
      expect(search.localGroups.value[0].stations.map((s) => s.name)).toEqual(['Groove Salad'])
      search.query.value = ''                      // clearing does not wait
      expect(search.localGroups.value).toEqual([])
      expect(search.pending.value).toBe(false)
    } finally { vi.useRealTimers() }
  })

  it('matches within one field, never across two', async () => {
    const s: Station = { id: '1', name: 'Radio Nova', url: 'https://a/1', group: 'Jazz', alternates: ['https://backup.example/s'] }
    expect(matches(s, 'NOVA')).toBe(true)
    expect(matches(s, 'backup.example')).toBe(true)
    expect(matches(s, 'novajazz')).toBe(false)
    expect(matches(s, 'nova jazz')).toBe(false) // the fields are not joined by anything that can be typed
    expect(matches(s, 'radio nova')).toBe(true)
    expect(matches(s, '')).toBe(true)
  })
})

describe('the finder keeps itself current from the listing', () => {
  it('re-reads only the list whose etag moved, and forgets one that went', async () => {
    const A: ListFile = { name: 'A.m3u8', path: '/Radio/A.m3u8', etag: 'a1' }
    const B: ListFile = { name: 'B.m3u8', path: '/Radio/B.m3u8', etag: 'b1' }
    const C: ListFile = { name: 'C.m3u8', path: '/Radio/C.m3u8', etag: 'c1' }
    const files = ref<ListFile[]>([A, B, C])
    const reads: string[] = []
    const contents: Record<string, Station[]> = {
      '/Radio/B.m3u8': [st('b', 'Jazz B', 'https://b/1')],
      '/Radio/C.m3u8': [st('c', 'Jazz C', 'https://c/1')]
    }
    const search = useSearch({
      files: () => files.value, currentFile: () => A, currentStations: () => [],
      readList: async (f) => { reads.push(f.path); return contents[f.path] }, debounceMs: 0
    })
    search.scope.value = 'all'
    search.query.value = 'jazz'
    await vi.waitFor(() => expect(search.localGroups.value).toHaveLength(2))
    expect(reads.sort()).toEqual(['/Radio/B.m3u8', '/Radio/C.m3u8'])

    // B is written (its etag moves): only B is read again, and its new station is found.
    reads.length = 0
    contents['/Radio/B.m3u8'] = [...contents['/Radio/B.m3u8'], st('b2', 'Jazz B2', 'https://b/2')]
    files.value = [A, { ...B, etag: 'b2' }, C]
    await vi.waitFor(() => expect(search.localGroups.value.find((g) => g.key === B.path)!.stations).toHaveLength(2))
    expect(reads).toEqual(['/Radio/B.m3u8'])

    // C is deleted: it leaves the results without a read of anything.
    reads.length = 0
    files.value = [A, { ...B, etag: 'b2' }]
    await vi.waitFor(() => expect(search.localGroups.value.map((g) => g.key)).toEqual([B.path]))
    expect(reads).toEqual([])
  })
})

describe('one reader for every playlist', () => {
  it('gates every station, whichever reader produced it, and adds nothing', async () => {
    const list = parsePlaylist('#EXTM3U\n#EXTINF:-1 tvg-chno="7",Kept\nhttps://a/1\n')
    expect(Object.keys(list.stations[0]).sort()).toEqual(['extra', 'id', 'name', 'url'])
    const xspf = parsePlaylist('<playlist xmlns="http://xspf.org/ns/0/"><trackList><track><location>https://a/1</location><info>javascript:alert(1)</info></track></trackList></playlist>')
    expect(xspf.stations[0].homepage).toBeUndefined()
    expect(() => parsePlaylist('#EXTM3U\n#EXT-X-VERSION:3\nseg.ts\n')).toThrow(/HLS/)
    expect(() => parsePlaylist('just some words')).toThrow(/not a playlist/)
  })
})

describe('what an empty results area says', () => {
  const base = { scope: 'all' as const, query: 'jazz', directoryProblem: '', working: false }
  it('names a directory problem first, but only in the directory scope', () => {
    expect(emptyMessage({ ...base, scope: 'directory', directoryProblem: 'Blocked.', working: true })).toBe('Blocked.')
    expect(emptyMessage({ ...base, directoryProblem: 'Blocked.' })).toBe('No stations match “jazz”.')
  })
  it('says it is still looking before it says there is nothing', () => {
    expect(emptyMessage({ ...base, working: true })).toBe('Searching…')
  })
  it('asks for more before sending a query too short for the directory', () => {
    expect(emptyMessage({ ...base, scope: 'directory', query: 'j' })).toMatch(/at least two characters/)
    expect(emptyMessage({ ...base, scope: 'list', query: 'j' })).toBe('No stations match “j”.')
  })
})

describe('titles, on by default since 1.2.0, on devices that used an earlier version', () => {
  it('an "off" stored before 1.2.0 was the old default, not a choice: titles come on, the rest stays', () => {
    localStorage.setItem('radio.prefs', JSON.stringify({ metadata: false, volume: 0.3, retries: 2 })) // no version: written by 1.1.x
    const { prefs, destroy } = usePreferences()
    expect(prefs.metadata).toBe(true)
    expect(prefs.volume).toBe(0.3)
    expect(prefs.retries).toBe(2)
    destroy()
  })

  it('an "off" chosen after the upgrade is saved as a choice, and survives the next load', () => {
    localStorage.setItem('radio.prefs', JSON.stringify({ metadata: false, volume: 0.3 })) // 1.1.x
    const first = usePreferences()
    expect(JSON.parse(localStorage.getItem('radio.prefs')!).v).toBe(2) // written back at once, marked
    first.prefs.metadata = false                                       // the user turns titles off
    first.destroy()                                                    // flushes the save
    const second = usePreferences()
    expect(second.prefs.metadata).toBe(false)
    second.destroy()
  })

  it('and still stands under a later version of the settings file', () => {
    localStorage.setItem('radio.prefs', JSON.stringify({ metadata: false, v: 3 }))
    const { prefs, destroy } = usePreferences()
    expect(prefs.metadata).toBe(false)
    destroy()
  })

  it('an "off" chosen since then stands', () => {
    localStorage.setItem('radio.prefs', JSON.stringify({ metadata: false, v: 2 }))
    const { prefs, destroy } = usePreferences()
    expect(prefs.metadata).toBe(false)
    destroy()
  })
})

describe('what a settings profile carries, and what stays on the device', () => {
  it('carries the choices that travel, in a stable shape, and nothing private', () => {
    localStorage.clear()
    const { prefs, destroy } = usePreferences({ retries: 3, backupKeep: 7 })
    prefs.theme = 'dark'; prefs.volume = 0.1; prefs.directoryReportClicks = true
    prefs.lastStation = 'https://relay.example/s'; prefs.lastList = 'Mine.m3u8'
    const travel = toProfile(prefs, false)
    expect(Object.keys(travel)).toEqual(['profile', 'columns', 'playback', 'backups'])
    expect(travel.playback).toEqual({ resume: 'true', retries: '3', metadata: 'true', analyser: 'true', directoryHttpsOnly: 'false' })
    expect(travel.backups).toEqual({ keep: '7' })
    const text = JSON.stringify(toProfile(prefs, true))
    for (const local of ['dark', '0.1', 'relay.example', 'Mine.m3u8', 'directoryReportClicks', 'volume']) {
      expect(text).not.toContain(local)   // the theme, the level, the history and a consent stay here
    }
    expect(Object.keys(toProfile(prefs, true).layout)[0]).toBe('railWidth')
    destroy()
  })

  it('reads back what it wrote, and refuses what it cannot read', () => {
    localStorage.clear()
    const from = usePreferences().prefs
    from.retries = 0; from.backupKeep = 25; from.analyser = false; from.widths.url = 333
    const into = usePreferences({ retries: 9 }).prefs
    const { applied } = fromProfile(toProfile(from, true), into)
    expect(applied).toBeGreaterThan(10)
    expect([into.retries, into.backupKeep, into.analyser, into.widths.url]).toEqual([0, 25, false, 333])
    const before = into.retries
    fromProfile({ playback: { retries: 'lots' } }, into)
    expect(into.retries).toBe(before)
  })
})

describe('the finder, when a read goes wrong', () => {
  const A: ListFile = { name: 'A.m3u8', path: '/Radio/A.m3u8', etag: 'a1' }
  const B: ListFile = { name: 'B.m3u8', path: '/Radio/B.m3u8', etag: 'b1' }
  const C: ListFile = { name: 'C.m3u8', path: '/Radio/C.m3u8', etag: 'c1' }

  it('tries a list that failed to read again at the next sync, not never', async () => {
    const files = ref<ListFile[]>([A, B])
    let fail = true
    let tries = 0
    const search = useSearch({
      files: () => files.value, currentFile: () => A, currentStations: () => [],
      readList: async () => { tries++; if (fail) throw new Error('503'); return [st('b', 'Bravo', 'https://b/1')] }, debounceMs: 0
    })
    search.scope.value = 'all'
    search.query.value = 'bravo'
    await vi.waitFor(() => expect(tries).toBe(1))           // the read was made, and failed
    await vi.waitFor(() => expect(search.loading.value).toBe(false))
    expect(search.localGroups.value).toEqual([])
    fail = false
    files.value = [...files.value] // a fresh listing, nothing changed
    await vi.waitFor(() => expect(search.localGroups.value).toHaveLength(1))
    expect(tries).toBe(2)
  })

  it('a list read again keeps the others it already has', async () => {
    const files = ref<ListFile[]>([A, B, C])
    const reads: string[] = []
    const search = useSearch({
      files: () => files.value, currentFile: () => A, currentStations: () => [],
      readList: async (f) => { reads.push(f.path); return [st(f.path, `Jazz ${f.name}`, `https://x${f.path}`)] }, debounceMs: 0
    })
    search.scope.value = 'all'
    search.query.value = 'jazz'
    await vi.waitFor(() => expect(search.localGroups.value).toHaveLength(2))
    files.value = [A, { ...B, etag: 'b2' }, C]
    await vi.waitFor(() => expect(reads.filter((r) => r === B.path)).toHaveLength(2))
    await vi.waitFor(() => expect(search.localGroups.value.map((g) => g.key)).toEqual([B.path, C.path]))
  })
})

describe('a last station stored by an older version', () => {
  it('is written back redacted as soon as it is read', () => {
    localStorage.setItem('radio.prefs', JSON.stringify({ lastStation: 'https://u:p@relay.example/s?token=secret' }))
    const { destroy } = usePreferences()
    expect(localStorage.getItem('radio.prefs')).not.toContain('secret')
    destroy()
    localStorage.removeItem('radio.prefs')
  })
})
