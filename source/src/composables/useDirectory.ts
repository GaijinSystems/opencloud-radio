import { ref, shallowRef } from 'vue'
import type { RadioConfig } from '../config'
import {
  buildClickUrl, buildSearchUrl, streamOf, type DirectoryStation, type SearchOptions
} from '../helpers/directory'
import { redact } from '../helpers/safeUrl'
import { anyRelays } from '../helpers/relays'
import { playsHere } from '../helpers/classify'
import { ANONYMOUS, refused } from '../helpers/fetch'

export type DirectoryError = 'none' | 'unreachable' | 'blocked' | 'busy'

/** Published mirrors, used when discovery itself cannot be reached. */
const FALLBACK = ['de1.api.radio-browser.info', 'nl1.api.radio-browser.info', 'at1.api.radio-browser.info']

/**
 * A discovered mirror must be a hostname AND belong to the service. The list
 * comes from a network response; an entry that pointed elsewhere would carry
 * the user's typed queries with it. Configured servers are the admin's call
 * and are only checked for shape (in `readConfig`); discovered ones are not.
 */
export const isDirectoryHost = (name: unknown): name is string =>
  typeof name === 'string' && /^[a-z0-9-]+(\.[a-z0-9-]+)*\.api\.radio-browser\.info$/i.test(name)

/**
 * radio-browser.info, queried straight from the browser.
 *
 * Two things the API expects that a browser cannot do, both by design rather
 * than oversight:
 *
 *  - It asks for a descriptive `User-Agent`. `fetch()` forbids setting that
 *    header and drops it silently. The request is a courtesy for contacting
 *    developers, not authentication, so the service still answers — but this
 *    app cannot comply and should not pretend to.
 *  - It documents DNS discovery of `all.api.radio-browser.info`. Browsers
 *    cannot resolve names, so the documented fallback `/json/servers` is used.
 */
export const useDirectory = (config: RadioConfig) => {
  const busy = ref(false)
  const error = ref<DirectoryError>('none')
  const results = shallowRef<DirectoryStation[]>([])
  const exhausted = ref(false)
  /**
   * How many rows the directory has given for this query, shown or not: the
   * offset of the next page. With "https only" and relays configured the
   * directory is asked for everything and the rows this page cannot play are
   * dropped here, so what is shown can be fewer than what was fetched.
   */
  const fetched = ref(0)

  let servers: string[] = []
  let current = 0
  let inflight: AbortController | null = null
  /** Set once anything has succeeded: separates "blocked" from "down". */
  let everReached = false

  const discover = async (): Promise<string[]> => {
    if (servers.length) return servers
    if (config.directoryServers.length) {
      servers = [...config.directoryServers] // already reduced to bare hostnames by readConfig
      return servers
    }
    try {
      const res = await fetch(`https://${FALLBACK[0]}/json/servers`, ANONYMOUS)
      if (!res.ok) throw new Error(String(res.status))
      const list = (await res.json()) as unknown
      const names = Array.isArray(list)
        ? [...new Set(list.map((s: { name?: unknown }) => s?.name).filter(isDirectoryHost))]
        : []
      everReached = true
      servers = names.length ? names.sort(() => Math.random() - 0.5) : [...FALLBACK]
    } catch {
      // Discovery is itself a network call; a failure here is not fatal.
      servers = [...FALLBACK]
    }
    return servers
  }

  /**
   * A CORS or CSP refusal surfaces as a TypeError with no status, identical to
   * being offline. The distinguisher is whether this session has ever reached
   * the service: if it never has, the likelier cause is the one an
   * administrator can fix.
   */
  const classifyFailure = (e: unknown): DirectoryError => {
    if (e instanceof DOMException && e.name === 'AbortError') return 'none'
    if (everReached) return 'unreachable'
    return refused(e) ? 'blocked' : 'unreachable'
  }

  /** `build` is given the mirror to use, so a retry on the next mirror is one
   *  call rather than a host swap on a finished URL. */
  const request = async (build: (server: string) => string, signal: AbortSignal): Promise<DirectoryStation[]> => {
    const attempts = Math.min(2, Math.max(1, servers.length))
    let last: unknown
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetch(build(servers[current]), { ...ANONYMOUS, signal })
        if (res.status === 429) {
          error.value = 'busy'
          return []
        }
        if (!res.ok) throw new Error(String(res.status))
        everReached = true
        const body = (await res.json()) as unknown
        // Rows only: anything else in the array cannot be a station, and is not
        // something the rest of the app should have to survive.
        return Array.isArray(body)
          ? body.filter((r): r is DirectoryStation => !!r && typeof r === 'object')
          : []
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e
        last = e
        current = (current + 1) % servers.length // rotate and try one more
      }
    }
    throw last
  }

  const search = async (options: SearchOptions): Promise<void> => {
    inflight?.abort() // a late response must never overwrite a newer one
    const controller = new AbortController()
    inflight = controller

    const append = (options.offset ?? 0) > 0
    busy.value = true
    error.value = 'none'
    if (!append) {
      results.value = []
      exhausted.value = false
      fetched.value = 0
    }
    // "https only" means "only what plays here". The directory can say which
    // stations are https, but not which http ones this cloud relays: with
    // relays configured, that half of the filter is done here.
    const local = !!options.httpsOnly && anyRelays()

    try {
      await discover()
      const limit = options.limit ?? config.directoryPageSize
      const page = await request((server) => buildSearchUrl(server, { ...options, limit, httpsOnly: options.httpsOnly && !local }), controller.signal)
      if (controller !== inflight) return // superseded while awaiting
      fetched.value += page.length
      const shown = local ? page.filter((r) => playsHere(streamOf(r))) : page
      const merged = append ? [...results.value, ...shown] : shown
      results.value = merged.slice(0, config.directoryMaxResults)
      // A 429 returns an empty page with `error` set; that is not the end of
      // the results, and marking it so hid the "Show more" the user would retry with.
      exhausted.value = error.value === 'none' &&
        (page.length < limit || results.value.length >= config.directoryMaxResults)
    } catch (e) {
      if (controller !== inflight) return
      const kind = classifyFailure(e)
      if (kind !== 'none') {
        error.value = kind
        console.warn('[radio] directory query failed', { kind, e })
      }
    } finally {
      if (controller === inflight) {
        busy.value = false
        inflight = null
      }
    }
  }

  const clear = () => {
    inflight?.abort()
    inflight = null
    results.value = []
    error.value = 'none'
    busy.value = false
    exhausted.value = false
  }

  /** Reported at most once per station per session; the server also dedupes. */
  const reported = new Set<string>()
  const reportClick = (uuid: string) => {
    if (!uuid || reported.has(uuid) || !servers.length) return
    reported.add(uuid)
    fetch(buildClickUrl(servers[current], uuid), ANONYMOUS)
      .catch((e) => console.debug('[radio] click not reported', redact(String(e))))
  }

  const message = (): string => {
    switch (error.value) {
      case 'blocked':
        return 'This site does not allow the station directory to be reached. An administrator needs to add its address to connect-src.'
      case 'unreachable':
        return 'The station directory is not responding. Try again in a minute.'
      case 'busy':
        return 'The station directory is busy. Wait a moment and try again.'
      default:
        return ''
    }
  }

  return { busy, error, results, fetched, exhausted, search, clear, reportClick, message }
}
