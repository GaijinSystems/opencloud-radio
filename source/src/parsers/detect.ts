import type { PlaylistFormat } from './types'
import { stripBom } from '../helpers/text'

/**
 * Sniff by content, not by extension. A .m3u8 is as likely to be an HLS
 * manifest as a station list, and importing a manifest's media segments as
 * stations produces a list of thousands of two-second files.
 */
export const detect = (text: string, filename = ''): PlaylistFormat => {
  const head = stripBom(text).slice(0, 4096)

  if (/^\s*#EXT-X-|\n#EXT-X-/.test(head)) return 'hls'
  if (/^\s*<\?xml|<playlist[\s>]/i.test(head)) return 'xspf'
  if (/^\s*\[playlist\]/i.test(head)) return 'pls'
  if (/^\s*#EXTM3U/.test(head)) return 'm3u'

  // No signature. Fall back to the extension, then to a shape test: a file of
  // bare URLs is a valid simple M3U.
  const ext = filename.toLowerCase().split('.').pop()
  if (ext === 'pls') return 'pls'
  if (ext === 'xspf') return 'xspf'
  if (ext === 'm3u' || ext === 'm3u8') return 'm3u'

  const lines = head.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length && lines.every((l) => l.startsWith('#') || /^[a-z]+:\/\//i.test(l))) {
    return 'm3u'
  }
  return 'unknown'
}
