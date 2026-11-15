type ScopeMode = 'analysed' | 'indicative' | 'idle'

export const BINS = 48
export const EDGE = 2 // at most two immobile bars at each end
const MID = (BINS - 1) / 2
/** Buckets per side: the display is mirrored around the centre. */
const HALF = Math.ceil(BINS / 2)

/**
 * Which frequency bucket a bar shows. The display is mirrored: low
 * frequencies in the middle, rising outwards to both edges. Both modes use
 * this, so a station that allows Web Audio and one that does not look like
 * the same instrument rather than two different ones. Exported so the tests
 * exercise the real mapping rather than a copy of it.
 */
export const bucketOf = (i: number): number => Math.floor(Math.abs(i - MID))

/** One of the bars held still at each end, in both modes. */
const still = (i: number): boolean => i < EDGE || i >= BINS - EDGE

/** Resting height profile for the indicative mode; 0 marks an immobile bar. */
export const shape = (i: number): number => {
  if (still(i)) return 0
  const d = Math.abs(i - MID) / MID
  return 0.22 + 0.78 * Math.pow(1 - d, 1.25)
}

/**
 * Log-spaced bucket boundaries over `n` FFT bins: linear bins put almost
 * everything in the first eighth, which reads as broken rather than as detail.
 * Constant per fftSize, so computed once rather than 60 times a second.
 */
export const bucketBounds = (n: number): Array<[number, number]> =>
  Array.from({ length: HALF }, (_, b) => {
    const lo = Math.floor(Math.pow(n, b / HALF))
    const hi = Math.min(n, Math.max(lo + 1, Math.floor(Math.pow(n, (b + 1) / HALF))))
    return [lo, hi]
  })

/**
 * Three states, and the middle one is a deliberate choice:
 *
 *   analysed   — Web Audio is available for this element; real frequency data
 *   indicative — the station blocks Web Audio but is playing; generated motion
 *   idle       — nothing is playing; a flat line
 *
 * The indicative state is not driven by the audio. It says "sound is coming
 * out", not "here is the sound". It runs only between `playing` and the next
 * stop, error or reconnect — never from the click, never during a failed
 * connection. That is the line between decoration and a lie.
 *
 * Rendering is a canvas, not 48 reactive DOM nodes: this runs at 60 Hz for as
 * long as anything plays and should cost nothing measurable.
 */
export const useSpectrum = () => {
  /** Plain, not reactive: only the drawing loop reads it. */
  let mode: ScopeMode = 'idle'

  let ctx: AudioContext | null = null
  let analyser: AnalyserNode | null = null
  let source: MediaElementAudioSourceNode | null = null
  let gain: GainNode | null = null
  let sourceEl: HTMLAudioElement | null = null
  let data: Uint8Array<ArrayBuffer> | null = null
  let bounds: Array<[number, number]> = []
  let canvas: HTMLCanvasElement | null = null
  let frame = 0
  let phase = 0
  const levels = new Float32Array(BINS).fill(0.03)
  const bucket = new Float32Array(HALF)

  /** Colours and gradient are read once per size/theme, not once per frame:
   *  `getComputedStyle` in a 60 Hz loop was the single most expensive call.
   *  `repaint` drops the cache; exported so the app can call it when it
   *  changes the role colours on its own root, which no observer here sees. */
  let paint: { h: number; grad: CanvasGradient } | null = null
  const repaint = () => { paint = null }

  /** Let go of the graph and the element it was built on. A
   *  MediaElementAudioSourceNode cannot be moved to another element, so a new
   *  element always means a new graph — and the old one must be unwired, or it
   *  stays connected to the speakers with a dead element as its input. */
  const release = () => {
    source?.disconnect()
    analyser?.disconnect()
    gain?.disconnect()
    source = null; analyser = null; gain = null; sourceEl = null
  }
  let themeWatch: MutationObserver | null = null

  const reduced = () =>
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

  const draw = () => {
    if (!canvas) return
    const g = canvas.getContext('2d')
    if (!g) return
    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth, h = canvas.clientHeight
    // Whole pixels: a canvas keeps its size truncated, so at 125 % or 150 %
    // scaling a fractional size never matched and the bitmap was rebuilt
    // every frame.
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr)
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw
      canvas.height = ph
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)
    if (!paint || paint.h !== h) {
      const styles = getComputedStyle(canvas)
      const grad = g.createLinearGradient(0, h, 0, 0)
      grad.addColorStop(0, styles.getPropertyValue('--oc-role-primary').trim() || '#00677f')
      grad.addColorStop(1, styles.getPropertyValue('--oc-role-tertiary').trim() || '#5a5c7e')
      paint = { h, grad }
    }
    g.fillStyle = paint.grad
    g.globalAlpha = mode === 'idle' ? 0.35 : 0.55
    const gap = 2
    const bw = (w - gap * (BINS - 1)) / BINS
    for (let i = 0; i < BINS; i++) {
      const bh = Math.max(2, levels[i] * h)
      g.fillRect(i * (bw + gap), h - bh, bw, bh)
    }
  }

  const step = () => {
    if (mode === 'analysed' && analyser && data) {
      analyser.getByteFrequencyData(data)
      for (let b = 0; b < HALF; b++) {
        const [lo, hi] = bounds[b]
        let sum = 0
        for (let j = lo; j < hi; j++) sum += data[j]
        bucket[b] = sum / (hi - lo) / 255
      }
      for (let i = 0; i < BINS; i++) {
        // Outermost bars stay still, matching the indicative mode exactly.
        const v = still(i) ? 0 : bucket[bucketOf(i)]
        levels[i] = Math.max(0.03, levels[i] + (v - levels[i]) * (v > levels[i] ? 0.6 : 0.14))
      }
    } else if (mode === 'indicative') {
      phase += 0.045
      for (let i = 0; i < BINS; i++) {
        const tilt = shape(i)
        if (tilt === 0) { levels[i] = 0.05; continue }
        const wob = 0.55 + 0.45 * Math.sin(phase * (0.7 + i * 0.035) + i * 0.6)
        const target = tilt * (0.35 + 0.65 * wob) * (0.75 + 0.25 * Math.random())
        levels[i] += (target - levels[i]) * (target > levels[i] ? 0.55 : 0.16)
      }
    }
    draw()
    frame = requestAnimationFrame(step)
  }

  const run = () => {
    cancelAnimationFrame(frame)
    if (mode === 'idle') { levels.fill(0.03); draw(); return }
    if (reduced()) { draw(); return }
    frame = requestAnimationFrame(step)
  }

  /** Give the composable its canvas. Safe to call with null on unmount. */
  const mount = (el: HTMLCanvasElement | null) => {
    canvas = el
    repaint()
    themeWatch?.disconnect()
    themeWatch = null
    if (el && typeof MutationObserver === 'function') {
      // The shell applies its theme as inline custom properties on <html>, so
      // a theme change there is a `style` mutation; nothing else on the page
      // tells the canvas about it.
      themeWatch = new MutationObserver(repaint)
      themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-theme', 'class'] })
    }
    draw()
  }

  /**
   * Called when an element is actually playing. `cors` says whether it was
   * loaded in CORS mode, i.e. whether routing it through Web Audio is safe.
   */
  const onPlaying = (el: HTMLAudioElement, cors: boolean) => {
    if (!cors) {
      // This element is not ours to analyse. If a previous one was, its graph
      // is still wired up; until 1.1.6 it stayed that way until the next CORS
      // station came along, which left `applyVolume`'s element check as the
      // only thing keeping a dead gain node from being treated as live.
      if (sourceEl !== el) release()
      mode = 'indicative'
      run()
      return
    }
    try {
      ctx ??= new AudioContext()
      if (sourceEl !== el) {
        release() // the old element was discarded by the player; its node goes with it
        source = ctx.createMediaElementSource(el)
        analyser = ctx.createAnalyser()
        analyser.fftSize = 2048
        analyser.smoothingTimeConstant = 0.75
        data = new Uint8Array(analyser.frequencyBinCount)
        bounds = bucketBounds(analyser.frequencyBinCount)
        // source -> analyser -> gain -> speakers.
        //
        // Volume MUST be applied after the analyser, not on the media element:
        // the element's own `volume` attenuates the signal before it reaches
        // the graph, so turning the sound down would flatten the display and
        // muting would empty it — even though the stream is still arriving.
        gain = ctx.createGain()
        // From silence, not from full: the level is handed over a moment later
        // as a ramp, and a node that starts at 1 was a full-volume blip — heard
        // even when muted — each time a graph was built.
        gain.gain.value = 0
        source.connect(analyser)
        analyser.connect(gain)
        gain.connect(ctx.destination)
        sourceEl = el
      }
      void ctx.resume()
      mode = 'analysed'
    } catch (e) {
      // createMediaElementSource throws if the element is already bound to
      // another context; there is nothing to read, so be honest about it.
      console.warn('[radio] web audio unavailable for this element', e)
      mode = 'indicative'
    }
    run()
  }

  /**
   * Set the listening level for the graph. Returns false when there is no
   * graph, in which case the caller falls back to the media element's own
   * volume — where attenuation is invisible to the display anyway, because
   * indicative motion is generated rather than measured.
   */
  const applyVolume = (volume: number, muted: boolean, el: HTMLAudioElement): boolean => {
    if (!gain || !ctx || sourceEl !== el) return false
    const target = muted ? 0 : Math.min(1, Math.max(0, volume))
    // A short ramp instead of a jump: an abrupt gain change clicks.
    gain.gain.setTargetAtTime(target, ctx.currentTime, 0.015)
    return true
  }

  const setIdle = () => {
    mode = 'idle'
    run()
  }

  const destroy = () => {
    cancelAnimationFrame(frame)
    themeWatch?.disconnect()
    themeWatch = null
    release()
    void ctx?.close()
    ctx = null; canvas = null
  }

  return { mount, onPlaying, applyVolume, setIdle, repaint, destroy }
}
