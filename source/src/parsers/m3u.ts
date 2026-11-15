import { type Playlist, type Station, emptyPlaylist, nextId } from './types'
import { safeUrl, safeUrls, oneLine } from '../helpers/safeUrl'
import { normalise } from '../helpers/text'

/** Attributes we map onto named fields. Everything else is carried in `extra`. */
const KNOWN: Record<string, keyof Station> = {
  'tvg-logo': 'logo',
  'group-title': 'group',
  'tvg-country': 'country',
  'tvg-language': 'language',
  'tvg-network': 'network',
  'radio-homepage': 'homepage',
  'radio-source': 'source',
  'radio-nowplaying': 'nowPlaying'
}
const TO_ATTR: Record<string, string> = Object.fromEntries(
  Object.entries(KNOWN).map(([attr, field]) => [field, attr])
)

/**
 * Quoted values, or a bare token up to the next space. The bare form is not in
 * any spec and is common anyway (`group-title=Rock`); until 1.1.1 it was
 * silently dropped on the way through, which is a data-loss bug.
 *
 * The value is optional so that a run of key characters is consumed whole
 * whether or not an `=` follows it; a match without a value is skipped. When
 * the `=` was required, a long run with none was retried from every offset —
 * quadratic, and ten seconds of frozen tab for a 100 kB line in a file opened
 * at launch. (A lookbehind would say the same thing, and is a syntax error
 * for the whole bundle on browsers that lack it.)
 */
const ATTR_RE = /([A-Za-z0-9_-]+)(?:=(?:"([^"]*)"|([^\s",]+)))?/g

interface Info {
  /** The line as it stood, for an entry that never gets its URL. */
  raw: string
  name: string
  duration: string
  fields: Partial<Station>
  extra: Record<string, string>
}

/**
 * `#EXTINF:<duration> <attributes>,<name>` — the name starts at the first comma
 * that is NOT inside double quotes. Splitting at the last comma, which is the
 * obvious thing, truncates any name or attribute value containing one
 * ("Jazz, Blues & Soul", group-title="Rock, Pop").
 */
const splitTitle = (body: string): [string, string] => {
  let quoted = false
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '"') quoted = !quoted
    else if (ch === ',' && !quoted) return [body.slice(0, i), body.slice(i + 1)]
  }
  return [body, '']
}

const URL_FIELDS = new Set<keyof Station>(['logo', 'homepage', 'source', 'nowPlaying'])
/** Fields a page fetches or shows on an https page itself: https or nothing. */
const HTTPS_ONLY = new Set<keyof Station>(['logo', 'nowPlaying'])

const parseExtinf = (line: string): Info => {
  const body = line.slice(line.indexOf(':') + 1)
  const [head, rawName] = splitTitle(body)
  const name = oneLine(rawName)
  // The duration is meaningless for a stream and other players write real
  // values anyway; carry it rather than rewrite every entry to -1.
  const duration = /^\s*(-?\d+(?:\.\d+)?)/.exec(head)?.[1] ?? '-1'

  const fields: Partial<Station> = {}
  // No prototype: `extra['__proto__'] = …` on an ordinary object sets nothing,
  // and the attribute was gone on the next save.
  const extra: Record<string, string> = Object.create(null)
  let m: RegExpExecArray | null
  ATTR_RE.lastIndex = 0
  while ((m = ATTR_RE.exec(head)) !== null) {
    const [, key, quoted, bare] = m
    if (quoted === undefined && bare === undefined) continue // a word, not an attribute
    const value = oneLine(quoted ?? bare ?? '')
    const lower = key.toLowerCase()
    if (lower === 'radio-alt') {
      // Space-separated: a URL cannot contain a space, so no escaping is needed.
      const alts = safeUrls(value.split(/\s+/))
      if (alts.length) fields.alternates = alts
      continue
    }
    // `hasOwn`: an attribute called `constructor` must not find Object's.
    const field = Object.hasOwn(KNOWN, lower) ? KNOWN[lower] : undefined
    if (!field) {
      extra[key] = value
    } else if (URL_FIELDS.has(field)) {
      // Logos must be https, as the form, the directory and the administrator's
      // defaults already require: an http image on an https page is blocked anyway.
      const url = HTTPS_ONLY.has(field) ? safeUrl(value, ['https:']) : safeUrl(value)
      if (url) (fields as Record<string, string>)[field] = url
    } else {
      ;(fields as Record<string, string>)[field] = value
    }
  }
  return { raw: line, name, duration, fields, extra }
}

export const parseM3u = (text: string): Playlist => {
  const list = emptyPlaylist()
  const lines = normalise(text)

  let info: Info | null = null
  let group: string | undefined
  let lead: string[] = []
  /** Lines between an entry's `#EXTINF` and its URL (`#EXTVLCOPT:` and the
   *  like). They belong after the `#EXTINF`, and used to be written before it. */
  let between: string[] = []

  for (const raw of lines) {
    const line = raw.trim()

    if (line === '') {
      // Blank lines are structure, not content. Keep them only between entries.
      if (info === null) lead.push(raw)
      continue
    }

    if (line.startsWith('#')) {
      const upper = line.toUpperCase()
      if (upper.startsWith('#EXTM3U')) {
        // Some players hang attributes on the header (`url-tvg=…`); keep them.
        if (line.length > '#EXTM3U'.length && list.stations.length === 0 && !list.header) list.header = line
        continue
      }
      if (upper.startsWith('#PLAYLIST:')) {
        list.title = line.slice(line.indexOf(':') + 1).trim()
        continue
      }
      if (upper.startsWith('#EXTINF')) {
        // An `#EXTINF` whose URL never came, overtaken by the next one. It is
        // still someone's line: carried ahead of the entry that follows it.
        if (info) { lead.push(info.raw, ...between); between = [] }
        info = parseExtinf(line)
        continue
      }
      if (upper.startsWith('#EXTGRP:')) {
        group = line.slice(line.indexOf(':') + 1).trim()
        continue
      }
      ;(info ? between : lead).push(raw) // a comment or tag we do not know: carry it
      continue
    }

    // Anything else is a URL, and closes the entry. A URL with a scheme we
    // would never play is kept as text so it can be shown and fixed, but the
    // classifier will mark it failed rather than the element trying it.
    const station: Station = {
      id: nextId(),
      name: info?.name || line,
      url: oneLine(line),
      ...(info?.fields ?? {})
    }
    if (!station.group && group) station.group = group
    if (info && info.duration !== '-1') station.duration = info.duration
    if (info && Object.keys(info.extra).length) station.extra = info.extra
    if (lead.length) station.lead = lead
    if (between.length) station.between = between

    list.stations.push(station)
    info = null
    lead = []
    between = []
  }

  // A dangling #EXTINF with no URL after it is still someone's content.
  list.trailing = lead.filter((l) => l.trim() !== '')
  if (info) list.trailing.push(info.raw, ...between)
  return list
}

/**
 * Attribute values are double-quoted and the format defines no escape for a
 * quote inside one, so a `"` in a group or network name is dropped on the way
 * out — the one field this writer cannot round-trip byte for byte. Names are
 * unaffected: they follow the comma unquoted and keep every character.
 */
const quote = (v: string) => `"${oneLine(v).replace(/"/g, '')}"`

export const serializeM3u = (list: Playlist): string => {
  const out: string[] = [list.header ? oneLine(list.header) : '#EXTM3U']
  if (list.title) out.push(`#PLAYLIST:${oneLine(list.title)}`)

  for (const s of list.stations) {
    if (s.lead?.length) out.push(...s.lead)

    const attrs: string[] = []
    for (const [field, attr] of Object.entries(TO_ATTR)) {
      const value = (s as unknown as Record<string, string>)[field]
      if (typeof value === 'string' && value) attrs.push(`${attr}=${quote(value)}`)
    }
    if (s.alternates?.length) attrs.push(`radio-alt=${quote(s.alternates.join(' '))}`)
    for (const [key, value] of Object.entries(s.extra ?? {})) {
      attrs.push(`${key}=${quote(value)}`)
    }

    const duration = s.duration ?? '-1'
    const head = attrs.length ? `${duration} ${attrs.join(' ')}` : duration
    out.push(`#EXTINF:${head},${oneLine(s.name)}`)
    if (s.between?.length) out.push(...s.between)
    out.push(oneLine(s.url))
  }

  if (list.trailing.length) out.push(...list.trailing)
  return out.join('\n') + '\n'
}
