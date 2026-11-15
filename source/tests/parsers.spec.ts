import { describe, it, expect, vi } from 'vitest'
import { parseM3u, serializeM3u } from '../src/parsers/m3u'
import { parsePls } from '../src/parsers/pls'
import { detect } from '../src/parsers/detect'
import { classify, explain, failedState, initialState } from '../src/helpers/classify'
import { BINS, EDGE, bucketOf, shape, bucketBounds } from '../src/composables/useSpectrum'
import { nextSelection, stationBaseName, stripServerSuffix } from '../src/helpers/text'
import { clampVolume, DEFAULT_VOLUME, clampRail, MIN_RAIL, toProfile, fromProfile, usePreferences } from '../src/composables/usePreferences'
import { parseIni, serializeIni, iniBool } from '../src/parsers/ini'
import { readdirSync, readFileSync } from 'node:fs'
import { parseXspf } from '../src/parsers/xspf'
import { isSameOrigin, sanitizeStation } from '../src/helpers/safeUrl'
import { readPlaylistServers } from '../src/helpers/resolve'
import { toStation, uuidOf, describeResult, buildSearchUrl } from '../src/helpers/directory'

const EXT = `#EXTM3U
#PLAYLIST:Ambient
#EXTINF:-1 tvg-logo="https://a/b.png" group-title="Ambient" tvg-country="United States",Groove Salad
https://ice1.somafm.com/groovesalad-128-aac
#EXTGRP:Eclectic
#EXTINF:-1,FIP
https://icecast.radiofrance.fr/fip-midfi.mp3
`

describe('m3u', () => {
  it('reads attributes, names and the list title', () => {
    const list = parseM3u(EXT)
    expect(list.title).toBe('Ambient')
    expect(list.stations).toHaveLength(2)
    expect(list.stations[0]).toMatchObject({
      name: 'Groove Salad',
      group: 'Ambient',
      country: 'United States',
      logo: 'https://a/b.png'
    })
  })

  it('applies #EXTGRP to entries that carry no group of their own', () => {
    expect(parseM3u(EXT).stations[1].group).toBe('Eclectic')
  })

  it('tolerates a BOM, CRLF and a missing #EXTM3U', () => {
    const rough = '\uFEFF#EXTINF:-1,Bare\r\nhttps://example.com/x\r\n'
    const list = parseM3u(rough)
    expect(list.stations).toHaveLength(1)
    expect(list.stations[0].name).toBe('Bare')
  })

  it('treats a file of bare URLs as a simple playlist', () => {
    const list = parseM3u('https://a/1\nhttps://a/2\n')
    expect(list.stations.map((s) => s.url)).toEqual(['https://a/1', 'https://a/2'])
    expect(list.stations[0].name).toBe('https://a/1')
  })

  it('round-trips without loss and is stable on a second pass', () => {
    const once = serializeM3u(parseM3u(EXT))
    const twice = serializeM3u(parseM3u(once))
    expect(twice).toBe(once)
    expect(parseM3u(once).stations[0].country).toBe('United States')
  })

  it('carries tags and attributes it does not understand', () => {
    const odd = `#EXTM3U
#SOMETHINGELSE:keep me
#EXTINF:-1 tvg-chno="7",X
https://example.com/x
`
    const out = serializeM3u(parseM3u(odd))
    expect(out).toContain('#SOMETHINGELSE:keep me')
    expect(out).toContain('tvg-chno="7"')
  })
})

describe('pls', () => {
  it('reads index-keyed entries with gaps and out-of-order keys', () => {
    const list = parsePls(`[playlist]
NumberOfEntries=9
Title3=Third
File3=https://a/3
File1=https://a/1
Title1=First
Length1=-1
`)
    expect(list.stations.map((s) => s.name)).toEqual(['First', 'Third'])
  })

  it('ignores a title with no stream', () => {
    expect(parsePls('[playlist]\nTitle1=Orphan\n').stations).toHaveLength(0)
  })
})

describe('detect', () => {
  it('spots an HLS manifest rather than importing its segments', () => {
    expect(detect('#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:2.0,\nseg1.ts\n')).toBe('hls')
  })
  it('identifies the other formats by content', () => {
    expect(detect('[playlist]\nFile1=x')).toBe('pls')
    expect(detect('<?xml version="1.0"?><playlist/>')).toBe('xspf')
    expect(detect('#EXTM3U\n#EXTINF:-1,a\nhttps://a/b')).toBe('m3u')
  })
  it('falls back to the extension when there is no signature', () => {
    expect(detect('https://a/b\n', 'stations.pls')).toBe('pls')
  })
})

describe('classify', () => {
  it('blocks http and allows https', () => {
    expect(classify({ id: '1', name: 'a', url: 'http://a/b' })).toBe('blocked')
    expect(classify({ id: '2', name: 'b', url: 'https://a/b' })).toBe('untested')
  })
  it('marks HLS unsupported', () => {
    expect(classify({ id: '3', name: 'c', url: 'https://a/b.m3u8' })).toBe('unsupported')
  })
  it('fails a URL it cannot parse', () => {
    expect(classify({ id: '4', name: 'd', url: 'not a url' })).toBe('failed')
  })
})

describe('ini', () => {
  it('reads sections, ignores comments, and round-trips', async () => {
    const text = `; a comment
[columns]
url=false
played=true

[playback]
retries=10
`
    const data = parseIni(text)
    expect(data.columns.url).toBe('false')
    expect(iniBool(data.columns.played, false)).toBe(true)
    expect(parseIni(serializeIni(data))).toEqual(data)
  })

  it('a section named after Object.prototype stays a section', async () => {
    // Reproduced against 1.1.8: on a plain object `out['__proto__']` is
    // Object.prototype, and the keys landed there for every object on the page.
    const data = parseIni('[__proto__]\npolluted=yes\n[constructor]\nstatic=yes\n')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect((Object as unknown as Record<string, unknown>).static).toBeUndefined()
    expect(data['__proto__'].polluted).toBe('yes') // read back as ordinary data
    expect(data['constructor'].static).toBe('yes')
  })
})

describe('preferences', () => {
  it('clamps a rail width against the viewport, not only against its own range', async () => {
    expect(clampRail(520, 2560)).toBe(520)
    expect(clampRail(520, 1000)).toBe(400) // 40% of a smaller screen
    expect(clampRail(10, 1600)).toBe(MIN_RAIL)
  })

  it('exports geometry only when asked', async () => {
    const prefs = { columns: { url: true }, widths: { url: 300 }, railWidth: 268,
      resume: true, retries: 5, metadata: false, analyser: true } as never
    expect(toProfile(prefs, false).layout).toBeUndefined()
    expect(toProfile(prefs, true).layout.railWidth).toBe('268')
  })
})

describe('fixtures', () => {
  it('parses every generated fixture as the format it claims to be', async () => {
    const expected: Record<string, string> = {
      'plain.m3u8': 'm3u', 'attributes.m3u8': 'm3u', 'bom-crlf.m3u': 'm3u',
      'bare-urls.m3u': 'm3u', 'gaps.pls': 'pls', 'orphan-title.pls': 'pls',
      'namespaced.xspf': 'xspf', 'manifest.m3u8': 'hls', 'insecure.m3u8': 'm3u'
    }
    // Playlist fixtures only: the directory capture is JSON, not a playlist,
    // and is exercised by its own tests.
    const names = readdirSync('tests/fixtures').filter((n) => !n.endsWith('.json'))
    expect(names.length).toBe(Object.keys(expected).length)
    for (const name of names) {
      const text = readFileSync(`tests/fixtures/${name}`, 'utf8')
      expect(detect(text, name), name).toBe(expected[name])
    }
  })

  it('classifies the insecure fixture as blocked', async () => {
    const list = parseM3u(readFileSync('tests/fixtures/insecure.m3u8', 'utf8'))
    expect(classify(list.stations[0])).toBe('blocked')
  })
})

describe('xspf', () => {
  it('reads namespaced tracks', async () => {
    const list = parseXspf(readFileSync('tests/fixtures/namespaced.xspf', 'utf8'))
    expect(list.title).toBe('Imported')
    expect(list.stations[0]).toMatchObject({ name: 'One', url: 'https://a/1' })
  })

  it('refuses a file that is not XML rather than returning nothing', async () => {
    expect(() => parseXspf('this is not xml <<<')).toThrow()
  })
})

describe('untrusted input', () => {
  it('keeps names and attributes that contain commas', () => {
    const l = parseM3u('#EXTINF:-1 group-title="Rock, Pop",Hits, Mixed\nhttps://a/b\n')
    expect(l.stations[0].name).toBe('Hits, Mixed')
    expect(l.stations[0].group).toBe('Rock, Pop')
  })
  it('drops a javascript: homepage and logo at parse time', () => {
    const l = parseM3u('#EXTINF:-1 radio-homepage="javascript:alert(1)" tvg-logo="data:text/html,x",X\nhttps://a/b\n')
    expect(l.stations[0].homepage).toBeUndefined()
    expect(l.stations[0].logo).toBeUndefined()
  })
  it('cannot be made to write a second entry through a name', () => {
    const out = serializeM3u({ title: 'T', trailing: [],
      stations: [{ id: '1', name: 'Evil\nhttps://evil/stream', url: 'https://a/b' }] })
    expect(parseM3u(out).stations).toHaveLength(1)
    expect(out).not.toContain('\nhttps://evil')
  })
  it('keeps a dangling #EXTINF instead of losing it', () => {
    const out = serializeM3u(parseM3u('#EXTM3U\n#EXTINF:-1,Orphan\n'))
    expect(out).toContain('Orphan')
  })
})

describe('settings profiles', () => {
  it('a profile cannot plant properties named after Object.prototype\'s', async () => {
    const { prefs } = usePreferences()
    const { applied } = fromProfile({ columns: { constructor: 'true', toString: 'false', url: 'true' },
      layout: { hasOwnProperty: '300', url: '300' } }, prefs)
    expect(applied).toBe(2) // url in each; `in` would have said 4
    expect(Object.hasOwn(prefs.columns, 'toString')).toBe(false)
    expect(Object.hasOwn(prefs.widths, 'hasOwnProperty')).toBe(false)
    expect(prefs.columns.url).toBe(true)
  })

  it('round-trips through INI and applies only known keys', async () => {
    const prefs = {
      columns: { url: true, group: false }, widths: { url: 420 }, railWidth: 300,
      theme: 'dark', resume: false, retries: 10, metadata: true, analyser: false,
      volume: 0.5, muted: false, lastList: '', lastStation: ''
    } as never
    const text = serializeIni(toProfile(prefs, true))
    const target = {
      columns: { url: false, group: true }, widths: { url: 260 }, railWidth: 268,
      theme: 'system', resume: true, retries: 5, metadata: false, analyser: true,
      volume: 0.7, muted: false, lastList: 'x', lastStation: 'y'
    } as never
    const result = fromProfile({ ...parseIni(text), bogus: { anything: 'yes' } }, target)
    expect(result.applied).toBeGreaterThan(5)
    expect((target as { columns: Record<string, boolean> }).columns.url).toBe(true)
    expect((target as { retries: number }).retries).toBe(10)
    expect((target as { widths: Record<string, number> }).widths.url).toBe(420)
    // device/session state is never part of a profile
    expect((target as { lastList: string }).lastList).toBe('x')
    expect((target as { volume: number }).volume).toBe(0.7)
  })
})

describe('first launch', () => {
  it('writes a usable empty list rather than an empty file', async () => {
    const out = serializeM3u({ title: 'Favourites', stations: [], trailing: [] })
    expect(out.startsWith('#EXTM3U')).toBe(true)
    const back = parseM3u(out)
    expect(back.title).toBe('Favourites')
    expect(back.stations).toHaveLength(0)
  })
})

describe('playlist links are not streams', () => {
  it('classifies a .pls or .m3u address as a playlist, not a station', () => {
    expect(classify({ id: '1', name: 'a', url: 'https://somafm.com/defcon256.pls' })).toBe('playlist')
    expect(classify({ id: '2', name: 'b', url: 'https://example.org/list.m3u' })).toBe('playlist')
  })
  it('still treats a direct stream as playable', () => {
    expect(classify({ id: '3', name: 'c', url: 'https://ice1.somafm.com/defcon-256-mp3' })).toBe('untested')
  })
  it('reads the stream addresses out of a SomaFM-style pls', () => {
    const list = parsePls(`[playlist]
numberofentries=2
File1=https://ice2.somafm.com/defcon-256-mp3
Title1=SomaFM: DEF CON Radio (#1)
Length1=-1
File2=https://ice4.somafm.com/defcon-256-mp3
Title2=SomaFM: DEF CON Radio (#2)
Length2=-1
Version=2
`)
    expect(list.stations).toHaveLength(2)
    expect(classify(list.stations[0])).toBe('untested')
  })
})

describe('same-origin addresses', () => {
  it('are recognised, so a failure is never blamed on the policy', async () => {
    const origin = 'https://cloud.example.org'
    expect(isSameOrigin(`${origin}/defcon256.pls`, origin)).toBe(true)
    expect(isSameOrigin('https://ice5.somafm.com/defcon-256-mp3', origin)).toBe(false)
    expect(isSameOrigin('not a url', origin)).toBe(false)
  })
  it('still classifies a relayed playlist path as a playlist', () => {
    expect(classify({ id: '1', name: 'relay', url: 'https://cloud.example.org/defcon256.pls' }))
      .toBe('playlist')
  })
})

describe('stations with several servers', () => {
  it('round-trips a backup server list', () => {
    const list = parseM3u(`#EXTM3U
#EXTINF:-1 radio-alt="https://ice6.somafm.com/defcon-256-mp3 https://ice2.somafm.com/defcon-256-mp3" radio-source="https://somafm.com/defcon256.pls",DEF CON Radio
https://ice5.somafm.com/defcon-256-mp3
`)
    expect(list.stations[0].alternates).toEqual([
      'https://ice6.somafm.com/defcon-256-mp3',
      'https://ice2.somafm.com/defcon-256-mp3'
    ])
    expect(list.stations[0].source).toBe('https://somafm.com/defcon256.pls')
    const again = parseM3u(serializeM3u(list))
    expect(again.stations[0].alternates).toEqual(list.stations[0].alternates)
    expect(again.stations[0].source).toBe(list.stations[0].source)
  })
  it('drops an unsafe alternate rather than carrying it', () => {
    const list = parseM3u('#EXTINF:-1 radio-alt="javascript:alert(1) https://ok.example/s",X\nhttps://a/b\n')
    expect(list.stations[0].alternates).toEqual(['https://ok.example/s'])
  })
})

describe('import grouping', () => {
  it('recognises one station listed on several servers', () => {
    const pls = parsePls(`[playlist]
numberofentries=4
File1=https://ice5.somafm.com/defcon-256-mp3
Title1=SomaFM: DEF CON Radio (#1)
File2=https://ice6.somafm.com/defcon-256-mp3
Title2=SomaFM: DEF CON Radio (#2)
File3=https://ice2.somafm.com/defcon-256-mp3
Title3=SomaFM: DEF CON Radio (#3)
File4=https://ice4.somafm.com/defcon-256-mp3
Title4=SomaFM: DEF CON Radio (#4)
`)
    // the import dialog's own normaliser, not a copy of it
    const names = pls.stations.map((s) => stationBaseName(s.name))
    expect(new Set(names).size).toBe(1)
    expect(pls.stations).toHaveLength(4)
  })

  it('does not group a genuine multi-station list', () => {
    const list = parseM3u(`#EXTM3U
#EXTINF:-1,Groove Salad
https://a/1
#EXTINF:-1,Drone Zone
https://a/2
`)
    expect(new Set(list.stations.map((s) => stationBaseName(s.name))).size).toBe(2)
  })
})

describe('SLAY Radio shape', () => {
  it('parses the relay list and groups it as one station', () => {
    const list = parseM3u(`#EXTM3U
#EXTINF:-1,SLAY Radio - 128kbps, relay2 [shoutcast - kork]
http://relay2.slayradio.org:8000/
#EXTINF:-1,SLAY Radio - 128kbps, relay3 [shoutcast - farsan]
http://relay3.slayradio.org:8000/
#EXTINF:-1,SLAY Radio - 128kbps, relay1 [shoutcast - elpost]
http://relay1.slayradio.org:8000/
#EXTINF:-1,SLAY Radio - 128kbps, relay4 [icecast - icepic]
http://relay4.slayradio.org:8000/
`)
    expect(list.stations).toHaveLength(4)
    expect(new Set(list.stations.map((s) => stationBaseName(s.name))).size).toBe(1)
    // …and every one of them is blocked until relayed
    expect(list.stations.every((s) => classify(s) === 'blocked')).toBe(true)
  })
})

describe('spectrum layout', () => {
  // Imported from the composable, not copied into the test: a copy stays green
  // when the real mapping regresses, which is what happened to twelve tests
  // before 1.1.1.
  it('is mirrored, with the lowest frequencies in the middle', () => {
    const map = Array.from({ length: BINS }, (_, i) => bucketOf(i))
    expect(map[BINS / 2 - 1]).toBe(0)
    expect(map[BINS / 2]).toBe(0)
    expect(map[0]).toBe(map[BINS - 1])
    expect(map.slice(0, BINS / 2)).toEqual(map.slice(BINS / 2).reverse())
  })

  it('uses every bucket exactly twice, so no frequency is lost', () => {
    const counts = new Map<number, number>()
    for (let i = 0; i < BINS; i++) counts.set(bucketOf(i), (counts.get(bucketOf(i)) ?? 0) + 1)
    expect(new Set(counts.values())).toEqual(new Set([2]))
    expect(counts.size).toBe(BINS / 2)
  })

  it('holds exactly two bars still at each end', () => {
    const still = Array.from({ length: BINS }, (_, i) => shape(i) === 0)
    expect(still.filter(Boolean)).toHaveLength(EDGE * 2)
    expect(still[0] && still[1] && still[BINS - 1] && still[BINS - 2]).toBe(true)
    expect(still[EDGE]).toBe(false)
  })

  it('log buckets span the FFT from the first bin to the last and never go backwards', () => {
    const n = 1024
    const b = bucketBounds(n)
    expect(b).toHaveLength(BINS / 2)
    expect(b[0][0]).toBe(1)
    expect(b.at(-1)![1]).toBe(n)
    for (const [lo, hi] of b) expect(hi).toBeGreaterThan(lo)
    for (let i = 1; i < b.length; i++) expect(b[i][0]).toBeGreaterThanOrEqual(b[i - 1][0])
    // and nothing above the first bin is skipped
    const covered = new Set<number>()
    for (const [lo, hi] of b) for (let j = lo; j < hi; j++) covered.add(j)
    for (let j = 1; j < n; j++) expect(covered.has(j)).toBe(true)
  })
})

// 'volume and the analyser' moved to tests/player.spec.ts, where it runs
// against the real player and a fake media element.

describe('1.0.1 regressions', () => {
  it('keeps a stored volume of zero', () => {
    // The old code was `Number(stored) ?? d || d`, which resets 0 to 0.72.
    expect(clampVolume(0)).toBe(0)
    expect(clampVolume('0')).toBe(0)
    expect(clampVolume(undefined)).toBe(DEFAULT_VOLUME)
    expect(clampVolume('nonsense')).toBe(DEFAULT_VOLUME)
    expect(clampVolume(7)).toBe(1)
  })

  it('a stored volume of zero survives a reload of the preferences', async () => {
    localStorage.setItem('radio.prefs', JSON.stringify({ volume: 0 }))
    const { prefs, destroy } = usePreferences()
    expect(prefs.volume).toBe(0)
    destroy()
    localStorage.removeItem('radio.prefs')
  })

  it('sanitises administrator-provided default stations', async () => {
    const s = sanitizeStation({
      id: 'x', name: 'Evil\nSecond line', url: 'https://a/b',
      logo: 'http://not-https.example/logo.png',
      homepage: 'javascript:alert(1)',
      alternates: ['javascript:x', 'https://ok.example/s']
    })
    expect(s.name).toBe('Evil Second line')
    expect(s.logo).toBeUndefined()
    expect(s.homepage).toBeUndefined()
    expect(s.alternates).toEqual(['https://ok.example/s'])
  })

  it('names a non-web scheme as unsupported rather than unresponsive', async () => {
    expect(classify({ id: '1', name: 'a', url: 'rtsp://a/b' })).toBe('unsupported')
    expect(explain(classify({ id: '', name: '', url: 'rtsp://a/b' }))).toMatch(/cannot be played in a browser/)
  })

  it('gates the playlist reader on web schemes', async () => {
    // The gate is that nothing is fetched. Asserting only the empty result
    // passed with the gate deleted, because a failed fetch is also empty.
    const fetched = vi.fn(async () => { throw new TypeError('not reached') })
    vi.stubGlobal('fetch', fetched)
    try {
      expect(await readPlaylistServers('file:///etc/passwd.pls', 2)).toEqual([])
      expect(await readPlaylistServers('javascript:alert(1).m3u', 2)).toEqual([])
      expect(fetched).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })

  it('reads a station playlist without cookies or a referrer, and not without limit', async () => {
    const fetched = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true, headers: new Headers(), text: async () => '[playlist]\nFile1=https://a/1\nFile2=https://a/2\n'
    }))
    vi.stubGlobal('fetch', fetched)
    try {
      expect(await readPlaylistServers('https://s.example/x.pls', 2)).toEqual(['https://a/1', 'https://a/2'])
      const init = fetched.mock.calls[0][1]!
      expect(init.credentials).toBe('omit')
      expect(init.referrerPolicy).toBe('no-referrer')
      expect(init.signal).toBeInstanceOf(AbortSignal)
      fetched.mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-length': '50000000' }), text: async () => 'https://a/1\n' })
      expect(await readPlaylistServers('https://s.example/huge.m3u', 2)).toEqual([])
      // …and one that does not say how long it is, and never stops, is cut off.
      let cancelled = false
      const endless = { getReader: () => ({
        read: async () => ({ done: false, value: new Uint8Array(400_000).fill(0x61) }),
        cancel: async () => { cancelled = true }
      }) }
      fetched.mockResolvedValueOnce({ ok: true, headers: new Headers(), body: endless, text: async () => '' } as never)
      expect(await readPlaylistServers('https://s.example/endless.m3u', 2)).toEqual([])
      expect(cancelled).toBe(true)
      // …and one that never answers at all is given up on.
      vi.useFakeTimers()
      fetched.mockImplementationOnce((_u: string, init?: RequestInit) => new Promise((_r, reject) => {
        init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      }) as never)
      const waiting = readPlaylistServers('https://s.example/silent.pls', 2)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(await waiting).toEqual([])
    } finally { vi.unstubAllGlobals(); vi.useRealTimers() }
  })
})

describe('selection and removal', () => {
  // The reproduction: select one station of three, then click the select-all
  // box (now showing a dash). The browser reports checked === true, so the old
  // code selected all three — and Remove took the list.
  it('clearing from a partial selection does not select everything', () => {
    expect(nextSelection(true, true, ['a', 'b', 'c'])).toEqual([])
  })
  it('still selects all from an empty selection, and clears from a full one', () => {
    expect(nextSelection(true, false, ['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
    expect(nextSelection(false, false, ['a', 'b', 'c'])).toEqual([])
  })
})

describe('directory results', () => {
  const load = async () => {
    return JSON.parse(readFileSync('tests/fixtures/directory-search.json', 'utf8'))
  }

  it('plays the resolved stream, not the playlist the station advertises', async () => {
    const [groove] = await load()
    const s = toStation(groove)
    // This is the whole reason the directory is useful from a browser: it did
    // the .pls fetch that a browser is not allowed to do.
    expect(s.url).toBe('https://ice2.somafm.com/groovesalad-128-mp3')
    expect(s.source).toBe('https://somafm.com/groovesalad.pls')
    expect(classify(s)).toBe('untested')
  })

  it('keeps the directory id so a play can be reported and the entry re-checked', async () => {
    const s = toStation((await load())[0])
    expect(uuidOf(s)).toBe('960cf833-0601-11e8-ae97-52543be04c81')
    // and it survives a round trip through the playlist file
    const back = parseM3u(serializeM3u({ title: 'T', trailing: [], stations: [s] }))
    expect(uuidOf(back.stations[0])).toBe(uuidOf(s))
  })

  it('capitalises the lowercase tags and languages the API returns', async () => {
    const s = toStation((await load())[0])
    expect(s.group).toBe('Ambient')
    expect(s.language).toBe('English')
  })

  it('drops a logo that is not https', async () => {
    const [row] = await load()
    expect(toStation(row).logo).toBe('https://somafm.com/img3/groovesalad-400.jpg')
    expect(toStation({ ...row, favicon: 'http://somafm.com/x.png' }).logo).toBeUndefined()
  })

  it('marks HLS and certificate failures without a directory-specific state', async () => {
    const [row] = await load()
    expect(classify(toStation({ ...row, url_resolved: 'https://a/b.m3u8' }))).toBe('unsupported')
    expect(describeResult({ ...row, ssl_error: 1 })).toContain('certificate problem')
    expect(describeResult(row)).toContain('MP3')
  })

  it('builds a search URL that hides broken stations and orders by popularity', async () => {
    const url = new URL(buildSearchUrl('de1.api.radio-browser.info', { query: 'jazz & blues' }))
    expect(url.searchParams.get('name')).toBe('jazz & blues')
    expect(url.searchParams.get('hidebroken')).toBe('true')
    expect(url.searchParams.get('order')).toBe('clickcount')
    expect(url.searchParams.get('is_https')).toBeNull()
    expect(new URL(buildSearchUrl('x', { query: 'a', httpsOnly: true })).searchParams.get('is_https')).toBe('true')
  })
})


describe('the verdict after a play attempt fails', () => {
  it('is failed only for a station that could have played', async () => {
    expect(failedState({ id: '1', name: 'S', url: 'https://a/1' })).toBe('failed')
    // Resume selects a station on load and the bar's button plays it whatever
    // the row says; until 1.1.8 the failure then overwrote "Blocked" with
    // "No response" and re-enabled the row's button.
    expect(failedState({ id: '1', name: 'S', url: 'http://a/1' })).toBe('blocked')
    expect(failedState({ id: '1', name: 'S', url: 'https://a/l.pls' })).toBe('playlist')
    expect(failedState({ id: '1', name: 'S', url: 'https://a/l.m3u8' })).toBe('unsupported')
  })
})

describe('the verdict a station carries before anything is tried', () => {
  it('a station this device has played is not "not played yet"', async () => {
    const s = { id: '1', name: 'S', url: 'https://a/1' }
    // The two columns are drawn from different places and only one survives a
    // reload, so after one the State said "Not played yet" beside a Last
    // played of "1 min ago".
    expect(initialState(s, false)).toBe('untested')
    expect(initialState(s, true)).toBe('ready')
  })

  it('a structural verdict still wins: history cannot make http playable', async () => {
    expect(initialState({ id: '1', name: 'S', url: 'http://a/1' }, true)).toBe('blocked')
    expect(initialState({ id: '1', name: 'S', url: 'https://a/l.pls' }, true)).toBe('playlist')
    expect(initialState({ id: '1', name: 'S', url: 'https://a/l.m3u8' }, true)).toBe('unsupported')
    expect(initialState({ id: '1', name: 'S', url: 'not a url' }, true)).toBe('failed')
  })
})

describe('hostile input costs nothing', () => {
  it('a very long #EXTINF line with no attribute in it parses at once', () => {
    // 100 kB of key characters with no `=` took ten seconds: every offset was
    // tried as the start of a key. A file like that, sorting first, froze the
    // tab at every launch.
    const line = `#EXTINF:-1 ${'a'.repeat(200_000)},Name\nhttps://a/1\n`
    const started = performance.now()
    expect(parseM3u(line).stations[0].name).toBe('Name')
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('so does a station name that is one long run of spaces or digits', () => {
    const started = performance.now()
    stationBaseName(`Station ${' '.repeat(100_000)}x`)
    stationBaseName(`Station ${'1'.repeat(100_000)}x`)
    stationBaseName(`Station ${'['.repeat(100_000)}`)
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('an attribute named after something on Object.prototype is an attribute', () => {
    const list = parseM3u('#EXTINF:-1 constructor="x" __proto__="y",N\nhttps://a/1\n')
    expect(Object.keys(list.stations[0])).toEqual(['id', 'name', 'url', 'extra'])
    expect(list.stations[0].extra!.constructor).toBe('x')
    expect(serializeM3u(list)).toContain('constructor="x"')
    expect(serializeM3u(list)).toContain('__proto__="y"') // and survives the round trip
    expect(({} as Record<string, unknown>).y).toBeUndefined()
  })
})

describe('lines another player wrote', () => {
  const rt = (t: string) => serializeM3u(parseM3u(t))

  it('attributes on the #EXTM3U line survive', () => {
    const t = '#EXTM3U url-tvg="https://e/guide.xml"\n#EXTINF:-1,N\nhttps://a/1\n'
    expect(rt(t)).toBe(t)
  })

  it('an #EXTINF overtaken by another keeps its line, attributes and all', () => {
    const t = '#EXTM3U\n#EXTINF:-1 group-title="Lost",No address\n#EXTINF:-1,Has one\nhttps://a/1\n'
    expect(rt(t)).toBe(t)
    expect(parseM3u(t).stations).toHaveLength(1)
  })

  it('a dangling last #EXTINF keeps its attributes', () => {
    const t = '#EXTM3U\n#EXTINF:-1,Has one\nhttps://a/1\n#EXTINF:-1 group-title="Kept",Orphan\n'
    expect(rt(t)).toBe(t)
  })

  it('an XSPF logo is https or nothing, as in every other format', async () => {
    const doc = (img: string) => `<playlist xmlns="http://xspf.org/ns/0/"><trackList><track><location>https://a/1</location><image>${img}</image></track></trackList></playlist>`
    expect(parseXspf(doc('http://a/l.png')).stations[0].logo).toBeUndefined()
    expect(parseXspf(doc('https://a/l.png')).stations[0].logo).toBe('https://a/l.png')
  })
})

describe('one station on several servers, or several stations', () => {
  it('keeps the capitals of the name it combines under', () => {
    expect(stripServerSuffix('SomaFM: DEF CON Radio (#1)')).toBe('SomaFM: DEF CON Radio')
    expect(stripServerSuffix('SLAY Radio - 128kbps, relay2 [shoutcast - kork]')).toBe('SLAY Radio - 128kbps')
  })

  it('a number that is part of the name is not a server index', () => {
    expect(stationBaseName('BBC Radio 1')).not.toBe(stationBaseName('BBC Radio 2'))
    expect(stationBaseName('Hits 80')).not.toBe(stationBaseName('Hits 90'))
    expect(stationBaseName('Groove Salad #1')).toBe(stationBaseName('Groove Salad [2]'))
  })
})

describe('a directory answer is not trusted to be the shape it should be', () => {
  it('a field of the wrong type does not reach the file', async () => {
    const row = { name: 'N', url: 'https://a/1', url_resolved: 'https://a/1', stationuuid: 123, countrycode: 7 }
    const s = toStation(row as never)
    expect(s.extra).toBeUndefined()
    // Until fixed this threw in the writer, and with it every save of the list.
    expect(serializeM3u({ stations: [s], trailing: [] })).toContain('https://a/1')
  })

  it('administrator defaults carry named fields only', async () => {
    const s = sanitizeStation({ id: 'x', name: 'N', url: 'https://a/1', group: 'G',
      lead: ['https://injected/line'], extra: { 'x"y': 'z' } } as never)
    expect(s.lead).toBeUndefined()
    expect(s.extra).toBeUndefined()
    expect(s.group).toBe('G')
  })
})
