#!/usr/bin/env node
/**
 * Regenerates tests/fixtures from nothing. Proven by wiping the directory: a
 * fixture that cannot be rebuilt is a fixture nobody dares to change.
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Beside this script, wherever it is run from: it wipes the folder first.
const dir = fileURLToPath(new URL('../tests/fixtures', import.meta.url))
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })

const files = {
  'plain.m3u8': `#EXTM3U\n#PLAYLIST:Plain\n#EXTINF:-1,Groove Salad\nhttps://ice1.somafm.com/groovesalad-128-aac\n`,
  'attributes.m3u8': `#EXTM3U\n#EXTINF:-1 tvg-logo="https://a/b.png" group-title="Ambient" tvg-country="United States" tvg-chno="7",Drone Zone\nhttps://ice1.somafm.com/dronezone-128-aac\n`,
  'bom-crlf.m3u': `\uFEFF#EXTINF:-1,No header\r\nhttps://example.com/stream\r\n`,
  'bare-urls.m3u': `https://a/1\nhttps://a/2\n`,
  'gaps.pls': `[playlist]\nNumberOfEntries=9\nTitle3=Third\nFile3=https://a/3\nFile1=https://a/1\nTitle1=First\nLength1=-1\n`,
  'orphan-title.pls': `[playlist]\nTitle1=Orphan\n`,
  'namespaced.xspf': `<?xml version="1.0" encoding="UTF-8"?>\n<playlist version="1" xmlns="http://xspf.org/ns/0/">\n  <title>Imported</title>\n  <trackList>\n    <track><location>https://a/1</location><title>One</title></track>\n  </trackList>\n</playlist>\n`,
  'manifest.m3u8': `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXTINF:2.0,\nseg1.ts\n`,
  'insecure.m3u8': `#EXTM3U\n#EXTINF:-1,WFMU\nhttp://stream0.wfmu.org/freeform-128k\n`
}

// A REAL capture from de1.api.radio-browser.info on 19 September 2026, trimmed
// to a few stations and the fields worth keeping. Not hand-written: the live response is what
// corrected two wrong assumptions in the mapping (a .pls `url` alongside an
// https `url_resolved`, and lowercase `language`).
files['directory-search.json'] = JSON.stringify([
  {
    "stationuuid": "960cf833-0601-11e8-ae97-52543be04c81",
    "serveruuid": null,
    "name": "SomaFM Groove Salad (128k MP3)",
    "url": "https://somafm.com/groovesalad.pls",
    "url_resolved": "https://ice2.somafm.com/groovesalad-128-mp3",
    "homepage": "https://somafm.com/groovesalad/",
    "favicon": "https://somafm.com/img3/groovesalad-400.jpg",
    "tags": "ambient,chillout,downtempo,groove,lounge,sleep",
    "country": "The United States Of America",
    "countrycode": "US",
    "state": "California",
    "language": "english",
    "languagecodes": "EN",
    "votes": 47594,
    "codec": "MP3",
    "bitrate": 128,
    "hls": 0,
    "lastcheckok": 1,
    "lastchecktime_iso8601": "2026-09-15T17:06:58Z",
    "clickcount": 150,
    "ssl_error": 0,
    "geo_distance": null,
    "has_extended_info": false
  },
  {
    "stationuuid": "960c7c81-0601-11e8-ae97-52543be04c81",
    "serveruuid": null,
    "name": "SomaFM Secret Agent (128k MP3)",
    "url": "https://somafm.com/secretagent.pls",
    "url_resolved": "https://ice5.somafm.com/secretagent-128-mp3",
    "homepage": "https://somafm.com/secretagent/",
    "favicon": "https://somafm.com/img3/secretagent-400.jpg",
    "tags": "ambient,downtempo,jazz,lounge,samba,sixties",
    "country": "The United States Of America",
    "countrycode": "US",
    "state": "California",
    "language": "english",
    "languagecodes": "EN",
    "votes": 35963,
    "codec": "MP3",
    "bitrate": 128,
    "hls": 0,
    "lastcheckok": 1,
    "lastchecktime_iso8601": "2026-09-15T18:05:47Z",
    "clickcount": 78,
    "ssl_error": 0,
    "geo_distance": null,
    "has_extended_info": false
  },
  {
    "stationuuid": "96394224-0601-11e8-ae97-52543be04c81",
    "serveruuid": null,
    "name": "SomaFM Indie Pop Rocks! (128k AAC)",
    "url": "https://somafm.com/indiepop130.pls",
    "url_resolved": "https://ice2.somafm.com/indiepop-128-aac",
    "homepage": "https://somafm.com/indiepop/",
    "favicon": "https://somafm.com/img3/indiepop-400.jpg",
    "tags": "indie,indie pop,indie rock",
    "country": "The United States Of America",
    "countrycode": "US",
    "state": "California",
    "language": "english",
    "languagecodes": "EN",
    "votes": 21155,
    "codec": "AAC",
    "bitrate": 128,
    "hls": 0,
    "lastcheckok": 1,
    "lastchecktime_iso8601": "2026-09-16T07:26:01Z",
    "clickcount": 74,
    "ssl_error": 0,
    "geo_distance": null,
    "has_extended_info": false
  }
], null, 2) + '\n'

for (const [name, body] of Object.entries(files)) {
  writeFileSync(join(dir, name), body)
}
console.log(`[radio] wrote ${Object.keys(files).length} fixtures to ${dir}`)
