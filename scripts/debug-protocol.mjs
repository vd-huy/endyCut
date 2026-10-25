// Debug the media:// protocol from the renderer with console capture.
import { chromium } from 'playwright-core'

const browser = await chromium.connectOverCDP('http://127.0.0.1:9223')
const page = browser.contexts()[0].pages()[0]

const logs = []
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`))

const result = await page.evaluate(async () => {
  const p = 'D:/Project/tool-lam-video/test_exe_out/scene-01.mp4'
  const url = `media://local?f=${encodeURIComponent(p)}`
  const out = {}
  try {
    const res = await fetch(url)
    out.status = res.status
  } catch (e) {
    out.fetchError = String(e)
    out.cause = e.cause ? String(e.cause) : null
  }
  return out
})
console.log('RESULT:', JSON.stringify(result))
console.log('CONSOLE LOGS:')
for (const l of logs) console.log(' ', l)
await browser.close()
