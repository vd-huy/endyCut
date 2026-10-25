// E2E export test: export the current (text-only) project to MP4 by stubbing
// the native save dialog, then validate the produced file.
import { chromium } from 'playwright-core'
import { stat, readFile } from 'node:fs/promises'

const CDP = 'http://127.0.0.1:9223'
const OUT = 'D:\\Project\\capcut clone\\editor\\smoke-export.mp4'

async function main() {
  const browser = await chromium.connectOverCDP(CDP)
  const context = browser.contexts()[0]
  const page = context.pages()[0]

  const errors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`))

  await page.waitForSelector('canvas', { timeout: 10000 })

  // Set the test save path; ExportModal picks this up instead of the native
  // dialog (contextBridge objects cannot be monkey-patched from the page).
  await page.evaluate((path) => {
    localStorage.setItem('cc-test-export-path', path)
  }, OUT)

  await page.getByText('Xuất video').click()
  await page.waitForTimeout(400)
  await page.getByText('Bắt đầu xuất').click()

  // Poll progress state for up to 60s.
  let lastStage = ''
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(500)
    const stage = await page.getByText(/Đang|Hoàn tất|Lỗi|Đã hủy/).first().textContent().catch(() => '')
    if (stage && stage !== lastStage) {
      console.log('stage:', stage)
      lastStage = stage
    }
    if (stage?.includes('Hoàn tất') || stage?.includes('Lỗi')) break
  }

  const outputRow = await page.getByText(/Đã lưu:/).count().catch(() => 0)
  const errorText = await page.locator('.bg-red-950\\/60').first().textContent().catch(() => null)

  // The file write happens right after the final stage — poll briefly.
  let fileCheck = { exists: false, size: 0, ftyp: false }
  for (let i = 0; i < 20; i++) {
    try {
      const info = await stat(OUT)
      const head = await readFile(OUT, { length: 12 })
      fileCheck = { exists: true, size: info.size, ftyp: head.subarray(4, 8).toString('latin1') === 'ftyp' }
      break
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }

  await page.screenshot({ path: 'smoke-export.png', animations: 'disabled', timeout: 15000 }).catch(() => {})
  console.log(JSON.stringify({ outputRow, errorText, fileCheck, errors: errors.slice(0, 8) }, null, 2))
  await browser.close()
}

main().catch((e) => {
  console.error('EXPORT TEST FAILED:', e.message)
  process.exit(1)
})
