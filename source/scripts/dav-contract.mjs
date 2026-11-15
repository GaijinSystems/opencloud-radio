#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
/**
 * What OpenCloud Radio relies on a WebDAV server to do, checked against one.
 *
 * The store's tests run against an in-memory server (tests/support/dav.ts).
 * Twice in this project's history that stand-in agreed with the code rather
 * than with the real server, and a release that could not save passed every
 * test. This script states the contract once, as HTTP: the test suite runs it
 * against the stand-in, and you can run it against your instance. If both
 * pass, the stand-in is telling the truth about your server.
 *
 *   OC_USER=alice OC_PASSWORD=… node scripts/dav-contract.mjs https://cloud.example.org
 *   OC_USER=alice OC_TOKEN=…    node scripts/dav-contract.mjs https://cloud.example.org
 *
 * A password needs basic auth enabled on the instance (PROXY_ENABLE_BASIC_AUTH);
 * a token is the bearer token a logged-in browser sends, from its developer
 * tools. Credentials go to the URL given and nowhere else, and only over https
 * (or to localhost). Everything happens in a new folder in the user's personal
 * space, `radio-contract-<time>`, which is deleted at the end — on OpenCloud
 * that puts it in the trash, from where it can be emptied.
 */

/** @typedef {{ name: string, ok: boolean, detail: string }} Result */

/**
 * Runs every check in a fresh folder under `base` (a WebDAV collection URL
 * ending in `/`), with `headers` added to each request.
 * @param {{ base: string, headers?: Record<string,string>, fetch?: typeof fetch }} o
 * @returns {Promise<Result[]>}
 */
export const runContract = async ({ base, headers = {}, fetch: request = fetch }) => {
  /** @type {Result[]} */
  const results = []
  const folder = `${base}radio-contract-${Date.now()}/`
  const call = (method, url, extra = {}, body) =>
    request(url, { method, headers: { ...headers, ...extra }, body, redirect: 'manual' })
  const expect = (name, ok, detail) => results.push({ name, ok: !!ok, detail: String(detail) })
  const etagOf = async (url) => (await call('GET', url)).headers.get('etag')
  const destination = (url) => ({ Destination: url, Overwrite: 'F' })

  let r = await call('PROPFIND', folder, { Depth: '1' })
  expect('listing a folder that is not there answers 404', r.status === 404, r.status)

  r = await call('PUT', `${folder}missing/list.m3u8`, { 'If-None-Match': '*' }, '#EXTM3U\n')
  expect('a write into a folder that is not there answers 409 (or 404)', r.status === 409 || r.status === 404, r.status)
  r = await call('PUT', `${folder}missing/list.m3u8`, { 'If-Match': '"any"' }, '#EXTM3U\n')
  expect('a write with If-Match into a folder that is not there is refused (409, 404 or 412)', [404, 409, 412].includes(r.status), r.status)

  r = await call('MKCOL', folder)
  expect('a folder can be made', r.status === 201, r.status)
  try {
    const list = `${folder}list.m3u8`
    r = await call('PUT', list, { 'If-None-Match': '*' }, '#EXTM3U\n')
    expect('a new file can be written with If-None-Match: *', r.status === 201 || r.status === 204, r.status)
    r = await call('PUT', list, { 'If-None-Match': '*' }, 'again')
    expect('If-None-Match: * refuses a name that is taken (412)', r.status === 412, r.status)

    const tag = await etagOf(list)
    expect('a GET carries the etag quoted', /^(W\/)?".+"$/.test(tag ?? ''), tag)
    r = await call('PROPFIND', folder, { Depth: '1' })
    const listing = await r.text()
    const bare = tag?.replace(/"/g, '') ?? ''
    expect('the listing carries the same etag', r.status === 207 && listing.includes(bare), `${r.status}, looking for ${bare}`)

    r = await call('PUT', list, { 'If-Match': bare }, 'bare')
    expect('If-Match must be quoted: a bare etag is refused (412)', r.status === 412, r.status)
    r = await call('PUT', list, { 'If-Match': tag }, '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    expect('If-Match with the current, quoted etag writes', r.status === 204 || r.status === 201, r.status)
    const next = await etagOf(list)
    expect('a write changes the etag', !!next && next !== tag, `${tag} → ${next}`)
    r = await call('PUT', list, { 'If-Match': tag }, 'stale')
    expect('If-Match with a stale etag is refused (412)', r.status === 412, r.status)
    r = await call('PUT', `${folder}gone.m3u8`, { 'If-Match': tag }, 'x')
    expect('If-Match on a file that is not there is refused (412)', r.status === 412, r.status)

    await call('MKCOL', `${folder}Backups/`)
    r = await call('COPY', list, destination(`${folder}Backups/copy.m3u8`))
    expect('COPY makes a copy (201)', r.status === 201, r.status)
    r = await call('GET', `${folder}Backups/copy.m3u8`)
    expect('the copy holds what the file held', (await r.text()).includes('https://a/1'), r.status)
    r = await call('COPY', list, destination(`${folder}Backups/copy.m3u8`))
    expect('COPY with Overwrite: F refuses a name that is taken (412)', r.status === 412, r.status)
    r = await call('COPY', list, destination(`${folder}nowhere/copy.m3u8`))
    expect('COPY into a folder that is not there answers 409 (or 404)', r.status === 409 || r.status === 404, r.status)
    r = await call('COPY', `${folder}gone.m3u8`, destination(`${folder}Backups/gone.m3u8`))
    expect('COPY of a file that is not there answers 404', r.status === 404, r.status)

    await call('PUT', `${folder}other.m3u8`, { 'If-None-Match': '*' }, '#EXTM3U\n')
    r = await call('MOVE', list, destination(`${folder}other.m3u8`))
    expect('MOVE with Overwrite: F refuses a name that is taken (412)', r.status === 412, r.status)
    r = await call('MOVE', list, destination(`${folder}renamed.m3u8`))
    expect('MOVE renames (201)', r.status === 201, r.status)

    r = await call('DELETE', `${folder}gone.m3u8`)
    expect('DELETE of a file that is not there answers 404', r.status === 404, r.status)
  } finally {
    await call('DELETE', folder).catch(() => undefined)
  }
  return results
}

const cli = async () => {
  const [url] = process.argv.slice(2)
  const { OC_USER: user, OC_PASSWORD: password, OC_TOKEN: token } = process.env
  if (!url || !user || !(password || token)) {
    console.error('usage: OC_USER=… OC_PASSWORD=…|OC_TOKEN=… node scripts/dav-contract.mjs https://cloud.example.org')
    process.exit(2)
  }
  const origin = new URL(url)
  if (origin.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) {
    console.error('Refusing to send credentials over plain http to anything but localhost.')
    process.exit(2)
  }
  const auth = token ? `Bearer ${token}` : `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`
  const base = new URL(`remote.php/dav/files/${encodeURIComponent(user)}/`, origin.href.endsWith('/') ? origin.href : `${origin.href}/`).href
  const results = await runContract({ base, headers: { Authorization: auth } })
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${r.detail})`)
  const failed = results.filter((r) => !r.ok).length
  console.log(failed ? `${failed} FAILED` : 'ALL PASS')
  process.exit(failed ? 1 : 0)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await cli() // not `file://` + path: see find-nowplaying.mjs
