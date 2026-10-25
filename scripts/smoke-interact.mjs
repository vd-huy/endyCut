// Interaction smoke test: add a text clip and verify it appears on the timeline.
import { chromium } from 'playwright-core'

const CDP = 'http://127.0.0.1:9223'

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

  // 1. Open the Text tab and add a title text clip.
  await page.getByText('Chữ', { exact: true }).first().click()
  await page.waitForTimeout(300)
  await page.getByText('Tiêu đề').click()
  await page.waitForTimeout(500)

  // 2. A text clip should now exist on the timeline (violet block with content).
  const clipOnTimeline = await page.locator('text=Chữ tiêu đề').count()
  const anyClip = await page.locator('text=Nhập chữ của bạn').count()

  // 3. Select it by clicking the clip, then check the inspector shows the text editor.
  if (anyClip > 0) {
    await page.locator('text=Nhập chữ của bạn').first().click()
    await page.waitForTimeout(300)
  }
  const inspectorContent = await page.locator('textarea').count()
  const inspectorTitle = await page.getByText('Nội dung', { exact: true }).count()

  // 4. Press space to start playback briefly.
  await page.keyboard.press('Space')
  await page.waitForTimeout(900)
  await page.keyboard.press('Space')

  await page.screenshot({ path: 'smoke-textclip.png', animations: 'disabled', timeout: 15000 }).catch((e) => console.log('screenshot failed:', e.message))

  console.log(JSON.stringify({ clipOnTimeline, anyClip, inspectorContent, inspectorTitle, errors: errors.slice(0, 8) }, null, 2))
  await browser.close()
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e.message)
  process.exit(1)
})
