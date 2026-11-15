import type { Playlist } from './types'
import { detect } from './detect'
import { parseM3u } from './m3u'
import { parsePls } from './pls'
import { parseXspf } from './xspf'
import { gateStation } from '../helpers/safeUrl'

/**
 * Any playlist this app reads, whatever its format, as stations that have all
 * passed the URL gate. The one way in for text: opening a list, searching
 * across lists, appending to one, importing, and re-reading a station's own
 * playlist all come through here, so a rule about what a station may carry
 * is made once. Each format's reader gates what it knows about as well; this
 * is what makes it true of every reader, including one added later.
 *
 * Throws, with a sentence a person can act on, for an HLS manifest (a stream,
 * not a list of stations) and for anything that is not a playlist.
 */
export const parsePlaylist = (text: string, name = ''): Playlist => {
  const format = detect(text, name)
  if (format === 'hls') throw new Error('This file is an HLS stream manifest, not a list of stations.')
  const list = format === 'pls' ? parsePls(text)
    : format === 'xspf' ? parseXspf(text)
      : format === 'm3u' ? parseM3u(text)
        : null
  if (!list) throw new Error('This file is not a playlist this app can read.')
  return { ...list, stations: list.stations.map(gateStation) }
}
