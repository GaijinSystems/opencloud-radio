import { vi } from 'vitest'

/**
 * An in-memory WebDAV with the behaviours the store leans on: etags that
 * change on every write, `If-Match` (412 on a stale etag), the client's error
 * shape (`statusCode`), and — since 1.1.8 — the client's two spellings of an
 * etag: a listing or a PUT's result carries it with the quotes stripped, a GET
 * header carries it as sent. `If-Match` is compared exactly, quotes included,
 * as OpenCloud compares it (a lenient compare here let 1.1.8 ship a save that
 * always 412ed). A mock that handed out one string everywhere hid a cache that
 * never hit. `knobs.putDelay` makes a PUT take time, which is what a race needs.
 * Everything the store does to a file can be checked by reading `disk` afterwards.
 */
export class DavError extends Error {
  constructor(public statusCode: number) { super(`HTTP ${statusCode}`) }
}
export const disk = new Map<string, { body: string; etag: string }>()
export const folders = new Set<string>()
let seq = 0
export const stamp = () => `"e${++seq}"`
const bare = (e?: string) => e?.replace(/"/g, '')
export const log: string[] = []
/** Every If-Match the server was sent, verbatim. */
export const ifMatchSeen: string[] = []

export const dav = {
  async listFiles(_s: unknown, { path }: { path: string }) {
    log.push(`LIST ${path}`)
    if (knobs.listFails.test(path)) throw new DavError(503)
    if (!folders.has(path)) throw new DavError(knobs.listStatus)
    const children = [...disk.entries()]
      .filter(([p]) => p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/'))
      .map(([p, f]) => ({ type: 'file', name: p.split('/').pop(), path: p, etag: bare(f.etag) }))
    return { children }
  },
  async createFolder(_s: unknown, { path }: { path: string }) { log.push(`MKCOL ${path}`); folders.add(path) },
  async getFileContents(_s: unknown, { path }: { path: string }) {
    log.push(`GET ${path}`)
    if (knobs.getDelay[path]) await wait(knobs.getDelay[path])
    const f = disk.get(path)
    if (!f) throw new DavError(404)
    return { body: f.body, headers: { ETag: f.etag } }
  },
  async putFileContents(_s: unknown, o: { path: string; content: string; previousEntityTag?: string; overwrite?: boolean }) {
    log.push(`PUT ${o.path}`)
    if (knobs.putFails.test(o.path)) throw new DavError(507)
    if (!folders.has(o.path.replace(/\/[^/]+$/, ''))) throw new DavError(409) // no parent collection
    if (knobs.putDelay && !o.path.includes('/Backups/')) await wait(knobs.putDelay)
    const have = disk.get(o.path)
    // The client's own rule (read from its bundle): an etag goes out as
    // `If-Match`; with none, anything but `overwrite: true` goes out as
    // `If-None-Match: *`. The server then compares exactly, quotes included —
    // a lenient compare here is what let the 1.1.8 rebuild ship a save that
    // always 412ed — and `If-Match` on a file that is not there fails too.
    if (o.previousEntityTag) {
      ifMatchSeen.push(o.previousEntityTag)
      if (!have || have.etag !== o.previousEntityTag) throw new DavError(412)
    } else if (o.overwrite !== true && have) {
      throw new DavError(412)
    }
    const etag = stamp()
    disk.set(o.path, { body: o.content, etag })
    // The client's write is the PUT and then a PROPFIND for the new etag; the
    // second can be lost after the first has landed.
    if (knobs.propfindLost.test(o.path)) throw knobs.propfindStatus ? new DavError(knobs.propfindStatus) : new Error('Network Error')
    return { etag: knobs.etagLost.test(o.path) ? null : bare(etag) }
  },
  async copyFiles(_a: unknown, from: { path: string }, _b: unknown, to: { path: string }) {
    log.push(`COPY ${from.path} ${to.path}`)
    if (!knobs.copySupported) throw new DavError(501)
    if (knobs.putFails.test(to.path)) throw new DavError(507)
    const f = disk.get(from.path)
    if (!f) throw new DavError(404)
    if (!folders.has(to.path.replace(/\/[^/]+$/, ''))) throw new DavError(409) // no parent collection
    if (disk.has(to.path)) throw new DavError(412) // the client sends Overwrite: F
    disk.set(to.path, { body: f.body, etag: stamp() })
    return { status: 201 }
  },
  async moveFiles(_a: unknown, from: { path: string }, _b: unknown, to: { path: string }) {
    if (disk.has(to.path)) throw new DavError(412) // the client sends Overwrite: F
    const f = disk.get(from.path)!
    disk.delete(from.path); disk.set(to.path, f) // a MOVE keeps the etag
  },
  async deleteFile(_s: unknown, { path }: { path: string }) {
    log.push(`DELETE ${path}`)
    if (!disk.has(path)) throw new DavError(404)
    disk.delete(path)
  }
}

/** What the server does differently in one test; `resetDav` puts it back. */
const defaults = () => ({
  /** How long a PUT of a station list takes, in ms; backups are always instant. */
  putDelay: 0 as number,
  /** What a LIST of a folder that is not there answers. */
  listStatus: 404 as number,
  /** Whether the server will COPY at all; a backup must not depend on it. */
  copySupported: true as boolean,
  /** How long a GET of one path takes, in ms. */
  getDelay: {} as Record<string, number>,
  /** Paths whose PUT lands but whose follow-up request is lost. */
  propfindLost: /(?!)/ as RegExp,
  /** The status that lost request answers with; 0 for no answer at all. */
  propfindStatus: 0 as number,
  /** Paths whose PUT should fail, for the backup-cannot-be-written case. */
  putFails: /(?!)/ as RegExp,
  /** Paths whose LIST should fail, for the prune-cannot-run case. */
  listFails: /(?!)/ as RegExp,
  /** Paths whose PUT lands but whose answer names no etag. */
  etagLost: /(?!)/ as RegExp
})
export const knobs = defaults()

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A station list in `Radio/`, with an etag of its own. */
export const seed = (name: string, body: string) => {
  folders.add('/Radio')
  disk.set(`/Radio/${name}`, { body, etag: stamp() })
}

/** An empty server and the default behaviour, for the start of each test. */
export const resetDav = () => {
  disk.clear(); folders.clear(); log.length = 0; ifMatchSeen.length = 0
  Object.assign(knobs, defaults())
  vi.useRealTimers()
}

/** The parts of web-pkg the store uses, served by this server. */
export const webPkgMock = () => ({
  useClientService: () => ({ webdav: dav }),
  useSpacesStore: () => ({ personalSpace: { id: 'personal' } })
})
