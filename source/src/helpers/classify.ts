import type { Station } from '../parsers/types'
import { HLS_LINK, isStationListUrl } from './playlist'
import { relayFor } from './relays'

export type Playability =
  | 'blocked'      // http:// — the browser will refuse it on a secure page
  | 'playlist'     // a .pls/.m3u link: a file listing streams, not a stream
  | 'unsupported'  // an HLS manifest (until hls.js), or a scheme no browser plays
  | 'untested'     // https, never played on this device
  | 'ready'        // played successfully at least once on this device
  | 'failed'       // tried and gave up

/**
 * Two things worth stating plainly, because both are easy to get wrong:
 *
 *  - `<audio>` playback does NOT require CORS. Media loads no-cors. CORS only
 *    affects metadata and the Web Audio graph, so a station must never be
 *    marked unplayable on CORS grounds.
 *  - An http:// URL is not salvageable in the browser. It is upgraded and then
 *    blocked. Saying so once, clearly, beats a retry loop — unless the
 *    administrator relays it (`helpers/relays`), when it plays from the relay.
 */
export const classifyUrl = (address: string): Playability => {
  let url: URL
  try {
    url = new URL(address)
  } catch {
    return 'failed'
  }
  // An http address this cloud relays plays from the relay, over https.
  if (url.protocol === 'http:') { if (relayFor(address) === undefined) return 'blocked' }
  else if (url.protocol !== 'https:') return 'unsupported' // rtsp, mms, file: a browser cannot open these
  if (HLS_LINK.test(url.pathname)) return 'unsupported'
  // Most station homepages hand out a .pls or .m3u. Feeding one to <audio>
  // fails in a way that looks like a dead station, so name it instead.
  if (isStationListUrl(address)) return 'playlist'
  return 'untested'
}

/**
 * Whether this page can play an address: the one test of it, used by the
 * player choosing a server, by what is kept from a playlist, and by the
 * directory's "https only". An https stream, or an http one this cloud relays;
 * not a playlist link, an HLS manifest, or plain http nobody relays.
 */
export const playsHere = (address: string): boolean => classifyUrl(address) === 'untested'

/** A station is judged by its primary address; its backups are the player's business. */
export const classify = (station: Station): Playability => classifyUrl(station.url)

/**
 * The verdict to show before anything has been tried this session.
 *
 * `classify` alone says `untested` for every https address, so after a reload
 * a station played a minute ago sat under "Not played yet" beside a Last
 * played column that said otherwise — the two are drawn from different places,
 * and only one of them survives a reload.
 *
 * A structural verdict still wins: an http address or a playlist link cannot
 * play in a browser whatever happened on this device before.
 */
export const initialState = (station: Station, playedBefore: boolean, verdict = classify(station)): Playability => {
  return verdict === 'untested' && playedBefore ? 'ready' : verdict
}

/**
 * The verdict after a play attempt failed. A station whose address is
 * structurally unplayable can still be handed to the player — resume selects
 * it on load and the bar's button is not disabled — and marking it `failed`
 * turned "Blocked" into "No response" and re-enabled the row's button. The
 * structural verdict stays; only a station that could have played is `failed`.
 */
export const failedState = (station: Station): Playability => {
  const verdict = classify(station)
  return verdict === 'untested' ? 'failed' : verdict
}

export const explain = (state: Playability): string => {
  switch (state) {
    case 'blocked':
      return 'This station uses an http address, which browsers block on a secure page. Ask the station for an https link, or your administrator to relay it.'
    case 'playlist':
      return 'This address is a playlist file rather than a stream. Use Import to read it, or open it and copy the stream address from inside.'
    case 'unsupported':
      return 'This address cannot be played in a browser: HLS streams are not supported yet, and rtsp, mms and similar schemes never are.'
    case 'failed':
      return 'The station did not respond. It may be offline.'
    default:
      return ''
  }
}
