// Probe: does the sample video have an audio track, and is AudioBufferSink usable?
import { chromium } from 'playwright-core'

const CDP = 'http://127.0.0.1:9223'
const VIDEO = 'D:/Project/tool-lam-video/test_exe_out/scene-01.mp4'

const browser = await chromium.connectOverCDP(CDP)
const page = browser.contexts()[0].pages()[0]
const logs = []
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`))

const out = await page.evaluate(async (src) => {
  const { Input, ALL_FORMATS, AudioBufferSink, createIpcFileSource } = await import('/src/core/media/mbDebug.ts')
  const input = new Input({ formats: ALL_FORMATS, source: createIpcFileSource(src) })
  const videoTrack = await input.getPrimaryVideoTrack()
  const audioTrack = await input.getPrimaryAudioTrack()
  const info = {
    duration: await input.computeDuration(),
    hasVideo: !!videoTrack,
    hasAudio: !!audioTrack
  }
  if (audioTrack) {
    info.audioCodec = audioTrack.codec
    const sink = new AudioBufferSink(audioTrack)
    let chunks = 0
    let lastTs = -1
    try {
      for await (const { buffer, timestamp } of sink.buffers(0, 2)) {
        chunks++
        lastTs = timestamp
        if (chunks >= 5) break
      }
    } catch (e) {
      info.sinkError = String(e)
    }
    info.chunks = chunks
    info.lastTs = lastTs
  }
  return info
}, VIDEO)
console.log('PROBE:', JSON.stringify(out))
for (const line of logs.slice(-10)) console.log(' ', line)
await browser.close()
