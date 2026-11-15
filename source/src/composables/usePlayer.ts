import { ref, shallowRef, computed, watch, toRaw, type Ref } from 'vue'
import type { Station } from '../parsers/types'
import type { RadioConfig } from '../config'
import { classifyUrl, explain, playsHere } from '../helpers/classify'
import { sameServers, serversOf, streamKey } from '../helpers/stations'
import { DEFAULT_VOLUME, clampVolume } from './usePreferences'
import { isSameOrigin, redact } from '../helpers/safeUrl'
import { reach } from '../helpers/relays'
import { Refused } from '../helpers/fetch'

export type PlayerState = 'idle' | 'connecting' | 'playing' | 'reconnecting' | 'resume' | 'failed'

/** The longest a stall is waited out, however many stray bytes or blips of sound arrive in it. */
const MAX_STALL_MS = 60_000
/** How long sound has to keep coming to end a stall — blips shorter than this continue it. */
export const GOOD_MS = 10_000
/** How long a pause the player did not make keeps the stream, for the system to resume it. */
export const PAUSE_GRACE_MS = 20_000

/** How long a stream must keep playing to count as recovered. */
export const STEADY_MS = 30_000

/**
 * Whether the bar's button means Stop. `resume` is a paused player asking
 * for a gesture; treating it as active made the "tap to resume" tap stop.
 * One definition, used by the player and drawn by the bar.
 */
export const isActiveState = (state: PlayerState): boolean =>
  state !== 'idle' && state !== 'failed' && state !== 'resume'

/**
 * The moves the player may make, and no others. Every change of state goes
 * through `to()`, which checks the move against this table: a move that is not
 * here is a mistake in this file, reported as one rather than drawn on screen
 * as a player that is "playing" after it was stopped. The bugs of five review
 * passes were, every one, a continuation acting on a play that had already
 * been replaced; the table is what makes such a move visible when it happens.
 */
export const TRANSITIONS: Readonly<Record<PlayerState, readonly PlayerState[]>> = {
  idle: ['idle', 'connecting', 'failed'],
  connecting: ['connecting', 'playing', 'reconnecting', 'resume', 'failed', 'idle'],
  playing: ['playing', 'connecting', 'reconnecting', 'resume', 'failed', 'idle'],
  reconnecting: ['reconnecting', 'connecting', 'playing', 'resume', 'failed', 'idle'],
  resume: ['connecting', 'playing', 'failed', 'idle'],
  failed: ['failed', 'connecting', 'idle']
}

export interface PlayerOptions {
  /**
   * Re-read a station's source playlist and return a fresh server list.
   * Called only when every known server has failed, and only when the caller
   * can actually read the file (same-origin relay, or a CORS-friendly host).
   */
  refreshServers?: (station: Station) => Promise<string[]>
  /** Whether station logos may be shown; absent means yes. Media Session artwork follows it. */
  showArtwork?: () => boolean
  /** Whether the caller wants Web Audio for this station right now. */
  wantAnalyser: () => boolean
  /** Reconnect attempts; may come from a preference rather than config. */
  attempts: () => number
  /**
   * Apply the listening level through the Web Audio graph. Returns true when
   * it handled it, in which case the media element is left at full volume so
   * the analyser keeps seeing the real signal.
   */
  applyGain?: (volume: number, muted: boolean, el: HTMLAudioElement) => boolean
  /**
   * Where the listening level lives. Given, the player reads and writes these
   * and nothing else: a level set from anywhere — the slider, Reset to
   * defaults, a profile — is heard at once. Until 1.2.0 the player kept a
   * copy of its own, and every other place that set the level had to remember
   * to tell it; Reset forgot once, and the slider and the sound disagreed.
   */
  level?: { volume: Ref<number>; muted: Ref<boolean> }
}

/**
 * One audio element, owned here rather than by a component, so moving between
 * views inside the app does not restart the stream.
 *
 * Stop, not pause: pausing a live stream either resumes minutes behind or
 * silently reconnects, and holds the connection open meanwhile. Stop releases
 * `src` and tears the element down; play opens a fresh connection.
 *
 * CORS and the analyser. Reading audio data needs the element routed through
 * Web Audio, which taints (silences) a cross-origin stream unless the element
 * was loaded with `crossOrigin="anonymous"` — and *that* makes stations without
 * an `Access-Control-Allow-Origin` header fail to load at all. So:
 *
 *   1. The attribute is set BEFORE `src`, or it does nothing.
 *   2. Whether CORS worked is decided by the load outcome — `playing` means yes,
 *      an `error` during the first CORS-mode load means no — not by whether a
 *      graph could be constructed, which always succeeds.
 *   3. A `MediaElementAudioSourceNode` cannot be detached. On a CORS failure the
 *      element is DISCARDED and a new one is created without the attribute.
 *      Reusing it would play silence, which is the one failure that must not
 *      happen.
 *
 * The outcome is cached per stream URL for the session.
 *
 * Failures. A load that fails is acted on only by the element's `error`
 * event; the `play()` promise is consulted for the one outcome that has no
 * event, a refusal to start without a gesture (see `open`).
 *
 * Plays and loads. A play is everything from choosing a station to stopping
 * or choosing another: its servers, which have been tried, how many back-offs
 * have been spent, whether its playlist has been re-read. That is one object,
 * `Play`, made new for each play and never reset field by field — a reset that
 * forgot one field, or ran in the wrong order, was the shape of three bugs in
 * 1.0.1 alone. A load is one `open()`, numbered by `loadSeq`, and every
 * asynchronous continuation — the element's events, the `play()` promise, the
 * refresh promise, the back-off and connect timers — carries the load or the
 * play it was started for and does nothing once that is no longer current.
 * Two 1.1.0 bugs were exactly a continuation acting on a load that was no
 * longer its own: a superseded `play()` promise rejects with AbortError and,
 * unguarded, its handler retried the *new* station or reopened the *old* one.
 */
export const usePlayer = (config: RadioConfig, options: PlayerOptions) => {
  /** The element in use. Plain, not reactive: nothing draws from it. */
  let audio: HTMLAudioElement | null = null
  const station = ref<Station | null>(null)
  const state = ref<PlayerState>('idle')
  const error = ref('')
  const volume = options.level?.volume ?? ref(DEFAULT_VOLUME)
  const muted = options.level?.muted ?? ref(false)
  /** true = CORS-mode load works, false = it does not, absent = untried. */
  const corsCache = new Map<string, boolean>()
  /** Whether the element currently in use was created in CORS mode. */
  let corsActive = false

  let timer: ReturnType<typeof setTimeout> | undefined
  let stallTimer: ReturnType<typeof setTimeout> | undefined
  let connectTimer: ReturnType<typeof setTimeout> | undefined
  /** Runs out once a stream has kept playing for `STEADY_MS`: see the `playing` listener. */
  let steadyTimer: ReturnType<typeof setTimeout> | undefined
  /** The steady time ran out during a stall: the play is settled when it plays again. */
  let steadyDue = false
  /** A failure, a new load or a stop: the steady time starts again from nothing. */
  const clearSteady = () => { clearTimeout(steadyTimer); steadyTimer = undefined; steadyDue = false }
  /** What failed before is history: the shortest wait again, every server and the playlist afresh. */
  const settle = () => {
    steadyDue = false
    current.attempt = 0
    current.tried = new Set([current.server])
    current.refreshed = false
    current.unread = undefined
  }
  /** Incremented by every `open()`; a continuation compares its own copy. */
  let loadSeq = 0
  /** Whether the load under way is the first CORS-mode load of its server. */
  let probing = false

  /** One play of one station: see the note above `usePlayer`. */
  interface Play {
    /** Index into the station's server list. */
    server: number
    /** The servers tried since the last back-off. */
    tried: Set<number>
    /** Back-offs spent. */
    attempt: number
    /** Whether the station's own playlist has been read again in this play. */
    refreshed: boolean
    /** Why it could not be, when it was refused: said when the play is given up on. */
    unread?: string
  }
  /**
   * The servers the station's playlist named when it was read again in this
   * play, used in place of the station's own until the play ends. The station
   * itself is not replaced: a copy with the first new server as its address
   * was not the row it came from any more, so the row neither showed it
   * playing nor stopped it — its button started the dead address again —
   * whenever the list did not take the new servers (read-only, say).
   */
  const reread = shallowRef<string[] | null>(null)
  const listOf = (s: Station): string[] => reread.value ?? serversOf(s)
  /**
   * The addresses of every row this play has been — the station it started
   * as, and any row it was found as since. With the server playing now, how
   * the player finds its row again when the list changes: see `follow`.
   */
  const wasRow = new Set<string>()
  /** Counts fresh plays, so a caller can note where each one started. */
  const plays = ref(0)
  const freshPlay = (): Play => {
    reread.value = null // a new play starts from the station's own servers
    wasRow.clear()
    return { server: 0, tried: new Set(), attempt: 0, refreshed: false }
  }
  /** The first server of `list` this play has not tried and this page can open; -1 when none is left. */
  const nextServer = (list: readonly string[], play: Play): number =>
    list.findIndex((u, i) => !play.tried.has(i) && playsHere(u))
  let current = freshPlay()

  /** The only place `state` is written. See `TRANSITIONS`. */
  const to = (next: PlayerState) => {
    if (!TRANSITIONS[state.value].includes(next)) {
      console.error(`[radio] player: no move from ${state.value} to ${next}`)
    }
    state.value = next
  }
  /**
   * Whether anything has EVER played on this device. Kept in localStorage,
   * because it is the only thing that separates "the policy blocks all media"
   * from "this particular station is down" — and a fresh tab must not forget
   * that a hundred stations played yesterday just because this one is dead.
   */
  const EVER_KEY = 'radio.everPlayed'
  let everPlayed = (() => { try { return localStorage.getItem(EVER_KEY) === '1' } catch { return false } })()
  const markPlayed = () => {
    if (everPlayed) return
    everPlayed = true
    try { localStorage.setItem(EVER_KEY, '1') } catch { /* device without storage */ }
  }

  type ElementListener = (el: HTMLAudioElement, corsActive: boolean) => void
  const elementListeners: ElementListener[] = []
  /** Fires whenever an element starts playing; the spectrum attaches here. */
  const onElementPlaying = (fn: ElementListener) => { elementListeners.push(fn) }

  /** The server this round is on; clamps in case the list shrank underneath it. */
  const currentUrl = (s: Station): string => {
    const list = listOf(s)
    return list[Math.min(current.server, list.length - 1)] ?? s.url
  }
  /** Which server is currently in use; surfaced so the UI can say so. */
  const currentServer = ref('')
  /** What was actually opened for it: the relay's address, for a relayed station. */
  let opened = ''
  /** The servers this play moves between: the station's, or what its playlist said when read again. */
  const servers = computed(() => (station.value ? listOf(station.value) : []))
  const serverCount = computed(() => servers.value.length)

  // Hedged on purpose: the same error code comes from a dead station, and the
  // only distinguisher is that nothing has ever played on this device yet.
  const POLICY_MESSAGE =
    'Nothing has played on this device yet, and this station could not be opened. If no station plays at all, the site does not allow audio from other hosts and an administrator needs to add media-src https: to the instance policy. If others play, this station is down.'

  /**
   * A policy refusal and a dead stream produce the same MediaError code, so the
   * distinguisher is whether ANY station has ever played on this device. If
   * none has, and the URL is a plausible https stream, the policy is by far the
   * likelier cause — and it is the one the user can act on.
   */
  const blockedByPolicy = (el: HTMLAudioElement): boolean => {
    if (everPlayed || el.error?.code !== MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) return false
    // The address actually opened: a relayed station's is this cloud's own.
    if (!opened.startsWith('https://')) return false
    return !isSameOrigin(opened, window.location.origin)
  }

  const describe = (el: HTMLAudioElement): string => {
    const code = el.error?.code
    if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
      if (opened && isSameOrigin(opened, window.location.origin)) {
        return 'This address returned something that is not audio — an error page, most likely. Check that it points at a stream.'
      }
      return 'The stream could not be opened. If no station plays at all, the site policy may not allow media from other hosts.'
    }
    if (code === MediaError.MEDIA_ERR_NETWORK) return 'The connection was lost.'
    if (code === MediaError.MEDIA_ERR_DECODE) return 'The stream is in a format this browser cannot decode.'
    return 'The station did not respond.'
  }

  /** Retrying a Content Security Policy refusal can never succeed, and five
   *  attempts bury the one line that says what to do. */
  const failForPolicy = () => {
    probing = false
    to('failed')
    error.value = POLICY_MESSAGE
  }
  /** The first CORS-mode load of this server failed: remember that, and try it
   *  again without CORS on a NEW element. Not counted as a reconnect attempt. */
  const retryPlain = (s: Station) => {
    corsCache.set(currentServer.value || s.url, false)
    probing = false
    open(s, { forcePlain: true })
  }
  /** Back to the station's first server with nothing tried; the rest of the play stands. */
  const restartServers = () => {
    current.server = 0
    current.tried = new Set()
  }

  const dispose = (el: HTMLAudioElement | null) => {
    if (!el) return
    el.pause()
    el.removeAttribute('src')
    el.load() // actually closes the connection; pause() alone does not
  }

  /** A fresh element whenever the CORS mode changes; listeners are bound per element. */
  const createElement = (cors: boolean): HTMLAudioElement => {
    dispose(audio)
    const el = new Audio()
    el.preload = 'none'
    el.volume = volume.value
    el.muted = muted.value
    if (cors) el.crossOrigin = 'anonymous' // before src, or it has no effect
    corsActive = cors

    // `audio` is replaced by every later `createElement` and cleared by
    // `destroy`, so this is false for any element that is no longer the one in use.
    const live = () => audio === el
    /**
     * A load that fails, or a stream that ends, while paused from outside: the
     * connection is let go and the station stays paused for a tap. Retried —
     * as a failure in any other state is — it came back on by itself, the
     * thing the pause is there to prevent (a station refusing the spectrum's
     * cross-origin check, paused while connecting, did so every time).
     */
    const failedWhilePaused = () => {
      if (state.value !== 'resume') return false
      clearGrace()
      dispose(el)
      return true
    }
    el.addEventListener('playing', () => {
      // Only while a load is wanted: an element the player stopped, or gave up
      // on, that starts after all is not a station playing — save the one
      // paused from outside, resumed from outside within its grace period (a
      // call ended, the system's play button): see the `pause` listener.
      const resumed = state.value === 'resume' && graceTimer !== undefined
      if (!live() || (!isActiveState(state.value) && !resumed)) return
      if (resumed) { clearTimeout(graceTimer); graceTimer = undefined }
      // Sound again — but a stall is over only once `GOOD_MS` of sound has
      // come in it, in all: blips of a second between long silences continue
      // the same stall, which is retried after `MAX_STALL_MS` of silence in
      // all, while a link that plays nine seconds in ten is soon over its.
      clearTimeout(stallTimer)
      stallTimer = undefined
      if (inStall) {
        const now = Date.now()
        if (silentFrom) { stallSilent += now - silentFrom; silentFrom = 0 }
        if (soundFrom) stallSound += now - soundFrom // a second `playing` with no silence between: still sound
        soundFrom = now
        clearTimeout(recoverTimer)
        recoverTimer = setTimeout(() => {
          recoverTimer = undefined
          clearStall()
          if (steadyDue) settle()
        }, Math.max(0, GOOD_MS - stallSound))
      }
      clearTimeout(connectTimer)
      clearTimeout(timer) // a back-off armed for a stall that has just mended itself
      const s = station.value
      if (s && cors) corsCache.set(currentServer.value || s.url, true)
      probing = false
      to('playing')
      // Recovered only once it has kept playing a while. A stream that plays
      // for a moment and drops (a "station offline" clip, a pre-roll that
      // hangs up) reset the back-off on every brief play, so it reconnected
      // about twice a second for as long as the tab was open, and never gave
      // up. After `STEADY_MS` of playing, what failed before is history: the
      // back-off starts again from the shortest wait, and a later failure
      // tries every server, and the playlist, afresh.
      //
      // The time is counted once per round, from the first `playing` after a
      // failure — a brief rebuffer does not start it again, or a flaky link
      // that rebuffers every twenty seconds never counted as recovered, and
      // its occasional real drops used up the retries one by one. Run out in
      // the middle of a stall, it waits for the stall to be over (sound for
      // `GOOD_MS` — see above); a stall that ends in a retry instead ends it
      // with nothing reset.
      if (steadyTimer === undefined && !steadyDue) {
        const steady = current
        steadyTimer = setTimeout(() => {
          steadyTimer = undefined
          if (current !== steady || state.value !== 'playing') return
          if (inStall) steadyDue = true // in a stall: when it is over
          else settle()
        }, STEADY_MS)
      }
      error.value = ''
      markPlayed()
      if (navigator.mediaSession) navigator.mediaSession.playbackState = 'playing'
      for (const fn of elementListeners) fn(el, cors)
    })
    // A late byte in a stall restarts its watch rather than ending it: a server
    // that sent one more packet and then held the connection open, silent,
    // left the bar saying "playing" for ever. The 18 s count from the last
    // byte — but a stall is given `MAX_STALL_MS` in all, or a server trickling
    // a byte now and then, never enough to play, held it there just the same.
    el.addEventListener('progress', () => { if (live() && stallTimer !== undefined) armStallWatch() })
    // Paused by something other than this player — the system unplugging
    // headphones, another app taking the audio, a phone call, a browser's own
    // controls. The bar went on saying "playing" over silence. Now the station
    // shows as paused ("Tap to resume") at once, and the stream is kept, paused,
    // for `PAUSE_GRACE_MS`: the system resumes short interruptions by itself
    // (a call ended, a voice assistant done), and on Android the media
    // notification and a headset's play button only reach a player that is
    // still there. After that the connection is closed: a live stream is not
    // held where it stopped, since resumed later it plays minutes-old audio
    // from the buffer, or nothing. A tap starts the station afresh either way.
    // Also while connecting or waiting to reconnect: ignored there, the retry
    // already armed started the stream again a moment later by itself — out of
    // the phone's speaker, with the headphones just unplugged. (Only an element
    // still playing can be paused: waiting out a stall, yes; after an error or
    // the end of the stream the system has nothing to pause, and the page is
    // not told.) The player's
    // own pauses all go through `dispose`, whose `load()` drops the event
    // before it is fired, or move to a state not handled here; setting a new
    // `src` fires none. The end of a stream fires `pause` too — `ended` deals
    // with that.
    el.addEventListener('pause', () => {
      if (!live() || !el.paused) return
      // Decided a moment later, not now: the end of a stream fires `pause`
      // and `ended` together, and whether `ended` already reads true when
      // `pause` is heard is up to the browser. By the next turn an `ended` or
      // `error` queued behind it has been dealt with, and the player has moved
      // on (a new load), which this sees.
      const load = loadSeq
      setTimeout(() => pausedFromOutside(load), 0)
    })
    const pausedFromOutside = (load: number) => {
      if (!live() || load !== loadSeq || !el.paused || el.ended || el.error) return
      if (state.value !== 'playing' && state.value !== 'connecting' && state.value !== 'reconnecting') return
      clearStall()
      clearSteady()
      clearTimeout(connectTimer)
      clearTimeout(timer)
      loadSeq++ // anything still in flight belongs to a load that is over
      probing = false
      to('resume')
      error.value = ''
      clearTimeout(graceTimer)
      graceTimer = setTimeout(() => {
        graceTimer = undefined
        if (state.value === 'resume' && audio === el) dispose(el)
      }, PAUSE_GRACE_MS)
      if (navigator.mediaSession) navigator.mediaSession.playbackState = 'paused'
    }
    el.addEventListener('waiting', () => {
      if (!live() || state.value !== 'playing') return
      // A stall begins, or — after sound too short to end it — goes on.
      clearTimeout(recoverTimer)
      recoverTimer = undefined
      const now = Date.now()
      if (!inStall) inStall = true
      else if (soundFrom) stallSound += now - soundFrom
      if (silentFrom) stallSilent += now - silentFrom // a second `waiting` with no sound between: still silent
      soundFrom = 0
      silentFrom = now
      if (stallSilent >= MAX_STALL_MS) { scheduleRetry('The stream stalled.'); return }
      armStallWatch() // and the steady time, if it runs out now, waits: see the `playing` listener
    })
    el.addEventListener('error', () => {
      if (!live()) return
      if (failedWhilePaused()) return
      clearTimeout(connectTimer)
      // The cross-origin check first. A station that refuses CORS fails its
      // first CORS-mode load with the same code a site policy refusal gives,
      // and on a device where nothing has played yet that was taken for the
      // policy: every new user, on every such station, was told to call an
      // administrator instead of being played the station plainly. A real
      // policy refusal now costs one plain retry, which fails into the
      // policy message below.
      if (probing && cors && station.value) {
        console.info('[radio] station does not allow cross-origin audio; analyser unavailable', redact(station.value.url))
        retryPlain(station.value)
        return
      }
      if (blockedByPolicy(el)) {
        failForPolicy()
        console.error('[radio] blocked by the site content security policy (media-src). ' +
          'No station can play until the instance allows media from other hosts.',
          { url: redact(station.value?.url ?? '') })
        return
      }
      scheduleRetry(describe(el))
    })
    el.addEventListener('ended', () => { if (live() && !failedWhilePaused()) scheduleRetry('The connection closed.') })

    audio = el
    return el
  }

  /**
   * Icecast streams rebuffer for a few seconds routinely; reconnecting is
   * slower than waiting. 18 s from the last byte (`progress` starts it again),
   * and never past the stall's `MAX_STALL_MS` of silence in all.
   */
  const armStallWatch = () => {
    clearTimeout(stallTimer)
    const silentSoFar = stallSilent + (silentFrom ? Date.now() - silentFrom : 0)
    stallTimer = setTimeout(() => {
      stallTimer = undefined
      if (state.value === 'playing') scheduleRetry('The stream stalled.')
    }, Math.max(0, Math.min(18_000, MAX_STALL_MS - silentSoFar)))
  }
  /** A new load, a retry, a stop, a stall over: nothing of it goes on. */
  const clearStall = () => {
    clearTimeout(stallTimer)
    stallTimer = undefined
    clearTimeout(recoverTimer)
    recoverTimer = undefined
    inStall = false
    stallSilent = stallSound = silentFrom = soundFrom = 0
  }
  /**
   * A stall, from its first `waiting` until `GOOD_MS` of sound has come in it:
   * the silence and the sound in it so far, and when the current stretch of
   * either began (0 when none is running).
   */
  let inStall = false
  let stallSilent = 0
  let stallSound = 0
  let silentFrom = 0
  let soundFrom = 0
  let recoverTimer: ReturnType<typeof setTimeout> | undefined
  /** Runs while a pause from outside keeps the stream: see the `pause` listener. */
  let graceTimer: ReturnType<typeof setTimeout> | undefined
  const clearGrace = () => { clearTimeout(graceTimer); graceTimer = undefined }

  /**
   * A server that accepts the connection and never sends a byte fires neither
   * `error` nor `playing`; without this the bar says "Connecting…" forever.
   */
  const CONNECT_TIMEOUT_MS = 25000
  const armConnectWatch = (load: number) => {
    clearTimeout(connectTimer)
    connectTimer = setTimeout(() => {
      if (load !== loadSeq) return
      if (state.value === 'connecting' || state.value === 'reconnecting') scheduleRetry('The station did not answer.')
    }, CONNECT_TIMEOUT_MS)
  }

  const scheduleRetry = (message: string) => {
    clearSteady() // it did not keep playing
    const s = station.value
    if (!s || state.value === 'idle') return
    clearStall()
    clearTimeout(connectTimer)
    console.warn('[radio] stream problem', { url: redact(currentServer.value), message })

    const list = listOf(s)
    const play = current
    play.tried.add(play.server)

    // A station's playlist lists several servers precisely so that one going
    // down is survivable. Move to the next immediately — waiting is only for
    // when they have all been tried.
    // Only one this browser can open at all: handing `open` an http backup
    // as "next" ended in "none of the servers can be opened", with a playable
    // primary sitting untried for the back-off that never came.
    const next = nextServer(list, play)
    if (next !== -1) {
      play.server = next
      to('reconnecting')
      error.value = message
      console.info('[radio] trying the next server', { server: redact(list[next]), of: list.length })
      open(s, { retrying: true })
      return
    }

    // Every server failed. Before backing off, ask for a fresh list once: the
    // file is the authority on which servers exist today.
    if (!play.refreshed && s.source && options.refreshServers) {
      play.refreshed = true
      to('reconnecting')
      error.value = message
      const load = loadSeq
      // The user may have stopped, or picked another station, while the
      // fetch was in flight. Either way this load is over; touching state
      // now would resurrect a stopped player or hijack the new station.
      // …or the stream may have come back by itself, and a stream that is
      // playing is not to be restarted on a fresh server list.
      // (Another station picked starts a new load and a new play; the station
      // itself is not compared, since the list changing may have given this
      // play its row afresh meanwhile — see `follow`.)
      const stillOurs = () => load === loadSeq && current === play && state.value === 'reconnecting'
      void options.refreshServers(s).then((fresh) => {
        if (!stillOurs()) return
        if (!fresh.length) return backOff(message)
        console.info('[radio] refreshed the server list from the playlist', { count: fresh.length })
        // Never written into the station here: the caller's `refreshServers`
        // is the one place that decides whether the file changes. These
        // servers belong to this play; if the list takes them, `follow` finds
        // the saved row by the one playing.
        reread.value = fresh
        restartServers()
        open(station.value ?? s, { retrying: true })
      }).catch((e: unknown) => {
        if (!stillOurs()) return
        // A playlist the page may not read is the administrator's to fix:
        // kept with the play, and said when the play is given up on, whatever
        // round that is — the bar says only "Reconnecting…" until then.
        if (e instanceof Refused) play.unread = `The station's playlist ${e.clause}`
        backOff(message)
      })
      return
    }

    backOff(message)
  }

  const backOff = (message: string) => {
    if (state.value === 'idle') return
    const play = current
    if (play.attempt >= options.attempts()) {
      // A load still under way must not start playing under "failed".
      clearTimeout(connectTimer)
      dispose(audio)
      to('failed')
      error.value = (serverCount.value > 1
        ? `${message} All ${serverCount.value} servers for this station were tried.`
        : message) + (play.unread ? ` ${play.unread}` : '')
      return
    }
    play.attempt += 1
    to('reconnecting')
    error.value = message
    const delay = Math.min(config.reconnectMaxDelayMs, 1000 * 2 ** (play.attempt - 1))
    const load = loadSeq
    timer = setTimeout(() => {
      if (load !== loadSeq || current !== play || !station.value || state.value !== 'reconnecting') return
      // From the first server again — decided now, not when the wait began:
      // a stream that mends itself meanwhile is still on the server it was.
      restartServers()
      open(station.value, { retrying: true })
    }, delay)
  }

  const sourceUrl = (s: Station, retrying: boolean): string => {
    // `currentServer` is the station's own address — what the bar shows and
    // titles are keyed by; what is opened is how this cloud reaches it.
    currentServer.value = currentUrl(s)
    const url = opened = reach(currentServer.value)
    if (!retrying || !config.cacheBustOnReconnect) return url
    return `${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`
  }

  /**
   * `retrying`: a later server or a back-off of the same play — keep the
   * round's position. `forcePlain`: the same server again without CORS after
   * the probe failed — ALSO keep the position: resetting it (as 1.1.3 did)
   * sent a station whose second server refused CORS back to its dead first one.
   */
  const open = (s: Station, { retrying = false, forcePlain = false } = {}) => {
    clearTimeout(timer)
    clearGrace()
    clearSteady()
    clearStall()
    const load = ++loadSeq
    if (!retrying && !forcePlain) {
      // A fresh play is a new `Play`. It has to exist BEFORE a server is
      // chosen, or a skip decided below is wiped out by starting afresh.
      current = freshPlay()
      wasRow.add(streamKey(s.url))
      error.value = ''
    }
    const play = current

    // Skip servers this browser cannot open at all — an http address among
    // https ones, say — rather than stopping at the first of them. Only when
    // every server is unplayable is there nothing to do.
    const list = listOf(s)
    if (!playsHere(currentUrl(s))) {
      const next = nextServer(list, play)
      if (next !== -1) {
        console.info('[radio] skipping a server this browser cannot open', { server: redact(currentUrl(s)) })
        play.tried.add(play.server)
        play.server = next
      } else {
        const verdict = classifyUrl(currentUrl(s))
        // Whatever was playing stops: the bar is about to show this station as
        // failed, with no Stop button for a stream still coming out.
        clearTimeout(connectTimer)
        dispose(audio)
        station.value = s
        to('failed')
        error.value = list.length > 1
          ? `${explain(verdict)} None of the ${list.length} servers for this station can be opened.`
          : explain(verdict)
        console.warn('[radio] not playable', { url: redact(s.url), reason: verdict, servers: list.length })
        return
      }
    }
    station.value = s
    to(retrying ? 'reconnecting' : 'connecting')
    if (!retrying && !forcePlain) plays.value++ // with the station set: see `plays`

    const known = corsCache.get(currentUrl(s))
    const cors = !forcePlain && options.wantAnalyser() && known !== false
    probing = cors && known === undefined

    // Reuse the element only when its CORS mode already matches; the mode
    // cannot be changed after the first load.
    const el = audio && corsActive === cors ? audio : createElement(cors)
    el.src = sourceUrl(s, retrying)
    armConnectWatch(load)

    el.play().catch((e: DOMException) => {
      // A load that fails is acted on in ONE place: the `error` event. The
      // browser fires it and only then rejects this promise (the media
      // element's failure steps, in that order), so acting here as well
      // handled every failure twice — half the reconnect attempts for a
      // station on one server, and all of them at once, undelayed, for a
      // station on two. 1.2.0 first guarded against the second call; the
      // guard then had to be re-armed when a stalled stream recovered, and
      // was not. There is no second call now, and nothing to guard.
      //
      // What is left is the one outcome with no event: the browser will not
      // start playback without a gesture. A load that never settles either
      // way is the connect timer's to catch.
      if (load !== loadSeq || audio !== el) return
      if (e?.name === 'NotAllowedError') {
        // Autoplay policy: after a reconnect some browsers want a fresh gesture.
        to('resume')
        error.value = 'Playback needs a tap to resume.'
      }
    })
    updateMediaSession(s)
  }

  const play = (s: Station) => open(s)

  const stop = () => {
    clearTimeout(timer)
    clearGrace()
    clearSteady()
    clearStall()
    clearTimeout(connectTimer)
    loadSeq++ // whatever was in flight belongs to a load that no longer exists
    current = freshPlay() // …and to a play that is over
    probing = false
    to('idle')
    error.value = ''
    currentServer.value = ''
    opened = ''
    dispose(audio)
    if (navigator.mediaSession) navigator.mediaSession.playbackState = 'paused'
  }

  const isActive = () => isActiveState(state.value)

  /** The element in use and whether it was loaded in CORS mode, for a caller
   *  that wants to attach the analyser to a stream already playing. */
  const element = () => ({ el: audio, cors: corsActive })

  /**
   * Keeps the player on the row it is playing whenever the list changes
   * under it. A row is known by its address, and every way of changing a
   * station's servers can change that address — the playlist read again,
   * Find backup servers, the station form, a reload after a refused save —
   * after which the row matched nothing playing, and its button started the
   * stream again rather than stopping it. The row is found again as one this
   * play has been, or as one that lists the server playing now — not merely
   * one sharing some backup, which another station in another list may well
   * do — and the player goes on as it, still on the servers it plays from,
   * so nothing is restarted.
   */
  const follow = (rows: readonly Station[], { sameList = false }: { sameList?: boolean } = {}): 'exact' | 'guess' | undefined => {
    const s = station.value
    // Also while paused from outside and still held: the system may resume it.
    if (!s || (!isActive() && !(state.value === 'resume' && graceTimer !== undefined))) return undefined
    // In order of certainty: the same row (ids last for one reading of the
    // file); a row with its address — taken up too, so a rename or a new logo
    // shows, and a reload's new ids are the ones used. Those are this stream
    // wherever it is listed ('exact': the caller may treat the play as that
    // list's from here on). The rest only in the list the play started from
    // (`sameList`), where a changed address is this station's own: a row this
    // play has been; a row whose own address is the server playing; and last,
    // a row listing that server among its backups — only if it is the one
    // row that does. Elsewhere, a station that shares a backup is another
    // station, and was taken for this one — shown, remembered, and its
    // playlist read into its row when every server failed.
    const exact = rows.find((r) => r.id === s.id && r.url === s.url) ?? rows.find((r) => r.url === s.url)
    let row = exact
    if (!row && sameList) {
      const playing = currentServer.value ? streamKey(currentServer.value) : ''
      const byServer = playing ? rows.filter((r) => serversOf(r).some((u) => streamKey(u) === playing)) : []
      row = rows.find((r) => wasRow.has(streamKey(r.url))) ??
        (playing ? rows.find((r) => streamKey(r.url) === playing) : undefined) ??
        (byServer.length === 1 ? byServer[0] : undefined)
    }
    if (!row) return undefined
    if (toRaw(s) !== row) {
      const playingFrom = listOf(s)
      station.value = row
      wasRow.add(streamKey(row.url))
      reread.value = sameServers(playingFrom, serversOf(row)) ? null : playingFrom
    }
    return exact ? 'exact' : 'guess'
  }


  const toggle = (s?: Station) => {
    const target = s ?? station.value
    if (!target) return
    if (isActive() && station.value?.url === target.url) stop()
    else play(target)
  }

  /**
   * Volume is applied to the graph where one exists, and to the element
   * otherwise. Never both: the element attenuates before the analyser sees the
   * signal, so using it would make the display fall with the volume and empty
   * on mute, while the stream is in fact still playing.
   */
  const applyLevel = () => {
    const el = audio
    if (!el) return
    // The graph may be attached to a PREVIOUS element (a station that allowed
    // Web Audio, followed by one that did not). Only a graph on this element
    // counts; otherwise the new element would play at full volume while the
    // gain node quietly controlled a dead one.
    const handled = options.applyGain?.(volume.value, muted.value, el) ?? false
    if (handled) {
      el.volume = 1
      el.muted = false
    } else {
      el.volume = volume.value
      el.muted = muted.value
    }
  }
  const setVolume = (v: number) => { volume.value = clampVolume(v, volume.value) }
  const setMuted = (m: boolean) => { muted.value = m }
  // Whoever sets the level, it is applied at once.
  watch([volume, muted], applyLevel, { flush: 'sync' })
  /** Called once a graph has attached, so the element can hand over. */
  const handOverLevel = () => applyLevel()

  /** What the lock screen and the OS media controls show: the track when one
   *  is known, the station otherwise. */
  let shown: { title: string; artist?: string } | null = null
  const describeToSystem = (s: Station) => {
    const ms = navigator.mediaSession
    if (!ms || typeof MediaMetadata === 'undefined') return
    ms.metadata = new MediaMetadata({
      title: shown?.title || s.name,
      artist: shown ? shown.artist || s.name : s.network || s.group || 'Internet radio',
      album: shown ? s.name : '',
      artwork: s.logo && (options.showArtwork?.() ?? true) ? [{ src: s.logo }] : []
    })
  }
  /** The track now playing, or null; shown by the system's media controls. */
  const showTrack = (t: { title: string; artist?: string } | null) => {
    shown = t && t.title ? t : null
    if (station.value) describeToSystem(station.value)
  }
  const updateMediaSession = (s: Station) => {
    const ms = navigator.mediaSession
    if (!ms) return
    describeToSystem(s)
    ms.setActionHandler('play', () => station.value && play(station.value))
    ms.setActionHandler('pause', stop) // there is nothing to pause; be honest about it
    ms.setActionHandler('stop', stop)
  }

  const destroy = () => {
    stop()
    audio = null
    const ms = navigator.mediaSession
    if (ms) {
      ms.metadata = null
      for (const a of ['play', 'pause', 'stop'] as const) ms.setActionHandler(a, null)
    }
  }

  return {
    station, state, error, volume, muted, currentServer, servers, serverCount, follow, plays,
    isActive, current: element, play, stop, toggle, showTrack, setVolume, setMuted, handOverLevel, onElementPlaying, destroy
  }
}
