# Installing OpenCloud Radio 1.2.3

The app is built from `source/` in one step, then copied into OpenCloud.

```
source/                      the app's source; step 1 builds it into source/dist/
deploy/csp.yaml              required policy change, see step 2
deploy/directory-check.html  tests directory reachability, see step 2c
deploy/haproxy-relay.cfg     optional, for http-only stations, see step 2b
deploy/relay-test/           tests the relay example with podman, see step 2b
docs/                        the directory plan, layout mockups
```

## 1. Build the app and copy it into place

Or skip the build: each release on GitHub
(<https://github.com/GaijinSystems/opencloud-radio/releases>) carries the
built app as `opencloud-radio-<version>.zip` and `.tar.gz`, each with its
`.sha256` (`sha256sum -c <file>.sha256` checks it).
Both unpack to `radio/`, the folder described below, so they go straight into
the apps asset path: `tar xzf opencloud-radio-<version>.tar.gz -C "$WEB_ASSET_APPS_PATH"`
(or `unzip -o -d "$WEB_ASSET_APPS_PATH" opencloud-radio-<version>.zip`). OpenCloud
7.2.5 or newer is required (README, *Install*).
When upgrading, remove the old `radio/js` and `radio/assets` first, as under
**Upgrading** below.

Build it with podman, which needs nothing else installed — from the
repository root:

```
podman run --rm -v "$PWD/source":/src:z -w /src -e RADIO_COMMIT="$(git rev-parse --short HEAD)" \
  docker.io/library/node:22-alpine sh -c 'npm ci --legacy-peer-deps && npm run build'
```

or, with Node 22 installed, `npm ci --legacy-peer-deps && npm run build` in
`source/`. Either way the app is `source/dist/`: a `manifest.json`, `js/` and
`assets/`. (`RADIO_COMMIT` only stamps the build with the commit it came from,
so a bug report can name it; leave it out and the stamp reads `unknown`.)

Copy the contents of `source/dist/` into a folder named `radio` in the apps
asset path, so that `radio/manifest.json` sits one level inside it:

```
$WEB_ASSET_APPS_PATH/radio/manifest.json
```

`WEB_ASSET_APPS_PATH` defaults to `$OC_BASE_DATA_PATH/web/assets/apps`, commonly
`/var/lib/opencloud/web/assets/apps`.

**There is no apps list to edit.** The web service composes the available
applications from its built-in ones plus everything it finds in that directory,
so an app directory containing a `manifest.json` is discovered automatically.
The `apps` list in the web configuration (`WEB_UI_CORE_APPS`) overrides the
*core* app set and is not where custom apps are registered.

Restart the OpenCloud web service and reload with a hard refresh. A **Radio**
entry appears in the application menu.

**Upgrading:** replace the build, not the folder. Each build names its files
anew, so remove the old ones first, then copy the new build over, from the
root of this repository and with `radio/` already in place:

```
apps="${WEB_ASSET_APPS_PATH:?set it to the apps path of the web service first}" &&
  rm -rf "$apps/radio/js" "$apps/radio/assets" &&
  cp -r source/dist/. "$apps/radio/"
```

A `config.json` of your own in `radio/` is kept; the build never contains
one. Then restart the web service and reload with a hard refresh, as above —
and any other tab still open on the old version too: an old tab writes its
own settings back when they change, over the new version's.

## 2. Allow audio from other hosts (required)

OpenCloud ships with `media-src: 'self'`, which blocks every internet radio
stream. Until this is changed the app installs and runs, stations save
correctly, and **nothing ever plays** — the browser console shows:

```
Content-Security-Policy: The page's settings blocked the loading of a resource
(media-src) at https://… because it violates the following directive: "media-src 'self'"
```

The policy comes from OpenCloud's **proxy service**, not from your reverse
proxy. Two environment variables control it:

| Variable | Behaviour |
|---|---|
| `PROXY_CSP_CONFIG_FILE_LOCATION` | Your file is **deep-merged** with the built-in default; lists are combined uniquely. |
| `PROXY_CSP_CONFIG_FILE_OVERRIDE_LOCATION` | Your file **replaces** the default entirely. |

Use the first. Because it merges, `deploy/csp.yaml` contains only the
media-src block — everything your identity provider, office integration and
other apps rely on stays untouched.

**If you already have a csp.yaml**, add the `media-src` entry to it rather than
pointing the variable somewhere new:

```yaml
directives:
  media-src:
    - "'self'"
    - 'https:'
```

**If you do not**, copy `deploy/csp.yaml` to somewhere the proxy can
read it and set the variable to that path.

Restart the proxy service, then verify **in a private window** — the old policy
is cached with the document, so an open tab keeps failing after the fix:

```
curl -sI https://cloud.example.org/ | grep -io "media-src[^;]*"
```

Optional directives, all commented out in `deploy/csp.yaml`: `img-src https:`
for station logos, and `connect-src` entries for what the app reads from other
hosts. Track titles are on by default but read nothing until `connect-src`
allows it — `https:`, since stations are any host (stations relayed under
your cloud's own hostname need nothing, and stations on hosts already allowed,
such as SomaFM's below, show titles too). **Find backup servers** and a pasted
playlist link read the station's playlist from its host: for SomaFM and
StreamTheWorld that is `https://somafm.com`, `https://*.somafm.com` and
`https://playerservices.streamtheworld.com`, all covered by `https:`. Without
them those lookups say what could not be read — and, for a playlist found for
the station or one a playlist leads to, its host (in the whole-list dialog,
where the stations share one). These are
instance-wide, not Radio's alone, and `csp.yaml` says what each gives up;
`connect-src https:` in particular lets every app on the instance send
requests to any https host.

## 2b. http-only stations — optional

A few stations have no https at all. Browsers refuse http audio on an https
page and there is no client-side fix, so such a stream has to be re-served over
TLS from a server of your own. `deploy/haproxy-relay.cfg` shows how, and why
OpenCloud's own proxy cannot do it for streams served at the server root.

**A relay serves someone else's plain-http content from an address your users
trust, so where it is served from matters.** Prefer a hostname of its own
(`radio-relay.example.org`): nothing it returns can then reach the cloud. If it
has to sit under the cloud's own hostname, keep the guard lines in each
backend of the example in full — they strip cookies and credentials from the
request, refuse any answer that is not plain audio, drop the response headers
that act on a whole hostname, and sandbox the response. They close the holes
that are known, which is not the same as a hostname of its own. Without them,
an origin that answered with a web page instead of a stream would have that
page run inside your OpenCloud, with the visitor's session. The path is
unauthenticated in either case, because an audio element cannot send a token.

If you change the guard lines, or move to another HAProxy version, run
`deploy/relay-test/run.sh` (podman only; the test runs on a network with no
way out, and only fetches its images the first time). It tests the example
in `deploy/haproxy-relay.cfg`, not your own HAProxy config, so make your
changes there first. It puts the example's own backend in front of an origin
that misbehaves on purpose and checks each promise above; every line should read PASS. One line reads KNOWN GAP: an
interim `103 Early Hints` answer is passed on by HAProxy as the origin sent it,
because the guard lines see only the final answer. Browsers act only on its
`Link` header, and only when the relay address itself is opened in a tab, but
it is one more reason to prefer a hostname of its own.

**It works for any origin that answers with an HTTP/1.x status line**, which
is every Icecast server. It does not work for SHOUTcast v1: that answers
players with `ICY 200 OK`, which HAProxy rejects, and answers a browser
User-Agent with its HTML status page rather than the stream. Check before you
relay:

```
curl -s -m 5 -D - -o /dev/null -A "Mozilla/5.0" http://host:port/ | head -3
```

`HTTP/1.0 200 OK` with an audio content type relays cleanly. `ICY 200 OK`, or
`text/html`, is SHOUTcast v1. A station with several relays usually mixes the
two — SLAY Radio's relay1 is SHOUTcast and its relay3 and relay4 are Icecast
(September 2026),
and its playlist says so — so pick the Icecast ones. If a station has only
SHOUTcast relays, the working approach is an Icecast server of your own in
relay mode: it accepts the ICY framing as a client and re-serves a proper HTTP
stream, and can add `Access-Control-Allow-Origin: *` so the spectrum analyses
that station.

**Then tell the app which streams you relay**, with the `relays` key (§3): one
line per relay, the stream's own address on the left, where you relay it on
the right — a path on the cloud, or an https address on a relay hostname of
its own. The script below writes it from your HAProxy config, so the two
cannot drift apart:

```
node source/scripts/relays-from-haproxy.mjs /etc/haproxy/haproxy.cfg [https://radio-relay.example.org]
```

```json
"relays": {
  "http://relay4.slayradio.org:8000/": "/radio-relay/slay4",
  "http://relay3.slayradio.org:8000/": "/radio-relay/slay3"
}
```

Stations then keep their own addresses — as their playlists, the directory and
every other player know them — and the app plays each relayed one from your
relay. A station added from the directory, imported from its playlist or
completed by **Find backup servers** works with nothing edited, and a server in
its playlist that you do not relay (SLAY's SHOUTcast relay1) is never tried:
it is kept after the ones that play, or left out by Find backup servers.
Lists stay usable in any other player. Moving a relay is a change to this
table, not to every list that names it. Stations entered the
old way, with the relay's own address, keep working.

Stations whose playlists list several relays keep working the same way: expose
each relay under its own path and list each in the table, and the player will
move between them as before.

A stream relayed under the cloud's own hostname is same-origin: its spectrum
is analysed rather than indicative, and its track titles are read through the
relay, with nothing more to set up (titles are on unless `metadataEnabled`
is turned off, or a user turns them off under Preferences › Playback). On a relay
hostname of its own, both need the cloud to be allowed to read the answer,
and titles need the browser's preflight answered, because reading them sends
a request header. The example carries the three lines for it, commented out,
in each relay backend; uncomment them in every one, with your cloud's address.
`deploy/relay-test/run.sh` tests the lines as shipped, switching them on in a
copy of the example; it does not test your own config. Titles there also need the
relay hostname allowed in `connect-src` (`https://radio-relay.example.org`, or
`https:` if you have opened it for titles already; see `deploy/csp.yaml`).
Without any of this the stream still plays.

Stations already entered with a relay's own address can be given theirs back:
**Find backup servers**, for one station or a whole list, offers it, and the
station still plays from the relay.

## 2c. Online directory search — optional

Off by default. To let users search radio-browser.info, set `directoryEnabled`
(§3) and add its hosts to the policy:

```yaml
directives:
  connect-src:
    - 'https://*.api.radio-browser.info'
```

The hosts are named rather than opening `connect-src` to all of `https:`,
because unlike audio the set is known. If you add other `connect-src` entries
(§2), put them all in this one block: a YAML mapping may hold `connect-src`
only once.

Verify with `deploy/directory-check.html`, served from your own origin. **curl
cannot test this** — it ignores the Content Security Policy, which is the part
most likely to block the request. Remove the page again once it has told you
what you needed; it is a test, not part of the app.

Two things to tell users: what they type is sent to a third party, and their
station lists are not. Reporting plays back to the directory is a second,
separate opt-in and requires `directoryReportClicks` as well.

## 3. Configuration — optional

**You do not need to create anything.** The defaults ship inside
`radio/manifest.json` and the app runs without further configuration.

If you do want to change something, there are two places. Both apply to the
whole server and every user — what each user may choose for themselves is in
the app's Preferences — and where both set a key, `config.json` wins:
**`config.json` > `apps.yaml` > the manifest**.

**In `apps.yaml`** — recommended: it sits with the rest of OpenCloud's
configuration, at `$OC_BASE_DATA_PATH/config/apps.yaml`, and no upgrade of
the app touches it:

```yaml
radio:
  config:
    rootFolder: Radio
    metadataEnabled: false   # titles are on by default; this turns them off
    defaultStations:
      - name: Groove Salad
        url: https://ice1.somafm.com/groovesalad-128-aac
        group: Ambient
```

**Or beside the app**, in a `config.json` you create next to the manifest at
`$WEB_ASSET_APPS_PATH/radio/config.json`. The app's own files never include
one, so installing a new build does not overwrite it — as long as the
upgrade replaces only the build (step 1), not the whole `radio/` folder:

```json
{
  "config": {
    "rootFolder": "Radio",
    "analyserEnabled": true
  }
}
```

Either file also accepts `disabled: true`, which stops the app loading without
removing it.

Do not edit `manifest.json` by hand — it is the app's own file and is replaced
on every upgrade. Use one of the two above instead.

### Keys

Every value is clamped, so a typo falls back to the default rather than
producing odd behaviour.

| Key | Default | Notes |
|---|---|---|
| `rootFolder` | `Radio` | Folder in the user's personal space holding station lists. |
| `settingsFolder` | `Settings` | Settings profiles, inside the root folder. |
| `backupFolder` | `Backups` | Copies of station lists, inside the root folder. Written before every change. |
| `backupKeep` | `5` | Starting number of copies to keep per list, 1–50. Users may change their own. |
| `defaultStations` | `[]` | Seeds a user's first list, once, on first launch. Never overwrites an existing list. |
| `reconnectAttempts` | `5` | Starting value for reconnect attempts, 0–10. Users may change their own. |
| `reconnectMaxDelayMs` | `16000` | 1000–120000. |
| `cacheBustOnReconnect` | `false` | Some Icecast setups reject unknown query parameters. |
| `metadataEnabled` | `true` | Track titles, from a station's now-playing address, its host, its status page, or its stream. Needs `connect-src https:`, except for stations relayed under the cloud's own hostname and those on hosts the policy already allows. Each user may turn them off under Preferences › Playback. For a public radio station's address, `node source/scripts/find-nowplaying.mjs <call letters>`. |
| `analyserEnabled` | `true` | Spectrum analyser. |
| `showLogos` | `true` | When false, no `img-src` entry is needed. |
| `maxPlaylistDepth` | `2` | Nested playlist resolution at import. |
| `maxStationsPerList` | `2000` | Guards against importing a directory dump. |
| `directoryEnabled` | `false` | Online directory search. Needs the `connect-src` entry in §2c. |
| `directoryServers` | `[]` | Override the mirrors; hostnames, optionally `host:port`, for a self-hosted directory. |
| `directoryReportClicks` | `false` | Whether users may opt in to reporting plays to the directory. |
| `directoryPageSize` | `50` | Results per request, 10–100. |
| `directoryMaxResults` | `500` | Cap per query, 100–2000. |
| `relays` | `{}` | The http-only streams you relay, and where: `{"http://host:port/path": "/relay-path"}`, or an `https://` address on a relay hostname of its own. See §2b; `source/scripts/relays-from-haproxy.mjs` writes it. A line that does not parse is dropped. |

## 4. Check it worked

1. A **Radio** entry is in the application menu.
2. Opening it creates a `Radio/` folder in your personal space.
3. Adding an `https://` station and pressing play produces sound.

Two things worth telling users once:

- A station's `.pls` or `.m3u` **link** can be pasted as its address where the
  station lets a page read it — SomaFM and StreamTheWorld did, measured in
  November 2026 — and its servers are kept as backups, up to ten. Elsewhere,
  download it and use **Import**: tick *One station on N servers*, and give
  the playlist's address there so the servers can be refreshed later. **Find
  backup servers** (in the station form, and for a whole list beside rename
  and delete) looks for a station's playlist by itself — given the
  `connect-src` entries in step 2.
- A station whose address starts with `http://` cannot play on an https site,
  unless you relay it and list it under `relays`. See step 2b.

If the app appears but nothing plays, it is step 2 — the app says so in the
player bar rather than retrying. Every failure is logged to the browser console
with a `[radio]` prefix and the stream URL.

## Uninstalling

Delete `$WEB_ASSET_APPS_PATH/radio/` and restart the web service. The user's
`Radio/` folder is ordinary playlist files and is left alone — remove it
separately if that is what you want.

## A note on quota

Every change to a station list writes a copy of the previous file to
`Radio/Backups/` first. The number kept per list is bounded, so the folder is
too: roughly *lists × copies* small files, a station list being a few kB.

`backupKeep` sets the starting number for your instance (1–50, default 5). It
seeds a device that has not stored the preference — a new user, a new browser —
after which it is the user's to change under Preferences › Storage. Raising it
later will not reach back into a choice someone has already made, and there is
no way to switch backups off entirely.

Pruning only removes files the app wrote, matched by name and timestamp, so
anything else a user keeps in that folder survives.
