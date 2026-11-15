import { computed, shallowRef } from 'vue'
import type { Station } from '../parsers/types'
import { readIcyTitle, IcyUnavailable } from '../helpers/icy'
import { reach } from '../helpers/relays'
import { ANONYMOUS, deadline, lateFetch } from '../helpers/fetch'
import { readCapped } from '../helpers/resolve'
import { trackFromText, publishedSources, fromStreamTitle, describeTrack, type Track } from '../helpers/nowPlaying'

/**
 * What is playing, from the best source a station offers, in this order:
 *
 *  1. The station's own now-playing address (`radio-nowplaying` in the list,
 *     "Now-playing address" in the form), when it has one — any answer
 *     `helpers/nowPlaying.ts` understands. This is the only way to KCUR,
 *     whose stream carries no titles.
 *  2. The address the stream's host publishes titles at, when the stream's
 *     own address says which host that is: AzuraCast, Radio.co, Triton,
 *     Zeno.FM (`publishedSources`). Nothing to configure.
 *  3. `/status-json.xsl` on the server playing (Icecast), then
 *     `/stats?sid=1&json=1` (SHOUTcast v2): one small request each, where
 *     the server allows a page to ask.
 *  4. The stream itself (ICY), read by a brief connection of its own: see
 *     `helpers/icy.ts`. This is how SomaFM and SLAY Radio give their titles.
 *
 * A source that never answered is remembered for the session, per server,
 * and not asked again: a station that does not cooperate costs one request
 * per source. One that has answered before is given another chance after a
 * failure, since a network blip is not a refusal.
 *
 * Polling is a timer per play, re-armed after each answer: every 30 s, or —
 * when the source says when the piece ends (Cadence does) — just after it
 * ends, and never more often than every 15 s, which is how long Cadence lets
 * its own answer be cached.
 */
const EVERY_MS = 30_000
/** No now-playing answer is this large; one that is, is not one. */
const MAX_ANSWER = 512 * 1024
/** The end of an event: a blank line, after any of the three line ends the format allows. */
const BLANK_LINE = /(?:\r\n|\r(?!\n)|\n)(?:\r\n|\r(?!\n)|\n)/
/** How long one source has to answer, body and all. */
const ANSWER_MS = 10_000
const SOONEST_MS = 15_000
const LATEST_MS = 120_000

interface Source {
  /** Remembered by this key when it fails: kind and server. */
  key: string
  read: (signal: AbortSignal) => Promise<Track | null>
}

export const useNowPlaying = ({ request = lateFetch }: { request?: typeof fetch } = {}) => {
  const track = shallowRef<Track | null>(null)
  /** One line for the player bar. */
  const title = computed(() => describeTrack(track.value))

  const refused = new Set<string>()
  const answered = new Set<string>()
  /** Each `start` is a play; a late answer for an earlier one is ignored. */
  let play: { timer?: ReturnType<typeof setTimeout>; abort: AbortController } | null = null

  /**
   * An answer's text, at most `MAX_ANSWER` of it. An event stream (Zeno) is
   * read to the end of its first event and then closed: it would otherwise
   * stay open for as long as anyone would let it.
   */
  const getText = async (url: string, playing: AbortSignal): Promise<string> => {
    // Ended by the play ending, or after ten seconds: a source that answers
    // and then sends nothing held every source after it — the status page,
    // the stream itself — until the station changed.
    const limit = deadline(playing, ANSWER_MS)
    try {
      const res = await request(url, { ...ANONYMOUS, signal: limit.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // An event stream (Zeno) is read to the end of its first event: it
      // would otherwise stay open for as long as anyone would let it. Only
      // where that end could now be is looked at, not all read so far again.
      const events = /text\/event-stream/i.test(res.headers?.get('content-type') ?? '')
      const text = await readCapped(res, MAX_ANSWER, events ? { until: (all, from) => BLANK_LINE.test(all.slice(Math.max(0, from - 3))) } : {})
      if (text === null) throw new Error('answer too large')
      return text
    } finally {
      limit.end()
    }
  }
  const keyed = (kind: string, url: string) => {
    try { return `${kind}:${new URL(url).origin}` } catch { return `${kind}:${url}` }
  }

  const sourcesFor = (s: Station, server: string): Source[] => {
    const out: Source[] = []
    const answer = (key: string, at: string): Source =>
      ({ key, read: async (signal) => trackFromText(await getText(at, signal), server) })
    if (s.nowPlaying) out.push(answer(`own:${s.nowPlaying}`, s.nowPlaying))
    for (const at of publishedSources(server)) out.push(answer(`published:${at}`, at))
    // What is opened: a relayed station's stream is read through the relay.
    const via = reach(server)
    let origin = ''
    try { origin = new URL(via).origin } catch { return out }
    // No status page is asked of a relay, or of this cloud: a relay re-serves
    // one path, and anything else under this origin is OpenCloud. For the
    // same reason a refusal there is remembered per path, not per origin —
    // relays share one, and one relay's refusal is its own.
    const here = via !== server || origin === globalThis.location?.origin
    if (!here) {
      out.push(answer(keyed('status', via), `${origin}/status-json.xsl`))
      out.push(answer(keyed('shoutcast', via), `${origin}/stats?sid=1&json=1`))
    }
    out.push({
      key: here ? `icy:${origin}${new URL(via).pathname}` : keyed('icy', via),
      read: async (signal) => fromStreamTitle(await readIcyTitle(via, { request, signal })) ?? { title: '' }
    })
    return out
  }

  const sameTrack = (a: Track | null, b: Track | null) =>
    a === b || (!!a && !!b && a.title === b.title && a.artist === b.artist && a.program === b.program)

  const nextIn = (t: Track | null): number => {
    if (!t?.endsAt) return EVERY_MS
    return Math.min(LATEST_MS, Math.max(SOONEST_MS, t.endsAt - Date.now() + 3_000))
  }

  /** `server` is the address being played, when it is not the station's first. */
  const start = (s: Station, server = s.url) => {
    stop()
    const mine = { abort: new AbortController() } as NonNullable<typeof play>
    play = mine
    const sources = sourcesFor(s, server)
    const poll = async () => {
      for (const source of sources) {
        if (refused.has(source.key)) continue
        try {
          const t = await source.read(mine.abort.signal)
          if (play !== mine) return
          // A JSON answer that is about some other stream says nothing about
          // this one: the next source is asked, as for a refusal.
          if (!t) throw new IcyUnavailable('no answer about this stream')
          answered.add(source.key)
          // The same piece again is not news: the bar, and the system's media
          // controls with their artwork, are redrawn only when it changes.
          const next = t.title ? t : null
          if (!sameTrack(track.value, next)) track.value = next
          mine.timer = setTimeout(poll, nextIn(t))
          return
        } catch (e) {
          if (play !== mine) return
          if (!answered.has(source.key) || e instanceof IcyUnavailable) refused.add(source.key)
          else { mine.timer = setTimeout(poll, EVERY_MS); return } // worked before: a blip, try it again later
        }
      }
      track.value = null // no source this station offers will answer
    }
    void poll()
  }

  const stop = () => {
    if (play) {
      clearTimeout(play.timer)
      play.abort.abort() // closes an ICY read still under way
    }
    play = null
    track.value = null
  }

  return { track, title, start, stop }
}
