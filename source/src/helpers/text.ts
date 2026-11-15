/** Without a leading UTF-8 byte-order mark, which editors on some systems add. */
export const stripBom = (text: string): string => text.replace(/^\uFEFF/, '')

/** Strip a UTF-8 BOM and normalise line endings. Both are common in the wild. */
export const normalise = (text: string): string[] =>
  stripBom(text).replace(/\r\n?/g, '\n').split('\n')

/** What to show for something thrown: its message if it has one, else `fallback`. */
export const messageOf = (e: unknown, fallback: string): string =>
  e instanceof Error && e.message ? e.message : fallback

/** Up to two initials, for the logo fallback tile. */
export const initials = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()

/** A filename as `[base, extension]`; the extension keeps its dot, and is '' when there is none. */
export const splitName = (name: string): [base: string, ext: string] => {
  const ext = name.match(/\.[^.]+$/)?.[0] ?? ''
  return [name.slice(0, name.length - ext.length), ext]
}
/** A filename without its extension: what a list is called in the interface. */
export const baseName = (name: string): string => splitName(name)[0]

/**
 * A station name less whatever marks it as one server of several: SomaFM's
 * "… (#1)", SLAY Radio's "…, relay2 [shoutcast - kork]". Two entries that
 * reduce to the same string are the same station on two servers.
 */
export const stationBaseName = (name: string): string => stripServerSuffix(name).toLowerCase()

/**
 * The same reduction with its capitals kept: what the combined station is
 * called. Naming it from the comparison key saved "SomaFM: DEF CON Radio" as
 * "Somafm: def con radio".
 *
 * A number counts as a server index only when it is marked as one — "(#2)",
 * "[2]", "#2". A bare trailing number is part of the name: "BBC Radio 1" and
 * "BBC Radio 2" are two stations, and stripping it offered to merge them.
 *
 * The input is cut to a length no station name reaches: each of these
 * patterns backtracks quadratically on a long run of spaces or digits, and
 * the names come from a file someone else may have written.
 */
export const stripServerSuffix = (name: string): string =>
  name.slice(0, 256)
      .replace(/\s*(?:[([]#?\d+[)\]]|#\d+)\s*$/, '')
      .replace(/\s*[-–,]\s*(relay|server|mirror)\s*\d*.*$/i, '')
      .replace(/\s*\[[^\]]*\]\s*$/, '')
      .trim()

/** Selection rule for the header checkbox, kept pure so it can be tested.
 *  A partially-filled box reports `checked === true` when clicked; from
 *  partial, clicking must clear — what file managers do and what the box
 *  appears to offer. */
export const nextSelection = (checked: boolean, someChecked: boolean, all: string[]): string[] =>
  checked && !someChecked ? all : []
