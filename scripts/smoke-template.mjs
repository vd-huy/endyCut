// Template import smoke test: paste a real capcut.com template link, verify
// the project is auto-set up (canvas + locked preview reference track).
import { chromium } from 'playwright-core'

const CDP = 'http://127.0.0.1:9223'
const TEMPLATE_URL = process.env.TEMPLATE_URL || 'https://www.capcut.com/template-detail/Try-This-Template/7663774397588655381'

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

  // 1. Open the "Mẫu" tab.
  await page.getByText('Mẫu', { exact: true }).first().click()
  await page.waitForTimeout(300)

  // 2. Paste the template link and start the import.
  await page.getByPlaceholder('https://www.capcut.com/template-detail/…').fill(TEMPLATE_URL)
  await page.getByText('Tự dựng theo mẫu').click()

  // 3. Wait for the outcome panel (network fetch + preview download can take a while).
  let outcomeText = ''
  try {
    await page.getByText(/Đã dựng (khung|đầy đủ) theo mẫu/).waitFor({ timeout: 60000 })
    outcomeText = await page.getByText(/Đã dựng (khung|đầy đủ) theo mẫu/).textContent()
  } catch {
    outcomeText = 'TIMEOUT: outcome panel did not appear'
  }

  // 4. Verify project state via visible UI.
  await page.waitForTimeout(800)
  const referenceTrack = await page.getByText('Tham chiếu mẫu (khóa)').count()
  const dimensionLabel = await page.getByText(/720×1280|1080×1920/).count()
  const templateChip = await page.getByText(/Mẫu hiện tại:/).count()
  const stageChip = await page.getByText(/KHUNG|ĐẦY ĐỦ/).count()

  await page.screenshot({ path: 'smoke-template.png', animations: 'disabled', timeout: 15000 }).catch((e) => console.log('screenshot failed:', e.message))

  console.log(JSON.stringify({ outcomeText, referenceTrack, dimensionLabel, templateChip, stageChip, errors: errors.slice(0, 8) }, null, 2))
  await browser.close()
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e.message)
  process.exit(1)
})
