/**
 * The smallest INI reader that is honest about what it saw. Used for settings
 * profiles, which live in the user's own space and are meant to be opened in a
 * text editor — which is why this is INI and not JSON: a missing comma in JSON
 * produces an error the user cannot act on.
 */
import { normalise } from '../helpers/text'

export type Ini = Record<string, Record<string, string>>

/**
 * Sections and the table of them are built without a prototype. On an
 * ordinary object, a section named `[__proto__]` resolves to
 * `Object.prototype` and its keys land there, for every object on the page;
 * `[constructor]` does the same to `Object`. Profiles are the one file this
 * app expects to be carried between machines, so this is not hypothetical.
 */
export const parseIni = (text: string): Ini => {
  const out: Ini = Object.create(null)
  let section = 'general'
  for (const raw of normalise(text)) {
    const line = raw.trim()
    if (line === '' || line.startsWith(';') || line.startsWith('#')) continue
    const s = /^\[(.+)\]$/.exec(line)
    if (s) {
      section = s[1].trim()
      out[section] ??= Object.create(null)
      continue
    }
    const eq = line.indexOf('=')
    if (eq === -1) continue
    out[section] ??= Object.create(null)
    out[section][line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
  return out
}

export const serializeIni = (data: Ini, header?: string): string => {
  const out: string[] = []
  if (header) out.push(...header.split('\n').map((l) => `; ${l}`), '')
  for (const [section, values] of Object.entries(data)) {
    out.push(`[${section}]`)
    for (const [k, v] of Object.entries(values)) {
      out.push(`${k.replace(/[=\r\n[\]]/g, '')}=${String(v).replace(/[\r\n]/g, ' ')}`)
    }
    out.push('')
  }
  return out.join('\n')
}

export const iniBool = (v: string | undefined, fallback: boolean): boolean =>
  v === undefined ? fallback : /^(1|true|yes|on)$/i.test(v)
