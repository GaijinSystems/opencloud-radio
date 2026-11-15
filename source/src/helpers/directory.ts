import { safeUrl, oneLine } from './safeUrl'
import { nextId, type Station } from '../parsers/types'
import { isPlaylistUrl } from './playlist'

/** The subset of radio-browser's Station struct this app consumes. */
export interface DirectoryStation {
  stationuuid: string
  name: string
  url: string
  url_resolved: string
  homepage: string
  favicon: string
  tags: string
  country: string
  countrycode: string
  language: string
  codec: string
  bitrate: number
  lastchecktime_iso8601: string
  ssl_error: number
}

const title = (v: string) => (v ? v[0].toUpperCase() + v.slice(1) : v)

/**
 * A result's stream address, through the URL gate: a directory entry is as
 * untrusted as a hand-edited file, and both go through `safeUrl` or not at all.
 */
export const streamOf = (r: DirectoryStation): string => safeUrl(r.url_resolved) ?? safeUrl(r.url) ?? ''

/**
 * Convert a directory result into the app's own Station.
 *
 * `url_resolved` is the stream: the directory already followed playlists and
 * redirects server-side, which is the fetch a browser is not allowed to make.
 * The original `url` is kept as `source` when it was a playlist, so the app's
 * existing "re-read the playlist when every server fails" behaviour still
 * works for directory stations.
 */
export const toStation = (r: DirectoryStation): Station => {
  const stream = streamOf(r)
  const original = safeUrl(r.url) ?? ''
  // The response is cast, not validated: a number here reached the M3U writer
  // as a non-string and every save of that list then threw.
  const uuid = typeof r.stationuuid === 'string' ? r.stationuuid : ''
  const extra: Record<string, string> = {}
  if (uuid) extra['radiobrowser-uuid'] = uuid
  if (typeof r.countrycode === 'string' && r.countrycode) extra['radiobrowser-country'] = r.countrycode

  return {
    // The directory's own id is stable across pages of results; a fresh
    // `nextId()` per conversion re-keyed every row on "Show more".
    id: uuid ? `dir:${uuid}` : nextId(),
    name: oneLine(String(r.name || stream)),
    url: stream,
    // Only a playlist original is worth keeping; a redirect is not re-readable.
    source: original !== stream && isPlaylistUrl(original) ? original : undefined,
    homepage: safeUrl(r.homepage),
    logo: safeUrl(r.favicon, ['https:']), // most favicons are http; dropping them is correct
    group: title(oneLine(String(r.tags || '').split(',')[0] || '')),
    country: oneLine(String(r.country || '')),
    // The API returns languages lowercase ("english"); the app's own stations
    // are capitalised, and a mixed column looks like a bug.
    language: title(oneLine(String(r.language || '').split(',')[0] || '')),
    extra: Object.keys(extra).length ? extra : undefined
  }
}

/** What the directory knows that the app's own table cannot show. */
export const describeResult = (r: DirectoryStation): string => {
  const bits: string[] = []
  if (r.codec) bits.push(r.codec)
  if (r.bitrate) bits.push(`${r.bitrate} kbps`)
  if (r.ssl_error) bits.push('certificate problem')
  const checked = r.lastchecktime_iso8601 ? Date.parse(r.lastchecktime_iso8601) : NaN
  if (Number.isFinite(checked)) {
    const h = Math.round((Date.now() - checked) / 3600000)
    bits.push(h < 1 ? 'checked just now' : h < 48 ? `checked ${h} h ago` : `checked ${Math.round(h / 24)} days ago`)
  }
  return bits.join(' · ')
}

export interface SearchOptions {
  query: string
  offset?: number
  limit?: number
  httpsOnly?: boolean
}

/** `order=clickcount` is popularity over the last 24 hours. */
export const buildSearchUrl = (server: string, o: SearchOptions): string => {
  const p = new URLSearchParams({
    name: o.query,
    hidebroken: 'true',
    order: 'clickcount',
    reverse: 'true',
    limit: String(o.limit ?? 50),
    offset: String(o.offset ?? 0)
  })
  if (o.httpsOnly) p.set('is_https', 'true')
  return `https://${server}/json/stations/search?${p.toString()}`
}

export const buildClickUrl = (server: string, uuid: string): string =>
  `https://${server}/json/url/${encodeURIComponent(uuid)}`

export const uuidOf = (s: Station): string | undefined => s.extra?.['radiobrowser-uuid']
