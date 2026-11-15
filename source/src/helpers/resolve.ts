import { parsePlaylist } from '../parsers'
import { isPlaylistUrl, isStationListUrl } from './playlist'
import { ANONYMOUS, lateFetch, refused, Refused, hostOf } from './fetch'

/*
 * Reading a playlist, and returning EVERY server in it, in order.
 *
 * The reason a station publishes a .pls is that it lists several servers: when
 * one dies the player moves to the next. Resolving the file to a single address
 * throws away exactly the thing it exists to provide, so this returns the whole
 * list and the caller keeps it.
 *
 * Fetching is a cross-origin request and fails for many hosts — best-effort:
 * an empty array on failure, or `Refused`, thrown, when it could not be
 * reached or read (see `refused`). Never called on the critical path of starting
 * playback for the first time.
 */

/** How long one playlist has to arrive, body and all. */
const FETCH_TIMEOUT_MS = 10000
/** A station's own playlist is a few hundred bytes; this is generous. */
const MAX_PLAYLIST_BYTES = 1_000_000

/**
 * A response's body as text, or null when it is longer than `max` bytes. It
 * is counted as it arrives, so a body with no declared length is bounded too,
 * and the rest is not downloaded once the limit is passed.
 */
export const readCapped = async (
  res: Response, max: number, { until }: { until?: (text: string, from: number) => boolean } = {}
): Promise<string | null> => {
  if (Number(res.headers?.get('content-length')) > max) return null
  const reader = res.body?.getReader()
  if (!reader) {
    const all = await res.text()
    return all.length > max ? null : all
  }
  const decoder = new TextDecoder()
  let out = ''
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return out + decoder.decode()
      bytes += value.byteLength
      if (bytes > max) return null
      const from = out.length
      out += decoder.decode(value, { stream: true })
      // Enough already (the first event of an event stream): the rest is not read.
      if (until?.(out, from)) return out
    }
  } finally {
    void reader.cancel().catch(() => undefined) // a no-op once the body is read to its end
  }
}

/**
 * The body as text, or null; and whether the host answered at all — a status,
 * or a body too large — as against a timeout, which is no answer.
 */
const fetchCapped = async (url: string): Promise<{ text: string | null; answered: boolean }> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await lateFetch(url, { ...ANONYMOUS, signal: controller.signal })
    return { text: res.ok ? await readCapped(res, MAX_PLAYLIST_BYTES) : null, answered: true }
  } finally {
    clearTimeout(timer)
    controller.abort() // releases a body refused unread; a no-op once it has been read
  }
}

/**
 * Every server a playlist lists (see the top of this file). When nothing could
 * be read because the page was refused (see `refused`), it says so by throwing
 * `Refused`: "nothing there" and "not allowed to look" are different answers,
 * and only the second is the administrator's to fix. Anything else — no
 * answer, a 404, not a playlist — is `[]`.
 */
export const readPlaylistServers = (url: string, depth: number): Promise<string[]> =>
  readFrom(url, depth, { seen: new Set(), asked: 0 })

/**
 * One lookup's walk through playlists: those already read (a playlist that
 * leads back to one before it is not read again), and how many requests were
 * made, which is bounded for the whole walk — a playlist of playlists of
 * playlists would otherwise be dozens of requests, one after another.
 */
type Walk = { seen: Set<string>; asked: number }
const MAX_ASKED = 8

const readFrom = async (url: string, depth: number, walk: Walk): Promise<string[]> => {
  // Its http and https forms are one address: an http one is asked over https.
  const asHttps = url.replace(/^http:/i, 'https:')
  if (depth <= 0 || !isPlaylistUrl(url) || !/^https?:\/\//i.test(url) || !fetchable(url) || walk.seen.has(url) || walk.seen.has(asHttps)) return []
  walk.seen.add(url).add(asHttps)
  try {
    // The address came from a file or a directory. No cookies, no referrer,
    // and neither forever nor without limit: a body that never ends otherwise
    // never returns and grows until the tab dies.
    //
    // A page served over https may not fetch plain http at all, so an http
    // link is asked for over https first: many hosts serve both, and the
    // directory still lists plenty of playlists by their old http address.
    //
    // From an https page the http address itself is never asked: it would be
    // blocked as mixed content, before it left the browser, every time.
    const secure = globalThis.location?.protocol === 'https:'
    const tries = /^http:/i.test(url) ? [asHttps, ...(secure ? [] : [url])] : [url]
    let text: string | null = null
    // Blamed on a refusal only when the last try was refused: an https try a
    // host cannot answer, then a 404 over http, is a dead link.
    let wasRefused = false
    let answered = false
    for (const at of tries) {
      // Out of requests before an answer: nothing is known, so nothing is said
      // — not a refusal of a try the next one might have bettered.
      if (walk.asked >= MAX_ASKED) return []
      walk.asked++
      try {
        ({ text, answered } = await fetchCapped(at))
        wasRefused = false
      } catch (e) {
        wasRefused = refused(e)
        answered = false
      }
      if (text !== null) break
    }
    // An http link from an https page was asked for over https alone. Its host
    // answered, but not with a playlist: the likeliest reason is that it serves
    // the file only over http, which this page may not ask — said as such,
    // since "nothing there" would be the one answer that is surely wrong. Not
    // said of a host that did not answer (a timeout, the browser offline).
    const httpOnly = secure && /^http:/i.test(url)
    const answeredWithout = () => new Refused('playlist', { http: true, answered: true, host: hostOf(url) })
    if (text === null) {
      if (wasRefused) throw new Refused('playlist', { http: httpOnly, host: hostOf(url) })
      if (httpOnly && answered) throw answeredWithout()
      return []
    }
    // An HLS manifest, or anything else that is not a playlist, throws here and
    // is an empty answer: the classifier already says what such an address is.
    // An HLS manifest over https is a stream that answered as one: not "without
    // a playlist", and not to be said as such.
    // An ASX file is a playlist this app does not read: not "without" one either.
    // A page that parses as nothing (a host's home page served for every
    // address over https) is an answer without the playlist as well; a
    // playlist that parsed, if with no http(s) streams in it, is not.
    const notAPlaylist = httpOnly && !/#EXT-X-|<asx/i.test(text)
    let entries: string[]
    try {
      entries = parsePlaylist(text, url).stations.map((s) => s.url)
    } catch {
      if (notAPlaylist) throw answeredWithout()
      return []
    }
    if (!entries.length && notAPlaylist) throw answeredWithout()
    const urls = [...new Set(entries.filter((u) => /^https?:\/\//i.test(u)))]
    // Streams, if it lists any, are the answer; an HLS manifest is a stream,
    // if not one this player plays yet. Playlists it lists instead are read in
    // turn, a few at most, each one level further: the first that gives
    // streams is the answer. None giving streams and one refused, so is this —
    // said as one it leads to, since this one was read. Past the depth followed, or giving
    // nothing, they are returned as they are, for the caller to say so.
    const lists = urls.filter((u) => isStationListUrl(u))
    if (lists.length < urls.length || !lists.length) return urls
    let refusal: Refused | undefined
    for (const at of lists.slice(0, MAX_FOLLOWED)) {
      try {
        const inner = await readFrom(at, depth - 1, walk)
        if (inner.length && inner.some((u) => !isStationListUrl(u))) return inner
      } catch (e) {
        if (!(e instanceof Refused)) throw e
        refusal ??= e.deeper()
      }
    }
    if (refusal) throw refusal
    return urls
  } catch (e) {
    if (e instanceof Refused) throw e
    return []
  }
}

/** How many playlists a playlist that lists only playlists has read in turn. */
const MAX_FOLLOWED = 3

/**
 * Whether an address can be asked for at all: one with a user name or
 * password in it, or one that is not an address, is refused by the browser
 * before it leaves — a TypeError that would read as the host refusing.
 */
const fetchable = (url: string): boolean => {
  try {
    const u = new URL(url)
    return !u.username && !u.password
  } catch { return false }
}
