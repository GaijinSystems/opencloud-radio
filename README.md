# OpenCloud Radio

An internet radio player for OpenCloud Web. Station lists are ordinary playlist
files in the user's own space; playback uses the browser's `<audio>` element.

**Demo:** [radio.gaijin.systems](https://radio.gaijin.systems) — the real app,
on stand-in services; your station lists stay in your browser.

Layout candidates are in
[`docs/mockups/`](docs/mockups/index.html) — number 11 is the one this
implements.

## Build

From `source/`:

```
npm install --legacy-peer-deps   # see note below
npm run build                    # -> dist/, with a build stamp in manifest.json
npm test                         # 524 tests, no server required
npm run check:types
```

`--legacy-peer-deps` is currently required: the OpenCloud packages pin peer
ranges that npm 10 will not resolve on its own. This is a workspace quirk, not a
compatibility problem.

The tests stand in for the server with an in-memory WebDAV. What that stand-in
assumes about a real server is written down in `source/scripts/dav-contract.mjs`; the
suite holds the stand-in to it, and you can hold your instance to it too:

```
OC_USER=alice OC_PASSWORD=… node source/scripts/dav-contract.mjs https://cloud.example.org
```

## Install

**Requires OpenCloud 7.2.5 or newer.** Version 1.2.2 was run against OpenCloud
7.2.5 (stable) and 8.1.0, 9.1.0 and 9.2.0 (rolling) in headless Chromium, each
a fresh installation, logged in for the first time, with `media-src` and
`connect-src` opened to `https:` and a local test station: the app loads, the
first "Add station" creates the `Radio/` folder and a list, the list is saved
and shows in Files, the station plays, and its title shows. On 6.0.0 that
first list is created but cannot be opened at once, so 6.0.0 is not
supported; no other versions were tried.

Download `opencloud-radio-<version>.zip` (or `.tar.gz`) from the
[releases](https://github.com/GaijinSystems/opencloud-radio/releases), or build
it (above, or with podman as INSTALL step 1 shows); either way the app is a
`radio/` folder for `$WEB_ASSET_APPS_PATH/radio/`. Apps in that directory are
discovered automatically — there is no apps list to edit. **OpenCloud's default
policy is `media-src 'self'`, which blocks every stream**; add `https:` to it
via the proxy service's CSP file — see [`deploy/csp.yaml`](deploy/csp.yaml).
Without it the app runs and nothing plays.

Full steps, including where configuration goes, are in
[`INSTALL.md`](INSTALL.md).

## Configuration

Defaults ship in `manifest.json`; nothing needs to be created. Override them
in `$OC_BASE_DATA_PATH/config/apps.yaml` under a `radio:` key (recommended: no
upgrade touches it), or in a `config.json` beside the manifest. Both apply to
the whole server; where both set a key, `config.json` wins, then `apps.yaml`,
then the manifest. Every value is clamped, so a typo degrades to a default
rather than to strange behaviour. See `source/src/config.ts`.

| Key | Default | Notes |
|---|---|---|
| `rootFolder` | `Radio` | Folder in the personal space holding station lists. |
| `settingsFolder` | `Settings` | Settings profiles, inside the root folder. |
| `backupFolder` | `Backups` | Copies of station lists, inside the root folder. |
| `backupKeep` | `5` | Starting number of copies to keep per list, 1–50. Users may change their own. |
| `defaultStations` | `[]` | Seeds the first list on first launch. |
| `reconnectAttempts` | `5` | Starting value for reconnect attempts, 0–10. Users may change their own. |
| `reconnectMaxDelayMs` | `16000` | 1000–120000. |
| `cacheBustOnReconnect` | `false` | Some Icecast setups reject unknown query parameters. |
| `metadataEnabled` | `true` | Track titles; each user may turn them off under Preferences › Playback. They read nothing until `connect-src` allows `https:`, except for stations relayed under the cloud's own hostname and those on hosts the policy already allows (such as SomaFM, once its entries for Find backup servers are in). |
| `relays` | `{}` | The http-only streams you relay, and where. See INSTALL §2b. |
| `analyserEnabled` | `true` | Spectrum analyser. |
| `showLogos` | `true` | When false, no `img-src` entry is needed. |
| `maxPlaylistDepth` | `2` | Nested playlist resolution at import. |
| `maxStationsPerList` | `2000` | Guards against importing a directory dump. |
| `directoryEnabled` | `false` | Online directory search. Needs a `connect-src` entry. |
| `directoryServers` | `[]` | Override the mirrors; hostnames, optionally with a port. For a self-hosted radio-browser. |
| `directoryReportClicks` | `false` | Whether users may opt in to telling the directory what they play. |
| `directoryPageSize` | `50` | Results per request, 10–100. |
| `directoryMaxResults` | `500` | Cap per query, 100–2000. |

## What it does

Station lists are `.m3u8` files in `Radio/` in the user's personal space (PLS
and XSPF are read too). Add, edit and reorder stations; import a playlist from
a file or pasted text; create, rename and delete lists; select several stations
to remove them, move them to another list or copy their addresses. Column
visibility and width, the list divider, volume and the last station are
remembered per device; named settings profiles can be saved to and loaded from
`Radio/Settings/` by hand. Nothing is translated; strings are English.

**Stations can have several servers.** A station's own playlist usually lists
the same stream on several machines, which is what makes it survivable when one
goes down. Import offers to keep them as one station with backups, and the
player moves to the next server immediately on failure, re-reads the playlist
when all of them have failed, and shows which server is in use.

**The spectrum is real where it can be.** Reading audio data needs the stream
routed through Web Audio, which requires the station's permission (CORS). Where
it is given the display is measured; where it is not, the strip shows
indicative movement while playing and a flat line when stopped. Volume is
applied after the analyser, so turning the sound down or muting does not change
what the display shows.

## Backups

**Every change to a station list writes a copy of the previous file first**, to
`Radio/Backups/` — saving an edit, renaming, deleting, and adding stations to
another list. The copy is of what was on the server, taken before the change,
and it is named for the list and the moment: `Favourites.2026-09-20T14-31-07-880Z.m3u8`.

If the backup cannot be written, **the change does not happen**. The banner says
so and your edit stays where it is, unsaved, rather than being written over
something there is no copy of.

**Five copies of each list are kept** — or whatever `backupKeep` says on your
instance; once a new one is made, older ones beyond that are removed. It is a
starting value, not a rule: change it under Preferences › Storage and your
choice sticks on that device, including if the instance default changes later.
It cannot be set to none, because a change is never made without a copy first,
so the most recent one always survives.

Pruning only ever removes files this app wrote: a name has to match the list it
belongs to *and* carry a timestamp in the exact form above. Anything else you
keep in that folder is left alone, including a file you name after a list
yourself. If the pruning fails the copy is still safe and the save still
happens — tidying up is not allowed to become a reason to refuse an edit.

Backups do not appear in the list rail: it shows files in `Radio/` itself, and
these are a folder down.

## Appearance

Radio has a theme of its own under Preferences › Appearance: Light, Dark, or
System, which follows OpenCloud's. It applies to Radio only — the rest of
OpenCloud keeps its own setting — and is available when the instance offers
both a light and a dark theme.

## Searching

The field in the header searches your lists: names, networks, groups, countries,
languages and stream addresses. `/` focuses it, Escape clears it. Results are
grouped by the list they came from and use whichever columns you have turned on.
Playing one leaves the results up, so you can try the next.

Search is deliberately a finder. There is no selection or reordering in results:
both belong to a list, and a result set drawn from several has no sensible answer
for either. Use "Open list" on a group header to go and edit.

### The online directory — optional, off by default

With `directoryEnabled` set, a third scope searches
[radio-browser.info](https://www.radio-browser.info/), a community-run directory
of tens of thousands of stations. Results play without being saved and can be
added to any list.

Two things worth knowing. The directory resolves playlists on its servers, so a
station that only publishes a `.pls` link arrives ready to play — that is the
fetch your browser is not allowed to make. And what you type goes to a third
party; your station lists never do. The preferences dialog says so, and an
instance that cannot accept it leaves the key off, which is the default.

It needs one policy entry: `connect-src https://*.api.radio-browser.info`. Test
it from your own origin with `deploy/directory-check.html` — curl cannot, since
it ignores the Content Security Policy.

## Stations that need deployment help

Two cases cannot be solved in the browser, and both are covered in
[`INSTALL.md`](INSTALL.md):

- **http-only stations.** Browsers refuse http audio on an https page. The
  stream has to be re-served over TLS from your own origin —
  [`deploy/haproxy-relay.cfg`](deploy/haproxy-relay.cfg) — and listed in the
  app's `relays` setting. Stations then keep their own addresses and play from
  the relay, however they were added.
- **A station that only publishes a `.pls`/`.m3u` link.** Reading that file is a
  cross-origin request, which some hosts permit — SomaFM and StreamTheWorld did,
  measured in November 2026 — and many do not. Where it is permitted, paste
  the link as the station's address and its servers are kept, up to ten. Where it
  is not, download it and use Import; relaying the file is optional and buys
  only automatic refresh of the server list.

## Backup servers

**Find backup servers**, in the station form and for a whole list (beside
rename and delete), looks for a station's own playlist and offers the servers
it lists that the station does not have yet. It finds the playlist from the
station's playlist address if it has one, from its host — SomaFM (choosing the
playlist of the station's own quality), StreamTheWorld — or, where the
administrator has enabled the online directory, from the station's directory
entry. A whole list is shown before anything changes; at most ten servers are
kept, the one playing first, and an http server you do not relay only if
there is nothing else. The playlist is kept as the
station's playlist address, so the server list is read again if every server
fails. A station entered with a relay's address (INSTALL §2b) is given its own
back, so its playlist can be matched; it still plays from the relay. The
playlists are read from the stations' hosts, so the site's policy has to allow
them (`connect-src`, INSTALL step 2); where it or the host does not, the
lookup says the playlist could not be read, not that there is none.

## Two things that will look like bugs

**A station plays but shows no spectrum.** Reading audio data requires routing
the stream through Web Audio, and doing that to a cross-origin stream without
CORS silences it outright. So the app probes once: if Web Audio works the
spectrum is real, and if it does not the strip shows indicative movement while
the station plays and a flat line when it stops. Playback is never sacrificed
for a visualisation.

**Track titles show for most stations, not all.** The app asks, in order:

1. the station's own **now-playing address**, if it has been given one;
2. the address its **host publishes titles at**, found from the stream's own
   address with nothing to configure — AzuraCast, Radio.co, Triton Digital
   (StreamTheWorld) and Zeno.FM;
3. the server's status page — **Icecast** `/status-json.xsl`, **SHOUTcast v2**
   `/stats?sid=1&json=1`;
4. the **stream itself** (ICY), by a brief connection of its own every half
   minute that reads up to the first title and closes.

A now-playing address can be any of those, NPR's **Cadence** service (public
radio stations such as KCUR, whose streams carry no titles), or SomaFM's song
feed. Only stations whose titles the app cannot find for itself need one,
which in practice means US public radio. The station form says how to find
it, and `source/scripts/find-nowplaying.mjs` finds it for you, from a station's
website or call letters:

```
node source/scripts/find-nowplaying.mjs KCUR
```

The app cannot do this lookup itself: of 45 public radio websites sampled in
November 2026,
37 carried the id and one allowed a page on another site to read it. What decides whether a title shows is mostly
whether the station lets a web page read it: measured in November 2026, every
source above allowed it for most of the stations sampled, and SomaFM allows it
on every channel. A station relayed under your cloud's own hostname can
always be read, if its stream carries titles. Not read: titles inside Ogg streams, which arrive only when a song changes, and
HLS metadata, since HLS does not play here. Titles are on by default, but
reading other hosts needs `connect-src https:` in the site's policy; until an
administrator adds it, only stations relayed under the cloud's own hostname,
and those on hosts the policy already allows (such as SomaFM, once its entries
for Find backup servers are in), show them.

## Mobile browsers

The app is written for desktop browsers and tested there. It plays in a
phone's browser too. How it answers the phone pausing playback itself —
headphones unplugged, a call, another app taking the audio — follows the
browser specifications: the station shows as paused, the stream is held 20 s
for the phone to resume it, and a tap starts it afresh. That part has not
been tried on devices.

## Licence

AGPL-3.0-or-later (version 3 of the GNU Affero General Public License, or any later version).
