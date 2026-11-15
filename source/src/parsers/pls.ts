import { type Playlist, emptyPlaylist, nextId } from './types'
import { oneLine } from '../helpers/safeUrl'
import { normalise } from '../helpers/text'

/**
 * PLS is INI-shaped and index-keyed. The indices are not reliable: files in the
 * wild skip numbers, start at 0, and disagree with their own NumberOfEntries.
 * So entries are collected by index and then emitted in index order, and
 * NumberOfEntries is ignored entirely.
 */
export const parsePls = (text: string): Playlist => {
  const list = emptyPlaylist()
  const entries = new Map<number, { file?: string; title?: string }>()

  for (const raw of normalise(text)) {
    const line = raw.trim()
    if (line === '' || line.startsWith(';') || line.startsWith('[')) continue

    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()

    const m = /^(File|Title)(\d+)$/i.exec(key)
    if (!m) continue // NumberOfEntries, Version, Length<n>: nothing we need

    const idx = Number(m[2])
    const entry = entries.get(idx) ?? {}
    if (m[1].toLowerCase() === 'file') entry.file = value
    else entry.title = value
    entries.set(idx, entry)
  }

  for (const idx of [...entries.keys()].sort((a, b) => a - b)) {
    const entry = entries.get(idx)!
    if (!entry.file) continue // a title with no stream is not a station
    list.stations.push({ id: nextId(), name: oneLine(entry.title || entry.file), url: oneLine(entry.file) })
  }
  return list
}
