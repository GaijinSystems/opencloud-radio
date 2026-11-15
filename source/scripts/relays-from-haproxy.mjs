#!/usr/bin/env node
// The app's `relays` table, read from the HAProxy configuration that serves
// the relays (INSTALL §2b), so the two cannot drift apart:
//
//   node source/scripts/relays-from-haproxy.mjs /etc/haproxy/haproxy.cfg [https://radio-relay.example.org]
//
// Each `use_backend NAME if { path /p }` (with `{ hdr(host) -i host }` beside
// it, for a relay hostname of its own) is paired with that backend's
// `server … host:port` and its `http-request set-path`, if any. Prints the
// block for config.json or apps.yaml, and a warning for every relay line it
// could not read, rather than guessing at one. The second argument is the
// relay hostname, when the routing does not say it with a host condition.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const BLOCK = /^(frontend|backend|listen|defaults|global|resolvers|peers|userlist|program|http-errors|ring|cache|mailers)\b\s*(\S*)/

/**
 * A `use_backend` condition, read only as far as it can be read for certain:
 * `{ path /p }`, and `{ hdr(host) -i host }` (or `req.hdr`, `-m str`) beside
 * it. Anything else — a negated group, a named ACL, an `or` — and the route is
 * reported rather than guessed at.
 */
const readCondition = (cond) => {
  let path
  let host
  const groups = [...cond.matchAll(/(!?)\s*\{([^}]*)\}/g)]
  const rest = cond.replace(/!?\s*\{[^}]*\}/g, '').trim()
  if (rest) return { unreadable: `"${rest}" is not something this script reads` }
  for (const [, not, inner] of groups) {
    const words = inner.trim().split(/\s+/)
    const fetch = words.shift()
    const flags = []
    while (words[0]?.startsWith('-')) { const f = words.shift(); flags.push(f === '-m' ? `-m ${words.shift()}` : f) }
    const plain = flags.every((f) => f === '-i' || f === '-m str')
    if (not) return { unreadable: 'a negated condition is not read' }
    if (fetch === 'path' && words.length === 1 && plain && !flags.includes('-i') && words[0].startsWith('/')) {
      if (path !== undefined) return { unreadable: 'two path conditions are not read' }
      path = words[0]
    }
    else if (/^(req\.)?hdr\(host\)$/.test(fetch) && words.length === 1 && plain) host = words[0].toLowerCase()
    else return { unreadable: `{ ${inner.trim()} } is not read` }
  }
  return { path, host }
}

/** `{ from: upstream http address, to: relay path or https address }` for each relay, and what could not be read. */
export const relaysFromHaproxy = (text, relayOrigin = '') => {
  const routes = []
  const backends = new Map()
  let section = null
  // `default-server … ssl` in a `defaults` section applies to every backend
  // after it, as one in a backend does to that backend's servers.
  let defaultsTls = false
  const namedTls = new Map() // a named defaults section's, for `backend x from <name>`
  const tlsOf = (words, inherited) => (words.includes('no-ssl') ? false : words.includes('ssl') || inherited)
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').replace(/^#.*$/, '').trimEnd()
    if (!line.trim()) continue
    const head = BLOCK.exec(line)
    if (head && !/^\s/.test(line)) {
      section = { kind: head[1], name: head[2] }
      // Each defaults section starts from nothing; a named one is kept, for a
      // backend that names it (`backend x from <name>`).
      if (section.kind === 'defaults') { defaultsTls = false; if (head[2]) namedTls.set(head[2], false) }
      if (section.kind === 'backend' || section.kind === 'listen') {
        const from = /\sfrom\s+(\S+)/.exec(line)?.[1]
        backends.set(section.name, { servers: [], setPath: undefined, rewrites: [], guarded: false,
          defaultTls: from === undefined ? defaultsTls : namedTls.get(from) ?? false })
      }
      continue
    }
    if (!section) continue
    const l = line.trim()
    if (section.kind === 'frontend' || section.kind === 'listen') {
      const use = /^use_backend\s+(\S+)\s+(if|unless)\s+(.*)$/.exec(l)
      if (use) routes.push({ backend: use[1], line: l, ...(use[2] === 'unless' ? { unreadable: '`unless` is not read' } : readCondition(use[3])) })
      const def = /^default_backend\s+(\S+)$/.exec(l)
      if (def) routes.push({ backend: def[1], line: l, unreadable: 'a default backend has no path' })
    }
    if (section.kind === 'defaults' && /^default-server\b/.test(l)) {
      defaultsTls = tlsOf(l.split(/\s+/), defaultsTls)
      if (section.name) namedTls.set(section.name, defaultsTls)
    }
    const b = section.kind === 'backend' || section.kind === 'listen' ? backends.get(section.name) : undefined
    if (b) {
      const server = /^server\s+\S+\s+([^\s:]+):(\d+)\b(.*)$/.exec(l)
      // Whole words: `check-ssl` and `no-ssl` are not `ssl`.
      if (server) b.servers.push({ host: server[1], port: server[2], tls: tlsOf(server[3].split(/\s+/), b.defaultTls) })
      if (/^default-server\b/.test(l)) b.defaultTls = tlsOf(l.split(/\s+/), b.defaultTls)
      const setPath = /^http-request\s+set-path\s+(\/[^\s%]*)$/.exec(l) // `%[…]` is an expression, not a path
      if (setPath) b.setPath = setPath[1]
      else if (/^http-request\s+(set-path|set-pathq|set-uri|replace-path|replace-pathq|replace-uri)\b/.test(l)) b.rewrites.push(l)
      if (/^http-request\s+deny\s+unless\s+METH_GET\b/.test(l)) b.guarded = true
    }
  }
  const relays = {}
  const problems = []
  for (const r of routes) {
    const b = backends.get(r.backend)
    if (!b) { problems.push(`${r.line}: no backend ${r.backend}`); continue }
    // A backend that looks like a relay — the guard, or a path rewrite — is
    // one whose route had better be read; any other is the cloud's own traffic.
    const relayLike = b.guarded || b.setPath !== undefined || b.rewrites.length > 0
    if (r.unreadable || !r.path) {
      if (relayLike) problems.push(`${r.line}: ${r.unreadable ?? 'no { path … } condition'}; not mapped`)
      continue
    }
    if (b.rewrites.length) { problems.push(`${r.line}: backend ${r.backend} rewrites the path in a way not read (${b.rewrites[0]}); not mapped`); continue }
    if (b.servers.length !== 1) { problems.push(`${r.line}: backend ${r.backend} has ${b.servers.length} servers; a relay has one`); continue }
    const s = b.servers[0]
    if (s.tls) continue // an https origin needs no relay in the app's table
    const upstream = new URL(`http://${s.host}:${s.port}${b.setPath ?? r.path}`)
    const origin = r.host ? `https://${r.host}` : relayOrigin && new URL(relayOrigin).origin
    relays[upstream.href] = origin ? `${origin}${r.path}` : r.path
  }
  return { relays, problems }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [file, relayOrigin = ''] = process.argv.slice(2)
  const isHttpsOrigin = (v) => { try { const u = new URL(v); return u.protocol === 'https:' && u.pathname === '/' && !u.search && !u.username } catch { return false } }
  if (!file || (relayOrigin && !isHttpsOrigin(relayOrigin))) {
    console.error('usage: relays-from-haproxy.mjs <haproxy.cfg> [https://relay-hostname]')
    process.exit(2)
  }
  const { relays, problems } = relaysFromHaproxy(readFileSync(file, 'utf8'), relayOrigin)
  for (const p of problems) console.error(`warning: ${p}`)
  if (!Object.keys(relays).length) { console.error('no relay routes found'); process.exit(1) }
  console.log('config.json, inside "config":\n')
  console.log(`"relays": ${JSON.stringify(relays, null, 2)}\n`)
  console.log('apps.yaml, under the radio app\'s config:\n')
  // A JSON string is a valid YAML double-quoted one: escaped the same way.
  console.log(`relays:\n${Object.entries(relays).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join('\n')}`)
}
