import { vi } from 'vitest'

/**
 * Stand-ins for what a server answers, for the parts of the app that fetch:
 * a status, a content type, and a body readable as text or JSON. One builder,
 * so a change to what the app reads from a response is made here only.
 */
export const answer = (body: string, { ok = true, type = 'application/json', headers = {} as Record<string, string> } = {}) =>
  ({ ok, status: ok ? 200 : 404, headers: new Headers({ 'content-type': type, ...headers }),
    text: async () => body, json: async () => JSON.parse(body) }) as unknown as Response

/**
 * A web answering from a table of addresses, everything else a 404, installed
 * as `fetch` as well as returned (some of what is tested fetches directly).
 * Every address asked is recorded, in order.
 */
export const web = (table: Record<string, string>) => {
  const asked: string[] = []
  const request = vi.fn(async (url: string) => {
    asked.push(String(url))
    const body = table[String(url)]
    return body !== undefined ? answer(body) : answer('', { ok: false })
  })
  vi.stubGlobal('fetch', request)
  return { asked, request: request as unknown as typeof fetch }
}

/**
 * A network that refuses everything, as a page is refused: a `TypeError` and
 * nothing more — the host not allowing other sites, the site's own policy, or
 * the host out of reach (see `refused` in helpers/fetch). Installed as `fetch`
 * as well as returned.
 */
export const refusing = () => {
  const request = vi.fn(async (_url: string) => { throw new TypeError('Failed to fetch') })
  vi.stubGlobal('fetch', request)
  return request as typeof request & typeof fetch
}
