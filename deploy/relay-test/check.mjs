import { connect } from 'node:net'
// Part of deploy/relay-test: see run.sh.
// Asks the relay for each path as a browser on the cloud would, and checks
// what comes back against what the example's comments promise.
const base = 'http://relay:8080/radio-relay/'
const CLOUD = 'https://cloud.example.org'
const visitor = { Cookie: 'oc_session=secret', Authorization: 'Bearer secret', Referer: 'https://cloud.example.org/radio/' }
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const get = (path, init = {}) => fetch(base + path, { redirect: 'manual', headers: visitor, ...init })
/** The question a browser asks before reading titles from another origin. */
const preflight = (path, origin) => get(path, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'icy-metadata' } })
/** The ICY block where the origin puts it, after 1024 bytes of audio, as text. */
const titleIn = (body) => new TextDecoder().decode(body.subarray(1025, 1025 + body[1024] * 16))

let r = await get('good', { headers: { ...visitor, 'X-Forwarded-For': '203.0.113.9', 'X-Real-IP': '203.0.113.9', Forwarded: 'for=203.0.113.9', 'X-Forwarded-Host': 'cloud.example', 'X-Forwarded-Proto': 'https', 'X-Forwarded-Server': 'cloud.example', 'X-Forwarded-Port': '443', 'X-Forwarded-Ssl': 'on', Via: '1.1 cloud.example', 'True-Client-IP': '203.0.113.9', 'CF-Connecting-IP': '203.0.113.9', 'X-Client-IP': '203.0.113.9', 'X-Cluster-Client-IP': '203.0.113.9', 'Client-IP': '203.0.113.9', 'Fastly-Client-IP': '203.0.113.9', 'X-Original-Forwarded-For': '203.0.113.9' } })
const seen = JSON.parse(r.headers.get('x-seen') ?? '{}')
check('a stream is relayed', r.status === 200 && r.headers.get('content-type') === 'audio/mpeg', `${r.status} ${r.headers.get('content-type')}`)
check('the body arrives', (await r.arrayBuffer()).byteLength === 4096)
check('the visitor\'s Cookie does not reach the origin', seen.cookie === null, String(seen.cookie))
check('nor their Authorization', seen.authorization === null, String(seen.authorization))
check('nor the page they were on', seen.referer === null, String(seen.referer))
check('the station is asked by its own name, not the cloud\'s', seen.host === 'relay4.slayradio.org:8000', String(seen.host))
check('nor told who is listening, by a header the visitor sent', seen.xff === null && seen.forwarded === null && seen.realIp === null, `${seen.xff} ${seen.forwarded} ${seen.realIp}`)
check('nor the cloud\'s own name and scheme', seen.xfh === null && seen.xfp === null, `${seen.xfh} ${seen.xfp}`)
check('nor what a proxy or CDN in front adds about either', Array.isArray(seen.more) && seen.more.length === 0, String(seen.more))
check('nothing is to be cached', r.headers.get('cache-control') === 'no-store', String(r.headers.get('cache-control')))
for (const h of ['set-cookie', 'clear-site-data', 'strict-transport-security', 'nel', 'report-to', 'reporting-endpoints', 'refresh',
  'alt-svc', 'link', 'accept-ch', 'set-login', 'access-control-allow-origin', 'access-control-allow-credentials', 'access-control-expose-headers']) {
  check(`the origin's ${h} is not passed on`, r.headers.get(h) === null, String(r.headers.get(h)))
}
check('nosniff is set', r.headers.get('x-content-type-options') === 'nosniff')
check('the answer is sandboxed', (r.headers.get('content-security-policy') ?? '').startsWith('sandbox'), String(r.headers.get('content-security-policy')))
// Track titles: the request header reaches the origin and the spacing comes
// back, so the app can read titles through the relay (same origin, no CORS).
r = await get('good', { headers: { ...visitor, 'Icy-MetaData': '1' } })
const icySeen = JSON.parse(r.headers.get('x-seen') ?? '{}')
const body = new Uint8Array(await r.arrayBuffer())
check('Icy-MetaData reaches the origin', icySeen.icy === '1', String(icySeen.icy))
check('icy-metaint comes back to the page', r.headers.get('icy-metaint') === '1024', String(r.headers.get('icy-metaint')))
check('and the title is in the stream where it says', titleIn(body).includes("StreamTitle='Artist - Title'"))
r = await get('good', { method: 'HEAD' })
check('HEAD is allowed (curl -I)', r.status === 200, String(r.status))
r = await get('good', { method: 'POST', body: 'x' })
check('POST is refused', r.status === 403, String(r.status))
r = await get('html')
check('an HTML answer is refused', r.status === 502 && !(await r.text()).includes('alert'), String(r.status))
r = await get('double')
check('two Content-Type headers are refused', r.status === 502, String(r.status))
r = await get('joined')
check('one Content-Type naming two types is refused', r.status === 502, String(r.status))
r = await get('typed')
check('a type that only begins like audio is refused', r.status === 502, String(r.status))
r = await get('redirect')
check('a redirect is refused, not followed or passed on', r.status === 502 && r.headers.get('location') === null, `${r.status} ${r.headers.get('location')}`)
// As shipped, the CORS lines are commented out: a preflight is refused like
// any other method.
r = await preflight('good', CLOUD)
check('as shipped, a preflight is refused', r.status === 403, String(r.status))
// A relay hostname of its own, the CORS lines switched on.
r = await preflight('cors', CLOUD)
check('own hostname: the cloud\'s preflight is answered', r.status === 204 && r.headers.get('access-control-allow-origin') === CLOUD &&
  /icy-metadata/i.test(r.headers.get('access-control-allow-headers') ?? ''), `${r.status} ${r.headers.get('access-control-allow-origin')} ${r.headers.get('access-control-allow-headers')}`)
r = await preflight('cors', 'https://elsewhere.example')
check('own hostname: any other site\'s preflight is refused', r.status === 403 && r.headers.get('access-control-allow-origin') === null, `${r.status} ${r.headers.get('access-control-allow-origin')}`)
r = await get('cors', { headers: { ...visitor, Origin: CLOUD, 'Icy-MetaData': '1' } })
check('own hostname: the cloud\'s address does not go upstream', JSON.parse(r.headers.get('x-seen') ?? '{}').origin === null, String(JSON.parse(r.headers.get('x-seen') ?? '{}').origin))
const corsBody = new Uint8Array(await r.arrayBuffer())
check('own hostname: the stream may be read by the cloud, titles and all', r.status === 200 && r.headers.get('access-control-allow-origin') === CLOUD &&
  /icy-metaint/i.test(r.headers.get('access-control-expose-headers') ?? '') && r.headers.get('icy-metaint') === '1024' &&
  titleIn(corsBody).includes('StreamTitle='),
  `${r.status} ${r.headers.get('access-control-allow-origin')} ${r.headers.get('access-control-expose-headers')}`)
r = await get('cors', { method: 'POST', body: 'x', headers: { Origin: CLOUD } })
check('own hostname: still nothing but GET', r.status === 403, String(r.status))
// The known gap (haproxy-relay.cfg): an interim 103 passes as it came. Read
// raw, since fetch does not show interim answers. Reported, not counted, so a
// HAProxy that ever closes it is noticed.
const raw = await new Promise((resolve) => {
  const s = connect(8080, 'relay', () => s.write('GET /radio-relay/early HTTP/1.1\r\nHost: cloud\r\nConnection: close\r\n\r\n'))
  let got = ''
  s.on('data', (d) => { got += d.toString('latin1') })
  s.on('close', () => resolve(got)); s.on('error', () => resolve(got))
  setTimeout(() => s.destroy(), 3000)
})
const interim = /^HTTP\/1\.1 103[^]*?\r\n\r\n/.exec(raw)?.[0] ?? ''
console.log(`KNOWN GAP  a 103 interim answer is passed on${interim ? ' with: ' + (interim.match(/^(link|set-cookie|clear-site-data):/gim) ?? []).join(' ') : ' — NOT ANY MORE: update haproxy-relay.cfg'}`)
console.log(results.every(Boolean) ? 'ALL PASS' : `${results.filter((x) => !x).length} FAILED`)
process.exit(results.every(Boolean) ? 0 : 1)
