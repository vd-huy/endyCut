import type { DenoiseMode, DenoiseSettings } from '@shared/document'

/**
 * Spectral-gating noise reduction — the local stand-in for CapCut's SAMI
 * neural denoise (draft `MaterialRealtimeDenoise`: `is_denoise` + `denoise_rate`
 * + `denoise_mode`). Per STFT frame the noise floor is tracked per bin with
 * minima-controlled recursive averaging, then a Wiener-style gain
 * `G = max(floor, (|X| − k·noise) / |X|)` suppresses bins below the floor.
 * `rate` (0..1) drives both the over-subtraction factor and the attenuation
 * depth; `mode` biases which bands are protected (voice formants / music).
 *
 * The same math runs in two shapes:
 *  - `denoiseBuffer`: one stateful pass over a whole decoded clip (export).
 *  - the AudioWorklet in `DENOISE_WORKLET_SRC`: streaming frames (preview).
 */

/** Per-bin tracking state shared by both the offline and worklet paths. */
export interface DenoiseTuning {
  /** Over-subtraction multiplier for `G = (mag − k·noise)/mag`. */
  k: number
  /** Minimum gain floor (linear), e.g. 0.01 ≈ −40 dB max attenuation. */
  floor: number
  /** Noise-floor rise time constant, seconds (slower = protects sustain). */
  tau: number
  /** Suppression relief (0..1) inside the 180 Hz–4 kHz formant band. */
  voiceProtect: number
  /** Extra suppression multiplier above 6.8 kHz (hiss lives there). */
  hissBoost: number
}

export function denoiseTuning(rate: number, mode: DenoiseMode): DenoiseTuning {
  const r = Math.min(1, Math.max(0, rate))
  let k = 1.1 + 2.4 * r
  let floor = Math.pow(10, -(8 + 30 * r) / 20)
  let tau = 1.2 - 0.7 * r
  let voiceProtect = 0
  let hissBoost = 1
  if (mode === 'voice') {
    voiceProtect = 0.45
    hissBoost = 1.35
    tau *= 0.85
  } else if (mode === 'music') {
    // Music has structured content everywhere — stay gentle to keep harmonics.
    k *= 0.7
    floor *= 3
    tau *= 1.6
  }
  return { k, floor, tau, voiceProtect, hissBoost }
}

/** Per-bin state: noise floor estimate + previous smoothed gain. */
export interface DenoiserState {
  noise: Float64Array
  prevGain: Float64Array
  primed: number
  primingMins: Float64Array | null
}

export function createDenoiserState(bins: number): DenoiserState {
  return { noise: new Float64Array(bins), prevGain: new Float64Array(bins).fill(1), primed: 0, primingMins: null }
}

const VOICE_LO_HZ = 180
const VOICE_HI_HZ = 4000
const HISS_HZ = 6800
const RUMBLE_HZ = 45

/**
 * Compute the suppression gain for one magnitude spectrum, advancing the noise
 * floor and gain-smoothing state. On return `mags` holds the per-bin gain.
 * Pure apart from the passed-in state, so the offline pass and the worklet
 * share this exact math (the worklet carries an inlined copy).
 * `hop` is the STFT hop in samples — it scales the floor's rise speed.
 */
export function spectralDenoiseFrame(
  state: DenoiserState,
  mags: Float64Array,
  tuning: DenoiseTuning,
  sampleRate: number,
  fftSize: number,
  hop: number
): void {
  const bins = mags.length
  const binHz = sampleRate / fftSize
  // Rise only near the floor; strong energy is treated as signal, not noise.
  const rise = Math.min(0.5, hop / sampleRate / tuning.tau)

  // Prime the noise floor from the first frames: per-bin running minimum.
  if (state.primed < 8) {
    if (!state.primingMins) {
      state.primingMins = new Float64Array(bins)
      state.primingMins.set(mags)
      state.noise.set(mags)
    } else {
      for (let i = 0; i < bins; i++) {
        if (mags[i] < state.primingMins[i]) state.primingMins[i] = mags[i]
      }
      state.noise.set(state.primingMins)
    }
    state.primed++
    if (state.primed < 8) return
  }

  // Minima-controlled tracking: fall fast, rise slowly near the floor only.
  for (let i = 0; i < bins; i++) {
    const n = state.noise[i]
    if (mags[i] < n) state.noise[i] = n + 0.5 * (mags[i] - n)
    else if (mags[i] < 2.2 * n) state.noise[i] = n + rise * (mags[i] - n)
  }

  // Frequency smoothing of the floor (3-bin) reduces random gate flicker.
  const smooth = new Float64Array(bins)
  for (let i = 0; i < bins; i++) {
    const a = state.noise[Math.max(0, i - 1)]
    const b = state.noise[i]
    const c = state.noise[Math.min(bins - 1, i + 1)]
    smooth[i] = (a + 2 * b + c) / 4
  }

  for (let i = 0; i < bins; i++) {
    const hz = i * binHz
    let k = tuning.k
    if (tuning.voiceProtect > 0) {
      if (hz >= VOICE_LO_HZ && hz <= VOICE_HI_HZ) k *= 1 - tuning.voiceProtect
      else if (hz > HISS_HZ) k *= tuning.hissBoost
    }
    const mag = mags[i]
    const target = mag > 1e-9 ? Math.max(tuning.floor, (mag - k * smooth[i]) / mag) : tuning.floor
    // Asymmetric temporal smoothing: fast open (attack), slower close
    // (release) — masks musical noise without smearing onsets.
    const prev = state.prevGain[i]
    const g = target > prev ? prev + 0.62 * (target - prev) : prev + 0.3 * (target - prev)
    state.prevGain[i] = g
    mags[i] = g
  }
  // DC/rumble bins never carry wanted content.
  const rumble = Math.max(1, Math.round(RUMBLE_HZ / binHz))
  for (let i = 0; i < rumble && i < bins; i++) state.prevGain[i] = Math.min(state.prevGain[i], 0.12)
}

// ---------------------------------------------------------------------------
// Whole-buffer pass (export)
// ---------------------------------------------------------------------------

const OFFLINE_FFT = 1024
const OFFLINE_HOP = 256

/** In-place iterative radix-2 FFT with precomputed tables. */
class FFT {
  private readonly rev: Uint32Array
  private readonly cosTable: Float64Array
  private readonly sinTable: Float64Array

  constructor(readonly size: number) {
    const bits = Math.log2(size)
    if (!Number.isInteger(bits)) throw new Error('FFT size must be a power of two')
    this.rev = new Uint32Array(size)
    for (let i = 0; i < size; i++) {
      let r = 0
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b)
      this.rev[i] = r
    }
    this.cosTable = new Float64Array(size / 2)
    this.sinTable = new Float64Array(size / 2)
    for (let i = 0; i < size / 2; i++) {
      this.cosTable[i] = Math.cos((-2 * Math.PI * i) / size)
      this.sinTable[i] = Math.sin((-2 * Math.PI * i) / size)
    }
  }

  forward(re: Float64Array, im: Float64Array): void {
    const n = this.size
    for (let i = 0; i < n; i++) {
      const j = this.rev[i]
      if (j > i) {
        let t = re[i]
        re[i] = re[j]
        re[j] = t
        t = im[i]
        im[i] = im[j]
        im[j] = t
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1
      const step = n / len
      for (let i = 0; i < n; i += len) {
        for (let j = 0; j < half; j++) {
          const tw = j * step
          const c = this.cosTable[tw]
          const s = this.sinTable[tw]
          const a = i + j
          const b = a + half
          const tre = re[b] * c - im[b] * s
          const tim = re[b] * s + im[b] * c
          re[b] = re[a] - tre
          im[b] = im[a] - tim
          re[a] += tre
          im[a] += tim
        }
      }
    }
  }

  /** Normalized inverse via conjugation (same tables). */
  inverse(re: Float64Array, im: Float64Array): void {
    const n = this.size
    for (let i = 0; i < n; i++) im[i] = -im[i]
    this.forward(re, im)
    const scale = 1 / n
    for (let i = 0; i < n; i++) {
      re[i] *= scale
      im[i] *= -scale
    }
  }
}

/**
 * Denoise a decoded clip buffer in one stateful pass. `rate` 0..1 mirrors the
 * CapCut strength slider; `mode` protects voice formants or music harmonics.
 * Returns the input buffer untouched when disabled or the rate is ~0.
 */
export function denoiseBuffer(ctx: BaseAudioContext, buffer: AudioBuffer, settings: DenoiseSettings): AudioBuffer {
  const rate = Math.min(1, Math.max(0, settings.rate))
  if (!settings.enabled || rate <= 0.001 || buffer.length === 0) return buffer
  // Shorter than one analysis frame — nothing to denoise.
  if (buffer.length < OFFLINE_FFT) return buffer

  const bins = OFFLINE_FFT / 2 + 1
  const fft = new FFT(OFFLINE_FFT)
  const window = new Float64Array(OFFLINE_FFT)
  for (let i = 0; i < OFFLINE_FFT; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (OFFLINE_FFT - 1))

  const tuning = denoiseTuning(rate, settings.mode)
  const channels: Float32Array[] = []
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) channels.push(buffer.getChannelData(ch))
  const out: Float64Array[] = channels.map(() => new Float64Array(buffer.length))
  const wsum = new Float64Array(buffer.length)

  // Per-channel scratch spectra; the gain comes from the joint (max-magnitude)
  // spectrum so stereo stays phase-coherent and the floor advances once.
  const reCh = channels.map(() => new Float64Array(OFFLINE_FFT))
  const imCh = channels.map(() => new Float64Array(OFFLINE_FFT))
  const joint = new Float64Array(bins)
  const state = createDenoiserState(bins)

  const nFrames = Math.max(1, Math.ceil((buffer.length - OFFLINE_FFT) / OFFLINE_HOP) + 1)
  for (let f = 0; f < nFrames; f++) {
    const offset = Math.min(buffer.length - OFFLINE_FFT, f * OFFLINE_HOP)
    for (let ch = 0; ch < channels.length; ch++) {
      const data = channels[ch]
      const re = reCh[ch]
      const im = imCh[ch]
      for (let i = 0; i < OFFLINE_FFT; i++) {
        re[i] = data[offset + i] * window[i]
        im[i] = 0
      }
      fft.forward(re, im)
    }
    for (let i = 0; i < bins; i++) {
      let m = 0
      for (let ch = 0; ch < channels.length; ch++) {
        const mag = Math.hypot(reCh[ch][i], imCh[ch][i])
        if (mag > m) m = mag
      }
      joint[i] = m
    }
    spectralDenoiseFrame(state, joint, tuning, buffer.sampleRate, OFFLINE_FFT, OFFLINE_HOP)
    for (let ch = 0; ch < channels.length; ch++) {
      const re = reCh[ch]
      const im = imCh[ch]
      for (let i = 0; i < bins; i++) {
        re[i] *= joint[i]
        im[i] *= joint[i]
      }
      for (let i = bins; i < OFFLINE_FFT; i++) {
        const g = joint[Math.min(bins - 1, OFFLINE_FFT - i)]
        re[i] *= g
        im[i] *= g
      }
      fft.inverse(re, im)
      const dest = out[ch]
      for (let i = 0; i < OFFLINE_FFT; i++) dest[offset + i] += re[i] * window[i]
      if (ch === 0) for (let i = 0; i < OFFLINE_FFT; i++) wsum[offset + i] += window[i] * window[i]
    }
  }

  const result = ctx.createBuffer(channels.length, buffer.length, buffer.sampleRate)
  for (let ch = 0; ch < channels.length; ch++) {
    const dest = result.getChannelData(ch)
    const src = out[ch]
    for (let i = 0; i < buffer.length; i++) {
      // Dividing by the accumulated window sum (Σw² = 1.5 in the interior)
      // reconstructs the signal exactly, including at the edges.
      dest[i] = wsum[i] > 1e-9 ? src[i] / wsum[i] : src[i]
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Streaming AudioWorklet (preview)
// ---------------------------------------------------------------------------

const DENOISE_WORKLET_SRC = /* js */ `
class FFT {
  constructor(size) {
    this.size = size
    const bits = Math.log2(size)
    this.rev = new Uint32Array(size)
    for (let i = 0; i < size; i++) {
      let r = 0
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b)
      this.rev[i] = r
    }
    this.cos = new Float64Array(size / 2)
    this.sin = new Float64Array(size / 2)
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / size)
      this.sin[i] = Math.sin((-2 * Math.PI * i) / size)
    }
  }
  forward(re, im) {
    const n = this.size
    for (let i = 0; i < n; i++) {
      const j = this.rev[i]
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t
        t = im[i]; im[i] = im[j]; im[j] = t
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1
      const step = n / len
      for (let i = 0; i < n; i += len) {
        for (let j = 0; j < half; j++) {
          const tw = j * step
          const c = this.cos[tw], s = this.sin[tw]
          const a = i + j, b = a + half
          const tre = re[b] * c - im[b] * s
          const tim = re[b] * s + im[b] * c
          re[b] = re[a] - tre; im[b] = im[a] - tim
          re[a] += tre; im[a] += tim
        }
      }
    }
  }
  inverse(re, im) {
    const n = this.size
    for (let i = 0; i < n; i++) im[i] = -im[i]
    this.forward(re, im)
    const sc = 1 / n
    for (let i = 0; i < n; i++) { re[i] *= sc; im[i] *= -sc }
  }
}

function tuningFor(rate, mode) {
  const r = Math.min(1, Math.max(0, rate))
  let k = 1.1 + 2.4 * r
  let floor = Math.pow(10, -(8 + 30 * r) / 20)
  let tau = 1.2 - 0.7 * r
  let voiceProtect = 0, hissBoost = 1
  if (mode === 'voice') { voiceProtect = 0.45; hissBoost = 1.35; tau *= 0.85 }
  else if (mode === 'music') { k *= 0.7; floor *= 3; tau *= 1.6 }
  return { k, floor, tau, voiceProtect, hissBoost }
}

const VOICE_LO_HZ = 180, VOICE_HI_HZ = 4000, HISS_HZ = 6800, RUMBLE_HZ = 45

class DenoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.fftSize = 512
    this.hop = 128
    this.bins = this.fftSize / 2 + 1
    this.fft = new FFT(this.fftSize)
    this.window = new Float64Array(this.fftSize)
    for (let i = 0; i < this.fftSize; i++) {
      this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (this.fftSize - 1))
    }
    // Hann² at 75% overlap sums to 1.5 — scale synthesis back to unity.
    this.overlapSum = 1.5
    this.tuning = tuningFor(0.6, 'standard')
    this.state = {
      noise: new Float64Array(this.bins),
      prevGain: new Float64Array(this.bins).fill(1),
      primed: 0,
      primingMins: null
    }
    // Absolute-sample-coordinated rings (indexed by sample time mod size).
    const R = this.fftSize * 4
    this.ringSize = R
    this.ring = [new Float64Array(R), new Float64Array(R)]
    this.outRing = [new Float64Array(R), new Float64Array(R)]
    this.ringWrite = 0 // next sample time to write into the input ring
    this.outStart = (R - (this.fftSize - this.hop)) % R // read lags OLA tail
    this.pending = 0
    this.re = [new Float64Array(this.fftSize), new Float64Array(this.fftSize)]
    this.im = [new Float64Array(this.fftSize), new Float64Array(this.fftSize)]
    this.joint = new Float64Array(this.bins)
    this.gains = new Float64Array(this.bins).fill(1)
    this.port.onmessage = (e) => {
      const d = e.data || {}
      this.tuning = tuningFor(d.rate ?? 0.6, d.mode ?? 'standard')
      if (d.reset) {
        this.state.noise.fill(0)
        this.state.prevGain.fill(1)
        this.state.primed = 0
        this.state.primingMins = null
      }
    }
  }
  process(inputs, outputs) {
    const input = inputs[0]
    const output = outputs[0]
    const frames = output[0].length
    if (!input || input.length === 0) {
      output.forEach((ch) => ch.fill(0))
      return true
    }
    const stereo = input.length > 1
    const R = this.ringSize
    for (let i = 0; i < frames; i++) {
      const w = (this.ringWrite + i) % R
      this.ring[0][w] = input[0][i] || 0
      this.ring[1][w] = (stereo ? input[1][i] : input[0][i]) || 0
    }
    this.pending += frames
    while (this.pending >= this.hop) {
      this.pending -= this.hop
      this.processHop()
    }
    for (let i = 0; i < frames; i++) {
      const idx = (this.outStart + i) % R
      output[0][i] = this.outRing[0][idx]
      output[1][i] = this.outRing[1][idx]
      this.outRing[0][idx] = 0
      this.outRing[1][idx] = 0
    }
    this.outStart = (this.outStart + frames) % R
    this.ringWrite = (this.ringWrite + frames) % R
    return true
  }
  processHop() {
    const N = this.fftSize
    const R = this.ringSize
    const bins = this.bins
    const st = this.state
    const t = this.tuning
    // Newest complete hop ends at ringWrite; the frame spans [start, start+N).
    const start = (this.ringWrite - this.hop + R) % R
    for (let ch = 0; ch < 2; ch++) {
      const re = this.re[ch]
      const im = this.im[ch]
      const ring = this.ring[ch]
      for (let i = 0; i < N; i++) {
        re[i] = ring[(start + i) % R] * this.window[i]
        im[i] = 0
      }
      this.fft.forward(re, im)
    }
    if (st.primed < 8) {
      for (let i = 0; i < bins; i++) {
        let m = 0
        for (let ch = 0; ch < 2; ch++) {
          const mag = Math.hypot(this.re[ch][i], this.im[ch][i])
          if (mag > m) m = mag
        }
        this.joint[i] = m
      }
      if (!st.primingMins) {
        st.primingMins = Float64Array.from(this.joint)
        st.noise.set(this.joint)
      } else {
        for (let i = 0; i < bins; i++) if (this.joint[i] < st.primingMins[i]) st.primingMins[i] = this.joint[i]
        st.noise.set(st.primingMins)
      }
      st.primed++
      return
    }
    for (let i = 0; i < bins; i++) {
      let m = 0
      for (let ch = 0; ch < 2; ch++) {
        const mag = Math.hypot(this.re[ch][i], this.im[ch][i])
        if (mag > m) m = mag
      }
      this.joint[i] = m
    }
    // Joint gain from the louder channel (mirrors denoise.ts).
    const binHz = sampleRate / this.fftSize
    const rise = Math.min(0.5, this.hop / sampleRate / t.tau)
    for (let i = 0; i < bins; i++) {
      const n = st.noise[i]
      const m = this.joint[i]
      if (m < n) st.noise[i] = n + 0.5 * (m - n)
      else if (m < 2.2 * n) st.noise[i] = n + rise * (m - n)
    }
    for (let i = 0; i < bins; i++) {
      const a = st.noise[Math.max(0, i - 1)]
      const b = st.noise[i]
      const c = st.noise[Math.min(bins - 1, i + 1)]
      const smooth = (a + 2 * b + c) / 4
      const hz = i * binHz
      let k = t.k
      if (t.voiceProtect > 0) {
        if (hz >= VOICE_LO_HZ && hz <= VOICE_HI_HZ) k *= 1 - t.voiceProtect
        else if (hz > HISS_HZ) k *= t.hissBoost
      }
      const mag = this.joint[i]
      const target = mag > 1e-9 ? Math.max(t.floor, (mag - k * smooth) / mag) : t.floor
      const prev = st.prevGain[i]
      const g = target > prev ? prev + 0.62 * (target - prev) : prev + 0.3 * (target - prev)
      st.prevGain[i] = g
      this.gains[i] = g
    }
    const rumble = Math.max(1, Math.round(RUMBLE_HZ / binHz))
    for (let i = 0; i < rumble && i < bins; i++) st.prevGain[i] = Math.min(st.prevGain[i], 0.12)
    // Apply the shared gain, invert, overlap-add into the output ring.
    for (let ch = 0; ch < 2; ch++) {
      const re = this.re[ch]
      const im = this.im[ch]
      for (let i = 0; i < bins; i++) {
        re[i] *= this.gains[i]
        im[i] *= this.gains[i]
      }
      for (let i = bins; i < N; i++) {
        const g = this.gains[Math.min(bins - 1, N - i)]
        re[i] *= g
        im[i] *= g
      }
      this.fft.inverse(re, im)
      const out = this.outRing[ch]
      for (let i = 0; i < N; i++) {
        out[(start + i) % R] += re[i] * this.window[i] / this.overlapSum
      }
    }
  }
}
registerProcessor('denoise-processor', DenoiseProcessor)
`

let denoiseModuleUrl: string | null = null

/**
 * Create the preview denoise AudioWorkletNode for a context. The worklet
 * module compiles once per process; repeated calls only instantiate nodes.
 * Returns null when AudioWorklet isn't available (caller plays unprocessed).
 */
export async function ensureDenoiseNode(
  ctx: BaseAudioContext,
  settings: DenoiseSettings
): Promise<AudioWorkletNode | null> {
  try {
    if (!denoiseModuleUrl) {
      denoiseModuleUrl = URL.createObjectURL(new Blob([DENOISE_WORKLET_SRC], { type: 'application/javascript' }))
    }
    await ctx.audioWorklet.addModule(denoiseModuleUrl)
    const node = new AudioWorkletNode(ctx, 'denoise-processor', { outputChannelCount: [2] })
    node.port.postMessage({ rate: settings.rate, mode: settings.mode })
    return node
  } catch {
    return null
  }
}
