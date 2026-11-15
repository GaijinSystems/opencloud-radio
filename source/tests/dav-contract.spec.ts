import { describe, it, expect, beforeEach } from 'vitest'
import { DavError, dav, disk, resetDav } from './support/dav'
import { runContract } from '../scripts/dav-contract.mjs'

/**
 * The in-memory server the store is tested against, spoken to as HTTP, held
 * to the contract `scripts/dav-contract.mjs` states. The same script runs
 * against a real instance; when both pass, what the store's tests assume
 * about the server is what the server does. The two times the stand-in was
 * wrong (1.1.8: etag spellings; 1.1.9: `If-Match` compared leniently) are
 * both checks below.
 */
const BASE = 'http://stand-in/dav/'
const pathOf = (url: string) => '/' + url.slice(BASE.length).replace(/\/$/, '')

const answer = (status: number, headers: Record<string, string> = {}, body = '') =>
  new Response(status === 204 ? null : body, { status, headers })

const standIn = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
  const url = String(input)
  const path = pathOf(url)
  const h = new Headers(init.headers)
  const to = h.get('Destination') ? pathOf(h.get('Destination')!) : ''
  try {
    switch (init.method) {
      case 'PROPFIND': {
        const { children } = await dav.listFiles(null, { path })
        return answer(207, {}, children.map((c) => `<d:getetag>"${c.etag}"</d:getetag>`).join(''))
      }
      case 'MKCOL':
        await dav.createFolder(null, { path })
        return answer(201)
      case 'GET': {
        const f = await dav.getFileContents(null, { path })
        return answer(200, { ETag: f.headers.ETag }, f.body)
      }
      case 'PUT': {
        const existed = disk.has(path)
        const ifMatch = h.get('If-Match') ?? undefined
        await dav.putFileContents(null, {
          path, content: String(init.body ?? ''), previousEntityTag: ifMatch,
          overwrite: ifMatch ? undefined : h.get('If-None-Match') === '*' ? false : true
        })
        return answer(existed ? 204 : 201)
      }
      case 'COPY': {
        const r = await dav.copyFiles(null, { path }, null, { path: to })
        return answer(r.status)
      }
      case 'MOVE':
        if (!disk.has(path)) throw new DavError(404)
        await dav.moveFiles(null, { path }, null, { path: to })
        return answer(201)
      case 'DELETE':
        await dav.deleteFile(null, { path })
        return answer(204)
      default:
        return answer(405)
    }
  } catch (e) {
    return answer(e instanceof DavError ? e.statusCode : 500)
  }
}

beforeEach(resetDav)

describe('the WebDAV contract', () => {
  it('is kept by the stand-in the store is tested against', async () => {
    const results = await runContract({ base: BASE, fetch: standIn as typeof fetch })
    const failed = results.filter((r) => !r.ok).map((r) => `${r.name} (${r.detail})`)
    expect(failed).toEqual([])
    expect(results.length).toBeGreaterThan(18)
  })

  it('would have caught the stand-in that let 1.1.9 ship a save that always failed', async () => {
    // The 1.1.8 mock compared If-Match leniently, quotes or not. Put that back
    // and the contract says so.
    const strict = dav.putFileContents
    dav.putFileContents = (async (s: unknown, o: { path: string; content: string; previousEntityTag?: string; overwrite?: boolean }) =>
      strict(s, { ...o, previousEntityTag: o.previousEntityTag && disk.get(o.path)?.etag.replace(/"/g, '') === o.previousEntityTag.replace(/"/g, '')
        ? disk.get(o.path)!.etag : o.previousEntityTag })) as typeof strict
    try {
      const results = await runContract({ base: BASE, fetch: standIn as typeof fetch })
      expect(results.find((r) => r.name.startsWith('If-Match must be quoted'))!.ok).toBe(false)
    } finally { dav.putFileContents = strict }
  })
})
