/**
 * How every request to a third party is made — a station, its host, the
 * directory: cross-origin, never cached, without the visitor's cookies or
 * credentials, and without saying which page asked. One definition, so a new
 * request cannot quietly leave one of them out.
 */
export const ANONYMOUS: RequestInit = { mode: 'cors', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }

/** `fetch`, looked up when called: a stand-in installed later (a test's) is the one used. */
export const lateFetch: typeof fetch = (...a) => fetch(...a)

/**
 * A signal that ends when `parent` does, or after `ms`, whichever comes
 * first — and `end()`, which ends it now and lets go of the parent. Call it
 * when done: it is also what closes a connection still open (a stream read
 * only to its first title). A parent already ended ends this one at once; a
 * listener added to it would never hear.
 */
export const deadline = (parent: AbortSignal | undefined, ms: number): { signal: AbortSignal; end: () => void } => {
  const controller = new AbortController()
  const stop = () => controller.abort()
  if (parent?.aborted) stop()
  else parent?.addEventListener('abort', stop, { once: true })
  const timer = setTimeout(stop, ms)
  return {
    signal: controller.signal,
    end: () => { clearTimeout(timer); parent?.removeEventListener('abort', stop); stop() }
  }
}

/**
 * Whether a request failed in a way the page is told nothing about: a
 * `TypeError`, no status. That is the host not allowing other sites to read
 * it, this site's own policy (`connect-src`) not allowing the request — and
 * also the host being down or out of reach. A page cannot tell them apart, so
 * every message that says so names them all. Not when the browser knows it is
 * offline (that is not the host's or the policy's doing), and an abort is not
 * one either.
 */
export const refused = (e: unknown): boolean => e instanceof TypeError && globalThis.navigator?.onLine !== false

/** Why a page could not read another host, in the one wording every message uses. */
const REFUSED_WHY = "the host may be down or may not allow other sites to read it, or your site's policy " +
  '(connect-src) may not allow the request — INSTALL.md, for the administrator, says which hosts the app needs'

/** The rest of the sentence after its subject, for a message that names the subject its own way. */
export const refusedClause = `could not be reached or read from this page: ${REFUSED_WHY}.`

/** The same, for several playlists on one host. */
export const refusedClauseOneHost = 'could not be reached or read from this page: that host may be down or may not allow ' +
  "other sites to read them, or your site's policy (connect-src) may not allow the requests — INSTALL.md, for the " +
  'administrator, says which hosts the app needs.'

/** The same, for several playlists on several hosts. */
export const refusedClauseMany = 'could not be reached or read from this page: their hosts may be down or may not allow ' +
  "other sites to read them, or your site's policy (connect-src) may not allow the requests — INSTALL.md, for the " +
  'administrator, says which hosts the app needs.'

/**
 * What was to be read: the station's own playlist (its `source`, or the link
 * given), a playlist the lookup found for it (SomaFM's, StreamTheWorld's, the
 * directory's), SomaFM's list of them, or the online directory's entry for it.
 */
export type RefusedKind = 'playlist' | 'found' | 'channels' | 'directory'
const SUBJECT: Record<RefusedKind, (host?: string) => string> = {
  playlist: () => "The station's playlist",
  found: (host) => `A playlist found for this station${host ? ` (on ${host})` : ''}`,
  channels: () => "SomaFM's channel list (on api.somafm.com)",
  directory: (host) => `The online directory${host ? ` (${host})` : ''}`
}

/** An address's host, for a message: `undefined` when it has none. */
export const hostOf = (u: string): string | undefined => { try { return new URL(u).host || undefined } catch { return undefined } }

/**
 * How a playlist was refused, beyond the reasons in `REFUSED_WHY`:
 *  - `http`: the address refused is http, asked for over https from an https
 *    page — the one reason `connect-src` cannot fix, since the page may not
 *    ask over http at all;
 *  - `levels`: how many playlists were read on the way to the one refused —
 *    0, the playlist itself; 1, the one it points to; more, one further on
 *    (`http` is always the refused one's);
 *  - `host`: the refused playlist's host, said where the site's policy may
 *    need it: for one a playlist led to, one found for the station, and the
 *    directory's;
 *  - `answered`: not refused at all — an http address from an https page,
 *    asked for over https, whose host answered without it. The page may not
 *    ask over http, so it is said with `http` alone, not the policy's reasons.
 */
export interface RefusedHow { http?: boolean; levels?: number; host?: string; answered?: boolean }

/** `answered`, said in the place of `refusedClause`. */
const ANSWERED = 'could not be read over https from this page: its host answered, but not with a playlist.'

export const HTTP_REASON = (whose: string) =>
  ` ${whose} address is http, and this https page may not read http: if its host serves it only over http, it cannot be read here.`
const VIA = (levels: number, host?: string) => {
  const on = host ? ` on ${host}` : ''
  if (levels === 0) return ''
  if (levels === 1) return `points to another playlist${on ? `,${on},` : ','} which `
  return `leads, through ${levels === 2 ? 'another playlist' : `${levels - 1} other playlists`}, to one${on ? `,${on},` : ''} which `
}

/** Something to be read from another host could not be, for one of the reasons in `REFUSED_WHY`. */
export class Refused extends Error {
  readonly http: boolean
  readonly levels: number
  readonly host?: string
  readonly answered: boolean
  /** The rest of the sentence after its subject, every reason included: "could not…", "points to another playlist, which could not…". */
  readonly clause: string
  constructor (readonly kind: RefusedKind = 'playlist', how: RefusedHow = {}) {
    const http = !!how.http
    const levels = how.levels ?? 0
    const answered = !!how.answered
    const clause = VIA(levels, how.host) + (answered ? ANSWERED : refusedClause) + (http ? HTTP_REASON(levels ? "That playlist's" : 'Its') : '')
    // The host is said once: of the one refused, after the way there, or in the subject.
    super(`${SUBJECT[kind](levels ? undefined : how.host)} ${clause}`)
    this.http = http
    this.levels = levels
    this.host = how.host
    this.answered = answered
    this.clause = clause
    this.name = 'Refused'
  }

  /** Whether a playlist read on the way led to the one refused. */
  get linked (): boolean { return this.levels > 0 }

  /** The same refusal, met through a playlist that was read: one level further on. */
  deeper (): Refused { return new Refused(this.kind, { ...this.how(), levels: this.levels + 1 }) }

  /** The same refusal, of a playlist the lookup found rather than the station's own. */
  found (): Refused { return new Refused('found', this.how()) }

  private how (): RefusedHow { return { http: this.http, levels: this.levels, host: this.host, answered: this.answered } }
}

