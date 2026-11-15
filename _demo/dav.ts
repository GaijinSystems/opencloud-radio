/**
 * A WebDAV server in the visitor's browser, standing in for OpenCloud's. It
 * answers the calls the app makes, the way OpenCloud's client and server do:
 * etags that change on every write and are compared exactly, `If-None-Match`
 * when no etag is given, 409 for a missing folder, no overwriting on COPY or
 * MOVE. Files are kept in localStorage, so a visitor's lists survive a reload;
 * nothing is sent anywhere.
 */
import { seedFiles } from './seed'

class DavError extends Error {
  constructor (public statusCode: number) { super(`HTTP ${statusCode}`) }
}

type Disk = { files: Record<string, { body: string; etag: string }>; folders: string[]; seq: number }
const KEY = 'radio-demo-files'

const fresh = (): Disk => {
  const disk: Disk = { files: {}, folders: ['/Radio'], seq: 0 }
  for (const [name, body] of Object.entries(seedFiles)) disk.files[`/Radio/${name}`] = { body, etag: `"e${++disk.seq}"` }
  return disk
}
const load = (): Disk => {
  try {
    const raw = localStorage.getItem(KEY)
    // Of the shape this demo writes, or not used: a store from an older demo,
    // or edited by hand, would otherwise fail every request until Start over.
    const d = raw ? JSON.parse(raw) as Partial<Disk> : undefined
    const entries = d && d.files && typeof d.files === 'object' ? Object.values(d.files) : []
    if (d && Array.isArray(d.folders) && d.folders.every((f) => typeof f === 'string') && !Array.isArray(d.files) &&
        Number.isInteger(d.seq) && (d.seq as number) >= 0 &&
        entries.every((f) => !!f && typeof f === 'object' && typeof f.body === 'string' && typeof f.etag === 'string')) return d as Disk
  } catch { /* storage unavailable or unreadable: start again */ }
  return fresh()
}
let disk = load()
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(disk)) } catch { /* private mode: this visit only */ } }

/** The demo as it was first opened. */
export const resetDemo = () => {
  disk = fresh()
  save()
  for (const k of Object.keys(localStorage)) if (k.startsWith('radio.')) localStorage.removeItem(k)
}

const parentOf = (path: string) => path.replace(/\/[^/]+$/, '')
const bare = (etag: string) => etag.replace(/"/g, '')
const stamp = () => `"e${++disk.seq}"`
const tick = () => new Promise((r) => setTimeout(r, 30)) // a server answers later, never at once

export const webdav = {
  async listFiles (_space: unknown, { path }: { path: string }) {
    await tick()
    if (!disk.folders.includes(path)) throw new DavError(404)
    const children = [
      ...disk.folders.filter((f) => parentOf(f) === path).map((f) => ({ type: 'folder', name: f.split('/').pop(), path: f })),
      ...Object.entries(disk.files).filter(([p]) => parentOf(p) === path)
        .map(([p, f]) => ({ type: 'file', name: p.split('/').pop(), path: p, etag: bare(f.etag) }))
    ]
    return { children }
  },
  async createFolder (_space: unknown, { path }: { path: string }) {
    await tick()
    if (disk.folders.includes(path)) throw new DavError(405)
    if (!disk.folders.includes(parentOf(path)) && parentOf(path) !== '') throw new DavError(409)
    disk.folders.push(path)
    save()
  },
  async getFileContents (_space: unknown, { path }: { path: string }) {
    await tick()
    const f = disk.files[path]
    if (!f) throw new DavError(404)
    return { body: f.body, headers: { ETag: f.etag } }
  },
  async putFileContents (_space: unknown, o: { path: string; content: string; previousEntityTag?: string }) {
    await tick()
    if (!disk.folders.includes(parentOf(o.path))) throw new DavError(409)
    const have = disk.files[o.path]
    if (o.previousEntityTag) {
      if (!have || have.etag !== o.previousEntityTag) throw new DavError(412)
    } else if (have) {
      throw new DavError(412)
    }
    const etag = stamp()
    disk.files[o.path] = { body: o.content, etag }
    save()
    return { etag: bare(etag) }
  },
  async copyFiles (_a: unknown, from: { path: string }, _b: unknown, to: { path: string }) {
    await tick()
    const f = disk.files[from.path]
    if (!f) throw new DavError(404)
    if (!disk.folders.includes(parentOf(to.path))) throw new DavError(409)
    if (disk.files[to.path]) throw new DavError(412)
    disk.files[to.path] = { body: f.body, etag: stamp() }
    save()
    return { status: 201 }
  },
  async moveFiles (_a: unknown, from: { path: string }, _b: unknown, to: { path: string }) {
    await tick()
    const f = disk.files[from.path]
    if (!f) throw new DavError(404)
    if (disk.files[to.path]) throw new DavError(412)
    delete disk.files[from.path]
    disk.files[to.path] = f
    save()
  },
  async deleteFile (_space: unknown, { path }: { path: string }) {
    await tick()
    if (!disk.files[path]) throw new DavError(404)
    delete disk.files[path]
    save()
  }
}
