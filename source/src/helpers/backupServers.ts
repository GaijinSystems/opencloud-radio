import type { Station } from '../parsers/types'
import { serversOf, distinctServers, MAX_SERVERS } from './stations'
import { playsHere } from './classify'
import { isPlaylistUrl, isStationListUrl } from './playlist'
import { readPlaylistServers, readCapped } from './resolve'
import { ownAddress } from './relays'
import { ANONYMOUS, lateFetch, refused, Refused, type RefusedKind } from './fetch'
import { tritonMount } from './nowPlaying'
import { uuidOf } from './directory'
import { safeUrl } from './safeUrl'

/**
 * Finding a station's other servers: the playlist it publishes, read for
 * every address in it.
 *
 * A station's playlist (.pls, .m3u) lists the same stream on several servers,
 * which is what lets the player move on when one fails. Kept as the station's
 * `source`, it also lets the player read the list again when every server it
 * knows has failed. Where to find that playlist, in order:
 *
 *  1. The station's own `source`, if it already has one.
 *  2. The playlist its host publishes, found from the stream address alone,
 *     for the hosts measured to allow it in November 2026:
 *       SomaFM — the channel list names a playlist per quality, and the one
 *         listing this exact stream is chosen, so a 64k AAC station never
 *         becomes a 256k MP3 one. Three servers each.
 *       StreamTheWorld (Triton) — `playerservices.streamtheworld.com/pls/
 *         <MOUNT>.pls`, from 3 to 100 servers of the same stream.
 *  3. The station's entry in the online directory — only when the
 *     administrator has enabled the directory, since asking it sends the
 *     station's name to a third party: the playlist link the station gave it.
 *
 * Not used, on the evidence: AzuraCast (its playlists did not allow another
 * site to read them), Zeno.FM (one server, nothing to fail over to), and a
 * station's own website (of those sampled, nearly none allowed it).
 */

export { MAX_SERVERS }

export interface Found {
  /** The playlist the servers came from, kept as the station's `source`. None when only `converted`. */
  playlist?: string
  /** Primary first, then backups: https first, the address playing kept first where it can be. */
  url: string
  alternates: string[]
  /** How many servers the station did not have before. */
  added: number
  /** How many of its addresses were a relay's, given back as the station's own (`helpers/relays`). */
  converted: number
  /**
   * With only `converted` to offer: the lookup for more could not be made,
   * and why (a `Refused`). Offered without it, the conversion read as all
   * there was to find.
   */
  unread?: Refused
}

export interface FindOptions {
  /** Whether the online directory may be asked (the administrator's `directoryEnabled`). */
  directory?: boolean
  /** The directory's mirror, when it is to be asked. */
  directoryHost?: string
  /** How deep a playlist that points at another playlist is followed. */
  depth?: number
  request?: typeof fetch
}

const getJson = async (url: string, request: typeof fetch): Promise<unknown> => {
  const res = await request(url, { ...ANONYMOUS, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  // A directory page or SomaFM's channel list is tens of kilobytes.
  const text = await readCapped(res, 2_000_000)
  if (text === null) throw new Error('answer too large')
  return JSON.parse(text)
}

/**
 * What says two addresses are the same stream across servers: the path —
 * SomaFM's `/groovesalad-128-mp3` on ice2, ice5 and ice6. A stream served from
 * its server's root (Icecast and SHOUTcast relays: SLAY Radio's
 * `http://relay4.slayradio.org:8000/`) has no path to tell it by, and every
 * root-served station would match; it is told by its host as well.
 */
const pathOf = (u: string): string => {
  try {
    const url = new URL(u)
    const path = url.pathname.replace(/\/+$/, '')
    return path || `//${url.host.toLowerCase()}`
  } catch { return '' }
}

/** SomaFM: the playlist, among the channel's, that lists this very stream. */
const somaPlaylists = async (stream: string, request: typeof fetch, note: (r: Refused) => void): Promise<string[]> => {
  let u: URL
  try { u = new URL(stream) } catch { return [] }
  if (!/(^|\.)somafm\.com$/i.test(u.hostname)) return []
  const mount = u.pathname.split('/').filter(Boolean)[0] ?? ''
  const channel = mount.split('-')[0]
  if (!/^[a-z0-9]+$/i.test(channel)) return []
  const out = [`https://somafm.com/${channel}.pls`]
  try {
    const j = await somaChannels(request)
    const channels = Array.isArray(j?.channels) ? j.channels : [] // not a list: no answer, not a refusal
    const playlists = channels.find((c) => c?.id === channel)?.playlists
    for (const p of Array.isArray(playlists) ? playlists : []) {
      if (typeof p?.url === 'string') out.push(p.url)
    }
  } catch (e) { if (refused(e)) note(new Refused('channels')) /* the 128k MP3 playlist alone */ }
  return out
}

type SomaChannels = { channels?: Array<{ id?: string; playlists?: Array<{ url?: string }> }> }
/**
 * SomaFM's channel list, asked for once and shared for a few minutes: a list
 * of thirty SomaFM stations looked over at once asked for the same file thirty
 * times. Kept per way of asking, so a stand-in's answers stay its own. A
 * failure is not kept — save a refusal, for a minute: where the site's policy
 * blocks SomaFM, each of thirty stations was refused in turn, each a console
 * error, and a report where the site asks for them.
 */
const SOMA_FOR_MS = 5 * 60_000
const REFUSED_FOR_MS = 60_000
let somaCache = new WeakMap<typeof fetch, { until: number; list: Promise<SomaChannels> }>()
const somaChannels = (request: typeof fetch): Promise<SomaChannels> => {
  const had = somaCache.get(request)
  if (had && Date.now() < had.until) return had.list
  const list = getJson('https://api.somafm.com/channels.json', request) as Promise<SomaChannels>
  const entry = { until: Date.now() + SOMA_FOR_MS, list }
  somaCache.set(request, entry)
  list.catch((e: unknown) => {
    if (somaCache.get(request) !== entry) return
    if (refused(e)) entry.until = Date.now() + REFUSED_FOR_MS
    else somaCache.delete(request)
  })
  return list
}

/** StreamTheWorld: the mount's own playlist. */
const tritonPlaylist = (stream: string): string[] => {
  const mount = tritonMount(stream)
  return mount ? [`https://playerservices.streamtheworld.com/pls/${mount}.pls`] : []
}

/**
 * A directory host that refused, and until when it is not asked again: where
 * the site's policy blocks the directory, each of thirty stations was refused
 * in turn, each a console error. Kept per way of asking, as SomaFM's list is.
 */
let directoryRefusedUntil = new WeakMap<typeof fetch, Map<string, number>>()

/** Forgets what was kept between lookups (SomaFM's list, refusals): for tests, which share one way of asking. */
export const forgetLookups = (): void => {
  somaCache = new WeakMap()
  directoryRefusedUntil = new WeakMap()
}

/** The directory's entry for this station: by its id if it came from there, else by name and stream. */
const directoryPlaylist = async (s: Station, host: string, request: typeof fetch, note: (r: Refused) => void): Promise<string[]> => {
  const base = `https://${host}/json/stations`
  const refusedHosts = directoryRefusedUntil.get(request) ?? new Map<string, number>()
  directoryRefusedUntil.set(request, refusedHosts)
  if ((refusedHosts.get(host) ?? 0) > Date.now()) { note(new Refused('directory', { host })); return [] }
  try {
    const uuid = uuidOf(s)
    const rows = (uuid
      ? await getJson(`${base}/byuuid/${encodeURIComponent(uuid)}`, request)
      : await getJson(`${base}/search?name=${encodeURIComponent(s.name)}&limit=20&hidebroken=true`, request)) as Array<{ url?: string; url_resolved?: string } | null>
    // An answer that is not a list is no answer — and not, as the TypeError of
    // reading it as one would have been taken for, a refusal.
    if (!Array.isArray(rows)) return []
    const path = pathOf(s.url)
    const mine = uuid ? rows : rows.filter((r) => pathOf(r?.url_resolved ?? '') === path) // by name: only an entry for this very stream
    return mine.map((r) => r?.url ?? '').filter((u) => isPlaylistUrl(u))
  } catch (e) {
    if (refused(e)) {
      refusedHosts.set(host, Date.now() + REFUSED_FOR_MS)
      note(new Refused('directory', { host }))
    }
    return []
  }
}

/**
 * The servers to keep: those this browser can play first, the one playing
 * now first among them, nothing twice, at most `MAX_SERVERS`.
 */
export const mergeServers = (current: Station, found: string[]): { url: string; alternates: string[] } => {
  // A playlist link is no server: it would be a row that does not play.
  const all = distinctServers([...found.filter((u) => !isStationListUrl(u)), ...serversOf(current)])
  const playable = all.filter(playsHere)
  const rest = all.filter((u) => !playable.includes(u))
  // An http server is only kept where there is nothing better: a browser on
  // an https page will not play it, and the player skips it anyway.
  const order = playable.length ? playable : rest
  if (order.includes(current.url)) {
    order.splice(order.indexOf(current.url), 1)
    order.unshift(current.url)
  }
  const kept = order.slice(0, MAX_SERVERS)
  return { url: kept[0] ?? current.url, alternates: kept.slice(1) }
}

/** Which refusal is said, of several met: the lower the rank, the more it says. */
const RANK: Record<RefusedKind, number> = { playlist: 0, found: 1, channels: 2, directory: 3 }

/**
 * Looks for a playlist that lists `given` and the servers in it. `null` when
 * there is none to be had, or it adds nothing the station does not have, and
 * none of its addresses was a relay's to give back as its own; `Refused`,
 * thrown, when there was nothing because a playlist could not be read.
 */
export const findBackupServers = async (given: Station, o: FindOptions = {}): Promise<Found | null> => {
  // A station entered with its relay's address is looked up by its own, which
  // is what playlists and the directory name; it plays from the relay either way.
  const own = [...new Set(serversOf(given).map((u) => ownAddress(u)))]
  const converted = serversOf(given).filter((u) => ownAddress(u) !== u).length
  const s: Station = converted ? { ...given, url: own[0], alternates: own.slice(1) } : given
  const request = o.request ?? lateFetch
  // What could not be read, if anything (see `Refused`): with nothing else
  // found, the answer is "could not look", not "nothing there". The station's
  // own playlist outranks one found for it, then SomaFM's channel list, then
  // the directory (`RANK`); of one rank, the first met.
  let unread: Refused | undefined
  const note = (r: Refused) => { if (!unread || RANK[r.kind] < RANK[unread.kind]) unread = r }
  const depth = o.depth ?? 2
  // In order, each source asked only when those before it found nothing: the
  // directory, which is sent the station's name, last of all.
  async function * candidates (): AsyncGenerator<{ at: string; exact: boolean }> {
    if (s.source) yield { at: s.source, exact: false }
    for (const at of tritonPlaylist(s.url)) yield { at, exact: false }
    // SomaFM offers a playlist per quality: only one that lists this stream will do.
    for (const at of await somaPlaylists(s.url, request, note)) yield { at, exact: true }
    if (o.directory && o.directoryHost) {
      for (const at of await directoryPlaylist(s, o.directoryHost, request, note)) yield { at, exact: true }
    }
  }
  const path = pathOf(s.url)
  const tried = new Set<string>()
  // The station's own playlist, in the form the URL gate gives, as each candidate is.
  const ownSource = safeUrl(s.source)
  for await (const { at: candidate, exact } of candidates()) {
    // Kept as the station's playlist address if it gives servers: through the
    // URL gate like every address a station keeps, and in the form it gives.
    const at = safeUrl(candidate)
    if (!at || tried.has(at)) continue
    tried.add(at)
    let servers: string[]
    try {
      servers = await readPlaylistServers(at, depth)
    } catch (e) {
      if (!(e instanceof Refused)) throw e
      // Only the station's own is "the station's playlist"; one found for it
      // is said as that, with its host, which the site's policy may need.
      note(at === ownSource ? e : e.found())
      continue
    }
    // Only playlists, none of them read (past the depth followed): no servers.
    servers = servers.filter((u) => !isStationListUrl(u))
    if (!servers.length) continue
    if (exact && !servers.some((u) => pathOf(u) === path)) continue
    const merged = mergeServers(s, servers)
    const before = new Set(serversOf(s))
    const added = [merged.url, ...merged.alternates].filter((u) => !before.has(u)).length
    if (!added && ownSource === at && !converted) return null
    return { playlist: at, ...merged, added, converted }
  }
  if (converted) return { url: s.url, alternates: s.alternates ?? [], added: 0, converted, ...(unread ? { unread } : {}) }
  if (unread) throw unread
  return null
}
