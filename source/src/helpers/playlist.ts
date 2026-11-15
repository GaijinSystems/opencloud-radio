/**
 * The one place that says what a playlist link looks like. Three copies of
 * this regex had drifted apart (one knew `.asx`, one split `.m3u8` out), so
 * the same address could be a "playlist" in one column and a stream in another.
 *
 * `.m3u8` is ambiguous: a station list or an HLS manifest. `HLS_LINK` is
 * tested first wherever the distinction matters; `PLAYLIST_LINK` then covers
 * everything a `<audio>` element should never be handed directly.
 */
export const HLS_LINK = /\.m3u8(\?|$)/i
const PLAYLIST_LINK = /\.(pls|m3u|m3u8|asx)(\?|$)/i

/** An address's path and query, apart: a fragment is never sent, and is no part of either. */
const partsOf = (url: string): { path: string; query: string } => {
  try {
    const u = new URL(url)
    return { path: u.pathname, query: u.search }
  } catch {
    const [path, query = ''] = url.split('#')[0].split('?')
    return { path, query: query ? `?${query}` : '' }
  }
}
const pathOf = (url: string): string => partsOf(url).path

/**
 * A playlist named by a query rather than a path: `tunein.php?file=station.pls`.
 * Only under a name that says it is the file served (`file`, `url`,
 * `playlist`): a stream's `?ref=list.m3u` or `?mount=live.pls` stays a stream.
 * A file name, then the extension, as the whole value: `listen?type=.m3u`
 * names no file. Not `.m3u8`, which by query alone could as well be HLS.
 */
const QUERY_PLAYLIST = /[?&](file|url|playlist)=[^&=]*[^&=./][^&=]*\.(pls|m3u|asx)(&|$)/i

/**
 * Whether an address is a playlist link, `.m3u8` included (a station list, or
 * an HLS manifest): told by its path, or by a file its query names.
 */
export const isPlaylistUrl = (url: string): boolean => {
  const { path, query } = partsOf(url)
  return PLAYLIST_LINK.test(path) || QUERY_PLAYLIST.test(query)
}

/** Whether an address is, by its path, an HLS manifest — or a `.m3u8` station list: the name cannot tell. */
export const isHlsUrl = (url: string): boolean => HLS_LINK.test(pathOf(url))

/** Whether a playlist link is an ASX file, which this app recognises but does not read. */
export const isAsxUrl = (url: string): boolean => {
  const { path, query } = partsOf(url)
  return /\.asx$/i.test(path) || /[?&](file|url|playlist)=[^&]*\.asx(&|$)/i.test(query)
}

/** Whether it is a station list that cannot be played as it is: a playlist link, and not HLS. */
export const isStationListUrl = (url: string): boolean => isPlaylistUrl(url) && !HLS_LINK.test(pathOf(url))
