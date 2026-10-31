import { describe, expect, it } from 'vitest'
import {
  createDenoiserState,
  denoiseBuffer,
  denoiseTuning,
  spectralDenoiseFrame
} from '../src/renderer/src/core/audio/denoise'

describe('denoiseTuning', () => {
  it('scales over-subtraction and depth with the rate', () => {
    const low = denoiseTuning(0.1, 'standard')
    const high = denoiseTuning(0.9, 'standard')
    expect(high.k).toBeGreaterThan(low.k)
    expect(high.floor).toBeLessThan(low.floor)
  })

  it('voice mode protects formants and boosts hiss suppression', () => {
    const t = denoiseTuning(0.5, 'voice')
    expect(t.voiceProtect).toBeGreaterThan(0)
    expect(t.hissBoost).toBeGreaterThan(1)
  })

  it('music mode is gentler than standard at the same rate', () => {
    const std = denoiseTuning(0.5, 'standard')
    const music = denoiseTuning(0.5, 'music')
    expect(music.k).toBeLessThan(std.k)
    expect(music.floor).toBeGreaterThan(std.floor)
  })
})

describe('spectralDenoiseFrame', () => {
  const tuning = denoiseTuning(0.8, 'standard')
  const RATE = 48_000
  const FFT = 1024

  it('primes the noise floor over the first frames (unity gain)', () => {
    const state = createDenoiserState(513)
    const mags = new Float64Array(513).fill(0.05)
    for (let i = 0; i < 7; i++) spectralDenoiseFrame(state, mags, tuning, RATE, FFT, 256)
    // During priming the signal passes through untouched.
    expect(mags.every((g) => g === 0.05)).toBe(true)
  })

  it('converges to strong suppression on steady noise, mild on loud content', () => {
    const state = createDenoiserState(513)
    const binHz = RATE / FFT
    const noiseBin = Math.round(1000 / binHz)
    const voiceBin = Math.round(500 / binHz)
    let noiseGain = 1
    let voiceGain = 1
    for (let f = 0; f < 60; f++) {
      const mags = new Float64Array(513)
      mags[noiseBin] = 0.04 + Math.random() * 0.005
      // The tone switches on after priming, like a voice starting mid-clip.
      mags[voiceBin] = f >= 8 ? 0.8 + Math.random() * 0.05 : 0.001
      spectralDenoiseFrame(state, mags, tuning, RATE, FFT, 256)
      if (f >= 20) {
        noiseGain = mags[noiseBin]
        voiceGain = mags[voiceBin]
      }
    }
    // The hiss floor is nearly gated out; the tone stays open (the floor only
    // rises near it, never toward strong energy).
    expect(noiseGain).toBeLessThan(0.1)
    expect(voiceGain).toBeGreaterThan(0.85)
    expect(voiceGain).toBeGreaterThan(noiseGain * 8)
  })

  it('keeps the rumble bins near silence', () => {
    const state = createDenoiserState(513)
    for (let f = 0; f < 12; f++) {
      const mags = new Float64Array(513).fill(0.5)
      spectralDenoiseFrame(state, mags, tuning, RATE, FFT, 256)
    }
    expect(state.prevGain[0]).toBeLessThanOrEqual(0.13)
  })
})

// Minimal AudioBuffer/BaseAudioContext stubs — denoiseBuffer only touches
// getChannelData/createBuffer/length/sampleRate/numberOfChannels.
function fakeBuffer(
  channels: number,
  length: number,
  sampleRate: number,
  fill?: (ch: number, i: number) => number
): AudioBuffer {
  const data = Array.from({ length: channels }, (_, ch) => {
    const arr = new Float32Array(length)
    if (fill) for (let i = 0; i < length; i++) arr[i] = fill(ch, i)
    return arr
  })
  return {
    numberOfChannels: channels,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: (ch: number) => data[ch],
    copyFromChannel: () => {},
    copyToChannel: () => {}
  } as unknown as AudioBuffer
}

const fakeCtx = {
  createBuffer: (channels: number, length: number, sampleRate: number) => fakeBuffer(channels, length, sampleRate)
} as unknown as BaseAudioContext

describe('denoiseBuffer', () => {
  it('returns the input untouched when disabled or too short', () => {
    const buf = fakeBuffer(1, 4096, 48_000, (_, i) => Math.sin(i / 10) * 0.5)
    expect(denoiseBuffer(fakeCtx, buf, { enabled: false, rate: 0.8, mode: 'standard' })).toBe(buf)
    expect(denoiseBuffer(fakeCtx, buf, { enabled: true, rate: 0, mode: 'standard' })).toBe(buf)
    const short = fakeBuffer(1, 512, 48_000, (_, i) => Math.sin(i / 10) * 0.5)
    expect(denoiseBuffer(fakeCtx, short, { enabled: true, rate: 0.8, mode: 'standard' })).toBe(short)
  })

  it('attenuates hiss and keeps a tone that starts mid-clip', () => {
    const rate = 48_000
    const length = 48_000 // 1 s
    const toneStart = Math.floor(length / 2)
    // Deterministic hiss (seeded LCG) so the assertion is stable.
    let seed = 12345
    const rand = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff
      return seed / 0x3fffffff - 1
    }
    const buf = fakeBuffer(1, length, rate, (_, i) => {
      const hiss = rand() * 0.05
      const tone = i >= toneStart ? Math.sin((2 * Math.PI * 500 * i) / rate) * 0.4 : 0
      return Math.max(-1, Math.min(1, hiss + tone))
    })
    const out = denoiseBuffer(fakeCtx, buf, { enabled: true, rate: 0.9, mode: 'standard' })
    expect(out).not.toBe(buf)
    expect(out.length).toBe(length)
    const seg = (b: AudioBuffer, from: number, to: number): number => {
      const d = b.getChannelData(0)
      let sum = 0
      for (let i = from; i < to; i++) sum += d[i] * d[i]
      return Math.sqrt(sum / (to - from))
    }
    // Hiss-only region: measurably quieter than the input.
    expect(seg(out, 10_000, 20_000)).toBeLessThan(seg(buf, 10_000, 20_000) * 0.9)
    // Tone region: the 500 Hz sine survives the gate (floor learned on hiss).
    expect(seg(out, 30_000, 45_000)).toBeGreaterThan(0.2)
  })
})
