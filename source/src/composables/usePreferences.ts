import { reactive, watch } from 'vue'
import shipped from '../defaults.json'
import { iniBool } from '../parsers/ini'
import { historyKey } from '../helpers/safeUrl'

/** The toggleable columns and whether each starts on. Widths are `DEFAULT_WIDTHS`. */
export const COLUMNS = [
  { key: 'index', label: 'Position number', visible: false },
  { key: 'logo', label: 'Station logo', visible: true },
  { key: 'home', label: 'Homepage link', visible: true },
  { key: 'network', label: 'Network', visible: true },
  { key: 'group', label: 'Group', visible: true },
  { key: 'url', label: 'Stream address', visible: false },
  { key: 'country', label: 'Country', visible: false },
  { key: 'language', label: 'Language', visible: false },
  { key: 'played', label: 'Last played', visible: true },
  { key: 'state', label: 'State', visible: true }
] as const

/** Table columns in DOM order. `station` takes a width; `actions` takes the slack. */
export const GRID = ['select', 'index', 'station', 'network', 'group', 'url',
  'country', 'language', 'played', 'state', 'actions'] as const

export const MIN_COL = 64
/** For a column no default names — none today, but a key from a newer version's storage could be one. */
export const DEFAULT_COL_WIDTH = 110
export const MIN_RAIL = 208
export const MAX_RAIL = 520
export const DEFAULT_RAIL = 268
export const DEFAULT_WIDTHS: Record<string, number> = {
  select: 40, index: 46, station: 300, network: 130, group: 110,
  url: 260, country: 130, language: 110, played: 132, state: 128
}

/** A whole number inside `[min, max]`, or `fallback` when `v` is not a number at all. */
export const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
}

export const DEFAULT_VOLUME = 0.72
/** A level between 0 and 1. A stored 0 is a choice, so only a non-number falls back. */
export const clampVolume = (v: unknown, fallback = DEFAULT_VOLUME): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback
}

/**
 * How many copies of one station list to keep. The floor is 1, not 0: every
 * change writes a backup first and that is not negotiable, so the most recent
 * one always survives. A zero here would be a way to turn the guarantee off
 * through the back door.
 */
const MIN_BACKUPS = 1
const MAX_BACKUPS = 50
/** The shipped default, from the same file the manifest is stamped with. */
export const DEFAULT_BACKUPS = shipped.backupKeep
export const clampBackups = (v: unknown): number => clampInt(v, MIN_BACKUPS, MAX_BACKUPS, DEFAULT_BACKUPS)

/**
 * Reconnect attempts. Bounds live here rather than in `config.ts` so the
 * configuration key and the preference cannot disagree about what is valid.
 */
const MIN_RETRIES = 0
const MAX_RETRIES = 10
const DEFAULT_RETRIES = shipped.reconnectAttempts
export const clampRetries = (v: unknown): number => clampInt(v, MIN_RETRIES, MAX_RETRIES, DEFAULT_RETRIES)

/** The administrator's starting values for the preferences that have one. */
export interface InstanceDefaults {
  /** `backupKeep` from the app configuration. */
  backupKeep?: number
  /** `reconnectAttempts` from the app configuration. */
  retries?: number
}

export const THEME_MODES = ['light', 'dark', 'system'] as const
export type ThemeMode = typeof THEME_MODES[number]

export interface Prefs {
  columns: Record<string, boolean>
  widths: Record<string, number>
  railWidth: number
  theme: ThemeMode
  resume: boolean
  retries: number
  backupKeep: number
  metadata: boolean
  analyser: boolean
  directoryReportClicks: boolean
  directoryHttpsOnly: boolean
  volume: number
  muted: boolean
  lastList: string
  lastStation: string
}

const KEY = 'radio.prefs'
/** Written with every save; a stored file without it is from before 1.2.0 (see `Field.since`). */
const PREFS_VERSION = 2

/**
 * Every preference that is one value, once: where it starts, what storage may
 * set it to, and whether and where it travels in a settings profile. Until
 * 1.2.0 each key was written out four times — the defaults, the load from
 * storage, the profile writer and the profile reader — and a key added to
 * three of them and not the fourth was how `fromProfile` came to clamp
 * retries by bounds of its own in 1.1.5.
 *
 * `stored` is handed what storage holds under the key and returns the value,
 * or `undefined` to keep the starting value: nothing from storage is trusted
 * as it is. `text` does the same for a profile's text. A key with no
 * `profile` stays on the device: the volume, the last list and station, the
 * theme (one device's light is another's dark), and the consent to report
 * plays to the directory, which is given where it applies and nowhere else.
 */
interface Field<K extends Scalar> {
  initial: (instance: InstanceDefaults) => Prefs[K]
  stored: (v: unknown) => Prefs[K] | undefined
  /**
   * The settings-file version from which a stored value is a choice. Every
   * preference is written whole on any change, defaults and all, and before
   * 1.2.0 the file carried no version: an older file's value for a default
   * that has since changed may be the old default, not a choice, and is set
   * aside once (the file is rewritten).
   */
  since?: number
  profile?: { section: string; key: string; geometry?: boolean; text: (v: string) => Prefs[K] | undefined }
}
type Scalar = Exclude<keyof Prefs, 'columns' | 'widths'>

const finite = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}
const flag = (fallback: boolean, profile?: { section: string; key: string }): Field<Scalar> => ({
  initial: () => fallback,
  stored: (v) => (typeof v === 'boolean' ? v : undefined),
  ...(profile ? { profile: { ...profile, text: (v: string) => iniBool(v, false) } } : {})
})
/** A number, clamped; absent when it is not a number at all. */
const clamped = (clamp: (n: number) => number) => (v: unknown): number | undefined => {
  const n = finite(v)
  return n === undefined ? undefined : clamp(n)
}
const whole = (clamp: (n: number) => number, initial: (i: InstanceDefaults) => number,
  profile?: { section: string; key: string; geometry?: boolean }): Field<Scalar> => ({
  initial,
  // Absent means this device never chose, so the starting value applies. A
  // stored 0 is a choice and survives; `|| default` would have turned it back
  // into the default on every reload, which is the volume bug of 1.0.1.
  stored: clamped(clamp),
  ...(profile ? { profile: { ...profile, text: clamped(clamp) } } : {})
})

const FIELDS: { [K in Scalar]: Field<K> } = {
  theme: {
    initial: () => 'system',
    stored: (v) => (THEME_MODES.includes(v as ThemeMode) ? (v as ThemeMode) : undefined)
  },
  resume: flag(true, { section: 'playback', key: 'resume' }) as Field<'resume'>,
  retries: whole(clampRetries, (i) => clampRetries(i.retries), { section: 'playback', key: 'retries' }) as Field<'retries'>,
  // On by default since 1.2.0; an "off" stored before then was the old default.
  metadata: { ...flag(true, { section: 'playback', key: 'metadata' }), since: 2 } as Field<'metadata'>,
  analyser: flag(true, { section: 'playback', key: 'analyser' }) as Field<'analyser'>,
  directoryHttpsOnly: flag(false, { section: 'playback', key: 'directoryHttpsOnly' }) as Field<'directoryHttpsOnly'>,
  directoryReportClicks: flag(false) as Field<'directoryReportClicks'>,
  // Clamped, not defaulted: a 0 from a hand-edited file becomes 1 rather than
  // silently restoring the default, since 0 would mean no backups at all.
  backupKeep: whole(clampBackups, (i) => clampBackups(i.backupKeep), { section: 'backups', key: 'keep' }) as Field<'backupKeep'>,
  railWidth: {
    initial: () => DEFAULT_RAIL,
    stored: (v) => { const n = finite(v); return n ? clampRail(n) : undefined },
    profile: { section: 'layout', key: 'railWidth', geometry: true, text: (v) => clamped(clampRail)(v) } // looked up when read: clampRail is defined below
  },
  volume: {
    initial: () => DEFAULT_VOLUME,
    stored: clamped(clampVolume)
  },
  muted: { initial: () => false, stored: (v) => v === true },
  lastList: { initial: () => '', stored: (v) => (typeof v === 'string' ? v : undefined) },
  // Redacted on the way in as on the way out: a value stored before 1.2.0 is
  // a full stream address, and the next save writes this one back.
  lastStation: { initial: () => '', stored: (v) => (typeof v === 'string' && v ? historyKey(v) : undefined) }
}
const SCALARS = Object.keys(FIELDS) as Scalar[]

const defaults = (instance: InstanceDefaults = {}): Prefs => ({
  columns: Object.fromEntries(COLUMNS.map((c) => [c.key, c.visible])),
  widths: { ...DEFAULT_WIDTHS },
  ...(Object.fromEntries(SCALARS.map((k) => [k, FIELDS[k].initial(instance)])) as Omit<Prefs, 'columns' | 'widths'>)
})

/** A width saved on a wide monitor must not swallow a laptop screen. */
export const clampRail = (v: number, viewport = window.innerWidth): number => {
  const room = Math.max(MIN_RAIL, Math.round(viewport * 0.4))
  return Math.max(MIN_RAIL, Math.min(Math.min(MAX_RAIL, room), Math.round(v)))
}
export const clampCol = (v: number): number => Math.max(MIN_COL, Math.round(v))

/**
 * Each value in `instance` is the administrator's starting value for one
 * preference: how many backups to keep, how many times to reconnect. It seeds
 * a device that has never stored the preference — a new user, a new browser —
 * and is then the user's to change. A device that has stored one keeps its
 * own; the instance value is a default, not a policy, so changing it later
 * does not reach back into choices people have made.
 */
export const usePreferences = (instance: InstanceDefaults = {}) => {
  const prefs = reactive<Prefs>(defaults(instance))

  let rewrite = false
  const load = () => {
    try {
      const raw = localStorage.getItem(KEY)
      if (!raw) return
      const stored = JSON.parse(raw) as Partial<Prefs>
      // Merge key by key: a stored file from an older version must not remove
      // preferences this version added, and an unknown key must not survive.
      // Nothing from storage is trusted as-is: enums are checked, numbers are
      // clamped, and keys this version does not know are dropped.
      const d = defaults(instance)
      if (stored.columns && typeof stored.columns === 'object') {
        for (const k of Object.keys(d.columns)) {
          if (typeof stored.columns[k] === 'boolean') prefs.columns[k] = stored.columns[k]
        }
      }
      if (stored.widths && typeof stored.widths === 'object') {
        for (const k of Object.keys(d.widths)) {
          const v = Number(stored.widths[k])
          if (Number.isFinite(v)) prefs.widths[k] = clampCol(v)
        }
      }
      // A field whose stored value is a choice only from a later version
      // (`since`) skips an older file's; files from before 1.2.0 carry no `v`.
      const written = (stored as { v?: unknown }).v
      const version = typeof written === 'number' ? written : 1
      for (const k of SCALARS) {
        const field = FIELDS[k] as Field<Scalar>
        if ((field.since ?? 0) > version) { rewrite = true; continue }
        const v = field.stored((stored as Record<string, unknown>)[k])
        if (v !== undefined) (prefs as Record<Scalar, unknown>)[k] = v
      }
      // A last station stored before 1.2.0 is a full address, token and all;
      // it is written back redacted now, not at the next change of any setting.
      if (typeof stored.lastStation === 'string' && stored.lastStation !== prefs.lastStation) rewrite = true
    } catch (e) {
      console.warn('[radio] stored preferences could not be read; using defaults', e)
    }
  }

  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...prefs, v: PREFS_VERSION }))
    } catch (e) {
      console.warn('[radio] preferences could not be saved on this device', e)
    }
  }

  load()

  // Dragging a column edge or the volume slider changes prefs dozens of times a
  // second; localStorage writes are synchronous. Coalesce, and flush on leave.
  let pending: ReturnType<typeof setTimeout> | undefined
  const saveSoon = () => {
    clearTimeout(pending)
    pending = setTimeout(save, 300)
  }
  watch(prefs, saveSoon, { deep: true })
  if (rewrite) save()
  const flush = () => { clearTimeout(pending); save() }
  if (typeof window !== 'undefined') window.addEventListener('pagehide', flush)
  /** Remove the page listener; each mount of the app used to add one more. */
  const destroy = () => {
    flush()
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', flush)
  }

  /** Everything back to its starting value; what Preferences' "Reset to defaults" means. */
  const reset = () => Object.assign(prefs, defaults(instance))
  /**
   * Only the table's shape. The Columns menu's Reset sits under "Show these
   * columns" and used to call `reset`, which also took the theme, the retry
   * count, the backup count, the volume and the last list with it.
   */
  const resetColumns = () => {
    const d = defaults(instance)
    Object.assign(prefs.columns, d.columns)
    Object.assign(prefs.widths, d.widths)
  }

  return { prefs, reset, resetColumns, save: flush, destroy }
}

/** Only the choices that travel; geometry is included on request. */
export const toProfile = (prefs: Prefs, includeGeometry: boolean) => {
  const data: Record<string, Record<string, string>> = {
    profile: { version: '1' },
    columns: Object.fromEntries(Object.entries(prefs.columns).map(([k, v]) => [k, String(v)]))
  }
  for (const k of SCALARS) {
    const where = FIELDS[k].profile
    if (!where || (where.geometry && !includeGeometry)) continue
    ;(data[where.section] ??= {})[where.key] = String(prefs[k])
  }
  if (includeGeometry) {
    Object.assign(data.layout ??= {}, Object.fromEntries(Object.entries(prefs.widths).map(([k, v]) => [k, String(v)])))
  }
  return data
}

/**
 * Apply a profile file. Applied wholesale — nothing is merged and nothing is
 * watched, so a profile saved elsewhere can never change this device on its
 * own. Unknown keys are ignored; values are checked as storage's are.
 */
export const fromProfile = (
  data: Record<string, Record<string, string>>,
  prefs: Prefs
): { applied: number; version: string } => {
  let applied = 0
  // `hasOwn`, not `in`: `'constructor' in prefs.columns` is true, and a
  // profile could plant own properties named after Object.prototype's.
  const has = (o: object | undefined, k: string): o is Record<string, string> => !!o && Object.hasOwn(o, k)
  for (const [k, v] of Object.entries(data.columns ?? {})) {
    if (Object.hasOwn(prefs.columns, k)) { prefs.columns[k] = iniBool(v, false); applied++ }
  }
  for (const k of SCALARS) {
    const where = FIELDS[k].profile
    const section = where && data[where.section]
    if (!where || !has(section, where.key)) continue
    const v = (where.text as (t: string) => unknown)(section[where.key])
    if (v !== undefined) { (prefs as Record<Scalar, unknown>)[k] = v; applied++ }
  }
  for (const [k, v] of Object.entries(data.layout ?? {})) {
    if (k === 'railWidth' || !Object.hasOwn(prefs.widths, k)) continue
    const n = finite(v)
    if (n !== undefined) { prefs.widths[k] = clampCol(n); applied++ }
  }
  return { applied, version: data.profile?.version ?? 'unknown' }
}
