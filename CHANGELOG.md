# Changelog

## 1.2.2 — 2026-11-17

The app is unchanged from 1.2.1; this is the first release built and published
by the repository's own workflow.

- **Each release on GitHub carries the built app**, as
  `opencloud-radio-<version>.tar.gz` with its `.sha256`, unpacking to the
  `radio/` folder INSTALL step 1 describes: no build is needed to install it.
- Every push to `main` is tested; a version tag also builds the release and
  rebuilds the demo site from the tagged code. `CONTENTS.md` says how to
  release. A release's files are the same each time they are built: its
  manifest records the commit's time as the build time.

## 1.2.1 — 2026-11-16

Fixed

- **A station logo that would not load left a broken or empty tile**, in the
  list and in the player bar. Its initials are shown instead, as for a station
  with no logo, and a different logo given to it later is tried afresh. Logos
  come from playlists, the online directory and hand entry, and an address
  that has since gone is common. Once an address has failed it is not asked
  for again, by a row drawn anew or another station sharing it, until the
  browser comes back online or the page is reloaded.
- 524 tests, from 521.

## 1.2.0 — 2026-11-16

A seventh pass over the whole tree, and an eighth over what was added after
it: a quality pass, then independent reviews for bugs and for security, each
fix reviewed again by a reviewer who had seen none of the earlier findings,
and in the eighth, every fix from the second change on checked by breaking
what it guards.

**The repository no longer carries a built app.** Build it from `source/` in
one step (INSTALL step 1, with podman or Node 22), then copy `source/dist/`
into the apps asset path as before. `app/radio/` and `SHA256SUMS` are gone; a
build in a container can stamp its commit through `RADIO_COMMIT`.

Added

- **Relayed stations keep their own addresses.** A new `relays` setting lists
  the http-only streams the administrator relays and where (a path on the
  cloud, or an https relay hostname). A station stays
  `http://relay4.slayradio.org:8000/` in its list, as its playlist and the
  directory know it, and is played, and its titles read, from the relay. So
  SLAY Radio added from the directory, imported from its own playlist, or
  completed by Find backup servers plays with nothing edited; a server in its
  playlist that nobody relays is never tried (kept last, or left out by Find
  backup servers); and lists stay usable in other
  players. Entries are checked one by one, and one that could point a stream
  off the cloud or at plain http is dropped. `scripts/relays-from-haproxy.mjs`
  writes the setting from the HAProxy config, so the two cannot drift; it
  reads the shipped example back to exactly the table INSTALL shows.
- **Track titles from a relay on a hostname of its own.** Reading titles
  sends a request header, so the browser asks first, and the relay's
  GET-only guard refused it: titles silently never appeared for the setup
  INSTALL recommends. The HAProxy example now carries three commented lines
  that answer that question for the cloud alone and let it read the answer.
- **Converting stations entered with a relay's address.** Find backup servers,
  for a station or a whole list, gives such a station its own address back
  from the `relays` table — it still plays from the relay — so its playlist
  and directory entry can be matched against it.
- **"https only" in directory search keeps stations the cloud relays.** With
  relays configured, the filter is applied in the app as "plays here", and
  the next page starts after every row the directory gave, shown or not.
- **Track titles from the stream itself.** Most stations weave the current
  title into their stream (ICY); where a station lets a page read it, the app
  now does, by a brief connection of its own every half minute that reads up
  to the first title and closes. Playback is never involved, so a failure
  here cannot stop the sound. Measured in November 2026: every SomaFM channel,
  MP3 and AAC, and SLAY Radio through the relay. A title encoded twice by the
  station's own software (SLAY's "WalldÃ©n") is put right. Before, titles
  were read only from `/status-json.xsl`, which none of SomaFM, SLAY Radio
  or KCUR answers.
- **A now-playing address per station**, for stations whose stream carries no
  titles: NPR's Cadence service, which public radio stations such as KCUR
  publish through, an Icecast status page, or SomaFM's song feed. Set in the
  station form, kept in the list as `radio-nowplaying`, https only. Cadence
  says when a piece ends, and the app asks again just after it does.
- **Titles from the hosting services, found automatically.** For a station
  on AzuraCast, Radio.co, Triton Digital (StreamTheWorld) or Zeno.FM, the
  address its host publishes titles at is worked out from the stream's own
  address. SHOUTcast v2's status is asked as Icecast's is. Every format was
  built from real answers and checked against live stations in November 2026: 17 of 20 gave a
  title a page may read, the misses being a station with its API switched off,
  a mount with no feed, and a station between tracks. A Triton track that
  ended long ago is the feed gone quiet, and is not shown as playing.
- Not read, on the evidence: titles inside Ogg streams. Of twelve sampled in
  November 2026,
  none carried a title in the headers a new connection receives.
- **Finding a public radio station's now-playing address.** Its Cadence
  channel appears nowhere in the stream address, only on the station's own
  website, which the app may not read (37 of 45 sampled in November 2026
  carried it; one let
  another site read it). The station form now says how to find it by hand, and
  `scripts/find-nowplaying.mjs` prints it from a station's website or call
  letters, with what is on now to confirm it.
- **Find backup servers**, for one station in its form or a whole list at
  once: the station's own playlist is found — from its playlist address, from
  its host (SomaFM, choosing the playlist of the station's own quality, and
  StreamTheWorld), or from its directory entry where the directory is enabled
  — and the servers it lists are offered, at most ten, the one playing kept
  first. A whole list is shown before anything changes. The playlist becomes
  the station's playlist address, so the list is read again when every
  server fails. Checked against live stations in November 2026: every SomaFM
  channel gained
  its other two servers in its own quality; Radio 538 and KUOW nine each.
  A stream served from its server's root (SLAY's relays) is matched by its
  host too, not taken as the same stream as every other root-served one.
- An `http://` playlist link is asked for over https first: a secure page may
  not fetch http at all, and the directory lists many by their old address.
- SomaFM's playlists, which the 1.0.0 plan recorded as unreadable from a
  page, now are; pasting one as a station's address keeps all three servers.
  A pasted playlist keeps at most ten, each once and those that play here
  first, as everywhere else.
- The lock screen and the system's media controls show the track as well as
  the station.

Changed — defaults

- **Track titles are on by default**, for the administrator
  (`metadataEnabled: true`) and for each user ("Show track titles" under
  Preferences › Playback). With both off by default, an administrator who had
  opened the site's policy for titles still left every user to find a
  checkbox, and titles looked broken. Every preference is saved whenever any
  one changes, the "off" default for titles with them, and before 1.2.0 the
  saved settings carried no version to tell a default from a choice; so on a
  device that used an earlier version, a stored "off" is set aside once and
  titles come on; a user who had turned them off deliberately turns them off
  again, and that choice then stands. (Settings profiles saved earlier still
  carry "off", and loading one applies it. A tab left open on an earlier
  version can write its old settings back over the new ones; reload every
  tab after upgrading.) Titles read nothing until the site's `connect-src`
  allows `https:`: until then each source a station has is tried once a
  session and left, and only stations relayed under the cloud's own hostname,
  or on hosts the policy already allows (SomaFM's, with its entries for Find
  backup servers), show titles. `metadataEnabled: false` turns them off.
- INSTALL no longer calls `config.json` "for this instance only": it and
  `apps.yaml` both apply to the whole server, `config.json` winning, and
  `apps.yaml` is the one no upgrade can touch. Upgrading replaces the build's
  files, not the `radio/` folder, so a `config.json` there is kept.

Fixed — playback

- **Find backup servers said "nothing found" when it had not been allowed to
  look.** A page is told the same — nothing — whether a host forbids other
  sites to read it, the site's own policy forbids the request, or the host is
  out of reach, and OpenCloud's default `connect-src` allows none of the
  hosts it reads from. It now says the playlist could not be reached or read
  and names the reasons (not when the browser knows it is offline). The same
  is said for the playlist read again when every server has failed, which was
  silent, and for a station address given as a playlist link. Each refusal is
  named as what it was — the station's playlist, a playlist found for it, one
  either leads to, the online directory, or SomaFM's channel list — with its
  host where the site's policy may need it. The whole-list dialog sums up
  several stations by kind, naming the host where they share one, and names
  the station where one was refused. INSTALL and `deploy/csp.yaml` list the
  hosts the app needs (`somafm.com`, `*.somafm.com`,
  `playerservices.streamtheworld.com`, or `https:`).
- **http playlist addresses from an https page.** One is asked for over https
  first and never over http, which the browser would block. Refused, or
  answered over https with something else (an error, or a page), it is said
  as such, with its being http as the reason the site's policy cannot fix —
  in the station form, the player and the whole-list dialog, for the
  playlist's own address or that of one it leads to. A pasted link of this
  kind used to say nothing.
- **Playlist links, read and saved.**
  - A link that could not be read no longer blames the station (it did even
    after a 404); lookups switched off (`maxPlaylistDepth: 0`) are said as
    such; and a refused `.m3u8` is said as possibly an HLS stream, which
    would not play here in any case.
  - A playlist that lists only playlists has them read in turn, up to three,
    the first giving streams the answer — eight requests at most for one
    playlist link, and none for an address already read on the way. A
    playlist link is never saved as a station's server — when adding a
    station, when its playlist is read again, or by Find backup servers —
    and one listing nothing else says so. An HLS manifest it lists is kept
    as a stream.
  - Streams saved from a playlist that will not play here say why: http
    nobody relays, HLS (whatever its scheme), or both. "Saved…" is said only
    once the station is saved, not before a save that then fails.
  - A playlist link is told by its path, or by a file its query names under
    `file`, `url` or `playlist` (`tunein.php?file=station.pls`): a fragment no longer keeps it from
    being read, and a stream with `.m3u` alone in its query
    (`listen?type=.m3u`) is no longer read as one. An address with a user
    name or password in it is not asked for, rather than blamed on its host.
- **After the playlist was read again, the row no longer knew its station.**
  The player went on with a copy whose address was the new first server; when
  the list did not take the new servers (read-only, or another row's
  address), the row neither showed it playing nor stopped it, and its button
  started the dead address again. The station stays itself now; the new
  servers belong to that play. Whenever the open list or the server playing
  changes, the player finds its row again — the same row, a row with its
  address (so a rename shows), a row it has been, a row whose address is the
  server playing, or the one row listing that server — the last three only
  in the list the play belongs to (the one it started from, or found its own
  row in; still after a rename, no longer after a delete), since elsewhere a
  station sharing a backup is another station — and goes on as it, on the servers it is playing from,
  with what is remembered (last played, the station to resume) following it — after the playlist was read
  again, Find backup servers, the station form putting another server first,
  or a reload after a refused save, each of which used to leave the row's
  button starting the stream again instead of stopping it. Servers a secure page can play come first, and the
  list is only rewritten with one of them first: a playlist that listed an
  http server first used to leave the row marked blocked, its button off.
- **A stream that played for a moment and dropped reconnected about twice a
  second for as long as the tab was open**, and never gave up: every brief
  play reset the back-off. A stream now counts as recovered only after 30 s
  of playing, counted once per round so brief rebuffers on a flaky link do
  not restart it, and settled only once it is playing again if the time ran
  out in a stall; until then the waits grow and the player stops as
  configured.
- **A pause the player did not make** — headphones unplugged, another app
  taking the audio, a phone call, a browser's own controls — left the bar
  saying "playing" over silence. The station now shows as paused ("Tap to
  resume") at once, and the stream is kept, paused, for 20 s: the system
  resumes short interruptions by itself (a call ended, a voice assistant
  done), and on Android the media notification and a headset's play button
  only reach a player still there. After that the connection is closed; a tap
  or the system's play button starts the station afresh at the live point,
  not minutes behind from the buffer. A pause while connecting or waiting to
  reconnect counts too: ignored, the retry already armed started the stream
  again by itself — as did a load failing during the 20 s, which is now let
  go with the station still paused.
- A stall that got one more packet and then went silent left the bar saying
  "playing" for ever; the stall watch now counts from the last byte, and a
  stall is given a minute of silence in all however many stray bytes or
  blips of sound arrive in it, and is over once 10 s of sound have come in
  it — so a near-silent link is one long stall and gives up as configured,
  rather than counting each blip as recovered, while a marginal one that
  plays nine seconds in ten counts as playing.
- A now-playing source that answered and then sent nothing held every source
  after it until the station changed; each now has ten seconds.
- **A relayed station could lose its relay when every server failed.** The
  player re-reads a station's playlist address once before giving up, and
  saves what it lists. For a station played through this cloud's relay
  because it has only http servers (SLAY Radio, say) whose playlist address is
  still the station's own file, that swapped the working https relay
  addresses for http servers a secure page refuses as mixed content. A station
  whose servers all play here now takes only servers that play here (https,
  or http this cloud relays) from a re-read playlist, and one that lists none
  changes nothing.
- **On a new device, a station that refuses cross-origin access was reported
  as blocked by the site policy**, and never tried without it. Its refusal
  arrives with the same error code as a policy refusal, and the policy check
  ran first; with the spectrum on, as it is by default, that was every new
  user on every such station. The station is now retried plainly first, and
  only a plain load that is refused too is taken for the policy.
- **One failed connection was counted twice.** A failed load is announced by
  an `error` event and then by the rejected `play()` promise, and when the
  first ended in a back-off the second was acted on as well. A dead station
  got about half the reconnect attempts it was set to; a station with two
  servers spent all of them at once, with no delay between.
- **A station with an https server and an http backup never reconnected.**
  When its stream dropped the http backup was picked as "the next server",
  found unplayable, and the station was failed under "None of the 2 servers
  for this station can be opened".
- Choosing a station that cannot play left the previous one playing, with no
  Stop button. A server list that arrived after a stall had mended itself
  restarted a stream that was playing.

Fixed — station lists

- **Adding to a list that changed elsewhere meanwhile** showed "Request failed
  with status code 412". It is merged into what the list holds now, once, and
  said in a sentence if it keeps changing.
- **A save whose answer named no version** made the next save look like a
  conflict, which reloaded the edit away. The file is read back for it, and
  so is an addition to another list whose save landed but whose answer was
  lost — reported as a failure, a move had left the stations in both lists.
- Combining an import into one station keeps at most ten servers, each once
  and those that play here first, as everywhere else, and keeps the first
  entry's own backups among them.
- Moving rows into a full list no longer drops a second row of the same
  stream (a hand-edited file) from this one when the other list took neither.
- **An edit made while another list was loading was dropped**, and the list
  just opened was then rewritten unchanged. Of two lists clicked in a row, the
  one whose answer came last was shown, not the one asked for last.
- **A copy just made could be the one pruned.** If the backup folder held
  copies stamped later than now — another device, its clock ahead — the new
  copy sorted as the oldest and was removed, and the list was then changed
  with no copy of what it had been.
- **A save that had landed could be reported as failed.** The client's write
  is a PUT and then a request for the new etag; when only the second failed
  the next save drew a conflict and was reloaded away as a change "somewhere
  else". The file is now read back before a failure is declared.
- A failed delete marked unsaved edits as saved. Importing "into the current
  list" with no list open said "N added" and kept nothing. Renaming doubled an
  extension typed with the name, refused a change of case alone, and left the
  page heading on the old name (a new list no longer writes its name into the
  file as a `#PLAYLIST:` title). Two backups made in the same millisecond
  collided. A refreshed server list was saved, and a backup spent, when
  nothing in it had changed.
- **One rule for what may join a list**, applied by every way in: one row per
  stream address, counting duplicates inside the batch itself, and no more
  than `maxStationsPerList`. A move into a full list now leaves behind, still
  selected, what the other list had no room for; before, the form, an add from
  the directory and a move were not capped at all, and nothing looked for a
  duplicate inside the batch being added.
- **Every edit goes through one door.** A read-only list refuses all of them
  in the store rather than by the interface hiding the control, and an edit
  schedules its own save instead of relying on the caller to ask for one.
- The State column is worked out where a row is drawn, so a search result, an
  imported station or a list reloaded after a conflict reads "Ready" when the
  device has played it, as an opened list already did.

Fixed — files from elsewhere

- **Combining an imported playlist into one station** kept playlist links it
  listed as servers, and with ten or more of them could leave out a stream
  listed after them; they are left out first. Saving a playlist link in the station form had the same fault, and
  is fixed the same way.
- **A long `#EXTINF` line could freeze the tab.** The attribute pattern was
  retried from every offset of a run of characters with no `=` in it: ten
  seconds for a 100 kB line, in a file that may be opened at launch. Parsing
  is linear now. A file over 8 MB is not opened as a station list at all.
- Attributes on the `#EXTM3U` line, an `#EXTINF` overtaken by another, and the
  attributes of a dangling last `#EXTINF` are carried through a save.
- Import's "one station on several servers" lower-cased the name it combined
  under, and took any trailing number for a server index, so "BBC Radio 1" and
  "BBC Radio 2" were offered as one station.
- XSPF logos must be https, as in every other format. A directory answer with
  a field of the wrong type no longer reaches the file.

Security

- **A hostile now-playing answer could freeze the tab.** The reader of Triton's
  XML backtracked on an answer of endless spaces with no end tag: 4 000 took
  15 s, a few thousand more never finished, and the whole OpenCloud tab hung
  with it. It now finds each property by search rather than by pattern, so no
  answer costs more than reading it once, and a CDATA title with a `]` in it
  is read whole, an empty property is empty rather than the next one, and
  `&amp;` is `&`; `tests/redos.spec.ts` holds the inputs. Only with track
  titles on.
- **A relay path could climb out by being encoded.** `..` was refused in the
  `relays` setting but `%2e%2e`, which a URL parser reads the same, was not.
- **The relay example strips more of what an origin could say about the
  cloud's hostname** — `Alt-Svc`, `Link`, the origin's own CORS headers — and
  says nothing is to be cached; matches the whole content type, not its first
  characters (`audio/x text/html` passed); and tells the station neither the
  cloud's name nor a forwarded address the visitor sent. One gap it cannot
  close is now stated: HAProxy passes a `103 Early Hints` on as it came.
- `find-nowplaying.mjs` prints nothing a website sends that could drive the
  terminal (control characters), and follows only web addresses.
- **`deploy/haproxy-relay.cfg` served a third party's plain-http answer from
  inside the OpenCloud origin**, outside OpenCloud's own policy, with the
  visitor's cookies forwarded. It now recommends a hostname of its own, and
  each backend carries guard lines for when that is not possible: GET only, no
  cookies, credentials or referrer forwarded, one `audio/…` content type and a
  plain 200 or nothing, no response headers that act on the whole hostname,
  and a sandboxing policy. Checked with HAProxy 2.4 and 3.0. **If you deployed
  the earlier example under your cloud's hostname, replace it.**
- **Stream addresses are no longer kept on the device with their credentials.**
  "Last played" and the last station are stored under the address without
  userinfo or query, plus — only when it had either — a short one-way hash of
  the whole of it, so `?sid=1` and `?sid=2` stay two stations and a token is
  never stored. What was stored before is rewritten on first load. A station
  whose token changes starts its history again.
- A station's own playlist is fetched without cookies or a referrer, for at
  most ten seconds and one megabyte. Media Session artwork follows the logo
  setting. Administrator default stations carry named fields only.
- `deploy/csp.yaml` says what `img-src https:` and `connect-src https:` give
  up for the whole instance.

Changed

- **Backups are made by the server.** A save asked for the whole list and sent
  it back as the copy before sending it again as the save; the server now
  copies the file itself (`COPY`). If that fails for any reason the copy is
  made the old way, and only that way decides whether there is a backup.
- Search works its results out when typing pauses rather than at every key.
- **The spectrum strip no longer rebuilds its drawing surface every frame**
  at 125 % or 150 % display scaling, and a station starting or stopping
  redraws two rows of the list, not all of them.
- **The relay example also removes `X-Forwarded-Host`, `X-Forwarded-Proto`
  and what a proxy or CDN in front commonly adds (`X-Forwarded-Server`,
  `-Port`, `-Ssl`, `Via`, and the client-address headers CDNs use)**, so neither
  the cloud's name nor the listener's address reaches the station that way;
  the relay test checks it.
- **Long lists and large result sets are drawn 200 rows at a time**, the next
  batch as the end of the last scrolls into view, with "Show all" for the
  keyboard and for the browser's own find, which only sees what is drawn.
  Select-all still selects the whole list.
- Track titles switched on or off take effect at once, not at the next
  station, and follow the player to the server a failover moved it to.
- **A list deleted elsewhere while it is being edited is written back** with
  the edit, rather than the edit being thrown away with a reload of a file
  that no longer exists. A list changed elsewhere is still a conflict.
- "This list is very long, so only the first N stations are shown" is drawn
  as information, not in the error colours.
- Old backups are pruned after the change they were made for, and deleted
  together rather than one after another: a save no longer waits for them.
- Search keeps itself current from the file listing and re-reads only a list
  that changed, where it used to re-read every list after each add or move.

Deployment

- **`deploy/relay-test/`** tests the relay example end to end: its own
  backend lines in a real HAProxy, in front of an origin that misbehaves on
  purpose, asked by a client that plays the visitor's browser. Podman only.
  It passes on HAProxy 2.4 and 3.0; the example as shipped in 1.1.9 fails 17
  of the 23 checks it had then. It also checks that track titles pass through
  the relay, and (42 checks now) that the optional CORS lines for a relay on
  a hostname of its own answer the cloud's preflight and nobody else's, and
  let the cloud read titles, while still refusing everything but GET.
- **`scripts/dav-contract.mjs`** states, as HTTP, everything the app relies on
  a WebDAV server to do, and checks a server against it. The test suite holds
  the in-memory server to the same contract; run it against your instance and
  the tests' assumptions are confirmed against your server.

Tests

- The WebDAV mock applies the client's own preconditions (`If-Match`, and
  `If-None-Match: *` when there is no etag), and knows `COPY`. Against it one
  existing test turned out to pass only because the mock was lenient.
- Tests that exercised a copy of the code now import the code; two that could
  not fail were fixed. Each new test was run against the code without its fix.
- `App.vue` has tests of its own, mounted against the in-memory server: first
  launch, import, a move into a full list, duplicate refusal, a read-only
  list, and what the device stores of a stream address.
- The WebDAV mock, the fake audio element and the mount helper are shared
  modules under `tests/support/`, and the tests import the code statically.
- Every player test and every app test also checks that the player made no
  move outside its transition table; removing a move the player really makes
  from the table fails the suite.
- The race tests run on fake timers, at exact simulated moments, rather than
  on real sleeps.
- 521 tests, from 203.

Internals

- **One rule each, after a quality pass.** Whether this page can play an
  address (`playsHere`), which servers a station keeps (`stations.ts`: at most
  ten, each once — now for a re-read playlist too, which could write a
  StreamTheWorld fleet of a hundred into a list), what makes two rows one
  stream (`streamTaken`, which also sees a row entered with its relay's
  address as the station it is), and how a third party is asked
  (`helpers/fetch.ts`: anonymous, uncached, no referrer — now for the
  directory too). Find backup servers asks each source only when the ones
  before it found nothing, so the directory is not sent a station's name when
  its own playlist answered, and SomaFM's channel list is asked for once per
  run rather than once per channel. Table rows work out their address's
  verdict once rather than on every redraw; an unchanged title no longer
  redraws the system's media controls; a save no longer replaces the listing
  twice. The store's second debounce (`saveSoon`), dead since edits schedule
  their own save, is gone.

- **The player is an explicit state machine.** Every change of state goes
  through one function that checks it against a table of allowed moves, and
  everything belonging to one play — its servers, which were tried, the
  back-offs spent, whether its playlist was re-read — is one object made new
  for each play, so a new play cannot inherit a field nobody reset. A failed
  load is acted on by the element's `error` event alone; the `play()` promise
  answers only for the one outcome with no event, a refusal without a gesture.
- **One way to write a file.** The etag spelling, the folder repair and the
  note of what was written are in one function rather than at five call
  sites. A folder is made when a write finds it missing, not in advance and
  not by remembering it was once there.
- **One way to read a playlist**, whatever its format, ending in the URL gate
  for every station; Import, opening, searching, appending and the server-list
  refresh all use it.
- **One table of preferences**: each key's default, how storage may set it,
  and whether and where it travels in a profile, where each key used to be
  written out four times. The volume and the list divider have one owner, the
  preferences, and the player reads its level from there.
- Column widths are read by a component of their own, so dragging a column
  edge no longer re-renders the table; rows are styled by class, not by
  per-render style objects; a search row is told it is one.
- One logo tile, one play icon, one close-on-outside-click rule, and one set
  of panel, input and notice styles, where each was written two to four times.

## 1.1.9 — 2026-09-20

Fixed

- **The 1.1.8 rebuild could not save at all.** Every add, edit and import
  ended in "This list changed somewhere else, so your edit was not saved" and
  a reload that threw the edit away. The rebuild's etag normalisation sent the
  tag to the server as `If-Match` without its quotes, and the server compares
  the header to its own tag exactly. An entity-tag is a quoted string (RFC
  7232); it is kept bare inside the app for comparison and quoted on the wire.
  Reported from a live instance within hours of the rebuild. If you installed
  the second 1.1.8 build (manifest stamp `94f518c`), install this.
- The reasoning that let it ship: the review inferred from OpenCloud's own
  editor that a bare tag is accepted, having read its save and missed the
  `412 → re-read → retry` loop directly beneath it that makes the bare tag
  work there.

Tests

- The WebDAV mock now compares `If-Match` exactly, quotes included, as the
  server does. Against the 1.1.8 rebuild's store it fails every save path,
  which is the symptom reported; one new test also asserts the header's form
  for both spellings the client hands out.
- 203 tests, from 202.

## 1.1.8 — 2026-09-20

Rebuilt the same day, at the same version, after a sixth review pass over the
whole tree. Twenty findings, two of them reproduced before being fixed.
Nothing about installation changes.

Fixed in the rebuild

- **Two saves close together could lose the second edit.** A save is four
  requests (the backup's read and write, the prune, the write itself) and the
  debounce is 800 ms, so on a slow connection a second save could start while
  the first was still writing. It carried the etag the first was about to
  replace, was refused as a conflict, and the app answered a conflict by
  reloading the list — which discarded the newer edit under a banner blaming a
  change "somewhere else". Writes now run one at a time, in order; the second
  waits for the first and takes its fresh etag. Reproduced with a slow mock
  before the fix; the same test now passes. A delete or a list switch likewise
  waits for a write in flight instead of overtaking it.
- **The Columns menu's Reset reset everything.** It sat under "Show these
  columns" and read "Saved on this device", and it put back the theme, the
  reconnect count, the backup count, the volume and the remembered list along
  with the columns. It now resets columns and their widths only, and says
  "Reset columns". Preferences' "Reset to defaults" still resets everything,
  and now also tells the player, so the volume slider follows rather than
  jumping on the next reload.
- **A settings profile could reach into every object on the page.** A section
  named `[__proto__]` in a profile file wrote its keys onto
  `Object.prototype`; `[constructor]` wrote onto `Object`. Profiles are the one
  file this app expects people to carry between machines. The INI reader now
  builds its tables without a prototype, and applying a profile checks for the
  app's own column and width names rather than anything an object inherits.
  Reproduced before the fix.
- **The cross-list search re-read every list, every time.** The read cache
  compared an etag from a listing (which the client hands out without its
  quotes) to one from a download (which keeps them). They never matched.
  Etags are now normalised where they enter the store; the shell itself sends
  the same form, so the conflict check is unaffected.
- **A blocked station played from the bar lost its "Blocked" badge.** Resume
  selects the last station on load, and the bar's button plays it whether or
  not the row's is disabled. The failure then read "No response" and the row's
  button came back. A structural verdict now survives a failed attempt.
- **Switching the spectrum back on mid-play did nothing until the next
  station.** Only the off direction was handled. It now attaches to whatever
  is playing.
- **A created or renamed list whose name was taken in another tab** reported
  the client's "Request failed with status code 412". It says the name is
  taken, and refreshes the rail.
- **Track titles were asked of the station's first server**, not the one
  playing, so a station on its second server asked a dead machine. And one
  malformed entry in the server's answer threw the whole answer away and
  marked the station unavailable for the session. Both fixed.
- **The `/` shortcut focused the search field behind an open dialog.** Ignored
  while a dialog is up.
- **Narrow layouts had no way to make a list**: the button lived in the rail,
  which narrow hides. There is one beside the list picker now.
- **Importing into a new list ignored the per-list cap** that importing into
  the current list applied. Same cap, same message, both ways.
- **Converting a .pls or .xspf renamed its title** to the filename. The
  original `#PLAYLIST:` title is kept.
- **"Add to list → New list…" dropped the station.** The list was created and
  the station had to be found again. It is added to the new list.
- **The profile-saved message showed the name typed**, not the name the file
  was given when the typed one held a character a filename cannot.
- **The station form saved the address as typed** after validating a
  normalised form of it; the two differ when the address holds a space. It
  saves what it validated, as the backup-servers field already did.
- **M3U logos accepted `http://`** while the form, the directory and the
  administrator's defaults all required `https://`. An http image on an https
  page is blocked by the browser anyway. One rule now.
- **Failures were logged with the client's whole error object**, which
  carries the request that was made and its Authorization header. The console
  gets the status and the message.
- Removed: a `startedAt` the player wrote and never read, an `invalidate` the
  store exported that its callers made redundant, a `load` the preferences
  returned that nothing called, and a `width` on each column entry that
  duplicated `DEFAULT_WIDTHS` and was read nowhere.

Documentation, after the rebuild

- **`deploy/haproxy-relay.cfg` and INSTALL §2b were wrong about SLAY Radio.**
  Both said its relays answer HTTP/0.9 and cannot be relayed through HAProxy,
  and the example pointed at `relay2`, which no longer resolves. Checked
  against the live relays: relay1 is SHOUTcast 1.9.8 and cannot; relay3 and
  relay4 are Icecast 2.4.4 and relay cleanly in `mode http`, verified end to
  end through a real HAProxy. The config now uses those two, and the
  instructions say how to tell the kinds apart before relaying.

Tests, in the rebuild

- The WebDAV mock now spells etags the way the client does (stripped from
  listings and write results, quoted in download headers) and can make a
  write take time. Both of the reproduced findings were invisible to a mock
  that agreed with itself.
- 202 tests, from 181.

Fixed

- **"Not played yet" sat beside "Last played 1 min ago".** The Last played
  column is kept on the device and survives a reload; the State column is
  session memory and does not, so after every reload it fell back to the
  address-only verdict and contradicted the column next to it. A station this
  device has played now opens as Ready. A structural verdict still wins:
  history cannot make an http address or a playlist link playable in a
  browser. Visible in a screenshot from a live instance.
- **A folder removed under the app wedged writing until the page was
  reloaded.** 1.1.7 fixed this for `Radio/Backups/`; `Radio/` itself had the
  same never-revisited flag, and the backup recovery could not help because
  its own folder could not be created either. Every write — saving a list,
  creating one, appending to another, writing a backup or a settings profile —
  now puts its folders back and tries once more. A refusal that is not a
  missing folder, such as a name already taken, is still a refusal.

Tests

- **The components have tests.** Eleven of twelve had none, which is what let
  the 1.1.6 theme regression through: its helper was proved correct in
  isolation while the page it produced was never looked at. 42 new tests cover
  the table and its rows, both column menus, the preferences, search, list,
  station-form, player-bar, dialog and import components, `useNowPlaying`, and
  the theme applied to a real element and taken off it again.
- 181 tests in total, from 139.

## 1.1.7 — 2026-09-20

Fixed

- **A theme that differed from OpenCloud's applied only to part of the app.**
  Radio's root set the `--oc-role-*` custom properties but painted no
  background or text colour of its own, so only the elements that paint their
  own background followed it: the station rail, the player bar and the search
  field went dark over a light page, while the list area kept the shell's
  background. The player bar's station name, which has no colour of its own,
  inherited the shell's dark text onto a dark bar and was all but invisible.
  The root now paints `--oc-role-background` and `--oc-role-on-background`;
  under "System" those resolve to the shell's own values, so nothing changes
  there. Reported from a live instance against 1.1.6.
- **A role a theme does not define no longer falls through to the other
  theme.** The shell writes to `:root`, where the design system's defaults
  sit, so an omitted role lands on a neutral value. Radio's properties go one
  level down, where an omitted role inherits whatever `:root` holds — the
  theme being overridden. `background` and `onBackground` decide the page
  itself and are now filled from `surface` and `onSurface` when a theme leaves
  them out, the same shape as the shell's own `chrome` fallback.

## 1.1.6 — 2026-09-20

A full review pass over the 1.1.5 tree: every file in `src/`, `tests/` and
`scripts/`, including the changes 1.1.5 itself made. Nineteen findings, all
addressed.

Fixed

- **The theme control never worked.** Radio set a `data-theme` attribute on
  `<html>`; the shell does not read one. It applies its theme as inline
  `--oc-role-*` custom properties on `:root`, one per design token. Radio now
  does exactly that on its own root element, so Light and Dark apply to Radio
  and to nothing else, System inherits the shell's, and there is nothing to
  restore on leaving. The control is disabled, with a note, on an instance that
  offers only one theme. This closed a `[verify on first live run]` marker that
  had stood since 1.0.0.
- **Removing `Radio/Backups/` by hand mid-session wedged every save.** A
  "folder exists" flag was set once and never cleared, so each later backup
  failed on a missing parent and the edit was refused until the page was
  reloaded. The folder is now recreated and the copy retried once.
- **Switching lists after a failed save silently dropped the edit.** `open()`
  reported the failure, then replaced the list anyway. It now refuses to
  switch: the edit stays on screen, the banner says so and how to discard it,
  and the same switch goes through once the cause is fixed.
- **Saving a settings profile under an existing name overwrote it** without a
  word. Refused now, the same way `createList` refuses a taken name.
- **Editing a station onto another station's address was allowed.** The
  duplicate check ran only on add. Two rows with one address would share a
  verdict, a last-played time and a place in every URL-keyed lookup.
- **A move that half-succeeded said "could not be saved".** When the target
  list had been written but this list's save failed, the banner read as if
  nothing had happened. It now says the stations are in both lists on the
  server until this one can be saved.
- **The spectrum graph stayed wired to a discarded element** after a CORS
  station was followed by one that refused CORS, until the next CORS station.
  Released on any element change now.
- **`fromProfile` clamped retries with a hardcoded 0–10** rather than the
  bounds 1.1.5 had moved into one place — a call site missed by that change.
- **`listProfiles` treated every error as "no profiles yet".** A 401 or a
  network failure now surfaces as one instead of an empty list.
- Directory mirrors may carry a port (`host:8443`); the validator refused the
  colon, so a self-hosted radio-browser on a non-standard port could not be
  configured.

Changed

- **Closing the tab or reloading with an edit unsaved asks first**, via the
  browser's own prompt. Moving to another OpenCloud app is a route change and
  the pending save completes; a real page unload was the one way to lose it.
- **Pruning no longer lists the backup folder on every save.** One PROPFIND per
  list per session; the app then keeps the names itself, tolerating a copy
  removed by hand. Each save is a request shorter for it.
- The reconnect-attempts picker offers 0 ("do not retry"), which the code
  always accepted and a test enshrined but the control could not reach.
- Import's "one station on several servers" detection now runs on pasted text
  as well as on a chosen file, and stops once the user has touched the box.
- "Last played" times tick once a minute rather than waiting for something
  else to re-render the row.
- The column checklist is one component, used by both the Columns menu and
  Preferences; the 1.1.4 `showLogos` fix had to be made in both.

Removed

- Exports nothing consumed: `ColumnKey`, `iniNum`, the `playing` computed on
  the player, `mode` on the spectrum, and `m3u`'s re-export of `normalise`.

Documented

- An attribute value's `"` is dropped on write — the one field the M3U writer
  cannot round-trip byte for byte, since the format defines no escape for it.

## 1.1.5 — 2026-09-20

A maintenance pass on the 1.1.4 tree, plus backups of station lists.
`app/radio/` was rebuilt, so this tree is not byte-identical to the published
1.1.4 archive; `SHA256SUMS` has been regenerated to match.

Added

- **Every change to a station list now copies the file first.** Saving an edit,
  renaming, deleting a list and adding stations to another one each write the
  previous contents to `Radio/Backups/` before touching the original, and the
  copy is read from the server rather than assumed, so it is of what was really
  there. If the copy cannot be written the change is abandoned and the edit is
  kept in the app — a backup that yields when it is inconvenient is not one.
  The folder is configurable as `backupFolder`.
- **Old copies are pruned as new ones are made**, to a number set under
  Preferences › Storage. `backupKeep` configures the instance's starting value
  (default 5), which seeds a device that has not stored one and is then the
  user's to change; never fewer than one, since a
  change is never made without a copy first. Pruning matches a copy to its list
  by name *and* an exact timestamp, so a list called `Rock` cannot sweep up the
  copies of `Rock.old`, and files the app did not write are left alone. A
  failure to prune is logged and swallowed: the copy is already safe by then,
  and tidying up must never become a reason to refuse an edit.

Changed

- `appendTo` no longer rewrites a list byte for byte when every station being
  added is already in it. It was a write that changed nothing, and it would
  have left a backup of a change that never happened.
- **"Clear search" moved out of the search band and into the header**, to the
  left of the search field, where the row's own spacing puts it the same
  distance from the field as the Columns button is on the other side. The band
  it lived in is gone: it said nothing the rest of the header does not already
  say — the match count is in the subtitle, the scope is on the field itself,
  and a directory query still in flight shows as "Searching…" in the results
  area and as a disabled "Show more".

Fixed

- **`scripts/prune-dist.mjs` could delete the entrypoint.** Its keep-list was
  hardcoded to `manifest.json`, `js` and `assets`, but module-federation emits
  `remoteEntry` into `js/` in some versions and into the dist root in others.
  Under the pinned plugin it is `js/`, so the bug was latent; on a plugin that
  emits to the root the manifest named a file the prune step had just removed —
  a build that looks successful and ships an app that cannot load. The
  keep-list now reads the entrypoint out of the manifest.
- **`reconnectAttempts` was read by nothing.** It was declared, type-checked,
  clamped, shipped in the manifest and documented in both README and INSTALL,
  and no code consulted it: the player takes its count from the `retries`
  preference, whose default was a separately hardcoded 5. Setting the key in
  `apps.yaml` had no effect, and only matched behaviour because both numbers
  happened to be the same. It is now the starting value for that preference,
  the same shape `backupKeep` uses. This is the second key to ship dead after
  `showLogos` in 1.1.3; all eighteen were swept this time, and it was the only
  one left.
- `SHA256SUMS` no longer covers `source/.__mf__temp/`, which is build scratch
  that `source/.gitignore` already ignores. It was listed in 1.1.4 as well —
  `node_modules/` and `dist/` were excluded and this was missed — and it means
  a fresh build makes the tree fail its own checksum on a file nobody edits.
- `package-lock.json` is pinned back to the dependency graph 1.1.4 shipped.
  Letting npm re-solve it moved `ws` out of the top level, where the hoisted
  `isomorphic-ws` could no longer resolve it, and the build failed to even load
  its vite config.
- **`package-lock.json` still carried `"version": "1.1.0"`**, four releases
  stale. A fresh `npm install` corrects it in place, which broke
  `sha256sum -c` on a file nobody had edited. No locked dependency changed.
- The `AddToList` tests mounted a component that uses `oc-button` without
  registering it, so every run printed two Vue resolution warnings. A typed
  stub now stands in for the design-system component.
- README said 50 tests; there are 99, as CONTENTS.md already said.

Not fixed, and why

- **Six high-severity advisories remain in the build toolchain** (`axios`,
  `ws`, `adm-zip`), all reached through `@opencloud-eu/extension-sdk` →
  `@module-federation/vite`, which the SDK pins to `1.14.2` exactly.

  Overriding that pin to `^1.22.1` does clear them, and was tried: tests, type
  check and build all passed. **The app then failed to load, and the admin apps
  list showed it as failed.** The newer plugin emits a different federation
  runtime — no `loadShare` chunks, and `remoteEntry` at the dist root rather
  than under `js/` — and the OpenCloud host could not negotiate the shared
  `vue`, `web-pkg` and `web-client` modules with it. The pin is load-bearing.

  None of the vulnerable code ships: all three are build-time only and appear
  nowhere in `dist/`. The exposure is to whoever runs `npm run build`, not to
  the instance or its users. It stays until the SDK moves its own pin.

## 1.1.4 — 2026-09-19

A second full review pass over 1.1.3, including everything changed since 1.1.0.

Fixed

- **Adding a directory station to a `.pls` or `.xspf` list, or moving a
  selection into one, wrote M3U into it** — the format bug closed in 1.1.1 for
  the open list was still reachable through the popup and the Move dialog.
  Those lists are no longer offered as targets and `appendTo` refuses them.
- **Player: the CORS fallback reset the round.** When a station's *second*
  server refused Web Audio, retrying it plain also reset the server index, so
  the player went back to the dead first server before trying the second one
  again. The fallback now keeps its place.
- **After a save conflict the list was wedged**: its etag was stale, so every
  later save failed the same way until the list was reopened. It is now
  re-read from the server when the conflict is reported.
- "Save a copy as .m3u8" dropped the overflow of a list longer than
  `maxStationsPerList`; the copy now carries it.
- A directory rate-limit (429) on "Show more" hid the button, so there was
  nothing to retry with.
- A station's Ready/No response verdict was forgotten when switching lists,
  so cross-list search results lost it.
- With `showLogos: false`, the Station logo checkbox in the Columns menu and
  Preferences toggled a setting with no effect; it is hidden now.
- Preferences named `Radio/Settings/` regardless of `settingsFolder`.
- `radio.lastPlayed` from storage is validated like the other stored values.
- Media Session playback state now follows real state rather than the click.


## 1.1.3 — 2026-09-19

Fixed

- **Adding a directory station to the open list, or moving a selection out of
  it, was never written to disk.** Both edit and then flush directly rather
  than through the debounce, and the pending-write flag introduced earlier in
  this series was only set by the debounce — so the flush found nothing to do.
  The station appeared in the list until the next reload. Every mutator now
  marks the list as pending.
- **Every banner was drawn in the error colours**, so "Added to Favourites"
  looked like a failure. Confirmations are now the secondary (blue) tone and
  only real failures are red.
- **The player bar ignored the Station logo column.** Turning logos off left
  one in the bar at the bottom, which for most stations is an empty tile.
  Logos are now one decision for the whole app.
- **`showLogos` was read by nothing.** The configuration key shipped in the
  manifest and was documented, but no code consumed it; setting it to `false`
  had no effect anywhere. It now switches logos off for the instance, which is
  what makes the "no `img-src` entry needed" note in INSTALL §3 true.
- **"Add to list" on a directory result appeared to do nothing.** The popup's
  outside-click listener was bound while the click that opened it was still
  bubbling, so that same click closed it again. It now listens for a press
  rather than a click, bound a task later. Present since 1.1.0; only reachable
  once the online directory is enabled.


## 1.1.2 — 2026-09-19

Fixed

- **A search run while the open list was empty showed "This list is empty"**
  instead of its results — with the correct match count in the header above it.
  Reported from a live instance against the online directory; it affected every
  scope. The four branches of the results area are now one decision
  (`helpers/view.ts`), tested, because the order of them was the bug.


## 1.1.1 — 2026-09-19

A correctness release from the third code review. No
new features; two data-loss paths and two player races closed. 86 tests, up
from 60, and the twelve that tested copies of the code now test the code.

Fixed

- **Player: a superseded `play()` promise acted on the next round.** Clicking a
  second station while the first was still connecting brought the first back
  and marked the second as refusing Web Audio for the session; every stream
  error skipped two servers instead of one. Each open is now a numbered round
  and every asynchronous continuation checks it is still the live one.
- **Lists: an edit followed by a quick list switch was lost.** The debounced
  save read the current list at fire time; opening, renaming, deleting or
  creating a list now writes any pending edit first.
- **Lists: a list longer than `maxStationsPerList` was written back truncated**
  on the next edit. The overflow is now carried as raw lines and written back
  intact; only the display is capped.
- **Lists: `.pls` and `.xspf` files were overwritten with M3U** under their own
  name once edited. They are read-only in the editor now, with a "save a copy
  as .m3u8" action; new lists are always `.m3u8` (or `.m3u`).
- "Tap to resume" stopped the player instead of resuming.
- Edit on a result of an All-lists search changed nothing: the finder re-read
  the current list and got different ids. The current list is now used live,
  and a result from another list opens that list before editing.
- Search results misaligned against the header when the Position column was on.
- A station that failed once could not be retried from the table until reload.
- Cross-list search did not see stations added or removed since the first search.
- M3U round trip: unquoted `#EXTINF` attributes were dropped; tags between an
  `#EXTINF` and its URL were written before it; the duration was reset to -1.
- XSPF: a playlist without a title of its own took the first track's.
- A stored `retries` of 0 reloaded as 5.
- A station that never answers no longer sits at "Connecting…" forever
  (25 s connect timeout, then the normal failover).
- The theme override is restored to the shell's value when leaving the app.
- A late `/status-json.xsl` answer no longer shows the previous station's title.
- Dead "Open list" on the directory group; preferences `pagehide` listener
  added once per mount; retries select blank for values outside 3/5/10;
  releasing a text selection outside a dialog closed it.

Hardening

- Directory mirror names discovered from `/json/servers` must be hostnames
  inside `*.api.radio-browser.info`; `url_resolved` passes the same URL gate as
  every other address. Stream URLs are logged without credentials or query.

Internals

- `StationRow` replaces two duplicated table bodies; one playlist-extension
  regex; one `normalise`; one `initials`; config defaults come from one JSON
  file for both the app and the manifest; spectrum colours are read per theme
  change rather than per frame; cross-list search loads lists in parallel.

## 1.1.0 — 2026-09-19

Search, across your lists and optionally across an online directory.

Added

- **Search**, in the header beside the other controls. `/` focuses it, Escape
  clears it. Three scopes: this list, all lists, and — when an administrator
  enables it — the online directory at radio-browser.info.
- Results use the columns you have configured, grouped under a header per list,
  with match counts. Playing a result leaves the results on screen.
- Search is a finder, not a mode of the table: no selection, no reordering.
  Both belong to a list, and a result set drawn from several lists has no
  coherent answer for either.
- **Online directory** (`directoryEnabled`, off by default). Results play
  without being saved, and can be added to any list. Stations the directory
  knows are already in one of your open lists say so instead of offering Add.
- Optional click reporting to the directory, double-gated: an administrator
  allows it at all, and you opt in. Off both ways by default.
- `deploy/directory-check.html`, which tests directory reachability from your
  own origin — something curl cannot do, because it ignores the CSP.

Notes

- Directory search needs `connect-src https://*.api.radio-browser.info` in the
  instance policy. The hosts are known, so it is named rather than opened wide.
- The directory resolves playlists server-side, so a station whose only address
  is a `.pls` arrives ready to play — the fetch a browser is not allowed to make.
- Two API expectations a browser cannot meet, both by design: the requested
  `User-Agent` header is forbidden to `fetch()`, and DNS-based server discovery
  is impossible, so the documented `/json/servers` fallback is used.

## 1.0.1 — 2026-09-19

Second review pass, before anyone else installs it. No new features; every
change below fixes something that could be reached from the interface.

Fixed

- A station that allowed Web Audio, followed by one that did not, played the
  second at full volume regardless of the slider: the gain node still answered
  for the previous element. Volume now asks which element the graph is on.
- Starting a station whose first server is `http:` and second `https:` tried
  the `http:` one anyway: the skip was decided before the round was reset, so
  the reset wiped it. Order fixed.
- Stopping, or choosing another station, while a playlist refresh was in
  flight could resurrect the stopped player or attach the result to the new
  station. The refresh now checks it is still wanted.
- A volume of exactly zero came back as 0.72 after a reload.
- Removing a station through the edit form left it counted in the bulk
  selection bar.
- Clicking a list in the rail while it failed to load left an unhandled
  rejection in the console.
- The "policy blocks media" message was asserted on the first failure ever,
  including when the first station tried happened to be dead. "Ever played" is
  now remembered per device, and the message says both possibilities.
- `rtsp:` and similar addresses were reported as "did not respond"; they are
  now "cannot be played in a browser", which is what is true.

Hardened

- The playlist address typed into Import, and administrator-provided default
  stations, now pass through the same URL gate as imported files.
- The playlist reader refuses non-web schemes before fetching.
- The gain node from a previous element is disconnected, not left wired to
  the speakers with no input.

Polish

- The Columns menu closes on click-outside and Escape.
- Home resets a column width from the keyboard, matching the list divider.
- Exports nothing reads (`audio`, `attempt`, `startedAt`, `corsCache`) removed
  from the player.

## 1.0.0 — 2026-09-19

First release, containing the whole scope: station lists as playlist files in
the user's own space, M3U/M3U8/PLS/XSPF import, playback with reconnect and
per-station server failover, a spectrum analyser, column preferences with
adjustable widths, bulk selection, list management, named settings profiles,
and best-effort track titles.

There is no 0.x line. Versions follow semantic versioning against the app's
public surface: the playlist files it writes, the configuration keys it reads,
and what it keeps in the browser's storage.

Deployment needs two things beyond copying the app: `media-src https:` in the
instance policy (`deploy/csp.yaml`), and, for http-only stations, a TLS relay
(`deploy/haproxy-relay.cfg`). Both are covered in `INSTALL.md`.

