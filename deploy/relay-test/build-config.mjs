// Builds the HAProxy config the test runs: one backend per kind of origin,
// each a byte-for-byte copy of `radio_slay4` from ../haproxy-relay.cfg with
// only its `server` line pointed at the test origin. What is tested is
// therefore exactly what an administrator is told to copy.
import { readFileSync, writeFileSync } from 'node:fs'

const [source, target] = process.argv.slice(2)
const text = readFileSync(source, 'utf8')
const block = /^backend radio_slay4\n(?:    .*\n)+/m.exec(text)?.[0]
if (!block || !block.includes('server slay4 ')) {
  console.error(`${source}: no radio_slay4 backend with a server line to point at the test origin`)
  process.exit(1)
}
// The relay on a hostname of its own: the same block with its commented CORS
// lines switched on, exactly as INSTALL tells an administrator to.
const CORS_LINE = /^    # (http-request return status 204 .*|http-response set-header Access-Control-.*)$/gm
const corsLines = block.match(CORS_LINE) ?? []
if (corsLines.length !== 3) {
  console.error(`${source}: expected the three commented CORS lines in radio_slay4, found ${corsLines.length}`)
  process.exit(1)
}
const corsBlock = block.replace(CORS_LINE, '    $1')
// Every relay gets the same guard: the one tested here is radio_slay4, so the
// others must not have drifted from it — its lines, and its optional CORS
// lines, commented out as shipped. Only the Host each names may differ.
const guardOf = (b) => (b.match(/^    (?:# )?http-(request|response) .*$/gm) ?? []).map((l) => l.replace(/set-header Host \S+/, 'set-header Host H')).join('\n')
const backends = [...text.matchAll(/^backend (radio_\w+)\n((?:    .*\n|\n)+?)(?=^\S|(?![\s\S]))/gm)]
for (const [, name, body] of backends) {
  if (guardOf(body) !== guardOf(block)) {
    console.error(`${source}: backend ${name} does not carry the same guard lines as radio_slay4`)
    process.exit(1)
  }
}
if (backends.length < 2) { console.error(`${source}: expected at least two relay backends, found ${backends.length}`); process.exit(1) }
const cases = { good: 8001, html: 8002, double: 8003, redirect: 8004, joined: 8005, typed: 8006, early: 8007, cors: 8001 }
const out = [
  'global', 'defaults', '    mode http', '    timeout connect 5s', '    timeout client 30s', '    timeout server 30s', '',
  'frontend cloud', '    bind :8080',
  ...Object.keys(cases).map((n) => `    use_backend relay_${n} if { path /radio-relay/${n} }`), ''
]
for (const [name, port] of Object.entries(cases)) {
  out.push((name === 'cors' ? corsBlock : block).replace('backend radio_slay4', `backend relay_${name}`).replace(/server slay4 \S+/, `server s origin:${port}`))
}
writeFileSync(target, out.join('\n') + '\n')
