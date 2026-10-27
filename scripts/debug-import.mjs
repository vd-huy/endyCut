// Diagnose import: run the real importAssetFromFile pipeline for video,
// image and audio samples inside the live renderer and capture errors.
import { chromium } from 'playwright-core'

const CDP = 'http://127.0.0.1:9223'
const VIDEO = 'D:/Project/tool-lam-video/test_exe_out/scene-01.mp4'
const AUDIO = 'D:/Project/capcut clone/editor/tmp-loop/test-tone.wav'
const IMG = 'D:/Project/capcut clone/editor/tmp-loop/test-red.png'

const browser = await chromium.connectOverCDP(CDP)
const context = browser.contexts()[0]
const page = context.pages()[0]

const logs = []
page.on('console', (msg) => logs.push(`[console.${msg.type()}] ${msg.text()}`))
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`))
page.on('requestfailed', (req) => logs.push(`[requestfailed] ${req.url()} :: ${req.failure()?.errorText}`))

await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('canvas', { timeout: 20000 })
await page.waitForTimeout(500)

async function timedRun(label, src) {
  const result = await page.evaluate(async ({ label, src }) => {
    const started = performance.now()
    const out = { label, src, ok: false, asset: null, error: null, ms: 0 }
    try {
      const mod = await import('/src/core/media/assets.ts')
      const asset = await Promise.race([
        mod.importAssetFromFile(src),
        new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT 90s')), 90_000))
      ])
      out.asset = {
        kind: asset.kind,
        duration: Math.round(asset.duration * 100) / 100,
        width: asset.width,
        height: asset.height,
        hasThumb: !!asset.thumbnail,
        waveformLen: asset.waveform?.length ?? 0,
        rms: asset.rms ?? null,
        beats: asset.beats?.length ?? null,
        bpm: asset.bpm ?? null
      }
      out.ok = true
    } catch (e) {
      out.error = String(e)
    }
    out.ms = Math.round(performance.now() - started)
    return out
  }, { label, src })
  const status = result.ok ? 'OK  ' : 'FAIL'
  console.log(`${status} ${result.label} (${result.ms}ms)`, JSON.stringify(result.asset ?? { error: result.error }))
}

await timedRun('video', VIDEO)
await timedRun('image', IMG)
await timedRun('audio', AUDIO)

console.log('--- console logs while importing ---')
for (const line of logs.slice(-40)) console.log(' ', line)
await browser.close()
