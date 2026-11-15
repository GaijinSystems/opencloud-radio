import { ANONYMOUS, deadline, lateFetch, refused } from './fetch'
import { oneLine } from './safeUrl'

/**
 * Reading a station's current title out of its stream, the way a player does,
 * without disturbing playback.
 *
 * Asked with `Icy-MetaData: 1`, an Icecast or SHOUTcast server weaves a short
 * metadata block into the audio every `icy-metaint` bytes: one length byte
 * (in units of 16), then text such as `StreamTitle='Artist - Title';`. The
 * first block of a new connection carries the title playing now. So this
 * opens a connection of its own, reads up to the end of that first block,
 * and closes it: a few seconds of audio for one title. Playback is never
 * involved, and a failure here can never stop the sound.
 *
 * A page can only do this where the station allows it: the request header
 * needs a CORS preflight the station must answer, and the station must expose
 * `icy-metaint` to the page. Measured in November 2026, SomaFM does, every
 * channel; a stream relayed from the cloud's own origin needs no permission
 * at all. The alternative, kept as an addition to consider, is to play through
 * the Media Source API from the app's own fetch and take the titles from the
 * same bytes: no second request, but playback would then depend on that fetch.
 */

/** No server spaces its blocks further apart than this; a larger claim is not believed. */
export const MAX_METAINT = 262_144
/** The most a block can hold: one length byte, counting in sixteens. */
const MAX_BLOCK = 255 * 16

/** This server will not give a page its titles: no metadata offered, or not to this origin. */
export class IcyUnavailable extends Error {
  constructor(why: string) {
    super(why)
    this.name = 'IcyUnavailable'
  }
}

/**
 * Text that was encoded as UTF-8 twice, put right; anything else unchanged.
 *
 * Some stations' software does exactly that — SLAY Radio sends "é" as the
 * four bytes `c3 83 c2 a9`, which read as UTF-8 once are "Ã©" — and players
 * show the result. Undone only when it is unambiguous: every character is
 * one a byte can hold, a UTF-8 lead and continuation pair is present, and the
 * text, taken as bytes once more, is valid UTF-8. A title that really holds
 * "Ã©" fails that last test far more often than not, and stays as it is.
 */
export const undoubleUtf8 = (text: string): string => {
  if (!/[\u00c2-\u00f4][\u0080-\u00bf]/.test(text) || /[^\u0000-\u00ff]/.test(text)) return text
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(text, (c) => c.charCodeAt(0)))
  } catch {
    return text
  }
}

/**
 * The title in one metadata block's text, or '' when the block names none
 * (between tracks some stations send an empty title, or other fields only).
 * Titles are UTF-8 where the station is modern and Latin-1 where it is not;
 * bytes that are not valid UTF-8 are read as Latin-1 rather than as `�`.
 */
export const streamTitleOf = (block: Uint8Array): string => {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(block)
  } catch {
    text = new TextDecoder('latin1').decode(block)
  }
  const m = /StreamTitle='(.*?)';/s.exec(text.replace(/\0+$/, ''))
  return oneLine(undoubleUtf8(m?.[1] ?? ''))
}

/**
 * The title playing now on `url`. Throws `IcyUnavailable` when the server does
 * not offer it to this page, so the caller can stop asking; any other throw
 * is a failure of this one attempt.
 */
export const readIcyTitle = async (
  url: string,
  { request = lateFetch, signal, timeoutMs = 10_000 }: { request?: typeof fetch; signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<string> => {
  // Ended by the caller, by the time allowed, or — in `finally` — by having
  // read the title: the stream's own connection is closed whatever happened.
  const limit = deadline(signal, timeoutMs)
  try {
    let res: Response
    try {
      res = await request(url, {
        ...ANONYMOUS,
        headers: { 'Icy-MetaData': '1' },
        signal: limit.signal
      })
    } catch (e) {
      // A refused preflight and a blocked request look the same to a page: a
      // TypeError with no status. Either way, this server will not do it.
      if (refused(e)) throw new IcyUnavailable('the station does not allow this page to ask')
      throw e
    }
    const metaint = Number(res.headers.get('icy-metaint'))
    if (!res.ok || !res.body || !Number.isInteger(metaint) || metaint <= 0 || metaint > MAX_METAINT) {
      throw new IcyUnavailable(res.ok ? 'no title data offered to this page' : `HTTP ${res.status}`)
    }
    const reader = res.body.getReader()
    let have = new Uint8Array(0)
    for (;;) {
      if (have.length > metaint) {
        const end = metaint + 1 + have[metaint] * 16
        if (have.length >= end) return streamTitleOf(have.subarray(metaint + 1, end))
      }
      if (have.length > metaint + 1 + MAX_BLOCK) throw new Error('metadata block larger than allowed')
      const { done, value } = await reader.read()
      if (done) throw new Error('the stream ended before its first title')
      const next = new Uint8Array(have.length + value.length)
      next.set(have)
      next.set(value, have.length)
      have = next
    }
  } finally {
    limit.end()
  }
}
