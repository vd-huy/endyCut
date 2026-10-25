import type { AudioEffectKind } from '@shared/document'

/** Effects that get a live WebAudio chain during preview. */
export const PREVIEWABLE_EFFECTS: ReadonlySet<AudioEffectKind> = new Set([
  'echo',
  'reverb',
  'robot',
  'phone',
  'bass-boost',
  'noise-reduction'
])

/** Pitch presets, in semitones. */
export const PITCH_SEMITONES: Partial<Record<AudioEffectKind, number>> = {
  'high-pitch': 4,
  'low-pitch': -4
}

export interface EffectChain {
  nodes: AudioNode[]
  input: AudioNode
  output: AudioNode
}

/**
 * Build a WebAudio processing graph for one audio effect kind. Works in both
 * real-time AudioContexts (preview) and OfflineAudioContexts (export).
 */
export function buildEffectNodes(ctx: BaseAudioContext, kind: AudioEffectKind): EffectChain {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const nodes: AudioNode[] = []
  const track = <T extends AudioNode>(node: T): T => {
    nodes.push(node)
    return node
  }
  switch (kind) {
    case 'echo': {
      const delay = track(ctx.createDelay(1))
      delay.delayTime.value = 0.28
      const feedback = track(ctx.createGain())
      feedback.gain.value = 0.4
      const wet = track(ctx.createGain())
      wet.gain.value = 0.45
      input.connect(output) // dry
      input.connect(delay)
      delay.connect(feedback)
      feedback.connect(delay)
      delay.connect(wet)
      wet.connect(output)
      break
    }
    case 'reverb': {
      const convolver = track(ctx.createConvolver())
      convolver.buffer = makeReverbImpulse(ctx, 2.2, 2.5)
      const wet = track(ctx.createGain())
      wet.gain.value = 0.5
      const dry = track(ctx.createGain())
      dry.gain.value = 0.75
      input.connect(dry)
      dry.connect(output)
      input.connect(convolver)
      convolver.connect(wet)
      wet.connect(output)
      break
    }
    case 'robot': {
      // Amplitude-modulated distortion — classic robotic timbre.
      const shaper = track(ctx.createWaveShaper())
      shaper.curve = makeDistortionCurve(24)
      const carrier = track(ctx.createGain())
      carrier.gain.value = 0
      const osc = track(ctx.createOscillator())
      osc.type = 'sine'
      osc.frequency.value = 42
      const depth = track(ctx.createGain())
      depth.gain.value = 0.5
      osc.connect(depth)
      depth.connect(carrier.gain)
      const post = track(ctx.createGain())
      post.gain.value = 0.6
      input.connect(shaper)
      shaper.connect(carrier)
      carrier.connect(post)
      post.connect(output)
      if (osc instanceof OscillatorNode) osc.start(0)
      break
    }
    case 'phone': {
      const hp = track(ctx.createBiquadFilter())
      hp.type = 'highpass'
      hp.frequency.value = 320
      const lp = track(ctx.createBiquadFilter())
      lp.type = 'lowpass'
      lp.frequency.value = 3300
      const shaper = track(ctx.createWaveShaper())
      shaper.curve = makeDistortionCurve(8)
      input.connect(hp)
      hp.connect(lp)
      lp.connect(shaper)
      shaper.connect(output)
      break
    }
    case 'bass-boost': {
      const shelf = track(ctx.createBiquadFilter())
      shelf.type = 'lowshelf'
      shelf.frequency.value = 130
      shelf.gain.value = 10
      const comp = track(ctx.createDynamicsCompressor())
      comp.threshold.value = -22
      comp.ratio.value = 2.4
      input.connect(shelf)
      shelf.connect(comp)
      comp.connect(output)
      break
    }
    case 'noise-reduction': {
      const hp = track(ctx.createBiquadFilter())
      hp.type = 'highpass'
      hp.frequency.value = 85
      const lp = track(ctx.createBiquadFilter())
      lp.type = 'lowpass'
      lp.frequency.value = 11500
      const comp = track(ctx.createDynamicsCompressor())
      comp.threshold.value = -48
      comp.knee.value = 30
      comp.ratio.value = 3
      comp.attack.value = 0.003
      comp.release.value = 0.25
      input.connect(hp)
      hp.connect(lp)
      lp.connect(comp)
      comp.connect(output)
      break
    }
    default:
      input.connect(output)
  }
  return { nodes, input, output }
}

export function makeDistortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const samples = 256
  const curve = new Float32Array(samples) as Float32Array<ArrayBuffer>
  const k = amount
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1
    curve[i] = ((3 + k) * x * 0.5 * Math.PI) / (Math.PI + k * Math.abs(x))
  }
  return curve
}

export function makeReverbImpulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate
  const length = Math.max(1, Math.floor(rate * seconds))
  const impulse = ctx.createBuffer(2, length, rate)
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch)
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay)
    }
  }
  return impulse
}

/**
 * Duration-preserving pitch shift via overlap-add granular resampling.
 * Used at export time where an AudioBufferSourceNode cannot change pitch
 * without also changing duration.
 */
export function pitchShiftBuffer(ctx: BaseAudioContext, buffer: AudioBuffer, semitones: number): AudioBuffer {
  const ratio = Math.pow(2, semitones / 12)
  if (Math.abs(semitones) < 0.01 || buffer.length === 0) return buffer
  const channels = buffer.numberOfChannels
  const input: Float32Array[] = []
  for (let ch = 0; ch < channels; ch++) input.push(buffer.getChannelData(ch))

  const grain = 2048
  const hopOut = Math.floor(grain / 2)
  const hopIn = Math.max(1, Math.round(hopOut * ratio))
  const outLength = buffer.length
  const out: Float32Array[] = []
  for (let ch = 0; ch < channels; ch++) out.push(new Float32Array(outLength))
  const norm = new Float32Array(outLength)
  const window = new Float32Array(grain)
  for (let i = 0; i < grain; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (grain - 1))

  let inPos = 0
  let outPos = 0
  while (outPos + grain < outLength) {
    for (let i = 0; i < grain; i++) {
      const src = inPos + i * ratio
      const i0 = Math.floor(src)
      const frac = src - i0
      const w = window[i]
      for (let ch = 0; ch < channels; ch++) {
        const data = input[ch]
        const s0 = data[Math.min(i0, data.length - 1)] ?? 0
        const s1 = data[Math.min(i0 + 1, data.length - 1)] ?? 0
        out[ch][outPos + i] += (s0 + (s1 - s0) * frac) * w
      }
      norm[outPos + i] += w
    }
    inPos += hopIn
    outPos += hopOut
    if (inPos + grain >= buffer.length) break
  }
  const shifted = ctx.createBuffer(channels, outLength, buffer.sampleRate)
  for (let ch = 0; ch < channels; ch++) {
    const dest = shifted.getChannelData(ch)
    for (let i = 0; i < outLength; i++) {
      dest[i] = norm[i] > 1e-6 ? out[ch][i] / norm[i] : 0
    }
  }
  return shifted
}
