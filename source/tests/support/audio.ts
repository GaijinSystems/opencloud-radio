/**
 * A media element that behaves the way the HTML spec says about the two
 * things the player depends on and cannot see:
 *
 *  - `play()` returns a promise that stays pending until the load settles.
 *  - a new load (`src` set) or `pause()` rejects every pending promise with
 *    AbortError; a failed load fires `error` and THEN rejects them with
 *    NotSupportedError, in that order.
 *
 * Both 1.1.0 S1 bugs were the player's `play().catch` acting on a rejection
 * that belonged to a round which had already been replaced.
 */
export class FakeAudio extends EventTarget {
  private _src = ''
  preload = ''
  volume = 1
  muted = false
  crossOrigin: string | null = null
  error: { code: number } | null = null
  paused = true
  private pending: Array<(e: Error) => void> = []
  get src() { return this._src }
  set src(v: string) { this._src = v; this.error = null; loads.push(v); this.rejectAll('AbortError') }
  play() { this.paused = false; return new Promise<void>((_r, rej) => this.pending.push(rej)) }
  pause() { this.paused = true; this.rejectAll('AbortError') }
  removeAttribute(name: string) { if (name === 'src') { this._src = ''; this.rejectAll('AbortError') } }
  load() {}
  rejectAll(name: string) {
    const p = this.pending; this.pending = []
    for (const rej of p) { const e = new Error(name); e.name = name; rej(e) }
  }
  /** What the browser does when the resource cannot be fetched or decoded. */
  fail(code: number) {
    this.error = { code }
    const p = this.pending; this.pending = []
    this.dispatchEvent(new Event('error'))
    for (const rej of p) { const e = new Error('NotSupportedError'); e.name = 'NotSupportedError'; rej(e) }
  }
  succeed() { this.pending = []; this.dispatchEvent(new Event('playing')) }
}

/** Every element made since `installFakeAudio`, in order. */
export const created: FakeAudio[] = []
/** Every address handed to an element, in order: one entry per connection attempt. */
export const loads: string[] = []

/** `Audio` and `MediaError` as the player expects them, and empty records. */
export const installFakeAudio = () => {
  created.length = 0
  loads.length = 0
  ;(globalThis as unknown as { Audio: unknown }).Audio = class extends FakeAudio {
    constructor() { super(); created.push(this) }
  }
  ;(globalThis as unknown as { MediaError: unknown }).MediaError = {
    MEDIA_ERR_SRC_NOT_SUPPORTED: 4, MEDIA_ERR_NETWORK: 2, MEDIA_ERR_DECODE: 3
  }
}
