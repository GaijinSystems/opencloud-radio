# Directory search — implementation plan

Adding "search an online directory of stations" to the search feature, as a third
scope beside *This list* and *All lists*. Results render in the same table with
the same columns, can be played in place, and can be added to a list.

| | |
|---|---|
| Status | Plan. Nothing built. |
| Written | 19 September 2026 |
| Depends on | The cross-list search feature (state, grouped headers, no selection), which is designed but not yet built. This plan assumes it exists. |
| Target release | 1.1.0 — a new capability that leaves existing files and config working |
| Directory | radio-browser.info, community-run, no API key |

Tags as in the main plan: **[source]** read from the API reference or code;
**[live]** observed on a running instance; **[inferred]** reasoned and unverified.

---

## 0. Two facts that shape everything

**The browser cannot honour the API's User-Agent request.** The documentation
asks every client to send `User-Agent: appname/version` **[source]**. `fetch()`
in a browser forbids setting that header — it is on the forbidden-header list
and is silently dropped. The request is a courtesy, not an authentication
requirement, so the API still answers; but this app cannot comply, and the plan
should not pretend otherwise. If the maintainer ever begins requiring it, the
only fix is a server-side proxy. (§10, risk 3.)

**The browser cannot do the DNS lookup the API expects.** The documented way to
find a server is a DNS lookup of `all.api.radio-browser.info` followed by a
reverse lookup of each address **[source]**. Browsers cannot do either. The
documentation offers `/json/servers` as the fallback for exactly this case, and
that is what this plan uses (§4).

Neither is a blocker. Both are the kind of thing that would have cost a day if
discovered during implementation rather than before it.

---

## 1. Scope

**In**

- A third search scope, **Online directory**, in the scope control of the
  existing search field.
- Query the directory by name, with sensible defaults (broken stations hidden,
  sorted by popularity, paged).
- Results in the existing table, using the user's configured columns, under a
  group header that names the directory.
- **Play in place**, exactly as with local results, without saving anything.
- **Add to list** per result, into the current list or a chosen one.
- Detection of results already in one of the user's lists, shown as "in
  Favourites" instead of an Add button.
- Optional, off by default, opt-in: reporting a play to the directory's click
  counter.
- Everything gated behind `directoryEnabled`, **default off**.

**Out**

| Not doing | Why |
|---|---|
| Browse by tag / country / language without a query | A different UI (facets, lists) and a much larger surface. The query box covers the common case. Revisit if asked. |
| Voting | Write action against a third party on the user's behalf; no clear benefit to a private instance. |
| Adding stations *to* the directory | Same, and a moderation problem that is not ours. |
| Directory results in *This list* / *All lists* scopes | Local and remote must not be mixed in one result set; provenance matters for Add and for trust. |
| A directory-specific column set | Results use whatever columns the user has; `bitrate`/`codec` from the directory are shown in the State tooltip, not as new columns, because the app's own table cannot populate them for local stations and a column that is empty for half the rows is worse than none. |

---

## 2. The API, as verified

Base servers: `de1.api.radio-browser.info`, `nl1.api.radio-browser.info`, and
others discovered at runtime **[source]**. All endpoints below are `GET`, JSON.

| Endpoint | Used for | Notes **[source]** |
|---|---|---|
| `/json/servers` | Discover mirrors | Returns `[{ip, name}]`. Documented as the fallback for clients that cannot do DNS. |
| `/json/stations/search` | The query | Parameters used: `name`, `hidebroken=true`, `order=clickcount` or `votes`, `reverse=true`, `limit`, `offset`, optionally `is_https=true`. |
| `/json/url/{stationuuid}` | Click counter | "Should be called every time a user starts playing." Deduplicated server-side per IP per station per day. Opt-in here. |
| `/json/stations/byuuid?uuids=…` | Re-check a saved station later | Not in 1.1; noted because the UUID is worth persisting now (§5). |

### Result fields this plan consumes

| Field | Maps to | Notes |
|---|---|---|
| `stationuuid` | `extra['radiobrowser-uuid']` | Persisted in the M3U as an attribute so it survives round-trips and enables click reporting and re-checks. |
| `name` | `name` | `oneLine()`. |
| `url_resolved` | `url` | **The stream.** Playlists and redirects already resolved server-side — the directory did the fetch the browser is not allowed to do. Fall back to `url` if empty. |
| `url` | `source`, **only if** it looks like a playlist | Preserves the app's existing "re-read the playlist when all servers fail" behaviour where the original was a `.pls`/`.m3u`. |
| `homepage` | `homepage` | `safeUrl()`. |
| `favicon` | `logo` | `safeUrl(…, ['https:'])`. Most favicons are http and will be dropped; that is correct. |
| `tags` | `group` | First tag, if any. The rest are discarded — the app has one group per station. |
| `country` | `country` | The API says `countrycode` is preferred; the app displays names, so `country` is used and `countrycode` kept in `extra`. |
| `language` | `language` | First of the comma list. |
| `codec`, `bitrate` | State tooltip | e.g. "MP3 · 128 kbps · checked 3 h ago". Not a column (see §1). |
| `hls` | classification | `1` → `unsupported`, exactly as a local `.m3u8` would be. |
| `lastcheckok`, `lastchecktime_iso8601` | filtering + tooltip | `hidebroken=true` at the API; the timestamp shown so the user knows how fresh the verdict is. |
| `ssl_error` | classification hint | `1` → treat as `failed` with a "certificate problem" message rather than letting the element time out. |
| `votes`, `clickcount` | ordering only | Not displayed. A popularity number next to a station invites the wrong question. |

### Unknowns to verify in phase 0

| Question | Why it matters | How to check |
|---|---|---|
| ~~Does the API send CORS headers?~~ **[live, 19 Sep 2026]** | **Confirmed.** `access-control-allow-origin: *` on both `/json/stats` and `/json/servers`, with `allow-methods: GET,POST`. The feature is viable. | Done with curl and an `Origin` header. |
| Rate limits **[inferred: none published]** | Decides debounce and page size. | Ask the `/json/stats` endpoint; read the server source if needed. |
| Behaviour of `/json/servers` under CORS | It is the bootstrap; if it is not CORS-enabled, a hard-coded list is the fallback. | Same fetch test. |

---

## 3. Deployment changes

One directive, and it is scoped rather than wide:

```yaml
directives:
  connect-src:
    - 'https://*.api.radio-browser.info'
  img-src:
    - 'https:'          # already needed for station logos
```

`connect-src` names the directory's hosts, not `https:`, because unlike media
the set of hosts is known. If an administrator configures a mirror or a
self-hosted instance (§8), they add its host here too, and the app's
"directory unavailable" message says so (§7).

No change to `media-src`: playing a directory result is playing a stream, which
`media-src https:` already permits.

---

## 4. Server discovery and failover

```
composables/useDirectory.ts
```

1. On first directory query of the session, `GET https://de1.api.radio-browser.info/json/servers`.
   Deduplicate by `name`, shuffle, keep the list in memory.
2. If that fails (offline, CORS, blocked), fall back to a **built-in list**
   `['de1', 'nl1', 'at1']` **[inferred: the currently-published mirrors]**,
   overridable by `directoryServers` in config.
3. Every query goes to the first server in the list. A network error or a 5xx
   rotates the list and retries once. Two failures → "The directory is not
   responding" and stop; do not hammer.
4. The chosen server is remembered for the session, not persisted — mirrors
   come and go.

---

## 5. Data model

No new types. A directory result is converted to a `Station` (the app's existing
type) **at the moment it is needed** — for play, or for Add — by one function:

```ts
export const toStation = (r: DirectoryStation): Station
```

with the field mapping in §2. Two additions to what a station already carries,
both in `extra` so the M3U parser round-trips them without changes:

| Attribute in M3U | Value | Why |
|---|---|---|
| `radiobrowser-uuid` | `stationuuid` | Click reporting; future re-check against the directory; deduplication of "is this already in my lists". |
| `radiobrowser-country` | `countrycode` | The API's preferred identifier, kept alongside the display name. |

The M3U parser's "carry unknown attributes in `extra`" rule was designed for
exactly this. No parser change is required. **Add a round-trip test anyway.**

Directory results held in memory while searching are `DirectoryStation`, the raw
API shape, so that fields not in `Station` (bitrate, codec, last check) are
available to the tooltip without inventing columns.

---

## 6. Search behaviour

Builds on the search composable from the cross-list feature. Adds one scope.

| | |
|---|---|
| Trigger | Query length ≥ 2, debounced 350 ms. The local scopes filter on every keystroke; the directory is a network call and must not. |
| Request | `/json/stations/search?name=<q>&hidebroken=true&order=clickcount&reverse=true&limit=50&offset=0` |
| Cancellation | `AbortController` per query. Typing "somaf" → "somafm" aborts the first request; a late response must never overwrite a newer one. |
| Paging | A "Show 50 more" row at the end of the group; `offset` advances. No infinite scroll — the table is shared with local lists and scrolling should never trigger network calls. |
| Ordering | By `clickcount` descending (popularity in the last 24 h). Tie-break by name. The user is not offered a sort control: this is a finder, and the same reasoning that removed sorting from the table applies. |
| Result cap | 500 per query, then "Refine the search." A name query returning more than that is not a search anyone can use. |
| Local dedup | Each result's `url_resolved` (and `url`) is checked against every station in every loaded list. A match renders **"in Favourites"** (or whichever list) in place of Add, and the row is styled as a known station. Lists not currently loaded are not searched — the app loads lists lazily — so the check is best-effort and the tooltip says "in a list that is open". **[decision]** Loading all lists for this check is not worth the cost; the Add action itself refuses a duplicate URL in the target list, which is the safety net. |
| Empty | "No stations in the directory match 'xyz'." in the centred empty state, with the query echoed. |
| Failure | Distinguish three cases, because the fix differs: (a) network error / all mirrors down → "The directory is not responding. Try again in a minute."; (b) `TypeError` from a CORS or CSP block on a **fresh session** → "This site does not allow the directory to be reached. An administrator needs to add its address to connect-src."; (c) 429 → "The directory is busy. Wait a moment." Same policy as the media-src message: name what the user can act on. |

### Classification of results

Each result gets a `Playability` through the existing `classify()` **before**
rendering, on `toStation(r)`. So an http-only result shows **Blocked**, an HLS
result shows **Not supported**, and neither has a live play button — the same
badges, the same explanations, no directory-specific states. This means a
large share of directory results will be Blocked. That is true and should be
visible, not filtered away: the `is_https=true` parameter exists and is offered
as a **checkbox in the scope dropdown, "https only"**, default off, remembered
per device.

---

## 7. Interface

All inside the existing search UI. Nothing new at the top level.

### Scope control

The scope pill in the search field becomes a dropdown with three entries:

```
This list
All lists
Online directory        ← only present when directoryEnabled
  ☐ https only
```

The band under the header reads `Searching the online directory · Clear search`,
and while a request is in flight `Searching the online directory…` with the
ellipsis doing the work of a spinner. Results appear under one group header:

```
ONLINE DIRECTORY · 47 results · most played first                 [Show 50 more]
```

### Rows

The configured columns, exactly as for a local station. Two differences:

- The actions cell shows **Add to list** (an `OcButton`, outline) instead of
  Edit. If the station is already in an open list, it shows the list's name as
  a link that opens that list and highlights the row.
- The State badge's tooltip carries the directory's facts: codec, bitrate, and
  "checked 3 h ago" from `lastchecktime_iso8601`.

Play-and-stay works unchanged: the play button on a directory row calls
`player.play(toStation(r))`. The station object is transient — nothing is
saved. The player bar shows `· from the online directory` where a local
station shows `· in Favourites`.

### Add to list

Click → a small popover (not a modal) anchored to the button:

```
Add "Groove Salad" to
  ● Favourites            ← the current list, preselected
  ○ Ambient & downtempo
  ○ Imported from Winamp
  ─────────────
  + New list…
                                              [Add]
```

Enter adds to the preselected list, so the common case is two keystrokes. On
success the row flips to "in Favourites" and a flash says so. Adding to the
current list uses `lists.addStation()` + `persist()`; to another list uses
`appendTo()`, which already does read-modify-write with the target's own ETag.
A duplicate URL in the target is refused with the existing message.

### Preferences

In the existing dialog, a new section, present only when `directoryEnabled`:

```
Online directory
  ☑ Search the online directory (radio-browser.info)
  ☐ Tell the directory when I play one of its stations
      Helps rank stations for everyone. Sends the station's id and your
      IP address to radio-browser.info; nothing else. Off by default.
  ☐ Show only https stations in directory results
```

The click-reporting line is the privacy disclosure. It is written so that what
leaves the instance is stated in one sentence, and it is separate from enabling
search, because searching and reporting are different consents.

### Keyboard

Unchanged from local search: `/` focuses, Escape clears. Additionally, within
the scope dropdown, the three scopes are radio buttons so arrow keys switch
scope without the mouse.

---

## 8. Configuration

| Key | Default | Notes |
|---|---|---|
| `directoryEnabled` | `false` | Master switch. When false, no scope entry, no preferences section, no requests, ever. |
| `directoryServers` | `[]` | Overrides discovery. For a mirror or a self-hosted radio-browser instance. Hosts only; the app adds the scheme and path. Any entry that fails `safeUrl` is dropped with a console warning. |
| `directoryReportClicks` | `false` | Whether the preference **exists**. When false the option is not shown and nothing is ever reported, regardless of any stored preference. An administrator can forbid it outright. |
| `directoryPageSize` | `50` | Clamped 10–100. |
| `directoryMaxResults` | `500` | Clamped 100–2000. |

Every value clamped in `config.ts`, as now. The manifest ships them all.

Per-device preferences (in `radio.prefs`): `directoryReportClicks` (user's own
consent, AND-ed with the admin's), `directoryHttpsOnly`.

---

## 9. Click reporting

Only when **both** `config.directoryReportClicks` and the user's preference are
true. Then, on the `playing` event for a station that carries
`extra['radiobrowser-uuid']`:

```
GET https://<server>/json/url/<uuid>
```

Fire and forget; a failure is logged at `debug` and never surfaces. Rate-limited
to once per station per session on our side even though the server also
deduplicates — no reason to send what will be discarded. Sent for **any**
station with the attribute, including ones added from the directory days ago
and now played from a list: that is the behaviour the directory asks for and
the one the user consented to.

Never sent for stations without the attribute. The app must not go looking up
a user's hand-entered stations in the directory to find a UUID for them.

---

## 10. Risks

1. **CORS.** If the API does not send `Access-Control-Allow-Origin`, the whole
   feature needs a proxy and this plan is void. Verified in phase 0 before any
   other work. **[inferred: it does]**
2. **Availability.** A community service with a stated "without guarantee to
   work" **[source]**. Mitigated by mirror rotation, by the feature being
   optional, and by a failure message that does not blame the app.
3. **User-Agent.** The API asks for one; a browser cannot send it (§0). If this
   ever becomes enforced, the feature stops working until a proxy exists. Low
   probability; the maintainer's stated purpose is contact, not gating.
4. **Result quality.** The directory is crowd-sourced. Names are inconsistent,
   many entries are http-only, some are dead despite `lastcheckok`. The app's
   existing classification and failure handling absorb this; nothing new to
   build, but expectations to set in the README.
5. **Blast radius of Add.** Adding fifty results one at a time is tedious, and
   the temptation will be a bulk Add. Resist it in 1.1: bulk actions were
   deliberately removed from search, and "add everything matching 'jazz'" is
   how a list becomes unusable.
6. **Privacy.** Queries go to a third party. Stated in the preferences text,
   in the README, and in INSTALL for the administrator enabling it. An instance
   that cannot accept this leaves `directoryEnabled` false, which is the
   default.

---

## 11. Testing

| Area | Test |
|---|---|
| Mapping | `toStation()` against a fixture JSON captured from the real API (generated by script from a saved response, never hand-written): `url_resolved` preferred over `url`; playlist `url` becomes `source`; http favicon dropped; first tag → group; `hls=1` → unsupported; `ssl_error=1` → failed. |
| Round trip | A station with `radiobrowser-uuid` in `extra` survives `serializeM3u → parseM3u`. |
| Query building | Exact URL for given inputs, including encoding of a query with `&` and `%` in it. |
| Cancellation | With a fake `fetch`, a slow first response arriving after a fast second one is discarded. |
| Server rotation | First mirror fails → second used → remembered; both fail → stop, message. |
| Dedup | A result whose `url_resolved` matches a loaded station is marked; one whose `url` (playlist) matches a station's `source` is also marked. |
| Failure messages | The three failure cases produce the three messages; a CORS/CSP `TypeError` on a fresh session names `connect-src`. |
| Consent | No click request is sent when either the admin key or the user preference is false; exactly one is sent per station per session when both are true. |
| Live, phase 0 | The CORS check, recorded with the response headers in the phase-0 table above (curl with an `Origin` header). |

---

## 12. Steps, in order

Each step ends in something runnable and tested. Do not start the next until
the previous passes.

**Phase 0 — verify (½ day)**
1. From a browser page on an https origin, `fetch('https://de1.api.radio-browser.info/json/stats')`. Record the CORS headers. **If this fails, stop and report; the plan changes.**
2. Same for `/json/servers`.
3. Run one `/json/stations/search?name=soma&hidebroken=true&limit=5` and save the response as `tests/fixtures/directory-search.json` via the fixture generator.

**Phase 1 — plumbing (1 day)**
4. `config.ts`: the five keys, clamped; manifest defaults via `prune-dist.mjs`.
5. `helpers/directory.ts`: `DirectoryStation` type from the fixture; `toStation()`; `buildSearchUrl()`. Tests.
6. `composables/useDirectory.ts`: server discovery with fallback list; `search(query, offset)` with abort; rotation; the three failure classes. Tests with a fake `fetch`.
7. M3U round-trip test for the two `extra` attributes.

**Phase 2 — search integration (1½ days)**
8. Scope dropdown gains "Online directory" when enabled; band text; "Searching…" state.
9. Results rendered through the existing grouped table with the directory header and the "Show 50 more" row.
10. `classify()` applied per result; badges and disabled play buttons as for local stations; tooltip with codec / bitrate / checked.
11. Play-and-stay for directory rows; player bar suffix "from the online directory".
12. Local dedup against loaded lists; "in <list>" rendering.

**Phase 3 — add (1 day)**
13. Add-to-list popover; Enter adds to current; New list… routes through the existing `ListDialog`.
14. `addStation` / `appendTo` paths, duplicate refusal, flash, row flip.

**Phase 4 — preferences and reporting (½ day)**
15. Preferences section, gated on config; consent text.
16. Click reporting on `playing`, double-gated, once per station per session. Tests.

**Phase 5 — ship (½ day)**
17. `deploy/csp.yaml` gains the commented `connect-src` block; INSTALL step 2 mentions it under "optional"; README gets a "Directory search" section including the privacy line.
18. CHANGELOG 1.1.0; the directory moves from out of scope to in; the phase-0 evidence is recorded in the phase-0 table.
19. Build, package, verify from extraction.

Total: about five days, of which the first half-day decides whether the other
four and a half happen.

---

## 13. Acceptance

The feature is done when all of these are true on a live instance:

- With `directoryEnabled` false: no scope entry, no preferences section, and
  the browser's network panel shows no request to any `radio-browser.info`
  host during a full session.
- With it true and `connect-src` **not** yet added: choosing the directory
  scope and typing a query produces the `connect-src` message within two
  seconds, and nothing else.
- With `connect-src` added: "soma" returns SomaFM stations within one second,
  in the user's configured columns, with http-only ones marked Blocked and at
  least one playable.
- Playing a result starts within the same time as a local station and the
  results remain on screen.
- Adding a result to Favourites appends one line to `Favourites.m3u8`
  containing `radiobrowser-uuid=`, and the row shows "in Favourites".
- Adding it again is refused with the duplicate message.
- With reporting off (either gate), no `/json/url/` request appears in the
  network panel when a directory-sourced station plays. With both gates on,
  exactly one appears the first time, and none on a second play.
- Killing network access mid-query produces "not responding", not a stack
  trace, and a later query recovers without a reload.
