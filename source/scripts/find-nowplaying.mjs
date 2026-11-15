#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
/**
 * Finds the now-playing address of a public radio station, for the station
 * form's "Now-playing address" field.
 *
 * Public radio stations in the US publish what is on through NPR's Cadence
 * service, under a channel id that appears nowhere in the stream address, so
 * the app cannot work it out from the stream. The id is in the station's own
 * website, on its player (`data-stream-channel-id`). The app cannot read
 * that either: of 45 station websites sampled in November 2026, 37 carried
 * such an id and only one allowed a web page on another site to read it.
 * Run here, outside a browser, there is no such restriction.
 *
 *   node scripts/find-nowplaying.mjs https://www.kcur.org/
 *   node scripts/find-nowplaying.mjs KCUR          (searches NPR's station directory)
 *
 * Prints each stream the website's player offers, with the address to paste
 * and what it says is on now. Sends nothing but ordinary page requests to the
 * station's website, NPR's station directory and Cadence.
 */
const UA = 'Mozilla/5.0 (compatible; opencloud-radio find-nowplaying)'
const get = (url) => fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(15000) })

export const cadenceAddress = (id) => `https://cadence.nprstations.org/api/cadence/widget/${id}?show_song=true`

/**
 * The player streams in a station website's HTML: each with its name, the
 * stream addresses it plays and its Cadence channel id.
 * @param {string} html
 * @returns {Array<{ name: string, id: string, streams: string[] }>}
 */
export const streamsInPage = (html) => {
  const out = []
  const seen = new Set()
  for (const m of html.matchAll(/<ps-stream\b([^>]*)>([\s\S]*?)<\/ps-stream>/gi)) {
    const attrs = m[1]
    const id = /data-stream-channel-id="([0-9a-f-]{36})"/i.exec(attrs)?.[1]
    if (!id || seen.has(id)) continue
    seen.add(id)
    const name = (/data-stream-name="([^"]*)"/i.exec(attrs)?.[1] ?? '').trim()
    const streams = [...m[2].matchAll(/data-stream-url="([^"]+)"/gi)].map((s) => s[1])
    out.push({ name, id, streams })
  }
  // A player written differently: the ids alone, without the names around them.
  for (const m of html.matchAll(/data-stream-channel-id="([0-9a-f-]{36})"/gi)) {
    if (!seen.has(m[1])) { seen.add(m[1]); out.push({ name: '', id: m[1], streams: [] }) }
  }
  return out
}

/** What Cadence says is on, in a few words, to show the address is the right one. */
/**
 * Text from a website or an answer, as it may be printed: without control
 * characters, which a hostile page could use to rewrite the terminal — the
 * very line about to be copied, the window title, or the clipboard.
 */
const shown = (v) => String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '') // and the bidi controls that reorder what is shown

const onNow = async (id) => {
  try {
    const r = await get(cadenceAddress(id))
    if (!r.ok) return `(Cadence answered ${r.status})`
    const j = await r.json()
    const song = j.currentlyPlayingSong
    return song?.title ? `${song.title}${song.composer ? ` — ${song.composer}` : ''}` : (j.onNow?.programName ?? '(nothing listed right now)')
  } catch (e) { return `(${e.name})` }
}

const websitesFor = async (query) => {
  const r = await get(`https://station.api.npr.org/v3/stations?q=${encodeURIComponent(query)}`)
  if (!r.ok) throw new Error(`NPR's station directory answered ${r.status}`)
  const j = await r.json()
  const seen = new Set()
  return (j.items ?? []).map((it) => ({
    name: it.attributes?.brand?.name ?? it.attributes?.network?.name ?? '',
    home: (it.links?.brand ?? []).find((l) => l.rel === 'homepage')?.href
  })).filter((s) => {
    // The directory lists a station once per service; its website once is enough.
    const key = s.home?.replace(/\/+$/, '').toLowerCase()
    if (!key || !/^https?:\/\//.test(key) || seen.has(key)) return false // a website, nothing else
    seen.add(key)
    return true
  })
}

const cli = async () => {
  const arg = process.argv.slice(2).join(' ').trim()
  if (!arg) {
    console.error('usage: node scripts/find-nowplaying.mjs <station website | call letters or name>')
    process.exit(2)
  }
  const sites = /^https?:\/\//i.test(arg) ? [{ name: '', home: arg }] : (await websitesFor(arg)).slice(0, 5)
  if (!sites.length) { console.error(`No station found for "${arg}".`); process.exit(1) }
  let found = 0
  for (const site of sites) {
    let html
    try {
      const r = await get(site.home)
      html = await r.text()
    } catch (e) { console.log(`${shown(site.home)}  could not be read (${e.name})`); continue }
    const streams = streamsInPage(html)
    console.log(`\n${site.name ? `${shown(site.name)} — ` : ''}${shown(site.home)}`)
    if (!streams.length) { console.log('  no Cadence channel on this website; its titles, if any, are elsewhere'); continue }
    for (const s of streams) {
      found++
      console.log(`  ${shown(s.name) || '(unnamed stream)'}`)
      if (s.streams.length) console.log(`    stream:           ${s.streams.map(shown).join('  ')}`)
      console.log(`    now-playing address: ${shown(cadenceAddress(s.id))}`)
      console.log(`    on now:           ${shown(await onNow(s.id))}`)
    }
  }
  process.exit(found ? 0 : 1)
}

// The URL form of the path, not `file://` + the path: a space or a non-ASCII
// letter in it otherwise made the CLI do nothing, and exit 0.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await cli()
