import { describe, it, expect, vi, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { findBackupServers, forgetLookups, mergeServers, MAX_SERVERS } from '../src/helpers/backupServers'
import { Refused } from '../src/helpers/fetch'
import { readPlaylistServers } from '../src/helpers/resolve'
import { refreshedServers } from '../src/helpers/stations'
import { isPlaylistUrl, isStationListUrl } from '../src/helpers/playlist'
import { classifyUrl } from '../src/helpers/classify'
import StationForm from '../src/components/StationForm.vue'
import BackupServersDialog from '../src/components/BackupServersDialog.vue'
import { mount, buttonNamed } from './support/mount'
import { web, answer, refusing } from './support/web'

/**
 * Finding a station's other servers. The stand-ins answer as the hosts were
 * measured to answer in November 2026: SomaFM's channel list and playlists
 * (three servers each, one playlist per quality), StreamTheWorld's mount
 * playlists, and the directory's entry for a station.
 */
afterEach(() => { vi.unstubAllGlobals(); forgetLookups() })

const pls = (...urls: string[]) => `[playlist]\nnumberofentries=${urls.length}\n${urls.map((u, i) => `File${i + 1}=${u}\nTitle${i + 1}=x`).join('\n')}\nVersion=2\n`
const soma = (channel: string, mount: string) => ['ice2', 'ice6', 'ice5'].map((h) => `https://${h}.somafm.com/${channel}-${mount}`)


const SOMA = {
  'https://api.somafm.com/channels.json': JSON.stringify({ channels: [{ id: 'dronezone', playlists: [
    { url: 'https://api.somafm.com/dronezone256.pls', format: 'mp3' },
    { url: 'https://api.somafm.com/dronezone130.pls', format: 'aac' },
    { url: 'https://api.somafm.com/dronezone64.pls', format: 'aacp' }] }] }),
  'https://somafm.com/dronezone.pls': pls(...soma('dronezone', '128-mp3')),
  'https://api.somafm.com/dronezone256.pls': pls(...soma('dronezone', '256-mp3')),
  'https://api.somafm.com/dronezone130.pls': pls(...soma('dronezone', '128-aac')),
  'https://api.somafm.com/dronezone64.pls': pls(...soma('dronezone', '64-aac'))
}

describe('which servers are kept', () => {
  it('the address playing stays first, then the rest, nothing twice', () => {
    const merged = mergeServers({ id: '1', name: 'S', url: 'https://ice6.somafm.com/x' }, ['https://ice2.somafm.com/x', 'https://ice6.somafm.com/x', 'https://ice5.somafm.com/x'])
    expect(merged).toEqual({ url: 'https://ice6.somafm.com/x', alternates: ['https://ice2.somafm.com/x', 'https://ice5.somafm.com/x'] })
  })

  it('an http address gives way to https, and is kept only where there is nothing better', () => {
    expect(mergeServers({ id: '1', name: 'S', url: 'http://a/s' }, ['https://b/s', 'http://c/s']))
      .toEqual({ url: 'https://b/s', alternates: [] })
    // Nothing better: what the station had stays first.
    expect(mergeServers({ id: '1', name: 'S', url: 'http://a/s' }, ['http://c/s']))
      .toEqual({ url: 'http://a/s', alternates: ['http://c/s'] })
  })

  it('no more than ten, out of a host fleet of a hundred', () => {
    const fleet = Array.from({ length: 100 }, (_, i) => `https://${i}.live.streamtheworld.com:443/RADIO538_SC`)
    const merged = mergeServers({ id: '1', name: 'S', url: 'https://x.live.streamtheworld.com/RADIO538.mp3' }, fleet)
    expect(merged.alternates.length + 1).toBe(MAX_SERVERS)
  })
})

describe('finding the playlist', () => {
  it("SomaFM: the playlist that lists this stream's own quality, not the first one offered", async () => {
    const { request } = web(SOMA)
    const f = await findBackupServers({ id: '1', name: 'Drone Zone', url: 'https://ice6.somafm.com/dronezone-64-aac' }, { request })
    expect(f).toEqual({ playlist: 'https://api.somafm.com/dronezone64.pls', url: 'https://ice6.somafm.com/dronezone-64-aac',
      alternates: ['https://ice2.somafm.com/dronezone-64-aac', 'https://ice5.somafm.com/dronezone-64-aac'], added: 2, converted: 0 })
  })

  it('SomaFM: a stream no playlist lists is left alone rather than switched to another quality', async () => {
    const { request } = web(SOMA)
    expect(await findBackupServers({ id: '1', name: 'X', url: 'https://ice6.somafm.com/dronezone-320-flac' }, { request })).toBeNull()
  })

  it("StreamTheWorld: the mount's playlist", async () => {
    const { request, asked } = web({ 'https://playerservices.streamtheworld.com/pls/KUOWFM_HIGH_MP3.pls':
      pls('https://18433.live.streamtheworld.com:443/KUOWFM_HIGH_MP3_SC', 'https://18233.live.streamtheworld.com:443/KUOWFM_HIGH_MP3_SC') })
    const f = await findBackupServers({ id: '1', name: 'KUOW', url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/KUOWFM_HIGH_MP3.mp3' }, { request })
    expect(f?.added).toBe(2)
    expect(f?.url).toBe('https://playerservices.streamtheworld.com/api/livestream-redirect/KUOWFM_HIGH_MP3.mp3')
    expect(asked).toEqual(['https://playerservices.streamtheworld.com/pls/KUOWFM_HIGH_MP3.pls'])
  })

  it('the directory is asked only when the administrator has enabled it', async () => {
    const station = { id: '1', name: 'Groove Salad', url: 'https://ice6.somafm.com/groovesalad-128-mp3', extra: { 'radiobrowser-uuid': 'u-1' } }
    const table = {
      'https://dir.example/json/stations/byuuid/u-1': JSON.stringify([{ url: 'https://other.example/groovesalad.pls' }]),
      'https://other.example/groovesalad.pls': pls('https://ice6.somafm.com/groovesalad-128-mp3', 'https://relay.example/groovesalad-128-mp3')
    }
    const off = web(table)
    expect(await findBackupServers(station, { request: off.request, directory: false, directoryHost: 'dir.example' })).toBeNull()
    expect(off.asked.some((u) => u.includes('dir.example'))).toBe(false) // the station's name went nowhere
    const on = web(table)
    const f = await findBackupServers(station, { request: on.request, directory: true, directoryHost: 'dir.example' })
    expect(f?.playlist).toBe('https://other.example/groovesalad.pls')
    expect(f?.alternates).toEqual(['https://relay.example/groovesalad-128-mp3'])
  })

  it("the station's own playlist comes first, and a playlist that adds nothing is not news", async () => {
    const { request } = web({ 'https://a.example/station.pls': pls('https://a.example/s', 'https://b.example/s') })
    const station = { id: '1', name: 'S', url: 'https://a.example/s', source: 'https://a.example/station.pls' }
    expect((await findBackupServers(station, { request }))?.added).toBe(1)
    expect(await findBackupServers({ ...station, alternates: ['https://b.example/s'] }, { request })).toBeNull()
  })

  it('a station with no playlist anywhere is nothing found', async () => {
    const { request } = web({})
    expect(await findBackupServers({ id: '1', name: 'KCUR', url: 'https://kcur.streamguys1.com/kcur-website-icy' }, { request })).toBeNull()
  })
})

describe('reading a playlist given by its http address', () => {
  it('asks for it over https first, since a secure page may not fetch http at all', async () => {
    const { asked } = web({ 'https://old.example/list.pls': pls('https://old.example/s1', 'https://old.example/s2') })
    expect(await readPlaylistServers('http://old.example/list.pls', 2)).toEqual(['https://old.example/s1', 'https://old.example/s2'])
    expect(asked[0]).toBe('https://old.example/list.pls')
  })
})

describe('when every server fails and the playlist is read again', () => {
  // SLAY Radio's own playlist, as served in November 2026: http-only relays.
  const SLAY = ['http://relay1.slayradio.org:8000/', 'http://relay4.slayradio.org:8000/']

  it("a relayed station keeps its relay: the http-only station's playlist cannot replace it", () => {
    const relayed = { id: '1', name: 'SLAY Radio', url: 'https://cloud.example.org/radio-relay/slay4',
      alternates: ['https://cloud.example.org/radio-relay/slay3'], source: 'http://www.slayradio.org/tune_in.php/128kbps/listen.m3u' }
    expect(refreshedServers(relayed, SLAY)).toEqual([]) // nothing to move to: the file is left alone
  })

  it('an https station takes only https servers from it', () => {
    expect(refreshedServers({ id: '1', name: 'S', url: 'https://a/s' }, ['http://b/s', 'https://c/s'])).toEqual(['https://c/s'])
  })

  it('a station already on http takes the list as it is', () => {
    expect(refreshedServers({ id: '1', name: 'SLAY Radio', url: 'http://relay3.slayradio.org:8000/' }, SLAY)).toEqual(SLAY)
  })
})

describe('in the station form', () => {
  it('fills in the servers and the playlist address, for the user to look over and save', async () => {
    const saved: Array<Record<string, unknown>> = []
    const host = mount(StationForm, {
      station: { id: 'x', name: 'Drone Zone', url: 'https://ice6.somafm.com/dronezone-64-aac' }, groups: [],
      findServers: async () => ({ playlist: 'https://api.somafm.com/dronezone64.pls', url: 'https://ice6.somafm.com/dronezone-64-aac',
        alternates: ['https://ice2.somafm.com/dronezone-64-aac', 'https://ice5.somafm.com/dronezone-64-aac'], added: 2, converted: 0 }),
      onSave: (s: Record<string, unknown>) => saved.push(s)
    })
    buttonNamed(host, 'Find backup servers').click()
    await vi.waitFor(() => expect(host.textContent).toContain('Found 2 more servers'))
    expect((host.querySelector('#st-alt') as HTMLTextAreaElement).value).toBe('https://ice2.somafm.com/dronezone-64-aac\nhttps://ice5.somafm.com/dronezone-64-aac')
    expect((host.querySelector('#st-source') as HTMLInputElement).value).toBe('https://api.somafm.com/dronezone64.pls')
    expect(saved).toEqual([]) // nothing is saved until the user says so
    buttonNamed(host, 'Save changes').click(); await nextTick()
    expect(saved[0]).toMatchObject({ alternates: ['https://ice2.somafm.com/dronezone-64-aac', 'https://ice5.somafm.com/dronezone-64-aac'],
      source: 'https://api.somafm.com/dronezone64.pls' })
  })

  it('says so when there is nothing to find, and offers nothing without a way to look', async () => {
    const host = mount(StationForm, { station: { id: 'x', name: 'KCUR', url: 'https://kcur.streamguys1.com/kcur-website-icy' }, groups: [],
      findServers: async () => null })
    buttonNamed(host, 'Find backup servers').click()
    await vi.waitFor(() => expect(host.textContent).toContain('No playlist listing other servers'))
    expect(buttonNamed(mount(StationForm, { station: null, groups: [] }), 'Find backup servers')).toBeUndefined()
  })
})

describe('for a whole list', () => {
  it('shows what it found and changes only what is ticked', async () => {
    const stations = [
      { id: 'a', name: 'Groove Salad', url: 'https://ice2.somafm.com/groovesalad-128-mp3' },
      { id: 'b', name: 'KCUR', url: 'https://kcur.streamguys1.com/kcur-website-icy' },
      { id: 'c', name: 'Drone Zone', url: 'https://ice6.somafm.com/dronezone-64-aac' }
    ]
    const applied: unknown[] = []
    const host = mount(BackupServersDialog, {
      stations,
      findServers: async (s: { id: string }) => (s.id === 'b' ? null
        : { playlist: `https://somafm.com/${s.id}.pls`, url: 'https://x/1', alternates: ['https://x/2', 'https://x/3'], added: 2, converted: 0 }),
      onApply: (c: unknown) => applied.push(c)
    })
    const said = () => (host.textContent ?? '').replace(/\s+/g, ' ')
    await vi.waitFor(() => expect(said()).toContain('Found changes for 2 of 3 stations'))
    expect(host.textContent).not.toContain('KCUR')
    const boxes = [...host.querySelectorAll('input[type=checkbox]')] as HTMLInputElement[]
    boxes[1].click(); await nextTick() // untick the second
    buttonNamed(host, 'Apply to 1 station').click(); await nextTick()
    expect((applied[0] as Array<{ id: string }>).map((c) => c.id)).toHaveLength(1)
  })
})

describe('a lookup this page was not allowed to make', () => {
  // A host's cross-origin refusal and this site's own connect-src refusal both
  // reach a page as a TypeError with nothing more said.
  it('is not "nothing there": it says the playlist could not be read', async () => {
    const request = refusing()
    await expect(findBackupServers({ id: '1', name: 'Groove Salad', url: 'https://ice2.somafm.com/groovesalad-128-mp3' }, { request }))
      .rejects.toBeInstanceOf(Refused)
  })

  it('while a host that answers, with nothing, is still nothing found', async () => {
    const { request } = web({})
    expect(await findBackupServers({ id: '1', name: 'Groove Salad', url: 'https://ice2.somafm.com/groovesalad-128-mp3' }, { request })).toBeNull()
  })

  it('the station form says so, naming both reasons and where to look', async () => {
    const host = mount(StationForm, { station: { id: 'x', name: 'Groove Salad', url: 'https://ice2.somafm.com/groovesalad-128-mp3' }, groups: [],
      findServers: async () => { throw new Refused() } })
    buttonNamed(host, 'Find backup servers').click()
    await vi.waitFor(() => expect(host.textContent).toContain('could not be reached or read from this page'))
    expect(host.textContent).toContain('connect-src')
    expect(host.textContent).toContain('INSTALL.md')
  })

  it('pasting a playlist link that cannot be read says why; one that reads empty does not blame the station', async () => {
    refusing()
    await expect(readPlaylistServers('https://somafm.com/groovesalad.pls', 2)).rejects.toBeInstanceOf(Refused)
    vi.unstubAllGlobals()
    web({})
    expect(await readPlaylistServers('https://somafm.com/groovesalad.pls', 2)).toEqual([]) // a 404: nothing there, not refused
  })

  it('the whole-list dialog counts the stations it could not look up', async () => {
    const host = mount(BackupServersDialog, {
      stations: [{ id: 'a', name: 'A', url: 'https://a.example/s' }, { id: 'b', name: 'B', url: 'https://b.example/s' }],
      findServers: async (s: { id: string }) => { if (s.id === 'a') throw new Refused(); return null }
    })
    await vi.waitFor(() => expect((host.textContent ?? '').replace(/\s+/g, ' ')).toContain("For A, the station's playlist could not be reached or read"))
  })
})

describe('a refusal, told apart from what is not one', () => {
  it('the browser knowing it is offline is not a refusal: nothing is blamed', async () => {
    refusing()
    const online = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine') ?? Object.getOwnPropertyDescriptor(navigator, 'onLine')
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    try {
      expect(await readPlaylistServers('https://somafm.com/groovesalad.pls', 2)).toEqual([])
    } finally {
      if (online) Object.defineProperty(navigator, 'onLine', online); else delete (navigator as unknown as Record<string, unknown>).onLine
      vi.unstubAllGlobals()
    }
  })

  it('a refused directory is a refusal too, not "nothing found"', async () => {
    const request = refusing()
    const lookup = findBackupServers({ id: '1', name: 'Some Station', url: 'https://some.example/live' },
      { request, directory: true, directoryHost: 'dir.example' })
    await expect(lookup).rejects.toBeInstanceOf(Refused)
    await expect(lookup).rejects.toThrow(/^The online directory \(dir\.example\) could not be reached or read/) // named as what it was
  })

  it('a refused SomaFM channel list is asked for once a minute, not once a station', async () => {
    vi.useFakeTimers()
    try {
      const request = refusing()
      const asked = () => request.mock.calls.filter((c) => String(c[0]).includes('channels.json')).length
      const station = (ch: string) => ({ id: ch, name: ch, url: `https://ice2.somafm.com/${ch}-128-mp3` })
      await findBackupServers(station('groovesalad'), { request }).catch(() => null)
      await findBackupServers(station('dronezone'), { request }).catch(() => null)
      expect(asked()).toBe(1)
      await vi.advanceTimersByTimeAsync(61_000)
      await findBackupServers(station('lush'), { request }).catch(() => null)
      expect(asked()).toBe(2)
    } finally { vi.useRealTimers() }
  })
})

describe('which refusal is named, and what is not one', () => {
  it('the playlist and the directory both refused: the playlist is named', async () => {
    const request = refusing()
    await expect(findBackupServers({ id: '1', name: 'S', url: 'https://some.example/live', source: 'https://some.example/s.pls' },
      { request, directory: true, directoryHost: 'dir.example' })).rejects.toThrow(/^The station's playlist/)
  })

  it('a directory or channel list answering something that is not a list is nothing found, not a refusal', async () => {
    const { request } = web({
      'https://dir.example/json/stations/search?name=S&limit=20&hidebroken=true': 'null',
      'https://api.somafm.com/channels.json': '{"channels": null}'
    })
    expect(await findBackupServers({ id: '1', name: 'S', url: 'https://some.example/live' },
      { request, directory: true, directoryHost: 'dir.example' })).toBeNull()
    expect(await findBackupServers({ id: '2', name: 'Drone Zone', url: 'https://ice2.somafm.com/dronezone-64-aac' }, { request })).toBeNull()
  })

  it('the whole-list dialog names a refused directory as the directory', async () => {
    const host = mount(BackupServersDialog, {
      stations: [{ id: 'a', name: 'A', url: 'https://a.example/s' }],
      findServers: async () => { throw new Refused('directory') }
    })
    await vi.waitFor(() => expect((host.textContent ?? '').replace(/\s+/g, ' ')).toContain('For A, the online directory could not be reached'))
    expect(host.textContent).toContain('No station in this list could be fully looked up')
  })
})

describe('the last edge cases of telling a refusal apart', () => {
  it('an http playlist from an https page whose https address has nothing: never asked over http, and http given as the reason', async () => {
    vi.stubGlobal('location', { ...location, protocol: 'https:' })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('https:')) return answer('', { ok: false })   // the https try: nothing there
      throw new TypeError('Mixed Content: blocked')                     // the http try, were it made: it must not be
    }))
    const read = readPlaylistServers('http://old.example/list.pls', 2)
    await expect(read).rejects.toThrow(/^The station's playlist could not be read over https from this page: its host answered, but not with a playlist\. Its address is http/)
    await expect(read).rejects.not.toThrow(/connect-src/)
  })

  it('SomaFM refusing its channel list while its general playlist answers without this stream is a refusal', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('api.somafm.com')) throw new TypeError('Failed to fetch')
      if (url === 'https://somafm.com/dronezone.pls') return answer(pls(...soma('dronezone', '128-mp3')))
      return answer('', { ok: false })
    }))
    await expect(findBackupServers({ id: '1', name: 'Drone Zone', url: 'https://ice6.somafm.com/dronezone-64-aac' },
      { request: fetch })).rejects.toThrow(/^SomaFM's channel list \(on api\.somafm\.com\) could not be reached/) // the playlist itself was read
  })
})

describe('after the review of the refusal changes', () => {
  it('an http-only host on an http page: a 404 over http is a dead link, not a refusal', async () => {
    vi.stubGlobal('location', { ...location, protocol: 'http:' })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('https:')) throw new TypeError('Failed to fetch') // no https on this host
      return answer('', { ok: false })                                      // and nothing at the address
    }))
    expect(await readPlaylistServers('http://old.example/list.pls', 2)).toEqual([])
  })

  it('an http playlist from an https page that the https try cannot reach also names http as a reason', async () => {
    vi.stubGlobal('location', { ...location, protocol: 'https:' })
    refusing()
    const read = readPlaylistServers('http://old.example/list.pls', 2)
    await expect(read).rejects.toBeInstanceOf(Refused)
    await expect(read).rejects.toThrow(/Its address is http/)
    vi.stubGlobal('location', { ...location, protocol: 'https:' })
    await expect(readPlaylistServers('https://somafm.com/groovesalad.pls', 2)).rejects.not.toThrow(/Its address is http/)
  })

  it('a directory answering a list with an empty row in it is nothing found, not a refusal', async () => {
    const { request } = web({ 'https://dir.example/json/stations/search?name=S&limit=20&hidebroken=true': '[null]' })
    expect(await findBackupServers({ id: '1', name: 'S', url: 'https://some.example/live' },
      { request, directory: true, directoryHost: 'dir.example' })).toBeNull()
  })

  it('a playlist read, pointing to an http one that cannot be read: said as the one it points to, and its address', async () => {
    vi.stubGlobal('location', { ...location, protocol: 'https:' })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === 'https://a.example/outer.pls') return answer(pls('http://b.example/inner.pls'))
      throw new TypeError('Failed to fetch')
    }))
    const read = readPlaylistServers('https://a.example/outer.pls', 2)
    await expect(read).rejects.toThrow(/^The station's playlist points to another playlist, on b\.example, which could not be reached/)
    await expect(read).rejects.toThrow(/That playlist's address is http/)
    await expect(read).rejects.not.toThrow(/Its address is http/)
  })

  it('deeper, it is said as one the playlist leads to, through another, with its http address', async () => {
    vi.stubGlobal('location', { ...location, protocol: 'https:' })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === 'https://a.example/outer.pls') return answer(pls('https://b.example/mid.pls'))
      if (url === 'https://b.example/mid.pls') return answer(pls('http://c.example/inner.pls'))
      throw new TypeError('Failed to fetch')
    }))
    const read = readPlaylistServers('https://a.example/outer.pls', 3)
    await expect(read).rejects.toThrow(/^The station's playlist leads, through another playlist, to one, on c\.example, which could not be reached/)
    await expect(read).rejects.toThrow(/That playlist's address is http/)
  })

  it('the whole-list dialog, for several playlists, says their hosts and how many were http', async () => {
    const host = mount(BackupServersDialog, {
      stations: [{ id: 'a', name: 'A', url: 'https://a.example/s' }, { id: 'b', name: 'B', url: 'https://b.example/s' }],
      findServers: async (s: { id: string }) => { throw new Refused('playlist', { http: s.id === 'a' }) }
    })
    await vi.waitFor(() => expect((host.textContent ?? '').replace(/\s+/g, ' ')).toContain('For 2 stations, the playlists could not be reached or read from this page: their hosts may be down'))
    expect(host.textContent).toContain('One of those playlists has an http address, and this https page')
  })

  it('and both or all of them, where all were', async () => {
    const two = mount(BackupServersDialog, {
      stations: [{ id: 'a', name: 'A', url: 'https://a.example/s' }, { id: 'b', name: 'B', url: 'https://b.example/s' }],
      findServers: async () => { throw new Refused('playlist', { http: true }) }
    })
    await vi.waitFor(() => expect(two.textContent).toContain('Both of those playlists have an http address'))
    const three = mount(BackupServersDialog, {
      stations: ['a', 'b', 'c'].map((id) => ({ id, name: id, url: `https://${id}.example/s` })),
      findServers: async () => { throw new Refused('playlist', { http: true }) }
    })
    await vi.waitFor(() => expect(three.textContent).toContain('All of those playlists have an http address'))
  })

  it('one playlist is said as it was, the http reason with it and not after the directory', async () => {
    const host = mount(BackupServersDialog, {
      stations: [{ id: 'a', name: 'A', url: 'https://a.example/s' }, { id: 'b', name: 'B', url: 'https://b.example/s' }],
      findServers: async (s: { id: string }) => { throw s.id === 'a' ? new Refused('playlist', { http: true }) : new Refused('directory') }
    })
    await vi.waitFor(() => expect(host.textContent).toContain('the online directory could not'))
    const notes = [...host.querySelectorAll('[role="note"]')].map((n) => n.textContent ?? '')
    const withHttp = notes.filter((n) => n.includes('is http'))
    expect(withHttp).toHaveLength(1)
    expect(withHttp[0]).toMatch(/^\s*For A, the station's playlist could not/)
    expect(withHttp[0]).toContain('Its address is http')
  })

  it('a playlist found for the station, not its own, is said as that, with its host', async () => {
    const request = refusing()
    await expect(findBackupServers({ id: '1', name: 'Groove Salad', url: 'https://ice2.somafm.com/groovesalad-128-mp3' }, { request }))
      .rejects.toThrow(/^A playlist found for this station \(on somafm\.com\) could not be reached/)
  })

  it('a refused directory is asked once a minute, not once a station', async () => {
    vi.useFakeTimers()
    try {
      const request = refusing()
      const asked = () => request.mock.calls.filter((c) => String(c[0]).includes('dir2.example')).length
      const look = (id: string) => findBackupServers({ id, name: `S${id}`, url: `https://s${id}.example/live` },
        { request, directory: true, directoryHost: 'dir2.example' }).catch(() => null)
      for (const id of ['1', '2', '3']) await look(id)
      expect(asked()).toBe(1)
      await vi.advanceTimersByTimeAsync(61_000)
      await look('4')
      expect(asked()).toBe(2)
    } finally { vi.useRealTimers() }
  })

  it('a relayed station given back its own, its lookup refused: the form and the dialog both say so', async () => {
    const found = { url: 'https://own.example/s', alternates: [], added: 0, converted: 1, unread: new Refused() }
    const form = mount(StationForm, { station: { id: 'x', name: 'R', url: 'https://relay.example/r' }, groups: [], findServers: async () => found })
    buttonNamed(form, 'Find backup servers').click()
    await vi.waitFor(() => expect(form.textContent).toContain("Not every source could be checked: the station's playlist could not be reached"))
    const dialog = mount(BackupServersDialog, { stations: [{ id: 'x', name: 'R', url: 'https://relay.example/r' }], findServers: async () => found })
    await vi.waitFor(() => expect((dialog.textContent ?? '').replace(/\s+/g, ' ')).toContain("For R, the station's playlist could not be reached"))
  })

  it('several playlists leading to others: said as those they lead to', async () => {
    const host = mount(BackupServersDialog, {
      stations: [{ id: 'a', name: 'A', url: 'https://a.example/s' }, { id: 'b', name: 'B', url: 'https://b.example/s' }],
      findServers: async (s: { id: string }) => { throw new Refused('playlist', { levels: s.id === 'a' ? 1 : 0 }) }
    })
    await vi.waitFor(() => expect((host.textContent ?? '').replace(/\s+/g, ' ')).toContain('the playlists, or the playlists they lead to, could not'))
    const all = mount(BackupServersDialog, {
      stations: [{ id: 'a', name: 'A', url: 'https://a.example/s' }, { id: 'b', name: 'B', url: 'https://b.example/s' }],
      findServers: async () => { throw new Refused('playlist', { levels: 1 }) }
    })
    await vi.waitFor(() => expect((all.textContent ?? '').replace(/\s+/g, ' ')).toContain('For 2 stations, the playlists they lead to could not'))
  })

  it('a station refused and one with nothing: "no station that could be looked up has servers to add"', async () => {
    const host = mount(BackupServersDialog, {
      stations: [{ id: 'a', name: 'A', url: 'https://a.example/s' }, { id: 'b', name: 'B', url: 'https://b.example/s' }],
      findServers: async (s: { id: string }) => { if (s.id === 'a') throw new Refused(); return null }
    })
    await vi.waitFor(() => expect(host.textContent).toContain('No station that could be looked up has servers to add.'))
  })

  it('playlists found for several stations, all on one host: that host is named', async () => {
    const host = mount(BackupServersDialog, {
      stations: ['a', 'b', 'c'].map((id) => ({ id, name: id, url: `https://${id}.example/s` })),
      findServers: async () => { throw new Refused('playlist', { host: 'playerservices.streamtheworld.com' }).found() }
    })
    await vi.waitFor(() => expect((host.textContent ?? '').replace(/\s+/g, ' '))
      .toContain('For 3 stations, the playlists found for them (all on playerservices.streamtheworld.com) could not be reached or read from this page: that host may be down'))
  })

  it('four playlists deep: through two others, and the advice is to follow them to the last', async () => {
    vi.stubGlobal('location', { ...location, protocol: 'https:' })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const next: Record<string, string> = {
        'https://a.example/1.pls': 'https://b.example/2.pls',
        'https://b.example/2.pls': 'https://c.example/3.pls',
        'https://c.example/3.pls': 'https://d.example/4.pls'
      }
      if (next[url]) return answer(pls(next[url]))
      throw new TypeError('Failed to fetch')
    }))
    await expect(readPlaylistServers('https://a.example/1.pls', 4))
      .rejects.toThrow(/^The station's playlist leads, through 2 other playlists, to one, on d\.example, which could not/)
  })

  it('playlists on one host, two of them, one leading to another: "both", the host inside, one host blamed', async () => {
    const host = mount(BackupServersDialog, {
      stations: [{ id: 'a', name: 'A', url: 'https://a.example/s' }, { id: 'b', name: 'B', url: 'https://b.example/s' }],
      findServers: async (s: { id: string }) => { throw new Refused('playlist', { host: 'h.example', levels: s.id === 'a' ? 1 : 0 }) }
    })
    await vi.waitFor(() => expect((host.textContent ?? '').replace(/\s+/g, ' '))
      .toContain('For 2 stations, the playlists, or the playlists they lead to (both on h.example), could not be reached or read from this page: that host may be down'))
  })

  it('one playlist found for one station: "found for it", after its name', async () => {
    const host = mount(BackupServersDialog, {
      stations: [{ id: 'a', name: 'Groove Salad', url: 'https://a.example/s' }],
      findServers: async () => { throw new Refused('playlist', { host: 'somafm.com' }).found() }
    })
    await vi.waitFor(() => expect((host.textContent ?? '').replace(/\s+/g, ' '))
      .toContain('For Groove Salad, a playlist found for it (on somafm.com) could not'))
  })
})

describe('playlist links, told and followed', () => {
  it('by path, or by a file its query names; not by a query that names none, nor by a fragment', () => {
    expect(isPlaylistUrl('https://x.example/live.pls')).toBe(true)
    expect(isPlaylistUrl('https://x.example/live.pls#a')).toBe(true)
    expect(isPlaylistUrl('https://x.example/tunein.php?file=station.pls')).toBe(true)
    expect(isPlaylistUrl('https://x.example/tunein.php?a=1&file=station.m3u&b=2')).toBe(true)
    expect(isPlaylistUrl('https://x.example/listen?type=.m3u')).toBe(false)
    expect(isPlaylistUrl('https://x.example/play.php?file=live.m3u8')).toBe(false) // by query, HLS as likely
    expect(isPlaylistUrl('https://x.example/live')).toBe(false)
    expect(isStationListUrl('https://x.example/live.m3u8')).toBe(false)
    expect(classifyUrl('https://x.example/tunein.php?file=station.pls')).toBe('playlist')
  })

  it('an address the browser would never ask for is nothing, not a refusal', async () => {
    const request = vi.fn(async () => { throw new TypeError('Request cannot be constructed from a URL that includes credentials') })
    vi.stubGlobal('fetch', request)
    expect(await readPlaylistServers('https://user:pass@x.example/live.pls', 2)).toEqual([])
    expect(request).not.toHaveBeenCalled()
  })

  it('a playlist listing only playlists: each read in turn, the first giving streams the answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === 'https://o.example/o.pls') return answer(pls('https://a.example/1.pls', 'https://b.example/2.pls'))
      if (url === 'https://b.example/2.pls') return answer(pls('https://s.example/live'))
      throw new TypeError('Failed to fetch')
    }))
    expect(await readPlaylistServers('https://o.example/o.pls', 2)).toEqual(['https://s.example/live'])
  })

  it('and every one refused: refused, as one it points to', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === 'https://o.example/o.pls') return answer(pls('https://a.example/1.pls', 'https://b.example/2.pls'))
      throw new TypeError('Failed to fetch')
    }))
    await expect(readPlaylistServers('https://o.example/o.pls', 2)).rejects.toThrow(/points to another playlist, on a\.example,/)
    const asked = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]))
    expect(asked).toContain('https://b.example/2.pls') // the second was tried as well
  })

  it('a playlist whose one entry is an HLS manifest that refuses: the manifest is the answer, a stream', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === 'https://n.example/n.pls') return answer(pls('https://refuse.example/live.m3u8'))
      throw new TypeError('Failed to fetch')
    }))
    expect(await readPlaylistServers('https://n.example/n.pls', 2)).toEqual(['https://refuse.example/live.m3u8'])
  })

  it('a playlist link is never kept as a server: read again, or found for the station', () => {
    // A station on http nobody relays: what does not play here is kept too, so only the filter keeps a playlist link out.
    const s = { id: '1', name: 'S', url: 'http://a.example/live' }
    expect(refreshedServers(s, ['https://b.example/next.pls', 'http://c.example/live'])).toEqual(['http://c.example/live'])
    const merged = mergeServers(s, ['https://b.example/next.pls', 'http://c.example/live'])
    expect([merged.url, ...merged.alternates]).not.toContain('https://b.example/next.pls')
  })

  it('the whole-list dialog: hosts that answered without the playlists are said as that, not as a refusal', async () => {
    const host = mount(BackupServersDialog, {
      stations: [{ id: 'a', name: 'A', url: 'https://a.example/s' }, { id: 'b', name: 'B', url: 'https://b.example/s' }],
      findServers: async (s: { id: string }) => { throw new Refused('playlist', { http: true, answered: true, host: `${s.id}.example` }) }
    })
    await vi.waitFor(() => expect((host.textContent ?? '').replace(/\s+/g, ' '))
      .toContain('For 2 stations, the playlists could not be read over https from this page: their hosts answered, but not with them. Both of those playlists have an http address'))
    expect(host.textContent).not.toContain('connect-src')
  })

  it('the whole-list dialog: http only in a playlist one leads to is said as that', async () => {
    const host = mount(BackupServersDialog, {
      stations: [{ id: 'a', name: 'A', url: 'https://a.example/s' }, { id: 'b', name: 'B', url: 'https://b.example/s' }],
      findServers: async (s: { id: string }) => { throw new Refused('playlist', s.id === 'a' ? { levels: 1, http: true } : {}) }
    })
    await vi.waitFor(() => expect((host.textContent ?? '').replace(/\s+/g, ' '))
      .toContain('One of those playlists leads to a playlist with an http address'))
  })

  it('the whole-list dialog: every one a playlist they lead to, the http address is that one\'s own', async () => {
    const host = mount(BackupServersDialog, {
      stations: [{ id: 'a', name: 'A', url: 'https://a.example/s' }, { id: 'b', name: 'B', url: 'https://b.example/s' }],
      findServers: async (s: { id: string }) => { throw new Refused('playlist', { levels: 1, http: s.id === 'a' }) }
    })
    await vi.waitFor(() => expect((host.textContent ?? '').replace(/\s+/g, ' '))
      .toContain('For 2 stations, the playlists they lead to could not'))
    expect((host.textContent ?? '').replace(/\s+/g, ' ')).toContain('One of those playlists has an http address')
  })

  it('the whole-list dialog: some answered, some refused — both said', async () => {
    const host = mount(BackupServersDialog, {
      stations: ['a', 'b', 'c'].map((id) => ({ id, name: id, url: `https://${id}.example/s` })),
      findServers: async (s: { id: string }) => { throw new Refused('playlist', { http: true, answered: s.id !== 'c', host: `${s.id}.example` }) }
    })
    await vi.waitFor(() => expect((host.textContent ?? '').replace(/\s+/g, ' '))
      .toContain('For 2 of them, the host answered over https, but not with the playlist.'))
  })

  it('an http link from an https page whose host does not answer (a timeout, offline): nothing, not "answered"', async () => {
    vi.stubGlobal('location', { ...location, protocol: 'https:' })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('timed out', 'AbortError') }))
    expect(await readPlaylistServers('http://x.example/l.pls', 2)).toEqual([])
  })

  it('an http HLS manifest from an https page, answering over https as one: a stream, not "answered without"', async () => {
    vi.stubGlobal('location', { ...location, protocol: 'https:' })
    vi.stubGlobal('fetch', vi.fn(async () => answer('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nseg1.ts\n')))
    expect(await readPlaylistServers('http://x.example/live.m3u8', 2)).toEqual([])
  })

  it('a walk through playlists of playlists is bounded, and a playlist leading back is not read again', async () => {
    const asked: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      asked.push(url)
      const n = Number(/\/p(\d+)\.pls$/.exec(url)?.[1] ?? 0)
      return answer(pls(...[1, 2, 3].map((i) => `https://x.example/p${n * 3 + i}.pls`)))
    }))
    await readPlaylistServers('https://x.example/p0.pls', 4)
    expect(asked.length).toBeLessThanOrEqual(8)
    asked.length = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      asked.push(url)
      return answer(pls(url.endsWith('a.pls') ? 'https://x.example/b.pls' : 'https://x.example/a.pls'))
    }))
    await readPlaylistServers('https://x.example/a.pls', 4)
    expect(asked).toEqual(['https://x.example/a.pls', 'https://x.example/b.pls'])
  })

  it('a playlist listing itself and another: the other is read', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === 'https://x.example/a.pls') return answer(pls('https://x.example/a.pls', 'https://x.example/b.pls'))
      if (url === 'https://x.example/b.pls') return answer(pls('https://s.example/live'))
      throw new TypeError('Failed to fetch')
    }))
    expect(await readPlaylistServers('https://x.example/a.pls', 4)).toEqual(['https://s.example/live'])
    const asked = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]))
    expect(asked.filter((u) => u === 'https://x.example/a.pls')).toHaveLength(1)
  })

  it('an http link from an https page answered with a page, not a playlist: answered without it', async () => {
    vi.stubGlobal('location', { ...location, protocol: 'https:' })
    vi.stubGlobal('fetch', vi.fn(async () => answer('<html><body>Welcome</body></html>')))
    await expect(readPlaylistServers('http://old.example/live.pls', 2)).rejects.toThrow(/its host answered, but not with a playlist/)
  })

  it('an ASX playlist is not called "not a playlist"', async () => {
    vi.stubGlobal('location', { ...location, protocol: 'https:' })
    vi.stubGlobal('fetch', vi.fn(async () => answer('<asx version="3.0"><entry><ref href="https://s.example/live"/></entry></asx>')))
    await expect(readPlaylistServers('http://old.example/live.asx', 2)).resolves.toBeDefined()
  })

  it('a playlist that parsed, with an XML declaration or with no http(s) streams in it, is not "not a playlist"', async () => {
    vi.stubGlobal('location', { ...location, protocol: 'https:' })
    for (const body of [
      '<?xml version="1.0"?><asx version="3.0"><entry><ref href="https://s.example/live"/></entry></asx>',
      '[playlist]\nFile1=rtsp://s.example/live\nNumberOfEntries=1\n'
    ]) {
      vi.stubGlobal('fetch', vi.fn(async () => answer(body)))
      await expect(readPlaylistServers('http://old.example/live.pls', 2)).resolves.toBeDefined()
    }
  })

  it('a playlist listing itself under its http address, read over https: not read again', async () => {
    vi.stubGlobal('location', { ...location, protocol: 'https:' })
    const request = vi.fn(async () => answer(pls('http://o.example/o.pls')))
    vi.stubGlobal('fetch', request)
    await readPlaylistServers('https://o.example/o.pls', 4)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('a query names a playlist file only under a name that says so', () => {
    expect(isPlaylistUrl('https://x.example/stream.mp3?ref=list.m3u')).toBe(false)
    expect(isPlaylistUrl('https://x.example/listen?mount=live.pls')).toBe(false)
    expect(isPlaylistUrl('https://x.example/get.php?url=station.m3u')).toBe(true)
    expect(classifyUrl('https://x.example/listen?mount=live.pls')).toBe('untested')
  })

  it('an address that is not one: a file its query names is still told', () => {
    expect(isPlaylistUrl('not an address?file=station.pls')).toBe(true)
  })

  it('the whole-list dialog: several directory refusals name the directory once', async () => {
    const host = mount(BackupServersDialog, {
      stations: [{ id: 'a', name: 'A', url: 'https://a.example/s' }, { id: 'b', name: 'B', url: 'https://b.example/s' }],
      findServers: async () => { throw new Refused('directory', { host: 'dir.example' }) }
    })
    await vi.waitFor(() => expect((host.textContent ?? '').replace(/\s+/g, ' '))
      .toContain('For 2 stations, the online directory (dir.example) could not'))
  })

  it('the whole-list dialog: playlists found on different hosts name none', async () => {
    const host = mount(BackupServersDialog, {
      stations: [{ id: 'a', name: 'A', url: 'https://a.example/s' }, { id: 'b', name: 'B', url: 'https://b.example/s' }],
      findServers: async (s: { id: string }) => { throw new Refused('playlist', { host: `${s.id}.example` }).found() }
    })
    await vi.waitFor(() => expect((host.textContent ?? '').replace(/\s+/g, ' '))
      .toContain('For 2 stations, the playlists found for them could not be reached or read from this page: their hosts may be down'))
  })
})

describe('the request budget running out', () => {
  it('on a try that is refused, before the next could be made: nothing known, not a refusal', async () => {
    // r lists three http playlists; a lists three more. Every try answers 404
    // but the eighth request — a3 over https — which is refused, the http try
    // after it never made for want of requests.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === 'https://x.example/r.pls') return answer(pls('http://h.example/a.pls', 'http://h.example/b.pls', 'http://h.example/c.pls'))
      if (url === 'http://h.example/a.pls') return answer(pls('http://h.example/a1.pls', 'http://h.example/a2.pls', 'http://h.example/a3.pls'))
      if (url === 'https://h.example/a3.pls') throw new TypeError('Failed to fetch')
      return answer('', { ok: false })
    }))
    await expect(readPlaylistServers('https://x.example/r.pls', 3)).resolves.toBeDefined()
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls).toHaveLength(8)
  })
})

describe('a playlist found for a station is kept in the form the URL gate gives', () => {
  it('a space in its address is kept encoded, as every address a station keeps', async () => {
    const { request } = web({ 'https://x.example/my%20list.pls': pls('https://s.example/live', 'https://t.example/live') })
    vi.stubGlobal('fetch', request)
    const f = await findBackupServers({ id: '1', name: 'S', url: 'https://s.example/live', source: 'https://x.example/my list.pls' }, { request })
    expect(f?.playlist).toBe('https://x.example/my%20list.pls')
  })
})

