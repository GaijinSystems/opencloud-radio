import type { Station } from './parsers/types'
import defaults from './defaults.json'
import { readRelays } from './helpers/relays'
import { clampBackups, clampRetries, clampInt as num } from './composables/usePreferences'

export interface RadioConfig {
  rootFolder: string
  settingsFolder: string
  backupFolder: string
  backupKeep: number
  defaultStations: Station[]
  reconnectAttempts: number
  reconnectMaxDelayMs: number
  cacheBustOnReconnect: boolean
  metadataEnabled: boolean
  analyserEnabled: boolean
  showLogos: boolean
  maxPlaylistDepth: number
  maxStationsPerList: number
  directoryEnabled: boolean
  directoryServers: string[]
  directoryReportClicks: boolean
  directoryPageSize: number
  directoryMaxResults: number
  /** Upstream http address → path on this cloud that relays it (INSTALL §2b). */
  relays: Record<string, string>
}

/**
 * One source of truth, shared with `scripts/prune-dist.mjs`, which stamps the
 * same block into the manifest. Two copies had already drifted in shape.
 */
const DEFAULTS: RadioConfig = { ...defaults, defaultStations: [] as Station[] }

const bool = (v: unknown, fallback: boolean): boolean =>
  typeof v === 'boolean' ? v : fallback
const path = (v: unknown, fallback: string): string => {
  if (typeof v !== 'string') return fallback
  const clean = v.replace(/^[/\s]+|[/\s]+$/g, '')
  return clean === '' || clean.includes('..') ? fallback : clean
}

/**
 * Every value is clamped, so an admin typo degrades to a default rather than
 * producing an app that loads and then behaves strangely.
 */
export const readConfig = (raw: Record<string, unknown> = {}): RadioConfig => ({
  rootFolder: path(raw.rootFolder, DEFAULTS.rootFolder),
  settingsFolder: path(raw.settingsFolder, DEFAULTS.settingsFolder),
  backupFolder: path(raw.backupFolder, DEFAULTS.backupFolder),
  // The starting value for a device that has not stored one; the user may
  // then set their own. The preference's own clamp, so the two cannot drift.
  backupKeep: clampBackups(raw.backupKeep),
  defaultStations: Array.isArray(raw.defaultStations)
    ? (raw.defaultStations as Station[]).filter((s) => s && typeof s.url === 'string')
    : DEFAULTS.defaultStations,
  // Read by nothing until 1.1.5: it is the starting value for the `retries`
  // preference, which is what the player actually consults.
  reconnectAttempts: clampRetries(raw.reconnectAttempts),
  reconnectMaxDelayMs: num(raw.reconnectMaxDelayMs, 1000, 120000, DEFAULTS.reconnectMaxDelayMs),
  cacheBustOnReconnect: bool(raw.cacheBustOnReconnect, DEFAULTS.cacheBustOnReconnect),
  metadataEnabled: bool(raw.metadataEnabled, DEFAULTS.metadataEnabled),
  analyserEnabled: bool(raw.analyserEnabled, DEFAULTS.analyserEnabled),
  showLogos: bool(raw.showLogos, DEFAULTS.showLogos),
  maxPlaylistDepth: num(raw.maxPlaylistDepth, 0, 4, DEFAULTS.maxPlaylistDepth),
  maxStationsPerList: num(raw.maxStationsPerList, 10, 20000, DEFAULTS.maxStationsPerList),
  directoryEnabled: bool(raw.directoryEnabled, DEFAULTS.directoryEnabled),
  // Hosts only; anything that is not a bare hostname is dropped rather than
  // guessed at, because a bad entry here means requests to the wrong place.
  directoryServers: Array.isArray(raw.directoryServers)
    ? (raw.directoryServers as unknown[])
        .filter((h): h is string => typeof h === 'string')
        .map((h) => h.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
        .filter((h) => /^[a-z0-9.-]+(:\d{1,5})?$/i.test(h)) // a port is allowed: self-hosted mirrors often need one
    : DEFAULTS.directoryServers,
  directoryReportClicks: bool(raw.directoryReportClicks, DEFAULTS.directoryReportClicks),
  directoryPageSize: num(raw.directoryPageSize, 10, 100, DEFAULTS.directoryPageSize),
  directoryMaxResults: num(raw.directoryMaxResults, 100, 2000, DEFAULTS.directoryMaxResults),
  // Each line checked on its own; one that does not parse is dropped, never guessed at.
  relays: readRelays(raw.relays)
})
