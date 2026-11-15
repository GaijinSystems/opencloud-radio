import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { disk, resetDav, seed, wait } from './support/dav'
import { created, installFakeAudio } from './support/audio'
import { mount, buttonNamed } from './support/mount'
import { answer, web, refusing } from './support/web'

vi.mock('@opencloud-eu/web-pkg', async () => ({
  ...(await import('./support/dav')).webPkgMock(),
  useThemeStore: () => ({ availableThemes: [] })
}))

import App from '../src/App.vue'
import { forgetLookups } from '../src/helpers/backupServers'
import { historyKey } from '../src/helpers/safeUrl'

/**
 * The app as a whole, against the in-memory server. Until 1.2.0 nothing
 * mounted App.vue, and several findings of the seventh review pass lived only
 * there: in how a move reports what did not fit, in import with no list open,
 * in what the device stores of a stream address.
 */
const config = { analyserEnabled: false, maxStationsPerList: 10 }
const list = (...urls: string[]) => '#EXTM3U\n' + urls.map((u, i) => `#EXTINF:-1,Station ${i + 1}\n${u}\n`).join('')
/** Mount, and wait for the first list to be on screen. */
const start = async (more: Record<string, unknown> = {}) => {
  const host = mount(App, { applicationConfig: { ...config, ...more } })
  await vi.waitFor(() => expect(host.querySelector('h1')?.textContent).not.toBe('Radio'))
  return host
}
const statusOf = (host: HTMLElement) => host.querySelector('[role=status]')?.textContent?.trim() ?? ''
const dialogOf = (host: HTMLElement) => host.querySelector('[role=dialog]') as HTMLElement
const type = async (field: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  field.value = value
  field.dispatchEvent(new Event('input'))
  await nextTick()
}

beforeEach(() => {
  // No test here reaches the network: titles are on by default, and asking a
  // test station for them must not leave the machine. A test that needs
  // answers installs its own.
  refusing() // no network in the app tests
  resetDav()
  installFakeAudio()
  localStorage.clear()
  localStorage.setItem('radio.everPlayed', '1')
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {} disconnect() {}
  }
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'debug').mockImplementation(() => {})
  vi.spyOn(console, 'error')
})
afterEach(() => {
  forgetLookups() // a refusal kept for a minute is not the next test's
  const illegal = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .map((c) => String(c[0])).filter((m) => m.includes('no move from'))
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  expect(illegal).toEqual([]) // the player made no move outside its table
})

describe('the app', () => {
  it('makes a first list on first launch, and says it is empty', async () => {
    const host = await start()
    expect(disk.has('/Radio/Favourites.m3u8')).toBe(true)
    expect(host.querySelector('h1')!.textContent).toContain('Favourites')
    expect(host.textContent).toContain('This list is empty.')
  })

  it('imports into the open list and saves it without being asked', async () => {
    seed('A.m3u8', list('https://a/1'))
    const host = await start()
    buttonNamed(host, 'Import').click(); await nextTick()
    await type(dialogOf(host).querySelector('textarea')!, list('https://a/1', 'https://x/2', 'https://x/3'))
    buttonNamed(dialogOf(host), 'Import').click()
    await vi.waitFor(() => expect(statusOf(host)).toContain('2 added, 1 already in the list'))
    await vi.waitFor(() => expect(disk.get('/Radio/A.m3u8')!.body).toContain('https://x/3'), { timeout: 3000 })
    expect(disk.get('/Radio/A.m3u8')!.body.match(/^https:/gm)).toHaveLength(3)
  })

  it('a move into a full list leaves what did not fit here, still selected, and says so', async () => {
    seed('A.m3u8', list('https://a/1', 'https://a/2', 'https://a/3'))
    seed('B.m3u8', list(...Array.from({ length: 9 }, (_, i) => `https://b/${i}`)))
    const host = await start()
    const all = host.querySelector('input[aria-label="Select all stations"]') as HTMLInputElement
    all.checked = true; all.dispatchEvent(new Event('change')); await nextTick()
    expect(host.textContent).toContain('3 stations selected')
    buttonNamed(host, 'Move to list').click(); await nextTick()
    const select = dialogOf(host).querySelector('select') as HTMLSelectElement
    select.value = 'B.m3u8'; select.dispatchEvent(new Event('change')); await nextTick()
    buttonNamed(dialogOf(host), 'Move').click()
    await vi.waitFor(() => expect(statusOf(host)).toContain('1 moved to B'))
    expect(statusOf(host)).toContain('2 left here because B is full')
    expect(disk.get('/Radio/B.m3u8')!.body.match(/^https:/gm)).toHaveLength(10)
    const a = disk.get('/Radio/A.m3u8')!.body
    expect(a).not.toContain('https://a/1')
    expect(a).toContain('https://a/2')
    expect(a).toContain('https://a/3')
    expect(host.textContent).toContain('2 stations selected')
  })

  it('will not add a station whose address the list already has', async () => {
    seed('A.m3u8', list('https://a/1'))
    const host = await start()
    buttonNamed(host, 'Add station').click(); await nextTick()
    await type(dialogOf(host).querySelector('#st-url') as HTMLInputElement, 'https://a/1')
    await type(dialogOf(host).querySelector('#st-name') as HTMLInputElement, 'Again')
    buttonNamed(dialogOf(host), 'Add station').click()
    await vi.waitFor(() => expect(statusOf(host)).toContain('already in this list'))
    expect(dialogOf(host)).not.toBeNull() // the form stays open with what was typed
  })

  it('a list it does not write offers to convert, and will not take a station', async () => {
    seed('Jazz.pls', '[playlist]\nFile1=https://a/1\nTitle1=One\n')
    const host = await start()
    expect(host.textContent).toContain('cannot be edited here')
    buttonNamed(host, 'Add station').click(); await nextTick()
    expect(statusOf(host)).toContain('read-only')
    expect(dialogOf(host)).toBeNull()
  })
})

describe('the row playing, through a change of its address', () => {
  it('the station form putting another server first: the row still shows it playing, and stops it', async () => {
    seed('A.m3u8', list('https://a/1'))
    const host = await start()
    ;(host.querySelector('button[aria-label="Play Station 1"]') as HTMLButtonElement).click()
    created.at(-1)!.succeed(); await nextTick()
    ;(host.querySelector('button[aria-label="Edit Station 1"]') as HTMLButtonElement).click()
    await nextTick()
    await type(dialogOf(host).querySelector('#st-url') as HTMLInputElement, 'https://a/2')
    await type(dialogOf(host).querySelector('#st-alt') as HTMLTextAreaElement, 'https://a/1')
    buttonNamed(dialogOf(host), 'Save changes').click()
    await vi.waitFor(() => expect(host.querySelector('button[aria-label="Stop Station 1"]')).not.toBeNull())
    ;(host.querySelector('button[aria-label="Stop Station 1"]') as HTMLButtonElement).click(); await nextTick()
    expect(host.querySelector('button[aria-label="Play Station 1"]')).not.toBeNull() // stopped, not started again
  })
})

describe('what the device keeps of a stream address', () => {
  const tokened = 'https://user:pw@relay.example/s?token=secret'

  it('a play is remembered under a key that does not hold the token', async () => {
    seed('A.m3u8', list(tokened))
    const host = await start()
    ;(host.querySelector('button[aria-label="Play Station 1"]') as HTMLButtonElement).click()
    created.at(-1)!.succeed(); await nextTick()
    const stored = localStorage.getItem('radio.lastPlayed')!
    expect(Object.keys(JSON.parse(stored))).toEqual([historyKey(tokened)])
    expect(stored).not.toContain('secret')
    expect(stored).not.toContain('pw@')
    window.dispatchEvent(new Event('pagehide')) // the preferences are written now rather than in 300 ms
    expect(localStorage.getItem('radio.prefs')).toContain(historyKey(tokened))
    expect(localStorage.getItem('radio.prefs')).not.toContain('secret')
  })

  it('what an older version stored is rewritten on load, and still resumes the station', async () => {
    seed('A.m3u8', list(tokened))
    localStorage.setItem('radio.lastPlayed', JSON.stringify({ [tokened]: Date.now() - 60_000 }))
    localStorage.setItem('radio.prefs', JSON.stringify({ resume: true, lastStation: tokened }))
    const host = await start()
    expect(localStorage.getItem('radio.lastPlayed')).not.toContain('secret') // at once, not at the next play
    expect(host.textContent).toContain('Ready')                              // its history was kept
    expect(host.textContent).not.toContain('Choose a station to start listening') // the bar has it, ready to play
    expect(host.querySelector('button[aria-label="Play"]')!.hasAttribute('disabled')).toBe(false)
    host.remove()
    window.dispatchEvent(new Event('pagehide'))
    expect(localStorage.getItem('radio.prefs')).not.toContain('secret')
  })
})

describe('settings with one owner', () => {
  it('Reset to defaults puts the volume slider back, without a reload', async () => {
    seed('A.m3u8', list('https://a/1'))
    const host = await start()
    const slider = host.querySelector('input[type=range]') as HTMLInputElement
    slider.value = '30'; slider.dispatchEvent(new Event('input')); await nextTick()
    expect(slider.value).toBe('30')
    ;(host.querySelector('button[aria-label=Preferences]') as HTMLButtonElement).click(); await nextTick()
    buttonNamed(dialogOf(host), 'Reset to defaults').click(); await nextTick()
    expect((host.querySelector('input[type=range]') as HTMLInputElement).value).toBe('72')
  })

  it('track titles are on unless the administrator turns them off', async () => {
    seed('A.m3u8', list('https://ice.example/stream'))
    const fetched = vi.fn(async (_url: string) => answer(JSON.stringify({ icestats: { source: { title: 'Now On' } } })))
    vi.stubGlobal('fetch', fetched)
    try {
      const host = mount(App, { applicationConfig: config }) // nothing said about titles
      await vi.waitFor(() => expect(host.querySelector('button[aria-label="Play Station 1"]')).not.toBeNull())
      ;(host.querySelector('button[aria-label="Play Station 1"]') as HTMLButtonElement).click()
      created.at(-1)!.succeed(); await nextTick()
      await vi.waitFor(() => expect(host.textContent).toContain('Now On'))
    } finally { vi.unstubAllGlobals() }
    const off = mount(App, { applicationConfig: { ...config, metadataEnabled: false } })
    const fetched2 = vi.fn(async (_url: string) => answer('{}'))
    vi.stubGlobal('fetch', fetched2)
    try {
      await vi.waitFor(() => expect(off.querySelector('button[aria-label="Play Station 1"]')).not.toBeNull())
      ;(off.querySelector('button[aria-label="Play Station 1"]') as HTMLButtonElement).click()
      created.at(-1)!.succeed(); await nextTick()
      await wait(50)
      expect(fetched2).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })

  it('track titles a user had turned off, switched on while a station plays, are asked for at once', async () => {
    seed('A.m3u8', list('https://ice.example/stream'))
    localStorage.setItem('radio.prefs', JSON.stringify({ metadata: false, v: 2 })) // this user's own choice, made in 1.2.0
    const fetched = vi.fn(async (_url: string) => answer(JSON.stringify({ icestats: { source: { title: 'Now On' } } })))
    vi.stubGlobal('fetch', fetched)
    try {
      const host = mount(App, { applicationConfig: { ...config, metadataEnabled: true } })
      await vi.waitFor(() => expect(host.querySelector('button[aria-label="Play Station 1"]')).not.toBeNull())
      ;(host.querySelector('button[aria-label="Play Station 1"]') as HTMLButtonElement).click()
      created.at(-1)!.succeed(); await nextTick()
      expect(fetched).not.toHaveBeenCalled()  // the user's choice stands
      ;(host.querySelector('button[aria-label=Preferences]') as HTMLButtonElement).click(); await nextTick()
      const box = [...dialogOf(host).querySelectorAll('label')].find((l) => l.textContent?.includes('track titles'))!
        .querySelector('input') as HTMLInputElement
      box.click(); await nextTick()
      await vi.waitFor(() => expect(host.textContent).toContain('Now On'))
      expect(String((fetched.mock.calls[0] as unknown[])[0])).toBe('https://ice.example/status-json.xsl')
    } finally { vi.unstubAllGlobals() }
  })
})

describe('what is playing, told to the system as well', () => {
  it('the lock screen and media keys show the track, under the station', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,Groove Salad\nhttps://ice2.somafm.com/groovesalad-128-mp3\n')
    const shown: Array<{ title: string; artist: string; album: string }> = []
    vi.stubGlobal('MediaMetadata', class { constructor(m: { title: string; artist: string; album: string }) { shown.push(m) } })
    Object.defineProperty(navigator, 'mediaSession', { configurable: true, value: { setActionHandler: () => {}, playbackState: 'none', metadata: null } })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).endsWith('.xsl')
      ? answer(JSON.stringify({ icestats: { source: { listenurl: 'http://ice2.somafm.com/groovesalad-128-mp3', title: 'Harold Budd - Templar' } } }))
      : answer('', { ok: false }))))
    try {
      const host = mount(App, { applicationConfig: { ...config, metadataEnabled: true } })
      await vi.waitFor(() => expect(host.querySelector('button[aria-label="Play Groove Salad"]')).not.toBeNull())
      ;(host.querySelector('button[aria-label="Play Groove Salad"]') as HTMLButtonElement).click() // titles on by default
      created.at(-1)!.succeed(); await nextTick()
      await vi.waitFor(() => expect(host.textContent).toContain('Templar — Harold Budd'))
      expect(shown.at(-1)).toMatchObject({ title: 'Templar', artist: 'Harold Budd', album: 'Groove Salad' })
    } finally {
      vi.unstubAllGlobals()
      delete (navigator as unknown as { mediaSession?: unknown }).mediaSession
    }
  })
})

describe('a playlist link given as a station\'s address', () => {
  it('keeps its servers each once, those that play here first, at most ten, and the link to read again', async () => {
    seed('A.m3u8', list('https://a/1'))
    const listed = ['http://unrelayed.example/s', 'https://s0.example/live', ...Array.from({ length: 11 }, (_, i) => `https://s${i}.example/live`)]
    web({ 'https://big.example/station.pls': `[playlist]\n${listed.map((u, i) => `File${i + 1}=${u}`).join('\n')}\nNumberOfEntries=${listed.length}\n` })
    try {
      const host = await start()
      buttonNamed(host, 'Add station').click(); await nextTick()
      await type(dialogOf(host).querySelector('#st-url') as HTMLInputElement, 'https://big.example/station.pls')
      await type(dialogOf(host).querySelector('#st-name') as HTMLInputElement, 'Big')
      buttonNamed(dialogOf(host), 'Add station').click()
      await vi.waitFor(() => expect(statusOf(host)).toContain('Saved with 10 servers'))
      await vi.waitFor(() => expect(disk.get('/Radio/A.m3u8')!.body).toContain('radio-source="https://big.example/station.pls"'), { timeout: 3000 })
      const body = disk.get('/Radio/A.m3u8')!.body
      expect(body).toContain('\nhttps://s0.example/live\n')       // a server that plays here first, not the http one
      expect(body).not.toContain('unrelayed.example')              // eleven that play: the one that cannot is cut
      expect(body.match(/s0\.example/g)).toHaveLength(1)          // nothing twice…
      expect(body).toContain('s9.example')                         // …so a repeat takes none of the ten places
    } finally { vi.unstubAllGlobals() }
  })
})

describe('a playlist the page may not read', () => {
  it('given as a station\'s address: saved, and said why — not that the station would not allow it', async () => {
    seed('A.m3u8', list('https://a/1'))
    const host = await start() // the app tests' network refuses
    buttonNamed(host, 'Add station').click(); await nextTick()
    await type(dialogOf(host).querySelector('#st-url') as HTMLInputElement, 'https://somafm.com/groovesalad.pls')
    await type(dialogOf(host).querySelector('#st-name') as HTMLInputElement, 'Groove Salad')
    buttonNamed(dialogOf(host), 'Add station').click()
    await vi.waitFor(() => expect(statusOf(host)).toContain('could not be reached or read from this page'))
    expect(statusOf(host)).toContain('connect-src')
    expect(statusOf(host)).not.toContain('station would not let')
  })

  it('one that answers with nothing is not blamed on the page; one with a fragment is read all the same', async () => {
    seed('A.m3u8', list('https://a/1'))
    web({}) // every address: a 404
    try {
      const host = await start()
      const add = async (url: string) => {
        buttonNamed(host, 'Add station').click(); await nextTick()
        await type(dialogOf(host).querySelector('#st-url') as HTMLInputElement, url)
        await type(dialogOf(host).querySelector('#st-name') as HTMLInputElement, 'X')
        buttonNamed(dialogOf(host), 'Add station').click()
      }
      await add('https://gone.example/live.pls')
      await vi.waitFor(() => expect(statusOf(host)).toContain('no stream could be read from it.'))
      expect(statusOf(host)).not.toContain('connect-src')
      await add('https://x.example/live.pls#a') // the fragment is never sent: read as any other
      await vi.waitFor(() => expect((globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
        .some((c) => String(c[0]).startsWith('https://x.example/live.pls'))).toBe(true))
    } finally { vi.unstubAllGlobals() }
  })

  it('one leading through another to one that cannot be read: the advice is to follow them to the last', async () => {
    seed('A.m3u8', list('https://a/1'))
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === 'https://a.example/outer.pls') return answer('[playlist]\nFile1=https://b.example/mid.pls\nNumberOfEntries=1\n')
      if (url === 'https://b.example/mid.pls') return answer('[playlist]\nFile1=https://c.example/inner.pls\nNumberOfEntries=1\n')
      throw new TypeError('Failed to fetch')
    }))
    const host = await start({ maxPlaylistDepth: 3 })
    buttonNamed(host, 'Add station').click(); await nextTick()
    await type(dialogOf(host).querySelector('#st-url') as HTMLInputElement, 'https://a.example/outer.pls')
    await type(dialogOf(host).querySelector('#st-name') as HTMLInputElement, 'X')
    buttonNamed(dialogOf(host), 'Add station').click()
    await vi.waitFor(() => expect(statusOf(host)).toContain('it leads, through another playlist, to one, on c.example, which could not'))
    expect(statusOf(host)).toContain('follow the playlists it leads to, to the last one')
  })

  it('an http link from an https page, refused: said, with http as the reason, though the address is "blocked"', async () => {
    seed('A.m3u8', list('https://a/1'))
    vi.stubGlobal('location', { ...location, protocol: 'https:' })
    const host = await start() // the app tests' network refuses
    buttonNamed(host, 'Add station').click(); await nextTick()
    await type(dialogOf(host).querySelector('#st-url') as HTMLInputElement, 'http://old.example/live.pls')
    await type(dialogOf(host).querySelector('#st-name') as HTMLInputElement, 'X')
    buttonNamed(dialogOf(host), 'Add station').click()
    await vi.waitFor(() => expect(statusOf(host)).toContain('Its address is http'))
    expect(statusOf(host)).toContain('connect-src') // refused: said as that, not as nothing there
    const asked = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]))
    expect(asked).not.toContain('http://old.example/live.pls') // never over http from an https page
  })

  it('an HLS manifest, or a stream with ".m3u" in its query, is not called a playlist link', async () => {
    seed('A.m3u8', list('https://a/1'))
    web({ 'https://h.example/live/index.m3u8': '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow.m3u8\n' })
    try {
      const host = await start()
      for (const url of ['https://h.example/live/index.m3u8', 'https://s.example/listen?type=.m3u']) {
        buttonNamed(host, 'Add station').click(); await nextTick()
        await type(dialogOf(host).querySelector('#st-url') as HTMLInputElement, url)
        await type(dialogOf(host).querySelector('#st-name') as HTMLInputElement, url)
        buttonNamed(dialogOf(host), 'Add station').click()
        await vi.waitFor(() => expect(disk.get('/Radio/A.m3u8')!.body).toContain(url))
        expect(statusOf(host)).not.toContain('playlist link')
      }
    } finally { vi.unstubAllGlobals() }
  })

  it('a playlist pointing only to another, past the depth followed: not saved as a stream, and said', async () => {
    seed('A.m3u8', list('https://a/1'))
    web({ 'https://a.example/outer.pls': '[playlist]\nFile1=https://b.example/inner.pls\nNumberOfEntries=1\n' })
    try {
      const host = await start({ maxPlaylistDepth: 1 })
      buttonNamed(host, 'Add station').click(); await nextTick()
      await type(dialogOf(host).querySelector('#st-url') as HTMLInputElement, 'https://a.example/outer.pls')
      await type(dialogOf(host).querySelector('#st-name') as HTMLInputElement, 'X')
      buttonNamed(dialogOf(host), 'Add station').click()
      await vi.waitFor(() => expect(statusOf(host)).toContain('it lists only other playlists, from which no stream was read'))
      expect(statusOf(host)).toContain('then a playlist it lists')
      await vi.waitFor(() => expect(disk.get('/Radio/A.m3u8')!.body).toContain('https://a.example/outer.pls'))
      expect(disk.get('/Radio/A.m3u8')!.body).not.toContain('\nhttps://b.example/inner.pls\n')
    } finally { vi.unstubAllGlobals() }
  })

  it('a playlist listing a playlist and an http stream: the stream is saved, never the playlist link, and said as http', async () => {
    seed('A.m3u8', list('https://a/1'))
    vi.stubGlobal('location', { ...location, protocol: 'https:' })
    web({ 'https://o.example/o.pls': '[playlist]\nFile1=https://b.example/1.pls\nFile2=http://s.example/live\nFile3=http://t.example/live\nNumberOfEntries=3\n' })
    try {
      const host = await start()
      buttonNamed(host, 'Add station').click(); await nextTick()
      await type(dialogOf(host).querySelector('#st-url') as HTMLInputElement, 'https://o.example/o.pls')
      await type(dialogOf(host).querySelector('#st-name') as HTMLInputElement, 'X')
      buttonNamed(dialogOf(host), 'Add station').click()
      await vi.waitFor(() => expect(statusOf(host)).toContain('Saved with 2 servers'))
      expect(statusOf(host)).toContain('They are http, which this page may not play: ask your administrator to relay them')
      await vi.waitFor(() => expect(disk.get('/Radio/A.m3u8')!.body).toContain('http://s.example/live'))
      expect(disk.get('/Radio/A.m3u8')!.body).not.toContain('https://b.example/1.pls')
    } finally { vi.unstubAllGlobals() }
  })

  it('a .m3u8 station list listing only playlists is said, though .m3u8 alone would be taken for HLS', async () => {
    seed('A.m3u8', list('https://a/1'))
    web({ 'https://l.example/list.m3u8': '#EXTM3U\n#EXTINF:-1,One\nhttps://b.example/1.pls\n#EXTINF:-1,Two\nhttps://c.example/2.pls\n' })
    try {
      const host = await start()
      buttonNamed(host, 'Add station').click(); await nextTick()
      await type(dialogOf(host).querySelector('#st-url') as HTMLInputElement, 'https://l.example/list.m3u8')
      await type(dialogOf(host).querySelector('#st-name') as HTMLInputElement, 'X')
      buttonNamed(dialogOf(host), 'Add station').click()
      await vi.waitFor(() => expect(statusOf(host)).toContain('it lists only other playlists'))
    } finally { vi.unstubAllGlobals() }
  })

  const addVia = async (host: HTMLElement, url: string, name = 'X') => {
    buttonNamed(host, 'Add station').click(); await nextTick()
    await type(dialogOf(host).querySelector('#st-url') as HTMLInputElement, url)
    await type(dialogOf(host).querySelector('#st-name') as HTMLInputElement, name)
    buttonNamed(dialogOf(host), 'Add station').click()
  }

  it('a refused .m3u8: may be a playlist link, or an HLS stream that would not play here anyway', async () => {
    seed('A.m3u8', list('https://a/1'))
    const host = await start() // the app tests' network refuses
    await addVia(host, 'https://hls.example/live.m3u8')
    await vi.waitFor(() => expect(statusOf(host)).toContain('Saved, but this may be a playlist link, and it could not be reached'))
    expect(statusOf(host)).toContain('If it is an HLS stream rather than a station list, it would not play here in any case')
  })

  it('a playlist whose only stream is HLS: saved, and said that this player does not play it yet', async () => {
    seed('A.m3u8', list('https://a/1'))
    web({ 'https://o.example/hls.pls': '[playlist]\nFile1=https://b.example/live.m3u8\nNumberOfEntries=1\n' })
    try {
      const host = await start()
      await addVia(host, 'https://o.example/hls.pls')
      await vi.waitFor(() => expect(statusOf(host)).toContain('the stream inside it was saved. It is an HLS stream, which this player does not play yet.'))
    } finally { vi.unstubAllGlobals() }
  })

  it('http and HLS streams, none playing here: not called all http', async () => {
    seed('A.m3u8', list('https://a/1'))
    vi.stubGlobal('location', { ...location, protocol: 'https:' })
    web({ 'https://o.example/mix.pls': '[playlist]\nFile1=http://a.example/s\nFile2=https://b.example/live.m3u8\nNumberOfEntries=2\n' })
    try {
      const host = await start()
      await addVia(host, 'https://o.example/mix.pls')
      await vi.waitFor(() => expect(statusOf(host)).toContain('None of them plays here: one is http, which this page may not play, and one is an HLS stream'))
      expect(statusOf(host)).not.toContain('They are http')
    } finally { vi.unstubAllGlobals() }
  })

  it('http nobody relays is said not to play on any page (this app plays it on none); https streams are not', async () => {
    seed('A.m3u8', list('https://a/1'))
    web({
      'https://o.example/h.pls': '[playlist]\nFile1=http://s.example/live\nNumberOfEntries=1\n',
      'https://o.example/s.pls': '[playlist]\nFile1=https://s.example/live\nNumberOfEntries=1\n'
    })
    try {
      const host = await start() // the test page is http
      await addVia(host, 'https://o.example/h.pls', 'H')
      await vi.waitFor(() => expect(statusOf(host)).toContain('the stream inside it was saved. It is http, which this page may not play'))
      await addVia(host, 'https://o.example/s.pls', 'S')
      await vi.waitFor(() => expect(disk.get('/Radio/A.m3u8')!.body).toContain('https://s.example/live'))
      expect(statusOf(host)).not.toContain('may not play')
    } finally { vi.unstubAllGlobals() }
  })

  it('a save refused (the stream already in the list): that is said, and "saved" is never shown', async () => {
    seed('A.m3u8', list('https://s.example/live'))
    web({ 'https://o.example/s.pls': '[playlist]\nFile1=https://s.example/live\nNumberOfEntries=1\n' })
    try {
      const host = await start()
      const seen: string[] = []
      const watch = new MutationObserver(() => seen.push(statusOf(host)))
      watch.observe(host, { subtree: true, childList: true, characterData: true })
      await addVia(host, 'https://o.example/s.pls')
      await vi.waitFor(() => expect(statusOf(host)).toContain('already in this list'))
      watch.disconnect()
      expect(seen.some((s) => s.includes('Saved'))).toBe(false)
    } finally { vi.unstubAllGlobals() }
  })

  it('http and HLS streams on an http page: both are the reason, as on https', async () => {
    seed('A.m3u8', list('https://a/1'))
    web({ 'https://o.example/mix.pls': '[playlist]\nFile1=http://a.example/s\nFile2=https://b.example/live.m3u8\nNumberOfEntries=2\n' })
    try {
      const host = await start() // the test page is http
      await addVia(host, 'https://o.example/mix.pls')
      await vi.waitFor(() => expect(statusOf(host)).toContain('None of them plays here: one is http, which this page may not play, and one is an HLS stream'))
    } finally { vi.unstubAllGlobals() }
  })

  it('an http HLS stream counts as HLS, not as http a relay would mend', async () => {
    seed('A.m3u8', list('https://a/1'))
    vi.stubGlobal('location', { ...location, protocol: 'https:' })
    web({ 'https://o.example/m.pls': '[playlist]\nFile1=http://a.example/s\nFile2=http://b.example/live.m3u8\nNumberOfEntries=2\n' })
    try {
      const host = await start()
      await addVia(host, 'https://o.example/m.pls')
      await vi.waitFor(() => expect(statusOf(host)).toContain('None of them plays here: one is http, which this page may not play, and one is an HLS stream'))
    } finally { vi.unstubAllGlobals() }
  })

  it('playlist links it lists take none of the ten places: the stream after them is kept', async () => {
    seed('A.m3u8', list('https://a/1'))
    const lists = Array.from({ length: 10 }, (_, i) => `https://l.example/${i}.pls`)
    const entries = [...lists, 'http://s.example/live']
    web({ 'https://o.example/many.pls': `[playlist]\n${entries.map((u, i) => `File${i + 1}=${u}`).join('\n')}\nNumberOfEntries=${entries.length}\n` })
    try {
      const host = await start({ maxPlaylistDepth: 1 })
      await addVia(host, 'https://o.example/many.pls')
      await vi.waitFor(() => expect(disk.get('/Radio/A.m3u8')!.body).toContain('http://s.example/live'))
    } finally { vi.unstubAllGlobals() }
  })

  it('a .m3u8 read and known to be a station list is not hedged as maybe HLS', async () => {
    seed('A.m3u8', list('https://a/1'))
    web({ 'https://l.example/list.m3u8': '#EXTM3U\n#EXTINF:-1,One\nhttps://b.example/1.pls\n' })
    try {
      const host = await start({ maxPlaylistDepth: 1 })
      await addVia(host, 'https://l.example/list.m3u8')
      await vi.waitFor(() => expect(statusOf(host)).toContain('Saved, but this is a playlist link, and it lists only other playlists'))
    } finally { vi.unstubAllGlobals() }
  })

  it('an http link from an https page with no answer in time: http still given as the likely reason', async () => {
    seed('A.m3u8', list('https://a/1'))
    vi.stubGlobal('location', { ...location, protocol: 'https:' })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('timed out', 'AbortError') }))
    const host = await start()
    await addVia(host, 'http://old.example/live.pls')
    await vi.waitFor(() => expect(statusOf(host)).toContain('no stream could be read from it over https. Its address is http'))
  })

  it('editing a station to a playlist link that cannot be read: said as when adding', async () => {
    seed('A.m3u8', list('https://a/1'))
    const host = await start() // the app tests' network refuses
    ;(host.querySelector('button[aria-label="Edit Station 1"]') as HTMLButtonElement).click()
    await nextTick()
    await type(dialogOf(host).querySelector('#st-url') as HTMLInputElement, 'https://somafm.com/groovesalad.pls')
    buttonNamed(dialogOf(host), 'Save changes').click()
    await vi.waitFor(() => expect(statusOf(host)).toContain('Saved, but this is a playlist link, and it could not be reached'))
  })

  it('lookups switched off, an https link: said as not read', async () => {
    seed('A.m3u8', list('https://a/1'))
    const host = await start({ maxPlaylistDepth: 0 })
    await addVia(host, 'https://o.example/s.pls')
    await vi.waitFor(() => expect(statusOf(host)).toContain('it was not read: this site is set not to read playlists'))
  })

  it('a .m3u8 station list that is refused is said, though .m3u8 alone would be taken for HLS', async () => {
    seed('A.m3u8', list('https://a/1'))
    const host = await start() // the app tests' network refuses
    buttonNamed(host, 'Add station').click(); await nextTick()
    await type(dialogOf(host).querySelector('#st-url') as HTMLInputElement, 'https://a.example/stations.m3u8')
    await type(dialogOf(host).querySelector('#st-name') as HTMLInputElement, 'X')
    buttonNamed(dialogOf(host), 'Add station').click()
    await vi.waitFor(() => expect(statusOf(host)).toContain('could not be reached or read from this page'))
  })

  it('a playlist whose only stream is http, on an https page: saved, and said that it will not play here', async () => {
    seed('A.m3u8', list('https://a/1'))
    vi.stubGlobal('location', { ...location, protocol: 'https:' })
    web({ 'https://e.example/h.pls': '[playlist]\nFile1=http://s.example/live\nNumberOfEntries=1\n' })
    try {
      const host = await start()
      buttonNamed(host, 'Add station').click(); await nextTick()
      await type(dialogOf(host).querySelector('#st-url') as HTMLInputElement, 'https://e.example/h.pls')
      await type(dialogOf(host).querySelector('#st-name') as HTMLInputElement, 'X')
      buttonNamed(dialogOf(host), 'Add station').click()
      await vi.waitFor(() => expect(statusOf(host)).toContain('the stream inside it was saved. It is http, which this page may not play'))
    } finally { vi.unstubAllGlobals() }
  })

  it('an http link from an https page whose https address has nothing: said, with http as the likely reason', async () => {
    seed('A.m3u8', list('https://a/1'))
    vi.stubGlobal('location', { ...location, protocol: 'https:' })
    web({}) // every address: a 404
    try {
      const host = await start()
      buttonNamed(host, 'Add station').click(); await nextTick()
      await type(dialogOf(host).querySelector('#st-url') as HTMLInputElement, 'http://old.example/live.pls')
      await type(dialogOf(host).querySelector('#st-name') as HTMLInputElement, 'X')
      buttonNamed(dialogOf(host), 'Add station').click()
      await vi.waitFor(() => expect(statusOf(host)).toContain('it could not be read over https from this page: its host answered, but not with a playlist. Its address is http'))
      expect(statusOf(host)).not.toContain('connect-src') // nothing was refused
    } finally { vi.unstubAllGlobals() }
  })

  it('an http link from an https page, with lookups switched off: said as not read', async () => {
    seed('A.m3u8', list('https://a/1'))
    vi.stubGlobal('location', { ...location, protocol: 'https:' })
    const host = await start({ maxPlaylistDepth: 0 })
    buttonNamed(host, 'Add station').click(); await nextTick()
    await type(dialogOf(host).querySelector('#st-url') as HTMLInputElement, 'http://old.example/live.pls')
    await type(dialogOf(host).querySelector('#st-name') as HTMLInputElement, 'X')
    buttonNamed(dialogOf(host), 'Add station').click()
    await vi.waitFor(() => expect(statusOf(host)).toContain('Saved, but this is a playlist link, and it was not read: this site is set not to read playlists'))
  })

  it('one pointing to another that cannot be read: the advice is to open that one', async () => {
    seed('A.m3u8', list('https://a/1'))
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === 'https://a.example/outer.pls') return answer('[playlist]\nFile1=https://b.example/inner.pls\nNumberOfEntries=1\n')
      throw new TypeError('Failed to fetch')
    }))
    const host = await start()
    buttonNamed(host, 'Add station').click(); await nextTick()
    await type(dialogOf(host).querySelector('#st-url') as HTMLInputElement, 'https://a.example/outer.pls')
    await type(dialogOf(host).querySelector('#st-name') as HTMLInputElement, 'X')
    buttonNamed(dialogOf(host), 'Add station').click()
    await vi.waitFor(() => expect(statusOf(host)).toContain('it points to another playlist, on b.example, which could not be reached'))
    expect(statusOf(host)).toContain('then the playlist it points to')
  })

  it('read again when every server failed: the reason is said where the failure is', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1 radio-source="https://somafm.com/x.pls",Station 1\nhttps://a/1\n')
    // No retries left, so the play is given up on as soon as the playlist is refused.
    const host = mount(App, { applicationConfig: { ...config, reconnectAttempts: 0 } })
    await vi.waitFor(() => expect(host.querySelector('button[aria-label="Play Station 1"]')).not.toBeNull())
    ;(host.querySelector('button[aria-label="Play Station 1"]') as HTMLButtonElement).click()
    created.at(-1)!.fail(2)
    await vi.waitFor(() => expect(host.textContent).toContain("The station's playlist could not be reached or read"))
    expect(host.textContent).toContain('connect-src')
  })

  it('not said for a play that is over: stopped, or another station picked, while the playlist was being asked for', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1 radio-source="https://somafm.com/x.pls",Station 1\nhttps://a/1\n#EXTINF:-1,Station 2\nhttps://a/2\n')
    // The playlist's answer held back until the user has moved on; anything
    // else asked for (titles) refused at once.
    let refuse: (() => void) | undefined
    vi.stubGlobal('fetch', vi.fn((url: string) => url === 'https://somafm.com/x.pls'
      ? new Promise((_ok, no) => { refuse = () => no(new TypeError('refused')) })
      : Promise.reject(new TypeError('refused'))))
    const host = await start()
    for (const thenWhat of ['Stop', 'Play Station 2']) { // the bar's Stop; another station's row
      refuse = undefined
      ;(host.querySelector('button[aria-label="Play Station 1"]') as HTMLButtonElement).click()
      created.at(-1)!.fail(2)                                   // every server failed: the playlist is asked for…
      await vi.waitFor(() => expect(refuse).toBeDefined())
      await vi.waitFor(() => expect(host.querySelector(`button[aria-label="${thenWhat}"]`)).not.toBeNull())
      ;(host.querySelector(`button[aria-label="${thenWhat}"]`) as HTMLButtonElement).click() // …and the user moves on
      if (thenWhat === 'Play Station 2') created.at(-1)!.succeed() // the station picked plays
      refuse!()
      await wait(50)
      expect(host.textContent).not.toContain("The station's playlist could not be reached")
      expect(host.textContent).not.toContain('Reconnecting') // nor is the play now under way set back
      ;(host.querySelector('button[aria-label="Stop"]') as HTMLButtonElement | null)?.click()
    }
  })
})

describe('finding backup servers for a whole list', () => {
  it('looks, shows, and writes what is applied to the list, backed up first', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,Drone Zone\nhttps://ice6.somafm.com/dronezone-64-aac\n')
    const servers = ['ice6', 'ice2', 'ice5'].map((h) => `https://${h}.somafm.com/dronezone-64-aac`)
    web({
      'https://api.somafm.com/channels.json': JSON.stringify({ channels: [{ id: 'dronezone', playlists: [{ url: 'https://api.somafm.com/dronezone64.pls' }] }] }),
      'https://api.somafm.com/dronezone64.pls': `[playlist]\n${servers.map((s, i) => `File${i + 1}=${s}`).join('\n')}\n`
    })
    try {
      const host = await start()
      buttonNamed(host, 'find backup servers').click(); await nextTick()
      await vi.waitFor(() => expect((dialogOf(host).textContent ?? '').replace(/\s+/g, ' ')).toContain('Found changes for 1 of 1'))
      buttonNamed(dialogOf(host), 'Apply to 1 station').click(); await nextTick()
      expect(statusOf(host)).toContain('Updated 1 station')
      await vi.waitFor(() => expect(disk.get('/Radio/A.m3u8')!.body).toContain('radio-alt='), { timeout: 3000 })
      const body = disk.get('/Radio/A.m3u8')!.body
      expect(body).toContain('radio-source="https://api.somafm.com/dronezone64.pls"')
      expect(body).toContain('https://ice2.somafm.com/dronezone-64-aac https://ice5.somafm.com/dronezone-64-aac')
      expect([...disk.keys()].some((k) => k.startsWith('/Radio/Backups/A.'))).toBe(true)
    } finally { vi.unstubAllGlobals() }
  })
})
