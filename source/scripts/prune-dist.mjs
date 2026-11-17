#!/usr/bin/env node
/**
 * Post-build: stamp the manifest with the build identity and drop anything the
 * host does not need. The stamp exists so a bug report can be tied to an exact
 * build without asking the reporter what they installed.
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const dist = 'dist'
const manifestPath = join(dist, 'manifest.json')

if (!existsSync(manifestPath)) {
  console.error('[radio] no dist/manifest.json — did vite build run?')
  process.exit(1)
}

// `RADIO_COMMIT` for a build with no git to ask — inside a container, say.
const commit = process.env.RADIO_COMMIT || (() => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim()
  } catch {
    return 'unknown'
  }
})()

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
// The time of the commit where the build is given one (SOURCE_DATE_EPOCH, as
// the release workflow sets it), so a release's files are the same each time
// they are built; otherwise, now.
const epoch = Number(process.env.SOURCE_DATE_EPOCH)
const builtAt = new Date(Number.isFinite(epoch) && epoch > 0 ? epoch * 1000 : Date.now()).toISOString()
manifest.build = { commit, builtAt }

// Defaults shipped with the app, from the same file the app itself reads, so
// the manifest cannot drift from the code. An administrator overrides these in
// `$OC_BASE_DATA_PATH/config/apps.yaml` or `radio/config.json`, both
// server-wide. Merge order is config.json > apps.yaml > manifest.
manifest.config = JSON.parse(readFileSync('src/defaults.json', 'utf8'))
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

// Nothing but the manifest, the entry graph and styles ships.
// The entrypoint is whatever the manifest names it. Module-federation emits
// remoteEntry into `js/` in some versions and into the dist root in others, so
// a hardcoded keep-list silently deleted it and shipped a manifest pointing at
// a file that was no longer there.
const keep = new Set(['manifest.json', 'js', 'assets', manifest.entrypoint.split('/')[0]])

for (const entry of readdirSync(dist)) {
  if (keep.has(entry)) continue
  rmSync(join(dist, entry), { recursive: true, force: true })
}

const size = (dir) =>
  readdirSync(dir, { withFileTypes: true }).reduce((total, e) => {
    const p = join(dir, e.name)
    return total + (e.isDirectory() ? size(p) : statSync(p).size)
  }, 0)

console.log(`[radio] ${manifest.name} ${manifest.version} (${commit}) — ${(size(dist) / 1024).toFixed(0)} kB`)
