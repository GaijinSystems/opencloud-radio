import type { Station } from '../parsers/types'
import { ownAddress } from './relays'
import { playsHere } from './classify'
import { isStationListUrl } from './playlist'
import { safeUrls } from './safeUrl'

/** A station's servers: the primary address first, then the backups its playlist named. */
export const serversOf = (s: Station): string[] => [s.url, ...(s.alternates ?? [])]

/** No station needs more servers; a hundred of one stream is a host's whole fleet. */
export const MAX_SERVERS = 10

/** Addresses that pass the URL gate, each once, in the order given. */
export const distinctServers = (list: readonly unknown[]): string[] => [...new Set(safeUrls(list))]

/**
 * The servers a station keeps of a list it is given whole — a pasted
 * playlist, an import combined into one station: each once, those that play
 * here first, at most `MAX_SERVERS`. Cut in the list's own order, a playlist
 * whose first ten were http servers nobody relays kept only those.
 */
export const keepServers = (list: readonly unknown[]): string[] => {
  const all = distinctServers(list)
  return [...all.filter(playsHere), ...all.filter((u) => !playsHere(u))].slice(0, MAX_SERVERS)
}

/**
 * What makes two rows one stream: the address — a relay's address read as the
 * station's own (`helpers/relays`), so a row entered before the relay table
 * and the same station added by its own address are not two stations.
 */
export const streamKey = (address: string): string => ownAddress(address)

/** Two server lists naming the same servers in the same order. */
export const sameServers = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((u, i) => u === b[i])

/** Whether another row (any but `exceptId`) already plays this stream. */
export const streamTaken = (stations: readonly Station[], address: string, exceptId?: string): boolean => {
  const key = streamKey(address)
  return stations.some((s) => s.id !== exceptId && streamKey(s.url) === key)
}

export interface Merge {
  /** `existing` followed by whatever of `incoming` was taken. */
  stations: Station[]
  /** How many of `incoming` were taken. */
  added: number
  /** How many were left out because their address is already there, or came twice. */
  duplicates: number
  /** The ones left out because the list was full, in the order they came. */
  left: Station[]
  /**
   * What became of each of `incoming`, in its order: taken, already there, or
   * left out for want of room. A second of the same stream in the batch shares
   * the first one's fate — it is the same stream — so a caller moving stations
   * keeps exactly those marked `left`, and needs to know nothing of the keying.
   */
  verdicts: Verdict[]
}
export type Verdict = 'added' | 'present' | 'left'

/**
 * The one place that says what may join a list.
 *
 * A stream address appears once in a list: verdicts, last-played times and
 * "what is playing" are all keyed by it, so two rows sharing one would share
 * all three. And a list holds at most `cap` stations. Both rules used to be
 * written out at each way of adding a station — the form, import, the
 * directory popup, a move — and each new way had to remember them; two did
 * not apply the cap, and none looked for a duplicate inside the batch itself.
 */
export const mergeStations = (existing: readonly Station[], incoming: readonly Station[], cap: number): Merge => {
  const fate = new Map<string, Verdict>(existing.map((s) => [streamKey(s.url), 'present']))
  const stations = [...existing]
  const left: Station[] = []
  let duplicates = 0
  const verdicts = incoming.map((s): Verdict => {
    const key = streamKey(s.url)
    const had = fate.get(key)
    if (had) { duplicates++; return had } // already there, or the same stream again: its fate
    const now: Verdict = stations.length >= cap ? 'left' : 'added'
    fate.set(key, now)
    if (now === 'left') left.push(s)
    else stations.push(s)
    return now
  })
  return { stations, added: stations.length - existing.length, duplicates, left, verdicts }
}


/**
 * What a re-read playlist may put in place of a station's servers.
 *
 * Once a station plays over https (its own servers, or this cloud's relay for
 * a station that has only http ones), an http server nobody relays is a step
 * back that a secure page cannot take: the browser refuses it as mixed
 * content. So when every server the station has plays here, the playlist's
 * entries that would not are dropped — and a playlist with nothing else (an
 * http-only station's own file, kept as the playlist address of a row that
 * names its relay) changes nothing, rather than swapping a working relay for
 * servers that can never play here. At most `MAX_SERVERS` are kept, as Find
 * backup servers keeps: a StreamTheWorld playlist names up to a hundred.
 */
export const refreshedServers = (s: Station, fresh: readonly string[]): string[] => {
  // A playlist it lists, not read (past the depth followed), is no server.
  const all = distinctServers(fresh).filter((u) => !isStationListUrl(u))
  const playable = all.filter(playsHere)
  // Those that play here first, always; the rest after them, and only for a
  // station that has some itself — a playlist's order put an http server
  // first and the player had to skip it every time.
  return (serversOf(s).every(playsHere) ? playable : [...playable, ...all.filter((u) => !playsHere(u))]).slice(0, MAX_SERVERS)
}
