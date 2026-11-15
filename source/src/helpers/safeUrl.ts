/**
 * Playlist files are untrusted input: imported from anywhere, shared into a
 * space, hand-edited. Every URL that came from one passes through here before
 * it reaches `href`, `src`, or the Media Session, so the model never holds a
 * value that could execute.
 */
export const safeUrl = (
  value: unknown,
  schemes: readonly string[] = ['https:', 'http:']
): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  try {
    const url = new URL(trimmed)
    if (!schemes.includes(url.protocol)) return undefined
    // The string form is kept so a file round-trips byte for byte — except
    // when it holds whitespace, which `radio-alt` uses as a separator. `URL`
    // percent-encodes it, so a literal space survives as %20 instead of
    // splitting the address in two on the next read.
    return /\s/.test(trimmed) ? url.href : trimmed
  } catch {
    return undefined
  }
}

/** Each address through the same gate; the ones that fail it are dropped. */
export const safeUrls = (values: readonly unknown[], schemes?: readonly string[]): string[] =>
  values.map((v) => safeUrl(v, schemes)).filter((u): u is string => u !== undefined)

/**
 * A stream address as it should appear in a log or in device storage: origin
 * and path, without userinfo or query, because some relays carry credentials
 * or tokens there and neither `console` nor `localStorage` is a place for them.
 */
export const redact = (value: string): string => {
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return value.replace(/\/\/[^/@]*@/, '//').replace(/\?.*$/, '')
  }
}

/** 53 bits of a string, not reversible: cyrb53, public domain. */
const digest = (text: string): string => {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/**
 * What a stream address is remembered under on the device: the address
 * without credentials or query, and — only when it had either — a short hash
 * of the whole of it. Two stations told apart only by their query
 * (`?sid=1`, `?sid=2`) stay two; a token is never stored, only a hash it
 * cannot be read back from. The price is that a station whose token changes
 * starts its history again, which is the honest outcome: it is a new address.
 */
export const historyKey = (address: string): string => {
  const bare = redact(address)
  if (bare === address) return bare
  // Already a key — what storage holds is passed through here again on every
  // load, and must come out as it went in.
  const mark = address.lastIndexOf('#')
  if (mark > 0 && address.slice(0, mark) === bare && /^[0-9a-z]{1,11}$/.test(address.slice(mark + 1))) return address
  return `${bare}#${digest(address)}`
}

/** One line only. Newlines in a name would become new entries in the file. */
export const oneLine = (value: string): string =>
  value.replace(/[\r\n\u2028\u2029]+/g, ' ').trim()

/**
 * `media-src 'self'` always permits the app's own origin, so a media failure on
 * a same-origin address can never be the policy — it means the server returned
 * something that is not audio. Judging this wrongly sends the user off to fix
 * a policy that is already correct.
 */
export const isSameOrigin = (url: string, origin: string): boolean => {
  try {
    return new URL(url).origin === origin
  } catch {
    return false
  }
}

import type { Station } from '../parsers/types'

/**
 * Apply the URL gate to every field of a station that will ever reach an
 * attribute. Used for administrator-provided defaults, which are trusted less
 * than they look: a typo in apps.yaml should not become a live link.
 */
const text = (v: unknown): string | undefined =>
  typeof v === 'string' && oneLine(v) ? oneLine(v) : undefined

/**
 * The URL gate, applied to a whole station: every address that will reach an
 * attribute (`href`, `src`, Media Session artwork, `radio-alt`) passes
 * `safeUrl`, logos only as https, and the name and stream address are one
 * line each. Everything else the station carries is kept, so a file from
 * another player loses nothing on the way through. An optional field that does
 * not pass is removed rather than set to nothing, so gating adds no keys.
 *
 * The stream address itself is not gated, only made one line: an address
 * this browser cannot play is kept as text, shown and fixable, and the
 * classifier says why it will not play.
 */
export const gateStation = (s: Station): Station => {
  const out: Station = { ...s, name: oneLine(String(s.name ?? s.url)), url: oneLine(String(s.url)) }
  const set = <K extends 'logo' | 'homepage' | 'source' | 'nowPlaying'>(key: K, value: string | undefined) => {
    if (value === undefined) delete out[key]
    else out[key] = value
  }
  if (s.logo !== undefined) set('logo', safeUrl(s.logo, ['https:']))
  if (s.homepage !== undefined) set('homepage', safeUrl(s.homepage))
  if (s.source !== undefined) set('source', safeUrl(s.source))
  if (s.nowPlaying !== undefined) set('nowPlaying', safeUrl(s.nowPlaying, ['https:']))
  if (s.alternates !== undefined) {
    const alternates = safeUrls(s.alternates)
    if (alternates.length) out.alternates = alternates
    else delete out.alternates
  }
  return out
}

/**
 * An administrator's default station: named fields only, then the gate.
 * Spreading the entry carried anything else it held — `lead`, `between`,
 * `extra` — into the file as raw lines and attributes.
 */
export const sanitizeStation = (s: Station): Station => gateStation({
  id: s.id,
  name: String(s.name ?? s.url),
  url: String(s.url),
  group: text(s.group),
  country: text(s.country),
  language: text(s.language),
  network: text(s.network),
  logo: s.logo,
  homepage: s.homepage,
  source: s.source,
  nowPlaying: s.nowPlaying,
  alternates: s.alternates ?? []
})
