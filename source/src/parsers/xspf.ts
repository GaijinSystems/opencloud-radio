import { type Playlist, emptyPlaylist, nextId } from './types'
import { safeUrl, oneLine } from '../helpers/safeUrl'

const NS = 'http://xspf.org/ns/0/'

/** Namespace-aware where the document declares one, tolerant where it does not. */
const pick = (el: Element, tag: string): string | undefined => {
  const byNs = el.getElementsByTagNameNS(NS, tag)
  const node = byNs.length ? byNs[0] : el.getElementsByTagName(tag)[0]
  const text = node?.textContent?.trim()
  return text || undefined
}

export const parseXspf = (text: string): Playlist => {
  const list = emptyPlaylist()
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) {
    throw new Error('This file is not valid XML.')
  }

  const root = doc.documentElement
  // Direct children only: `getElementsByTagName` searches the whole tree, so a
  // playlist with no title of its own used to take the first track's.
  const own = Array.from(root.children).find((c) => c.localName === 'title')
  list.title = own?.textContent?.trim() || undefined

  const tracks = root.getElementsByTagNameNS(NS, 'track').length
    ? root.getElementsByTagNameNS(NS, 'track')
    : root.getElementsByTagName('track')

  for (const track of Array.from(tracks)) {
    const url = pick(track, 'location')
    if (!url) continue
    list.stations.push({
      id: nextId(),
      name: oneLine(pick(track, 'title') || url),
      url: oneLine(url),
      logo: safeUrl(pick(track, 'image'), ['https:']), // https only, as everywhere else
      homepage: safeUrl(pick(track, 'info')),
      group: pick(track, 'album')?.replace(/\s+/g, ' ')
    })
  }
  return list
}
