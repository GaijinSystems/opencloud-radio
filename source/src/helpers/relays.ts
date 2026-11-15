/**
 * The administrator's relays: which http-only streams this cloud re-serves
 * over https, and under which path (`deploy/haproxy-relay.cfg`, INSTALL §2b).
 *
 * A station keeps its own address — `http://relay4.slayradio.org:8000/`, as its
 * playlist, the directory and every other player know it — and this table
 * decides how this cloud reaches it. So every way an address arrives (import,
 * the directory, a re-read playlist, Find backup servers) needs nothing done
 * to it, a list stays usable in any other player, and moving a relay is one
 * line of configuration rather than an edit to every list that names it.
 *
 * Nothing is guessed: an http address with no line here is not relayed, and
 * stays what it was — an address a secure page cannot play.
 */

/** The upstream address as written in the table and looked up: scheme, host (port only if not 80), path. */
const relayKey = (address: string): string | undefined => {
  let u: URL
  try { u = new URL(address.trim()) } catch { return undefined }
  if (u.protocol !== 'http:' || u.username || u.password) return undefined
  return `http://${u.host}${u.pathname}`
}

/**
 * Where a relay is: a path on this cloud (`/radio-relay/slay4`), or an https
 * address on a relay hostname of its own (`https://radio-relay.example.org/slay4`,
 * which INSTALL §2b prefers). A path is one path and nothing else: anything
 * that could leave the origin (`//host/…`, a backslash some parsers read as a
 * slash) or climb out of it (`..`) is refused. An address must be https, with
 * no credentials: the point of a relay is a stream a secure page may play.
 */
const RELAY_PATH = /^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/
const relayTarget = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const v = value.trim()
  // `..`, or the same encoded (`%2e%2e`, which a URL parser reads as `..`):
  // a dot has no business being encoded in a relay's address.
  if (v.split(/[/?#]/).includes('..') || /%2e/i.test(v)) return undefined
  if (RELAY_PATH.test(v)) return v
  try {
    const u = new URL(v)
    return u.protocol === 'https:' && !u.username && !u.password && !v.includes('\\') ? u.href : undefined
  } catch { return undefined }
}

/** The configured table, cleaned: entries that do not parse are dropped rather than guessed at. */
export const readRelays = (raw: unknown): Record<string, string> => {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [from, to] of Object.entries(raw as Record<string, unknown>)) {
    const key = relayKey(from)
    const target = relayTarget(to)
    if (key && target) out[key] = target
  }
  return out
}

let table = new Map<string, string>()

/** Set once, from the configuration, as the app starts. */
export const setRelays = (relays: Record<string, string>) => { table = new Map(Object.entries(relays)) }

/** Where an address is relayed, if it is: a path on this cloud, or an https address. */
export const relayFor = (address: string): string | undefined => {
  const key = relayKey(address)
  return key === undefined ? undefined : table.get(key)
}

/**
 * The address to open for a station's address: its relay when there is one
 * (any query carried over), otherwise the address itself.
 */
export const reach = (address: string, origin = globalThis.location?.origin ?? ''): string => {
  const target = relayFor(address)
  if (target === undefined) return address
  // An opaque origin ("null": a sandboxed frame) has nothing to resolve a path against.
  try {
    const out = new URL(target, origin)
    out.search = new URL(address.trim()).search || out.search
    return out.href
  } catch { return address }
}

/** Whether any stream is relayed at all: when none is, nothing needs asking. */
export const anyRelays = (): boolean => table.size > 0


/**
 * The station's own address for one of its relay's: the other way round from
 * `reach`. A station entered before the table existed was given the relay's
 * address (`/radio-relay/slay4`), which no playlist or directory names, so
 * nothing can be matched against it; its own address can.
 */
export const ownAddress = (address: string, origin = globalThis.location?.origin ?? ''): string => {
  let u: URL
  try { u = new URL(address.trim(), origin || undefined) } catch { return address }
  const bare = `${u.origin}${u.pathname}`
  for (const [from, to] of table) {
    let at: URL
    try { at = new URL(to, origin || undefined) } catch { continue }
    if (`${at.origin}${at.pathname}` === bare) return from + u.search
  }
  return address
}
