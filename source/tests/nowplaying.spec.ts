import { describe, it, expect, vi, afterEach } from 'vitest'
import { useNowPlaying } from '../src/composables/useNowPlaying'
import { readIcyTitle, streamTitleOf, undoubleUtf8, IcyUnavailable, MAX_METAINT } from '../src/helpers/icy'
import { trackFromJson, trackFromText, trackFromTritonXml, publishedSources, fromStreamTitle, describeTrack } from '../src/helpers/nowPlaying'
import { parseM3u, serializeM3u } from '../src/parsers/m3u'
import { gateStation } from '../src/helpers/safeUrl'
import { answer as respond } from './support/web'

/**
 * Track titles, from the three places a station may give them: its own
 * now-playing address, Icecast's status page, and the stream itself (ICY).
 * The stand-ins below answer as the real services were measured to answer
 * in November 2026 — SomaFM's ICY blocks, NPR's Cadence for KCUR and
 * Classical KC, an Icecast status — not as the code would like them to.
 */
afterEach(() => { vi.useRealTimers() })

/** A stream that weaves `title` into its audio every `metaint` bytes, served in chunks. */
const icyStream = (title: string | null, metaint = 64, { chunk = 50, encoding = 'utf-8' as 'utf-8' | 'latin1' } = {}) => {
  const text = title === null ? '' : `StreamTitle='${title}';`
  const bytes = encoding === 'latin1' ? Uint8Array.from([...text].map((c) => c.charCodeAt(0))) : new TextEncoder().encode(text)
  const len = Math.ceil(bytes.length / 16)
  const block = new Uint8Array(1 + len * 16)
  block[0] = len
  block.set(bytes, 1)
  const all = new Uint8Array(metaint + block.length + metaint)
  all.fill(0xff, 0, metaint)
  all.set(block, metaint)
  let at = 0
  let cancelled = false
  const reads = { count: 0, get cancelled() { return cancelled } }
  return {
    reads,
    response: {
      ok: true, status: 200, headers: new Headers({ 'icy-metaint': String(metaint) }),
      body: {
        getReader: () => ({
          read: async () => {
            reads.count++
            if (at >= all.length) return { done: true, value: undefined }
            const value = all.subarray(at, at + chunk)
            at += chunk
            return { done: false, value }
          },
          cancel: async () => { cancelled = true }
        })
      }
    } as unknown as Response
  }
}
/** An answer as a server sends one: a status, a type, and text. */
const answer = (text: string, type = 'application/json', ok = true) => respond(text, { type, ok })
const json = (body: unknown, ok = true) => respond(JSON.stringify(body), { ok })

describe('reading a title out of a stream', () => {
  it('reads up to the end of the first block, and no further', async () => {
    const s = icyStream('Klangstein - Ganz Leise (Tim Angrave Mix)', 64)
    const seen: Array<{ url: string; init?: RequestInit }> = []
    const title = await readIcyTitle('https://ice2.somafm.com/groovesalad-128-mp3', {
      request: (async (url: string, init?: RequestInit) => { seen.push({ url, init }); return s.response }) as typeof fetch
    })
    expect(title).toBe('Klangstein - Ganz Leise (Tim Angrave Mix)')
    expect((seen[0].init!.headers as Record<string, string>)['Icy-MetaData']).toBe('1')
    expect(seen[0].init!.credentials).toBe('omit')
    expect(seen[0].init!.referrerPolicy).toBe('no-referrer')
    expect(s.reads.count).toBeLessThanOrEqual(3) // 64 bytes of audio and one block: no more chunks than that
    expect((seen[0].init!.signal as AbortSignal).aborted).toBe(true) // and the connection is let go
  })

  it('reads Latin-1 where the bytes are not UTF-8, and UTF-8 where they are', () => {
    expect(streamTitleOf(Uint8Array.from([...`StreamTitle='Café';`].map((c) => c.charCodeAt(0))))).toBe('Café')
    expect(streamTitleOf(new TextEncoder().encode(`StreamTitle='İlhan Şeşen - Sarılınca Sana';\0\0\0`))).toBe('İlhan Şeşen - Sarılınca Sana')
    expect(streamTitleOf(new TextEncoder().encode(`StreamUrl='x';`))).toBe('')
  })

  it('puts right a title the station encoded twice, and leaves an honest one alone', () => {
    // SLAY Radio's bytes, as sent in November 2026: "é" as c3 83 c2 a9.
    const slay = Uint8Array.from([...new TextEncoder().encode("StreamTitle='Kent 'Trace' Walld"), 0xc3, 0x83, 0xc2, 0xa9,
      ...new TextEncoder().encode("n - Slaine';")])
    expect(streamTitleOf(slay)).toBe("Kent 'Trace' Walldén - Slaine")
    expect(undoubleUtf8('Walldén')).toBe('Walldén')       // already right
    expect(undoubleUtf8('Ã and ©')).toBe('Ã and ©')       // not a pair a double encoding makes
    expect(undoubleUtf8('İlhan Ã©')).toBe('İlhan Ã©')     // holds a character no byte can: not double-encoded
  })

  it('an empty first block is an empty title, not a failure', async () => {
    const s = icyStream(null, 32)
    expect(await readIcyTitle('https://a/s', { request: (async () => s.response) as typeof fetch })).toBe('')
  })

  it('a station that offers no metadata, or will not let the page ask, is unavailable rather than broken', async () => {
    const none = { ok: true, status: 200, headers: new Headers(), body: {} } as unknown as Response
    await expect(readIcyTitle('https://a/s', { request: (async () => none) as typeof fetch })).rejects.toBeInstanceOf(IcyUnavailable)
    // KCUR's server allows a page to send only `Range`: the preflight fails, as a TypeError.
    await expect(readIcyTitle('https://a/s', { request: (async () => { throw new TypeError('Failed to fetch') }) as typeof fetch }))
      .rejects.toBeInstanceOf(IcyUnavailable)
    const huge = { ok: true, status: 200, headers: new Headers({ 'icy-metaint': String(MAX_METAINT + 1) }), body: {} } as unknown as Response
    await expect(readIcyTitle('https://a/s', { request: (async () => huge) as typeof fetch })).rejects.toBeInstanceOf(IcyUnavailable)
  })

  it('a stream that never reaches its first block is given up on', async () => {
    vi.useFakeTimers()
    const stalled = {
      ok: true, status: 200, headers: new Headers({ 'icy-metaint': '16000' }),
      body: { getReader: () => ({ read: () => new Promise(() => {}), cancel: async () => {} }) }
    } as unknown as Response
    let signal: AbortSignal | undefined
    const reading = readIcyTitle('https://a/s', {
      request: (async (_u: string, init?: RequestInit) => { signal = init!.signal!; return stalled }) as typeof fetch,
      timeoutMs: 10_000
    })
    reading.catch(() => undefined)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(signal!.aborted).toBe(true)
  })
})

describe('the shapes a now-playing answer comes in', () => {
  it("NPR's Cadence, during music: the piece, its composer and performers, and when it ends", () => {
    const t = trackFromJson({
      currentlyPlayingSong: { title: 'Symphony No. 101 "The Clock"', artist: ['Chamber Orchestra of Europe'], composer: 'Franz Joseph Haydn',
        conductor: ['Claudio Abbado'], end: { utc: '2026-11-14T21:46:01Z' } },
      onNow: { programName: 'Classical Afternoons' }
    }, 'https://kcur.streamguys1.com/classicalkc-website-icy')
    expect(t).toEqual({ title: 'Symphony No. 101 "The Clock"', artist: 'Franz Joseph Haydn · Chamber Orchestra of Europe',
      program: 'Classical Afternoons', endsAt: Date.parse('2026-11-14T21:46:01Z') })
  })

  it("NPR's Cadence, during talk: the programme", () => {
    expect(trackFromJson({ onNow: { programName: 'BBC Newshour', end: { utc: '2026-11-14T22:00:00Z' } }, upNext: {} }, 'https://a/s'))
      .toEqual({ title: 'BBC Newshour', endsAt: Date.parse('2026-11-14T22:00:00Z') })
  })

  it('an Icecast status, matched to the mount playing', () => {
    const status = { icestats: { source: [
      { listenurl: 'http://ice.example:8000/other', title: 'Wrong - Track' },
      { listenurl: 'http://ice.example:8000/live', title: 'Right Artist - Right Track' }
    ] } }
    expect(trackFromJson(status, 'https://ice.example/live')).toEqual({ artist: 'Right Artist', title: 'Right Track' })
    expect(trackFromJson({ icestats: { source: [{ listenurl: 'http://x/a' }, { listenurl: 'http://x/b' }] } }, 'https://x/c')).toBeNull()
  })

  it("SomaFM's song feed, newest first", () => {
    expect(trackFromJson({ songs: [{ title: 'Ganz Leise', artist: 'Klangstein', album: 'Cool Off' }, { title: 'Older' }] }, 'https://a/s'))
      .toEqual({ title: 'Ganz Leise', artist: 'Klangstein' })
  })

  it('anything else is not an answer', () => {
    expect(trackFromJson('<HTML>Please, Donate to SomaFM.com</HTML>', 'https://a/s')).toBeNull()
    expect(trackFromJson({ unrelated: true }, 'https://a/s')).toBeNull()
  })

  it('an ICY title splits at the first " - ", and reads as one line', () => {
    expect(fromStreamTitle('Sound Factory - Come Take Control (Gloryfied Mix)')).toEqual({ artist: 'Sound Factory', title: 'Come Take Control (Gloryfied Mix)' })
    expect(fromStreamTitle('BBC World Service Online')).toEqual({ title: 'BBC World Service Online' })
    expect(fromStreamTitle('')).toBeNull()
    expect(describeTrack({ title: 'Templar', artist: 'Harold Budd' })).toBe('Templar — Harold Budd')
  })
})

describe('choosing a source and polling it', () => {
  const soma = { id: '1', name: 'Groove Salad', url: 'https://ice2.somafm.com/groovesalad-128-mp3' }

  it('SomaFM: status page refused (a donation page), titles from the stream', async () => {
    const request = vi.fn(async (url: string) => {
      if (url.endsWith('/status-json.xsl')) return answer('<HTML><body>Please, Donate to SomaFM.com</body></HTML>', 'text/html')
      if (url.includes('/stats?')) return answer('Not Found', 'text/plain', false)
      return icyStream('Harold Budd - Templar', 64).response
    })
    const np = useNowPlaying({ request: request as unknown as typeof fetch })
    np.start(soma)
    await vi.waitFor(() => expect(np.title.value).toBe('Templar — Harold Budd'))
    np.stop()
    expect(np.title.value).toBe('')
  })

  it('a source that refused is not asked again this session; one that answered is', async () => {
    vi.useFakeTimers()
    const request = vi.fn(async (url: string) => {
      if (url.endsWith('/status-json.xsl') || url.includes('/stats?')) throw new TypeError('blocked')
      return icyStream('A - One', 64).response
    })
    const kind = (u: unknown) => (String(u).endsWith('.xsl') ? 'status' : String(u).includes('/stats?') ? 'shoutcast' : 'icy')
    const np = useNowPlaying({ request: request as unknown as typeof fetch })
    np.start(soma)
    await vi.advanceTimersByTimeAsync(0)
    expect(request.mock.calls.map((c) => kind(c[0]))).toEqual(['status', 'shoutcast', 'icy'])
    await vi.advanceTimersByTimeAsync(30_000)
    expect(request.mock.calls.map((c) => kind(c[0]))).toEqual(['status', 'shoutcast', 'icy', 'icy'])
    np.stop()
  })

  it("a station's own address comes first, and a piece's end decides when to ask again", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-11-14T21:45:00Z'))
    const classical = { id: '2', name: '91.9 Classical KC', url: 'https://kcur.streamguys1.com/classicalkc-website-icy',
      nowPlaying: 'https://cadence.nprstations.org/api/cadence/widget/bff7476e-7a94-46bd-a35c-0fc00c9f0d51?show_song=true' }
    const request = vi.fn(async (_url: string) => json({ currentlyPlayingSong: { title: 'The Clock', composer: 'Haydn', end: { utc: '2026-11-14T21:46:01Z' } } }))
    const np = useNowPlaying({ request: request as unknown as typeof fetch })
    np.start(classical)
    await vi.advanceTimersByTimeAsync(0)
    expect(np.title.value).toBe('The Clock — Haydn')
    expect(String(request.mock.calls[0][0])).toContain('cadence.nprstations.org')
    await vi.advanceTimersByTimeAsync(30_000)  // the usual interval: not yet, the piece is still playing
    expect(request).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(35_000)  // it ends at 21:46:01, and is asked about just after
    expect(request).toHaveBeenCalledTimes(2)
    np.stop()
  })

  it('never asks more often than every 15 s, whatever a source says', async () => {
    vi.useFakeTimers()
    const request = vi.fn(async (_url: string) => json({ onNow: { programName: 'News', end: { utc: new Date(Date.now() + 1000).toISOString() } } }))
    const np = useNowPlaying({ request: request as unknown as typeof fetch })
    np.start({ id: '3', name: 'KCUR', url: 'https://kcur.streamguys1.com/kcur-website-icy', nowPlaying: 'https://cadence.example/w' })
    await vi.advanceTimersByTimeAsync(14_000)
    expect(request).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(request).toHaveBeenCalledTimes(2)
    np.stop()
  })

  it('asks the server that is playing, not the station\'s first', async () => {
    const request = vi.fn(async (_url: string) => json({ icestats: { source: [{ listenurl: 'http://s2.example/x', title: 'On Two' }] } }))
    const np = useNowPlaying({ request: request as unknown as typeof fetch })
    np.start({ id: '1', name: 'S', url: 'https://s1.example/x', alternates: ['https://s2.example/x'] }, 'https://s2.example/x')
    await vi.waitFor(() => expect(np.title.value).toBe('On Two'))
    expect(String(request.mock.calls[0][0])).toBe('https://s2.example/status-json.xsl')
    np.stop()
  })

  it('a late answer for the previous station is not shown under the new one', async () => {
    let release: (v: Response) => void = () => {}
    const np = useNowPlaying({ request: (() => new Promise<Response>((r) => { release = r })) as unknown as typeof fetch })
    np.start({ id: '1', name: 'S', url: 'https://a.example/1' })
    np.stop() // the user moved on while the request was out
    release(json({ icestats: { source: [{ listenurl: 'http://a.example/1', title: 'Stale' }] } }))
    await new Promise((r) => setTimeout(r, 5))
    expect(np.title.value).toBe('')
  })

  it('stopping closes a stream read still under way', async () => {
    let signal: AbortSignal | undefined
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('.xsl')) throw new TypeError('blocked')
      signal = init!.signal!
      return new Promise<Response>(() => {}) // the stream has not answered yet
    })
    const np = useNowPlaying({ request: request as unknown as typeof fetch })
    np.start(soma)
    await vi.waitFor(() => expect(signal).toBeDefined())
    np.stop()
    expect(signal!.aborted).toBe(true)
  })
})

describe("a station's now-playing address in the list", () => {
  it('round-trips as radio-nowplaying, https only', () => {
    const at = 'https://cadence.nprstations.org/api/cadence/widget/2edfb643-4010-4f9e-a6f8-78b08d5dbc2d?show_song=true'
    const list = parseM3u(`#EXTM3U\n#EXTINF:-1 radio-nowplaying="${at}",KCUR\nhttps://kcur.streamguys1.com/kcur-website-icy\n`)
    expect(list.stations[0].nowPlaying).toBe(at)
    expect(serializeM3u(list)).toContain(`radio-nowplaying="${at}"`)
    expect(parseM3u('#EXTINF:-1 radio-nowplaying="http://plain.example/np",X\nhttps://a/1\n').stations[0].nowPlaying).toBeUndefined()
    expect(gateStation({ id: '1', name: 'X', url: 'https://a/1', nowPlaying: 'javascript:alert(1)' }).nowPlaying).toBeUndefined()
  })
})

describe('the hosting services, as they answered in November 2026', () => {
  it('AzuraCast: the song, and when it ends from the seconds remaining', () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000_000)
    const t = trackFromJson({ station: {}, now_playing: { played_at: 1794693736, duration: 0, elapsed: 9, remaining: 242,
      song: { text: 'Snoop Dogg - What\'s My Name', artist: 'Snoop Dogg', title: 'What\'s My Name', album: '' } }, playing_next: {} }, 'https://a/listen/x/radio.mp3')
    expect(t).toEqual({ title: "What's My Name", artist: 'Snoop Dogg', endsAt: 1_000_000 + 242_000 })
    // A live DJ with only the combined text, and nothing remaining known:
    expect(trackFromJson({ now_playing: { remaining: 0, song: { text: 'Noizu - Summer 91 (Looking Back)', title: '', artist: '' } } }, 'https://a/s'))
      .toEqual({ artist: 'Noizu', title: 'Summer 91 (Looking Back)' })
  })

  it('Radio.co: the current track, as "Artist - Title"', () => {
    expect(trackFromJson({ status: 'online', current_track: { title: 'Good Riddance - Flies First Class', start_time: '2026-11-14T21:56:00+00:00' } }, 'https://a/s'))
      .toEqual({ artist: 'Good Riddance', title: 'Flies First Class' })
  })

  it('SHOUTcast v2: the song title among the server statistics', () => {
    expect(trackFromJson({ currentlisteners: 752, servertitle: 'DamarTürk FM', songtitle: 'ümit besen - Islak Mendil', streamstatus: 1 }, 'https://a/s'))
      .toEqual({ artist: 'ümit besen', title: 'Islak Mendil' })
  })

  it('Triton: the XML feed, its end time, and a track gone stale', () => {
    vi.useFakeTimers()
    const xml = (startMs: number) => `<?xml version="1.0" encoding="UTF-8"?><nowplaying-info-list><nowplaying-info mountName="RADIO538" timestamp="1" type="track">` +
      `<property name="cue_time_duration"><![CDATA[201912]]></property><property name="cue_time_start"><![CDATA[${startMs} ]]></property>` +
      `<property name="cue_title"><![CDATA[CARELESS WHISPER]]></property><property name="track_artist_name"><![CDATA[GEORGE MICHAEL]]></property>` +
      `</nowplaying-info></nowplaying-info-list>`
    vi.setSystemTime(1_794_678_700_000)
    expect(trackFromTritonXml(xml(1_794_678_645_407))).toEqual({ title: 'CARELESS WHISPER', artist: 'GEORGE MICHAEL', endsAt: 1_794_678_645_407 + 201_912 })
    // The same answer four hours later, as captured: the feed has gone quiet, and it is not what is on.
    vi.setSystemTime(1_794_693_736_000)
    expect(trackFromTritonXml(xml(1_794_678_645_407))).toBeNull()
    expect(trackFromText(xml(Date.now()), 'https://a/s')?.title).toBe('CARELESS WHISPER')
  })

  it('Zeno.FM: the first event of its metadata stream', () => {
    const sse = 'id:1794693696005\nevent:message\ndata:{"mount":"c45wbq2us3buv","streamTitle":"ALANIS MORISSETTE - KING OF PAIN"}\n\n'
    expect(trackFromText(sse, 'https://stream.zeno.fm/c45wbq2us3buv')).toEqual({ artist: 'ALANIS MORISSETTE', title: 'KING OF PAIN' })
  })

  it('an answer that is none of these is not an answer', () => {
    expect(trackFromText('<HTML><body>Please, Donate to SomaFM.com</body></HTML>', 'https://a/s')).toBeNull()
    expect(trackFromText('Not Found', 'https://a/s')).toBeNull()
  })
})

describe('where a stream says its titles are published', () => {
  it('is worked out from the stream address, for the hosts whose addresses say so', () => {
    expect(publishedSources('https://onair.armisa.it/listen/armisa/radio.mp3')).toEqual(['https://onair.armisa.it/api/nowplaying/armisa'])
    expect(publishedSources('https://streaming.radio.co/s6f093248d/listen')).toEqual(['https://public.radio.co/stations/s6f093248d/status'])
    expect(publishedSources('https://s3.radio.co/sc8d895604/listen')).toEqual(['https://public.radio.co/stations/sc8d895604/status'])
    expect(publishedSources('https://streams.radio.co/sa3345aaa8/listen')).toEqual(['https://public.radio.co/stations/sa3345aaa8/status'])
    expect(publishedSources('https://www.radio.co/about')).toEqual([]) // not a station
    expect(publishedSources('https://playerservices.streamtheworld.com/api/livestream-redirect/VIRGIN_RADIO_SC'))
      .toEqual(['https://np.tritondigital.com/public/nowplaying?mountName=VIRGIN_RADIO&numberToFetch=1&eventType=track'])
    expect(publishedSources('https://22323.live.streamtheworld.com/RADIO538.mp3'))
      .toEqual(['https://np.tritondigital.com/public/nowplaying?mountName=RADIO538&numberToFetch=1&eventType=track'])
    expect(publishedSources('https://stream.zeno.fm/c45wbq2us3buv')).toEqual(['https://api.zeno.fm/mounts/metadata/subscribe/c45wbq2us3buv'])
  })

  it('and for anything else, nothing is guessed', () => {
    expect(publishedSources('https://ice2.somafm.com/groovesalad-128-mp3')).toEqual([])
    expect(publishedSources('https://evil.example/listen/x/y')).toEqual(['https://evil.example/api/nowplaying/x']) // same host as the stream: nothing new is reached
    expect(publishedSources('https://notstreamtheworld.com.evil.example/RADIO538.mp3')).toEqual([])
    expect(publishedSources('not a url')).toEqual([])
  })
})

describe('reading an answer', () => {
  it('a published source is asked before the server and the stream', async () => {
    const request = vi.fn(async (url: string) => (url.includes('/api/nowplaying/')
      ? json({ now_playing: { song: { title: 'Lonely East Texas Nights', artist: 'Whiskey Myers' }, remaining: 41 } })
      : answer('', 'text/plain', false)))
    const np = useNowPlaying({ request: request as unknown as typeof fetch })
    np.start({ id: '1', name: 'Outlaw', url: 'https://radio.example/listen/outlaw/radio.mp3' })
    await vi.waitFor(() => expect(np.title.value).toBe('Lonely East Texas Nights — Whiskey Myers'))
    expect(request).toHaveBeenCalledTimes(1)
    np.stop()
  })

  it('an event stream is read to its first event and then let go', async () => {
    let cancelled = false
    const chunks = ['id:1\nevent:message\ndata:{"streamTitle":"Lata - Song"}\n', '\n', 'id:2\ndata:{"streamTitle":"never read"}\n\n']
    const sse = { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream;charset=UTF-8' }),
      body: { getReader: () => ({ read: async () => (chunks.length ? { done: false, value: new TextEncoder().encode(chunks.shift()!) } : new Promise(() => {})),
        cancel: async () => { cancelled = true } }) } } as unknown as Response
    const np = useNowPlaying({ request: (async () => sse) as unknown as typeof fetch })
    np.start({ id: '1', name: 'Zeno', url: 'https://stream.zeno.fm/abc123' })
    await vi.waitFor(() => expect(np.title.value).toBe('Song — Lata'))
    expect(chunks).toHaveLength(1) // the second event was never read
    expect(cancelled).toBe(true)
    np.stop()
  })

  it('an answer too large to be one is refused, and the next source asked', async () => {
    const big = { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
      body: { getReader: () => ({ read: async () => ({ done: false, value: new Uint8Array(600 * 1024).fill(0x20) }), cancel: async () => {} }) } } as unknown as Response
    const request = vi.fn(async (url: string) => (url.endsWith('.xsl') ? big : url.includes('/stats?')
      ? json({ songtitle: 'Next - Source' }) : answer('', 'text/plain', false)))
    const np = useNowPlaying({ request: request as unknown as typeof fetch })
    np.start({ id: '1', name: 'S', url: 'https://sc.example:8000/stream' })
    await vi.waitFor(() => expect(np.title.value).toBe('Source — Next'))
    np.stop()
  })
})
