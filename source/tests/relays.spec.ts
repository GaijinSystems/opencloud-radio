import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { readRelays, setRelays, relayFor, reach, ownAddress } from '../src/helpers/relays'
import { useDirectory } from '../src/composables/useDirectory'
import { nextTick } from 'vue'
import BackupServersDialog from '../src/components/BackupServersDialog.vue'
import StationForm from '../src/components/StationForm.vue'
import { mount, buttonNamed } from './support/mount'
import { web, answer, refusing } from './support/web'
import { Refused } from '../src/helpers/fetch'
import { readConfig } from '../src/config'
import { classifyUrl } from '../src/helpers/classify'
import { refreshedServers } from '../src/helpers/stations'
import { mergeServers, findBackupServers } from '../src/helpers/backupServers'
import { usePlayer } from '../src/composables/usePlayer'
import { useNowPlaying } from '../src/composables/useNowPlaying'
import { created, installFakeAudio } from './support/audio'

/**
 * The administrator's relays (INSTALL §2b), as set up for SLAY Radio: its
 * relay3 and relay4 are Icecast and relayed; relay1 is SHOUTcast and is not.
 * SLAY's own playlist, as served in November 2026, lists relay1 and relay4.
 */
const ORIGIN = location.origin
const SLAY_RELAYS = { 'http://relay4.slayradio.org:8000/': '/radio-relay/slay4', 'http://relay3.slayradio.org:8000/': '/radio-relay/slay3' }
const SLAY_PLAYLIST = ['http://relay1.slayradio.org:8000/', 'http://relay4.slayradio.org:8000/']
const slay = { id: 's', name: 'SLAY Radio', url: 'http://relay4.slayradio.org:8000/', alternates: ['http://relay3.slayradio.org:8000/'],
  source: 'http://www.slayradio.org/tune_in.php/128kbps/listen.m3u' }

beforeEach(() => setRelays(readRelays(SLAY_RELAYS)))
afterEach(() => { setRelays({}); vi.restoreAllMocks() })

describe('the table', () => {
  it('is read from the configuration, each address written as the station knows it', () => {
    expect(readConfig({ relays: { 'http://Relay4.SlayRadio.org:8000': '/radio-relay/slay4' } }).relays)
      .toEqual({ 'http://relay4.slayradio.org:8000/': '/radio-relay/slay4' })
    expect(readConfig({}).relays).toEqual({})
  })

  it('refuses a line that could send a stream anywhere but this cloud, rather than guess at it', () => {
    expect(readRelays({
      'http://a.example/s': '//elsewhere.example/s',        // protocol-relative: another host
      'http://b.example/s': 'http://elsewhere.example/s',   // a relay that is itself http
      'http://b2.example/s': 'https://u:p@relay.example/s', // credentials
      'http://b3.example/s': 'javascript:alert(1)',
      'http://c.example/s': '/radio-relay/../index.html',   // climbing out
      'http://c2.example/s': '/radio-relay/%2e%2E/remote.php/dav', // the same, encoded
      'http://c3.example/s': 'https://relay.example/a/%2e%2e/b',
      'http://d.example/s': '/\\elsewhere.example',         // a backslash some read as a slash
      'http://e.example/s': 'radio-relay/e',                // not absolute
      'http://f.example/s': 42,
      'https://g.example/s': '/radio-relay/g',              // https needs no relay
      'http://user:pw@h.example/s': '/radio-relay/h',       // credentials do not belong in a key
      'not an address': '/radio-relay/i',
      'http://ok.example/s': '/radio-relay/ok',
      'http://own.example/s': 'https://radio-relay.example.org/own' // a relay hostname of its own, as INSTALL §2b prefers
    })).toEqual({ 'http://ok.example/s': '/radio-relay/ok', 'http://own.example/s': 'https://radio-relay.example.org/own' })
    expect(readRelays(['http://a.example/s'])).toEqual({})
    expect(readRelays('/radio-relay/x')).toEqual({})
  })

  it('opens a relayed address from this cloud, its query carried over, and leaves every other alone', () => {
    expect(reach('http://relay4.slayradio.org:8000/')).toBe(`${ORIGIN}/radio-relay/slay4`)
    expect(reach('http://relay4.slayradio.org:8000/?_=1')).toBe(`${ORIGIN}/radio-relay/slay4?_=1`)
    expect(reach('http://relay1.slayradio.org:8000/')).toBe('http://relay1.slayradio.org:8000/') // not relayed
    expect(reach('https://ice2.somafm.com/groovesalad-128-mp3')).toBe('https://ice2.somafm.com/groovesalad-128-mp3')
    expect(reach('http://relay4.slayradio.org:8000/', 'null')).toBe('http://relay4.slayradio.org:8000/')
    expect(relayFor('http://relay4.slayradio.org:8000')).toBe('/radio-relay/slay4') // the same address without its slash
    setRelays(readRelays({ 'http://relay4.slayradio.org:8000/': 'https://radio-relay.example.org/slay4' }))
    expect(reach('http://relay4.slayradio.org:8000/')).toBe('https://radio-relay.example.org/slay4')
    expect(classifyUrl('http://relay4.slayradio.org:8000/')).toBe('untested')
  })
})

describe('what plays', () => {
  it('a relayed http address plays; one nobody relays is still blocked', () => {
    expect(classifyUrl('http://relay4.slayradio.org:8000/')).toBe('untested')
    expect(classifyUrl('http://relay1.slayradio.org:8000/')).toBe('blocked')
  })

  it('the player opens the relay, and says the station address is the one playing', () => {
    installFakeAudio()
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const p = usePlayer(readConfig({}), { wantAnalyser: () => true, attempts: () => 5 })
    p.play(slay)
    expect(created.at(-1)!.src).toBe(`${ORIGIN}/radio-relay/slay4`)
    expect(p.currentServer.value).toBe('http://relay4.slayradio.org:8000/')
    expect(p.state.value).toBe('connecting')
  })

  it('a station listed with an unrelayed server first starts on its relayed one', () => {
    installFakeAudio()
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const p = usePlayer(readConfig({}), { wantAnalyser: () => true, attempts: () => 5 })
    p.play({ id: 'x', name: 'SLAY Radio', url: SLAY_PLAYLIST[0], alternates: [SLAY_PLAYLIST[1]] })
    expect(created.at(-1)!.src).toBe(`${ORIGIN}/radio-relay/slay4`)
  })
})

describe('servers from a playlist', () => {
  it("SLAY's own playlist: the relayed server is kept, the one nobody relays is not", () => {
    expect(mergeServers(slay, SLAY_PLAYLIST)).toEqual({ url: slay.url, alternates: ['http://relay3.slayradio.org:8000/'] })
    expect(refreshedServers(slay, SLAY_PLAYLIST)).toEqual(['http://relay4.slayradio.org:8000/'])
  })

  it('a station served from its server root is matched by its host, not by every root-served stream', async () => {
    const table: Record<string, string> = {
      'https://dir.example/json/stations/search?name=SLAY%20Radio&limit=20&hidebroken=true': JSON.stringify([
        { url: 'http://other.example/listen.m3u', url_resolved: 'http://other.example:8000/' }, // another station, also at a root
        { url: 'http://www.slayradio.org/listen.m3u', url_resolved: 'http://relay4.slayradio.org:8000/' }]),
      'https://other.example/listen.m3u': 'http://other.example:8000/\nhttp://relay4.slayradio.org:8000/\n',
      'https://www.slayradio.org/listen.m3u': SLAY_PLAYLIST.join('\n') + '\n'
    }
    const { request } = web(table)
    const f = await findBackupServers({ id: 's', name: 'SLAY Radio', url: 'http://relay4.slayradio.org:8000/' },
      { request, directory: true, directoryHost: 'dir.example' })
    vi.unstubAllGlobals()
    expect(f?.playlist).toBe('http://www.slayradio.org/listen.m3u')
    expect(f).toMatchObject({ url: 'http://relay4.slayradio.org:8000/', alternates: [], added: 0 })
  })
})

describe('titles', () => {
  it("are read through the relay, and no status page is asked of this cloud", async () => {
    const asked: string[] = []
    const metaint = 16
    const text = new TextEncoder().encode("StreamTitle='Ben Daglish - Walldén';")
    const block = new Uint8Array(1 + Math.ceil(text.length / 16) * 16); block[0] = (block.length - 1) / 16; block.set(text, 1)
    const all = new Uint8Array([...new Uint8Array(metaint), ...block])
    const request = vi.fn(async (url: string) => {
      asked.push(url)
      let sent = false
      return { ok: true, status: 200, headers: new Headers({ 'icy-metaint': String(metaint) }),
        body: { getReader: () => ({ read: async () => (sent ? { done: true } : (sent = true, { done: false, value: all })), cancel: async () => {} }) } } as unknown as Response
    })
    const np = useNowPlaying({ request: request as unknown as typeof fetch })
    np.start(slay)
    await vi.waitFor(() => expect(np.title.value).toBe('Walldén — Ben Daglish'))
    np.stop()
    expect(asked).toEqual([`${ORIGIN}/radio-relay/slay4`])
  })
})

describe('the table, read from the HAProxy configuration', () => {
  it('the example in deploy/ gives exactly the SLAY table above', async () => {
    const { readFileSync } = await import('node:fs')
    const { relaysFromHaproxy } = await import('../scripts/relays-from-haproxy.mjs')
    const { relays, problems } = relaysFromHaproxy(readFileSync(`${process.cwd()}/../deploy/haproxy-relay.cfg`, 'utf8'))
    expect(problems).toEqual([])
    expect(relays).toEqual(SLAY_RELAYS)
    expect(readRelays(relays)).toEqual(relays) // and the app takes it as it is
  })

  it('a relay hostname of its own, the path kept upstream, and lines it cannot read said rather than guessed', async () => {
    const { relaysFromHaproxy } = await import('../scripts/relays-from-haproxy.mjs')
    const { relays, problems } = relaysFromHaproxy([
      'frontend relay',
      '    bind :443 ssl crt /x.pem',
      '    use_backend r_a if { hdr(host) -i radio-relay.example.org } { path /a }',
      '    use_backend r_b if { path /b }',
      '    use_backend r_two if { path /two }',
      '    use_backend r_gone if { path /gone }',
      '    use_backend cloud if { path_beg / }        # the cloud itself, not a relay',
      'backend r_a',
      '    server a icecast.example:8000',
      'backend r_b',
      '    http-request set-path /live.mp3',
      '    server b 10.0.0.5:8080',
      'backend r_two',
      '    server x one.example:8000',
      '    server y two.example:8000',
      'backend cloud',
      '    server oc 127.0.0.1:9200'
    ].join('\n'), 'https://radio-relay.example.org/')
    expect(relays).toEqual({
      'http://icecast.example:8000/a': 'https://radio-relay.example.org/a',
      'http://10.0.0.5:8080/live.mp3': 'https://radio-relay.example.org/b'
    })
    expect(problems).toEqual([
      'use_backend r_two if { path /two }: backend r_two has 2 servers; a relay has one',
      'use_backend r_gone if { path /gone }: no backend r_gone'
    ])
  })
})

describe('stations entered with the relay\'s own address', () => {
  const old = { id: 'o', name: 'SLAY Radio', url: `${ORIGIN}/radio-relay/slay4`, alternates: [`${ORIGIN}/radio-relay/slay3`] }

  it('are given their own addresses back, and still play from the relay', () => {
    expect(ownAddress(`${ORIGIN}/radio-relay/slay4`)).toBe('http://relay4.slayradio.org:8000/')
    expect(ownAddress('/radio-relay/slay3')).toBe('http://relay3.slayradio.org:8000/')
    expect(ownAddress(`${ORIGIN}/radio-relay/other`)).toBe(`${ORIGIN}/radio-relay/other`) // not a relay this cloud lists
    expect(ownAddress('https://ice2.somafm.com/groovesalad-128-mp3')).toBe('https://ice2.somafm.com/groovesalad-128-mp3')
    setRelays(readRelays({ 'http://relay4.slayradio.org:8000/': 'https://radio-relay.example.org/slay4' }))
    expect(ownAddress('https://radio-relay.example.org/slay4')).toBe('http://relay4.slayradio.org:8000/')
    expect(reach(ownAddress('https://radio-relay.example.org/slay4'))).toBe('https://radio-relay.example.org/slay4')
  })

  it('Find backup servers converts them even where no playlist is found', async () => {
    const { request } = web({})
    const f = await findBackupServers(old, { request })
    vi.unstubAllGlobals()
    expect(f).toEqual({ url: 'http://relay4.slayradio.org:8000/', alternates: ['http://relay3.slayradio.org:8000/'], added: 0, converted: 2 })
  })

  it('and matches them against their playlist by their own address', async () => {
    const table: Record<string, string> = { 'https://www.slayradio.org/listen.m3u': 'http://relay4.slayradio.org:8000/\nhttp://relay3.slayradio.org:8000/\nhttp://relay1.slayradio.org:8000/\n' }
    const { request } = web(table)
    const f = await findBackupServers({ ...old, alternates: [], source: 'http://www.slayradio.org/listen.m3u' }, { request })
    vi.unstubAllGlobals()
    // relay3 is added (it is relayed); relay1 is not (nobody relays it).
    expect(f).toEqual({ playlist: 'http://www.slayradio.org/listen.m3u', url: 'http://relay4.slayradio.org:8000/',
      alternates: ['http://relay3.slayradio.org:8000/'], added: 1, converted: 1 })
  })

  it('the whole-list dialog offers the conversion, and the form says what happened', async () => {
    const found = { url: 'http://relay4.slayradio.org:8000/', alternates: ['http://relay3.slayradio.org:8000/'], added: 0, converted: 2 }
    const applied: unknown[] = []
    const dialog = mount(BackupServersDialog, { stations: [old], findServers: async () => found, onApply: (c: unknown) => applied.push(c) })
    await vi.waitFor(() => expect((dialog.textContent ?? '').replace(/\s+/g, ' ')).toContain("its own addresses instead of your relay's"))
    expect(dialog.textContent).toContain('still played from your relay')
    buttonNamed(dialog, 'Apply to 1 station').click(); await nextTick()
    expect(applied).toEqual([[{ id: 'o', found }]])

    const form = mount(StationForm, { station: old, groups: [], findServers: async () => found })
    buttonNamed(form, 'Find backup servers').click()
    await vi.waitFor(() => expect(form.textContent).toContain("2 addresses were your relay's"))
    expect((form.querySelector('#st-alt') as HTMLTextAreaElement).value).toBe('http://relay3.slayradio.org:8000/')
  })
})

describe('"https only" in directory search', () => {
  const row = (name: string, url: string) => ({ stationuuid: name, name, url, url_resolved: url })
  const page1 = [row('A', 'https://a.example/s'), row('SLAY Radio', 'http://relay4.slayradio.org:8000/'), row('B', 'http://b.example:8000/')]
  const page2 = [row('C', 'https://c.example/s')]

  const directoryWith = (pages: unknown[][]) => {
    const asked: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      asked.push(String(url))
      const offset = Number(new URL(String(url)).searchParams.get('offset'))
      const body = offset === 0 ? pages[0] : offset === 3 ? pages[1] : []
      return answer(JSON.stringify(body))
    }))
    return { asked, dir: useDirectory(readConfig({ directoryEnabled: true, directoryServers: ['dir.example'], directoryPageSize: 3 })) }
  }
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the stations this cloud relays, and the next page starts after every row given', async () => {
    const { asked, dir } = directoryWith([page1, page2])
    await dir.search({ query: 'x', httpsOnly: true })
    expect(new URL(asked[0]).searchParams.has('is_https')).toBe(false) // asked for everything…
    expect(dir.results.value.map((r) => r.name)).toEqual(['A', 'SLAY Radio']) // …and filtered here
    expect(dir.fetched.value).toBe(3)
    await dir.search({ query: 'x', httpsOnly: true, offset: dir.fetched.value })
    expect(new URL(asked[1]).searchParams.get('offset')).toBe('3')
    expect(dir.results.value.map((r) => r.name)).toEqual(['A', 'SLAY Radio', 'C'])
  })

  it('with no relays, the directory does the filtering, as before', async () => {
    setRelays({})
    const { asked, dir } = directoryWith([page1])
    await dir.search({ query: 'x', httpsOnly: true })
    expect(new URL(asked[0]).searchParams.get('is_https')).toBe('true')
  })
})

describe('rules shared since the cleanup pass', () => {
  it('a re-read playlist is held to the same ten servers, and to what plays here', () => {
    const fleet = Array.from({ length: 40 }, (_, i) => `https://${i}.live.streamtheworld.com/KUOWFM_HIGH_MP3_SC`)
    const s = { id: 'k', name: 'KUOW', url: fleet[0] }
    expect(refreshedServers(s, [...fleet, fleet[1]])).toHaveLength(10) // and nothing twice
    expect(refreshedServers(s, ['https://a.example/list.pls', 'https://a.example/live.m3u8', 'https://a.example/s'])).toEqual(['https://a.example/s'])
  })

  it("a row entered with the relay's address and the station's own address are one stream", async () => {
    const { mergeStations, streamTaken } = await import('../src/helpers/stations')
    const old = [{ id: 'o', name: 'SLAY Radio', url: `${ORIGIN}/radio-relay/slay4` }]
    expect(mergeStations(old, [{ id: 'n', name: 'SLAY Radio', url: 'http://relay4.slayradio.org:8000/' }], 100).duplicates).toBe(1)
    expect(streamTaken(old, 'http://relay4.slayradio.org:8000/')).toBe(true)
    expect(streamTaken(old, 'http://relay4.slayradio.org:8000/', 'o')).toBe(false) // its own row
  })

  it("the directory, which is sent the station's name, is not asked when the station's own playlist answers", async () => {
    const { asked, request } = web({ 'https://a.example/station.pls': '[playlist]\nFile1=https://a.example/s\nFile2=https://b.example/s\nNumberOfEntries=2\n' })
    const f = await findBackupServers({ id: '1', name: 'S', url: 'https://a.example/s', source: 'https://a.example/station.pls' },
      { request, directory: true, directoryHost: 'dir.example' })
    vi.unstubAllGlobals()
    expect(f?.added).toBe(1)
    expect(asked.some((u) => u.includes('dir.example'))).toBe(false)
  })

  it('the same piece again is not announced again', async () => {
    vi.useFakeTimers()
    const request = vi.fn(async () => answer(JSON.stringify({ icestats: { source: { title: 'A - One' } } })))
    const np = useNowPlaying({ request: request as unknown as typeof fetch })
    np.start({ id: '1', name: 'S', url: 'https://ice.example/s' })
    await vi.advanceTimersByTimeAsync(0)
    const first = np.track.value
    expect(first?.title).toBe('One')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(request.mock.calls.length).toBeGreaterThan(1)
    expect(np.track.value).toBe(first) // the same object: nothing downstream was told
    np.stop()
    vi.useRealTimers()
  })
})

describe('the HAProxy reader says what it cannot read, rather than guess', () => {
  const relay = (name: string, extra = '') => [`backend ${name}`, '    http-request set-path /', extra, '    http-request deny unless METH_GET', `    server s ${name}.example:8000`].filter(Boolean)
  it('negated groups, named ACLs, unless, default backends and unread rewrites are reported, not mapped', async () => {
    const { relaysFromHaproxy } = await import('../scripts/relays-from-haproxy.mjs')
    const { relays, problems } = relaysFromHaproxy([
      'frontend f',
      '    use_backend a if { hdr(host) -i -m str relay.example.org } { path /a }', // flags in the other order: read
      '    use_backend b if !{ hdr(host) -i relay.example.org } { path /b }',
      '    use_backend c if is_relay',
      '    use_backend d unless { path /x }',
      '    use_backend e if { path /e }',
      '    default_backend f',
      ...relay('a'), ...relay('b'), ...relay('c'), ...relay('d'),
      ...relay('e', '    http-request replace-path /e(.*) /live\\1'), ...relay('f')
    ].join('\n'))
    expect(relays).toEqual({ 'http://a.example:8000/': 'https://relay.example.org/a' })
    expect(problems.map((p: string) => p.split(':')[0])).toEqual([
      'use_backend b if !{ hdr(host) -i relay.example.org } { path /b }',
      'use_backend c if is_relay',
      'use_backend d unless { path /x }',
      'use_backend e if { path /e }',
      'default_backend f'
    ])
  })
})

describe('combining an import into one station', () => {
  it('keeps no more servers than a station keeps anywhere else', async () => {
    const { default: ImportDialog } = await import('../src/components/ImportDialog.vue')
    const imported: Array<{ stations: Array<{ alternates?: string[] }> }> = []
    const host = mount(ImportDialog, { onImport: (l: { stations: Array<{ alternates?: string[] }> }) => imported.push(l) })
    // Forty servers, the first listed twice over: a repeat must take none of the ten places.
    const hosts = [0, 0, 0, ...Array.from({ length: 40 }, (_, i) => i)]
    const pls = `[playlist]\n${hosts.map((h, i) => `File${i + 1}=https://${h}.live.streamtheworld.com/X_SC\nTitle${i + 1}=X (#${i + 1})`).join('\n')}\nNumberOfEntries=${hosts.length}\n`
    const input = host.querySelector('input[type=file]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [new File([pls], 'x.pls')] })
    input.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(buttonNamed(host, 'Import')).toBeTruthy())
    await vi.waitFor(() => expect(host.textContent).toMatch(/one station|several servers|combine/i))
    const box = [...host.querySelectorAll('input[type=checkbox]')][0] as HTMLInputElement | undefined
    if (box && !box.checked) { box.click(); await nextTick() }
    buttonNamed(host, 'Import').click(); await nextTick()
    expect(imported[0].stations).toHaveLength(1)
    const kept = imported[0].stations[0] as { url?: string; alternates?: string[] }
    expect(kept.alternates).toHaveLength(9)
    expect(new Set([kept.url, ...(kept.alternates ?? [])]).size).toBe(10) // ten different servers
  })
})

describe('found by the second review', () => {
  it('a re-read playlist puts what plays here first, whatever order it lists them in', () => {
    const mixed = { id: 'm', name: 'M', url: 'https://a.example/dead', alternates: ['http://b.example/s'] }
    expect(refreshedServers(mixed, ['http://c.example/s', 'https://d.example/s'])).toEqual(['https://d.example/s', 'http://c.example/s'])
  })

  it('a source that answers and then says nothing gives way to the next after ten seconds', async () => {
    vi.useFakeTimers()
    const asked: string[] = []
    const request = vi.fn((url: string, init?: RequestInit) => {
      asked.push(String(url))
      if (String(url).endsWith('.xsl')) {
        return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
      }
      return Promise.resolve(answer('', { ok: false }))
    })
    const np = useNowPlaying({ request: request as unknown as typeof fetch })
    np.start({ id: '1', name: 'S', url: 'https://ice.example/s' })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(asked.some((u) => u.includes('/stats?'))).toBe(false) // still waiting on the silent one
    await vi.advanceTimersByTimeAsync(6_000)
    expect(asked.some((u) => u.includes('/stats?'))).toBe(true)
    np.stop()
    vi.useRealTimers()
  })
})

describe('the HAProxy reader and TLS to the station', () => {
  it('reads ssl from the server, its backend\'s default-server, or a defaults section — check-ssl is not ssl', async () => {
    const { relaysFromHaproxy } = await import('../scripts/relays-from-haproxy.mjs')
    const relay = (name: string, server: string, extra: string[] = []) =>
      [`backend ${name}`, '    http-request set-path /', '    http-request deny unless METH_GET', ...extra, `    ${server}`]
    const { relays } = relaysFromHaproxy([
      'frontend f',
      '    use_backend a if { path /a }', '    use_backend b if { path /b }', '    use_backend c if { path /c }',
      ...relay('a', 'server s a.example:8000 check check-ssl'),            // health checks over TLS; the stream is plain
      ...relay('b', 'server s b.example:8443', ['    default-server ssl verify required']),
      'defaults', '    default-server ssl',
      ...relay('c', 'server s c.example:8000 no-ssl'),                     // inherits ssl, and turns it off
      ...relay('d', 'server s d.example:8443'),                            // inherits ssl
      'defaults',                                                          // a new defaults starts from nothing
      ...relay('e', 'server s e.example:8000')
    ].join('\n').replace('    use_backend c if { path /c }', '    use_backend c if { path /c }\n    use_backend d if { path /d }\n    use_backend e if { path /e }'))
    // b and d are https: no relay needed
    expect(relays).toEqual({ 'http://a.example:8000/': '/a', 'http://c.example:8000/': '/c', 'http://e.example:8000/': '/e' })
  })
})

describe('the HAProxy reader and a named defaults section', () => {
  it('a backend that names its defaults takes their TLS, not the latest section\'s', async () => {
    const { relaysFromHaproxy } = await import('../scripts/relays-from-haproxy.mjs')
    const relay = (head: string, server: string) => [head, '    http-request set-path /', '    http-request deny unless METH_GET', `    ${server}`]
    const { relays } = relaysFromHaproxy([
      'frontend f', '    use_backend a if { path /a }', '    use_backend b if { path /b }',
      'defaults tls', '    default-server ssl',
      'defaults plain',
      ...relay('backend a from tls', 'server s a.example:8443'),   // https, by its named defaults
      ...relay('backend b', 'server s b.example:8000')             // the latest, plain
    ].join('\n'))
    expect(relays).toEqual({ 'http://b.example:8000/': '/b' })
  })
})

describe('a relayed station whose lookup was refused', () => {
  it('is still given its own addresses back, and told the lookup for more could not be made', async () => {
    refusing()
    const old = { id: 'o', name: 'SLAY Radio', url: `${ORIGIN}/radio-relay/slay4`, source: 'https://www.slayradio.org/listen.m3u' }
    const f = await findBackupServers(old, { request: fetch }).finally(() => vi.unstubAllGlobals())
    expect(f).toMatchObject({ url: 'http://relay4.slayradio.org:8000/', converted: 1, added: 0 })
    expect(f?.unread).toBeInstanceOf(Refused)
  })
})
