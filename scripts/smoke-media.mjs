// Full media E2E: import a real video through the app's own pipeline, drop it
// on the timeline, verify playback changes frames, then export again.
import { chromium } from 'playwright-core'
import { stat } from 'node:fs/promises'

const CDP = 'http://127.0.0.1:9223'
const SRC = 'D:/Project/tool-lam-video/test_exe_out/scene-01.mp4'
const OUT = 'D:/Project/capcut clone/editor/smoke-export-media.mp4'

async function main() {
  const browser = await chromium.connectOverCDP(CDP)
  const context = browser.contexts()[0]
  const page = context.pages()[0]

  const errors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`))

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('canvas', { timeout: 15000 })
  await page.waitForTimeout(800)

  // 1. Import the sample video through the app's own import pipeline.
  const assetInfo = await page.evaluate(async (src) => {
    const mod = await import('/src/core/media/assets.ts')
    const asset = await mod.importAssetFromFile(src)
    const store = await import('/src/store/projectStore.ts')
    store.useProjectStore.getState().addAssetsToLibrary([asset])
    store.useProjectStore.getState().addAssetToTimeline(asset.id, 0)
    return { kind: asset.kind, duration: asset.duration, width: asset.width, height: asset.height, hasThumb: !!asset.thumbnail, hasWave: !!asset.waveform }
  }, SRC)
  console.log('asset:', JSON.stringify(assetInfo))
  await page.waitForTimeout(1200)

  // 2. Verify the library counter updated.
  const libCount = await page.getByText('1 video · 0 âm thanh · 0 ảnh').count().catch(() => 0)

  // 3. Playback: the playhead must advance and the video element must play.
  await page.keyboard.press('Space')
  await page.waitForTimeout(2500)
  const playback = await page.evaluate(() => {
    const el = [...document.querySelectorAll('span')].find((s) => /^\d\d:\d\d\.\d\d$/.test(s.textContent))
    const videos = [...document.querySelectorAll('video')]
    return {
      playhead: el?.textContent,
      videoCount: videos.length,
      videoPlaying: videos.some((v) => !v.paused && v.currentTime > 0),
      videoTime: videos[0]?.currentTime ?? null
    }
  })
  await page.keyboard.press('Space')
  console.log(JSON.stringify({ libCount, playback }))

  // 4. Export with media.
  await page.evaluate((path) => localStorage.setItem('cc-test-export-path', path), OUT)
  await page.getByText('Xuất video').click()
  await page.waitForTimeout(400)
  await page.getByText('Bắt đầu xuất').click()

  let lastStage = ''
  for (let i = 0; i < 240; i++) {
    await page.waitForTimeout(500)
    const stage = await page.getByText(/Đang|Hoàn tất|Lỗi|Đã hủy/).first().textContent().catch(() => '')
    if (stage && stage !== lastStage) {
      console.log('stage:', stage)
      lastStage = stage
    }
    if (stage?.includes('Hoàn tất') || stage?.includes('Lỗi')) break
  }

  let fileCheck = { exists: false, size: 0 }
  for (let i = 0; i < 20; i++) {
    try {
      const info = await stat(OUT)
      fileCheck = { exists: true, size: info.size }
      break
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  console.log(JSON.stringify({ fileCheck, errors: errors.slice(0, 8) }, null, 2))
  await page.screenshot({ path: 'smoke-media.png', animations: 'disabled', timeout: 15000 }).catch(() => {})
  await browser.close()
}

main().catch((e) => {
  console.error('MEDIA TEST FAILED:', e.message)
  process.exit(1)
})
