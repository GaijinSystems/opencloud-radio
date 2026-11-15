import { oneLine } from './safeUrl'

/**
 * What is playing, from wherever a station says so, as one shape.
 *
 * Every kind of answer below is told apart by its shape rather than by who
 * sent it, so that a station's now-playing address can point at any of them.
 * Each was built from real answers captured in November 2026, and each
 * allowed a page on another origin to read it then:
 *
 *  - NPR's Cadence (`cadence.nprstations.org/api/cadence/widget/…`), for
 *    public radio such as KCUR: the programme and, during music, the piece,
 *    its composer and performers, and when it ends.
 *  - Icecast's `/status-json.xsl`: one entry per mount, matched to the stream.
 *  - SHOUTcast v2's `/stats?sid=1&json=1`.
 *  - AzuraCast's `/api/nowplaying/<station>`, the common self-hosted panel.
 *  - Radio.co's `public.radio.co/stations/<id>/status`.
 *  - Triton Digital's `np.tritondigital.com/public/nowplaying` (XML), which
 *    serves the StreamTheWorld stations of many commercial broadcasters.
 *  - Zeno.FM's metadata event stream (`api.zeno.fm/mounts/metadata/subscribe/…`).
 *  - SomaFM's song feed (`somafm.com/songs/<channel>.json`): newest first.
 *
 * An ICY `StreamTitle`, read from the stream itself, is the last resort.
 *
 * Not read, on the evidence: titles inside Ogg streams (Vorbis, Opus, FLAC).
 * Of twelve Ogg stations sampled, none carried a title in the headers a new
 * connection receives — the title arrives only when the song changes, which a
 * brief read cannot wait for. Icecast's status page covers most of them.
 */
export interface Track {
  /** The piece or programme, as the station names it. */
  title: string
  /** Who made or performs it, when the source says. */
  artist?: string
  /** The programme it is part of, when that is not the title itself. */
  program?: string
  /** When the source says this ends, epoch ms: the moment to ask again. */
  endsAt?: number
}

const str = (v: unknown): string => (typeof v === 'string' ? oneLine(v) : '')
const first = (v: unknown): string => (Array.isArray(v) ? str(v.find((x) => str(x))) : str(v))
const time = (v: unknown): number | undefined => {
  const t = Date.parse(str((v as { utc?: unknown } | undefined)?.utc))
  return Number.isFinite(t) ? t : undefined
}

/** An ICY title, usually "Artist - Title": split at the first " - " when there is one. */
export const fromStreamTitle = (text: string): Track | null => {
  const t = str(text)
  if (!t) return null
  const at = t.indexOf(' - ')
  return at > 0 ? { artist: t.slice(0, at).trim(), title: t.slice(at + 3).trim() } : { title: t }
}

/** An ICY-style title, or a blank answer: about this stream, but naming nothing (unlike `null`, no answer at all). */
const titled = (text: string): Track => fromStreamTitle(text) ?? { title: '' }

/** A track carrying only the fields that have a value. */
const track = (title: string, more: Omit<Track, 'title'> = {}): Track => {
  const t: Track = { title }
  if (more.artist) t.artist = more.artist
  if (more.program) t.program = more.program
  if (more.endsAt) t.endsAt = more.endsAt
  return t
}

const fromCadence = (j: Record<string, unknown>): Track | null => {
  const song = j.currentlyPlayingSong as Record<string, unknown> | undefined
  const onNow = j.onNow as Record<string, unknown> | undefined
  const program = str(onNow?.programName) || str((onNow?.program as Record<string, unknown> | undefined)?.name)
  if (song && str(song.title)) {
    // Classical listings name a composer and the performers; popular music an artist.
    const artist = [str(song.composer), first(song.artist) || first(song.ensemble) || first(song.conductor)]
      .filter(Boolean).filter((v, i, all) => all.indexOf(v) === i).join(' · ')
    return track(str(song.title), { artist, program, endsAt: time(song.end) })
  }
  if (program) return track(program, { endsAt: time(onNow?.end) })
  return null
}

const fromStatusJson = (j: Record<string, unknown>, stream: string): Track | null => {
  const src = (j.icestats as { source?: unknown } | undefined)?.source
  const sources = (Array.isArray(src) ? src : src ? [src] : []) as Array<Record<string, unknown>>
  let path = ''
  try { path = new URL(stream).pathname.replace(/\/+$/, '') } catch { return null }
  // One malformed `listenurl` must not throw the whole answer away.
  const samePath = (listen: unknown): boolean => {
    try { return typeof listen === 'string' && new URL(listen, stream).pathname.replace(/\/+$/, '') === path } catch { return false }
  }
  const match = sources.find((s) => samePath(s.listenurl)) ?? (sources.length === 1 ? sources[0] : undefined)
  if (!match) return null // this server does not carry the stream: not an answer about it
  return titled(str(match.title) || str(match.yp_currently_playing))
}

const fromAzuraCast = (j: Record<string, unknown>): Track | null => {
  const np = j.now_playing as Record<string, unknown> | undefined
  const song = np?.song as Record<string, unknown> | undefined
  if (!song) return null
  const title = str(song.title)
  const remaining = Number(np?.remaining)
  const endsAt = Number.isFinite(remaining) && remaining > 0 ? Date.now() + remaining * 1000 : undefined
  const t = title ? track(title, { artist: str(song.artist) }) : titled(str(song.text))
  return t.title ? track(t.title, { artist: t.artist, endsAt }) : t
}

const fromRadioCo = (j: Record<string, unknown>): Track =>
  titled(str((j.current_track as Record<string, unknown> | undefined)?.title))

const fromShoutcast = (j: Record<string, unknown>): Track => titled(str(j.songtitle))

/** A finished track older than this is the feed having gone quiet, not what is on now. */
const STALE_MS = 10 * 60_000

/** The entities XML itself defines; Triton's plain values use no others. */
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/**
 * Triton's answer is XML: one `nowplaying-info` with named properties. Its
 * last track can be hours old when a station's feed has stopped — Radio 538's
 * was four hours old when captured — so a track that ended long ago is not
 * reported as playing; the next source is asked instead.
 */
export const trackFromTritonXml = (answer: string): Track | null => {
  // One track's properties are a few hundred bytes; the rest is not read.
  const xml = answer.slice(0, 64_000)
  if (!/<nowplaying-info[\s>]/.test(xml)) return null
  // Found, not matched: one search for the property and one for its end,
  // so no answer, however built, costs more than reading it once. (Two
  // regular expressions before this took minutes, then a quarter of a second
  // a poll, on answers made to defeat them.)
  const prop = (name: string) => {
    const at = xml.indexOf(`<property name="${name}"`)
    const open = at < 0 ? -1 : xml.indexOf('>', at)
    if (open < 0 || xml[open - 1] === '/') return '' // absent, or empty: `<property … />`
    const end = xml.indexOf('</property>', open)
    if (end < 0) return ''
    const value = xml.slice(open + 1, end).trim()
    // A CDATA section is the text between its markers, `]` and all.
    if (value.startsWith('<![CDATA[') && value.endsWith(']]>')) return str(value.slice(9, -3))
    if (value.includes('<')) return '' // markup, not a value: the next property, say
    return str(value.replace(/&(\w+);/g, (m, e: string) => ENTITIES[e] ?? m))
  }
  const title = prop('cue_title')
  if (!title) return { title: '' }
  const start = Number(prop('cue_time_start'))
  const duration = Number(prop('cue_time_duration'))
  const endsAt = start > 0 && duration > 0 ? start + duration : undefined
  if (endsAt && endsAt < Date.now() - STALE_MS) return null
  return track(title, { artist: prop('track_artist_name'), endsAt: endsAt && endsAt > Date.now() ? endsAt : undefined })
}

/** The first event of an event stream, as Zeno.FM sends it: `data:{"streamTitle":…}`. */
const trackFromEventStream = (text: string): Track | null => {
  const data = text.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n')
  if (!data) return null
  try {
    const j = JSON.parse(data) as Record<string, unknown>
    return 'streamTitle' in j ? titled(str(j.streamTitle)) : null
  } catch { return null }
}

const fromSomaSongs = (j: Record<string, unknown>): Track | null => {
  const song = (j.songs as Array<Record<string, unknown>>)[0]
  if (!song || !str(song.title)) return null
  return track(str(song.title), { artist: str(song.artist) })
}

/**
 * The track in a JSON answer, or `null` when the answer is not one this app
 * understands or says nothing about this stream. `stream` is the address
 * playing, which Icecast's status lists by mount.
 */
export const trackFromJson = (json: unknown, stream: string): Track | null => {
  if (!json || typeof json !== 'object') return null
  const j = json as Record<string, unknown>
  if ('onNow' in j || 'currentlyPlayingSong' in j) return fromCadence(j)
  if ('icestats' in j) return fromStatusJson(j, stream)
  if ('now_playing' in j) return fromAzuraCast(j)
  if ('current_track' in j) return fromRadioCo(j)
  if ('songtitle' in j) return fromShoutcast(j)
  if (Array.isArray(j.songs)) return fromSomaSongs(j)
  return null
}

/**
 * The track in any answer this app understands, whatever it is written in:
 * JSON, Triton's XML, or the first event of an event stream.
 */
export const trackFromText = (text: string, stream: string): Track | null => {
  const t = text.trimStart()
  if (t.startsWith('<')) return trackFromTritonXml(t)
  if (/^(id|event|data|retry):/m.test(t) && !t.startsWith('{')) return trackFromEventStream(t)
  try { return trackFromJson(JSON.parse(t), stream) } catch { return null }
}

/**
 * A StreamTheWorld (Triton) stream's mount: …streamtheworld.com/…/<MOUNT>[_SC][.mp3|.aac].
 * Both its now-playing feed and its playlist know it without `_SC`.
 */
export const tritonMount = (stream: string): string | undefined => {
  let u: URL
  try { u = new URL(stream) } catch { return undefined }
  if (!/(^|\.)streamtheworld\.com$/i.test(u.hostname)) return undefined
  const file = u.pathname.split('/').filter(Boolean).pop() ?? ''
  const mount = file.replace(/\.(mp3|aac|m3u8|pls)$/i, '').replace(/_SC$/i, '')
  return /^[A-Z0-9_]+$/i.test(mount) ? mount : undefined
}

/**
 * Where a stream's own address says its titles are published, for the hosts
 * whose addresses say so. No configuration needed for these: a station on
 * AzuraCast, Radio.co, Triton (StreamTheWorld) or Zeno.FM shows its titles as
 * soon as it plays. Each rule was checked against real stations in November
 * 2026 (AzuraCast 6 of 8, Radio.co 8 of 8, Triton 13 of 14, Zeno 6 of 6; then
 * 15 of 17 through this code, the two misses being a station with its API
 * switched off and a mount with no feed).
 */
export const publishedSources = (stream: string): string[] => {
  let u: URL
  try { u = new URL(stream) } catch { return [] }
  const parts = u.pathname.split('/').filter(Boolean)
  const out: string[] = []
  // AzuraCast: https://host/listen/<station>/<file>
  if (parts[0] === 'listen' && parts.length >= 3) out.push(`${u.origin}/api/nowplaying/${encodeURIComponent(parts[1])}`)
  // Radio.co: https://<any>.radio.co/<station id>/listen — stream, streaming,
  // streams, s2, s3… all seen; the station id is an "s" and hex.
  if (/(^|\.)radio\.co$/i.test(u.hostname) && /^s[0-9a-f]{6,}$/i.test(parts[0] ?? '')) {
    out.push(`https://public.radio.co/stations/${encodeURIComponent(parts[0])}/status`)
  }
  const mount = tritonMount(stream)
  if (mount) out.push(`https://np.tritondigital.com/public/nowplaying?mountName=${mount}&numberToFetch=1&eventType=track`)
  // Zeno.FM: https://stream(-…).zeno.fm/<mount>
  if (/(^|\.)zeno\.fm$/i.test(u.hostname) && parts.length && /^[a-z0-9]+$/i.test(parts[parts.length - 1])) {
    out.push(`https://api.zeno.fm/mounts/metadata/subscribe/${parts[parts.length - 1]}`)
  }
  return out
}

/** One line for the player bar. */
export const describeTrack = (t: Track | null): string =>
  !t || !t.title ? '' : t.artist ? `${t.title} — ${t.artist}` : t.title
