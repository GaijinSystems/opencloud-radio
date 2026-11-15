import { historyKey } from './safeUrl'

/** A value held under `key` itself, never one inherited from `Object.prototype`:
 *  these records are keyed by addresses out of files, and one of those may be
 *  the word `constructor`. */
export const own = <T>(record: Record<string, T>, key: string): T | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined

/**
 * The device's last-played times, as stored. Storage is not trusted as-is (the
 * same rule as preferences): an object of finite numbers keyed by string, or
 * nothing. Keys are passed through `historyKey` on the way in, which is also
 * the migration: before 1.2.0 they were full stream addresses, credentials
 * and tokens included. A key already in the new form comes through as it is;
 * should an old and a new spelling of one address both be there, the later
 * time is kept.
 */
export const readHistory = (stored: string | null): Record<string, number> => {
  const out: Record<string, number> = {}
  try {
    const raw: unknown = JSON.parse(stored ?? '{}')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue
      const key = historyKey(k)
      if (!Object.hasOwn(out, key) || out[key] < v) out[key] = v
    }
  } catch { /* nothing usable stored */ }
  return out
}
