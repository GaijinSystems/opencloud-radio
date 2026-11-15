# OpenCloud Radio 1.2.0 — what is here

Start with `INSTALL.md`: build the app from `source/` (step 1), then deploy it
with what is in `deploy/`; the rest is reference. Upgrading: **remove the
old build's `js/` and `assets/` from the `radio/` folder before copying the
new build in** (INSTALL step 1), so its content-hashed files do not linger;
a `config.json` of your own there is kept. Then restart the web service.
No app configuration changes are required: stations entered with a relay's
address keep working. If you relay an http-only station, list it under
`relays` so stations keep their own addresses (INSTALL §2b); and if you
deployed the earlier HAProxy example under your cloud's hostname, replace it
with the new one — it closes holes the old one left open. Track titles are now
on by default — they need `connect-src https:` in the site's policy to show
for most stations, and `metadataEnabled: false` turns them off.

```
INSTALL.md            building and deploying, in four steps
README.md             what the app does, and two things that look like bugs
CHANGELOG.md          what changed in 1.2.0 and before
LICENSE               AGPL-3.0-or-later

deploy/
  csp.yaml            media-src, for OpenCloud's proxy service (required)
  haproxy-relay.cfg   relaying an http-only station over TLS (optional)
  relay-test/         tests that relay config end to end, with podman (run.sh)
  directory-check.html  tests directory reachability from your own origin
docs/
  DIRECTORY-PLAN.md   the directory feature, with its verification recorded
  mockups/            layout candidates; index.html is the gallery
source/               full source, tests and build scripts; scripts/dav-contract.mjs
                      checks a server does what the app relies on, and
                      scripts/find-nowplaying.mjs finds a public radio station's
                      now-playing address, and scripts/relays-from-haproxy.mjs
                      writes the `relays` setting from an HAProxy config
```

## Building from source

```
cd source
npm install --legacy-peer-deps
npm run build          # -> dist/, the app to install (INSTALL step 1)
npm test               # 521 tests, no server required
```

The build is not reproducible byte-for-byte: filenames carry content hashes and
the manifest records a build timestamp and commit. The commit is read from git,
or from `RADIO_COMMIT` where there is no git (INSTALL step 1 sets it for the
podman build), and reads `unknown` otherwise.
