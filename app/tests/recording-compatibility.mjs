// Synthetic images only. Does not start NVIDIA recording or access audio devices.
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { waitForRegionReady } from './region-ready.mjs'

const directory = mkdtempSync(join(tmpdir(), 'sobesych-recording-'))
const env = { ...process.env, SOBESYCH_DATA_DIR: directory, SOBESYCH_HEADLESS: '1', SOBESYCH_TEST_SCREEN: '1', SOBESYCH_SKIP_STT_WARMUP: '1', OPENAI_API_KEY: 'recording-fixture', OPENAI_BASE_URL: 'http://127.0.0.1:1' }
delete env.ELECTRON_RUN_AS_NODE
const executable = process.argv[2]
if (!executable) env.SOBESYCH_LAYOUT_TEST = '1'
const application = await electron.launch({ ...(executable ? { executablePath: resolve(executable) } : {}), args: executable ? [] : [resolve('.')], env })
try {
  const page = await application.firstWindow()
  await page.getByRole('button', { name: 'Начать звонок', exact: true }).waitFor()
  await application.evaluate(({ BrowserWindow, desktopCapturer, nativeImage, screen }) => {
    const win = BrowserWindow.getAllWindows()[0]
    globalThis.__captureTest = { visible: true, minimized: false, restored: 0, fail: false, protectionCalls: [], captures: 0 }
    const state = globalThis.__captureTest
    const protect = BrowserWindow.prototype.setContentProtection
    BrowserWindow.prototype.setContentProtection = function (enabled) {
      state.protectionCalls.push(enabled)
      return protect.call(this, enabled)
    }
    // Simulate visibility changes without showing a test window over the user's desktop.
    win.isVisible = () => state.visible
    win.isMinimized = () => state.minimized
    win.hide = () => { state.visible = false }
    win.showInactive = () => { state.visible = true; state.restored++ }
    desktopCapturer.getSources = async () => {
      state.captures++
      if (state.visible && !state.minimized) throw new Error('App window was not hidden before capture')
      if (state.fail) throw new Error('Synthetic capture failure')
      return screen.getAllDisplays().map(display => ({ display_id: String(display.id), thumbnail: nativeImage.createFromBitmap(Buffer.alloc(32 * 32 * 4, 255), { width: 32, height: 32 }) }))
    }
  })
  const snapshot = () => application.evaluate(({ BrowserWindow }) => ({ ...globalThis.__captureTest, nativeProtected: BrowserWindow.getAllWindows().some(win => win.isContentProtected()) }))
  const affinity = async () => {
    if (process.platform !== 'win32') return null
    // GetWindowDisplayAffinity requires a layered window. Apply opacity only to
    // the isolated hidden fixture, then restore it without changing protection.
    const { handle, opacity } = await application.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      const opacity = win.getOpacity()
      if (opacity === 1) win.setOpacity(0.99)
      return { handle: win.getNativeWindowHandle().readBigUInt64LE().toString(), opacity }
    })
    assert.match(handle, /^\d+$/)
    const script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class CaptureAffinity { [DllImport("user32.dll", SetLastError=true)] public static extern bool GetWindowDisplayAffinity(IntPtr hwnd, out uint affinity); }'; [uint32]$affinity = 0; if (![CaptureAffinity]::GetWindowDisplayAffinity([IntPtr]::new([long]${handle}), [ref]$affinity)) { throw "GetWindowDisplayAffinity failed" }; Write-Output $affinity`
    try { return Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, encoding: 'utf8', timeout: 10000 }).trim()) }
    finally { await application.evaluate(({ BrowserWindow }, opacity) => BrowserWindow.getAllWindows()[0].setOpacity(opacity), opacity) }
  }
  const capture = () => page.evaluate(() => window.sobesych.captureScreen())
  const result = await capture()
  assert.deepEqual((await snapshot()).protectionCalls, [], 'ordinary screenshots must never toggle OS capture protection')
  assert.equal(result.error, undefined, result.error)
  assert.match(result.screenshot, /^data:image\/png;base64,/)
  assert.equal((await snapshot()).restored, 1)
  assert.equal((await snapshot()).nativeProtected, false)
  console.log('PASS screenshot hides/restores the app without enabling capture protection')

  await application.evaluate(() => { globalThis.__captureTest.fail = true })
  assert.match((await capture()).error, /Synthetic capture failure/)
  assert.equal((await snapshot()).visible, true)
  assert.equal((await snapshot()).restored, 2)
  await application.evaluate(() => { Object.assign(globalThis.__captureTest, { fail: false, visible: false }) })
  assert.equal((await capture()).error, undefined)
  assert.equal((await snapshot()).visible, false, 'a hidden window must not appear after capture')
  await application.evaluate(() => { Object.assign(globalThis.__captureTest, { visible: true, minimized: true }) })
  assert.equal((await capture()).error, undefined)
  assert.equal((await snapshot()).restored, 2, 'a minimized window must not be restored by capture')
  await application.evaluate(() => { Object.assign(globalThis.__captureTest, { visible: true, minimized: false }) })
  console.log('PASS capture failure, hidden and minimized window restoration')

  const opened = application.waitForEvent('window')
  await page.evaluate(() => { window.__selection = window.sobesych.selectScreenRegion() })
  const selector = await opened
  await waitForRegionReady(selector)
  assert.equal((await snapshot()).nativeProtected, false, 'selection windows must not block desktop recorders')
  assert.deepEqual((await snapshot()).protectionCalls, [])
  const before = (await snapshot()).captures
  assert.match((await capture()).error, /Сначала заверши текущее выделение/)
  assert.equal((await snapshot()).captures, before, 'overlapping capture must not restore the main window early')
  assert.equal((await snapshot()).visible, false)
  await selector.evaluate(() => window.region.cancel()).catch(error => { if (!/closed/i.test(error.message)) throw error })
  assert.match((await page.evaluate(() => window.__selection)).error, /Выделение отменено/)
  assert.equal((await snapshot()).visible, true)
  assert.equal((await capture()).error, undefined, 'cancellation must release the capture lock')
  console.log('PASS region selection has no protected windows; overlap rejected and cancellation releases capture')

  await application.evaluate(({ dialog }) => {
    globalThis.__captureTest.dialogs = []
    dialog.showMessageBox = async (_window, options) => {
      globalThis.__captureTest.dialogs.push(options)
      return { response: 0 }
    }
  })
  await page.getByRole('button', { name: 'Включить скрытый режим', exact: true }).click()
  await page.getByRole('button', { name: 'Выключить скрытый режим', exact: true }).waitFor()
  assert.equal((await snapshot()).nativeProtected, false, "The ordinary eye toggle must allow desktop recording")
  if (process.platform === 'win32') assert.equal(await affinity(), 0, 'Windows itself must report WDA_NONE with the eye mode enabled')
  assert.deepEqual((await snapshot()).dialogs, [], 'Explicit privacy toggle must not open a native confirmation')
  assert.equal(await page.locator('.capture-warning').count(), 0, 'Privacy must not add a banner above the call')
  assert.ok((await page.evaluate(() => window.sobesych.setCaptureProtection('false'))).error, 'Invalid payload must not turn protection on')
  await capture()
  assert.deepEqual((await snapshot()).protectionCalls, [], 'The eye button and capture must never enable Windows protection by default')
  await page.reload()
  const privacyButton = page.getByRole('button', { name: 'Выключить скрытый режим', exact: true })
  await privacyButton.waitFor()
  assert.equal(await privacyButton.getAttribute('aria-pressed'), 'true', 'Reload must reflect the current privacy mode')
  assert.match(await privacyButton.getAttribute('title'), /Совместим с записью/)
  for (const [width, height] of [[1320, 860], [720, 600], [390, 844]]) {
    await application.evaluate(({ BrowserWindow }, { width, height }) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.setMinimumSize(320, 360); win.setContentSize(width, height)
    }, { width, height })
    await page.waitForFunction(width => innerWidth === width, width, { polling: 50 })
    // Visual fixtures use synthetic content; native flags are checked in the EXE too.
    if (!executable) await page.screenshot({ path: join(directory, `privacy-${width}.png`) })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    const button = await privacyButton.boundingBox()
    assert.ok(button && button.x >= 0 && button.x + button.width <= width, `Recording button must fit the settled ${width}px viewport: ${JSON.stringify(button)}`)
  }
  await page.getByRole('button', { name: 'Включить компактный оверлей', exact: true }).click()
  await page.locator('.overlay-shell').waitFor()
  await page.reload()
  await page.locator('.overlay-shell').waitFor()
  await privacyButton.click()
  await page.getByRole('button', { name: 'Включить скрытый режим', exact: true }).waitFor()
  assert.equal((await snapshot()).nativeProtected, false)
  assert.deepEqual((await snapshot()).protectionCalls, [])
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getOpacity()), 0.82, 'Recording compatibility must preserve the translucent overlay')
  assert.equal((await capture()).error, undefined)
  assert.equal((await snapshot()).nativeProtected, false, 'Screen tasks must not re-enable protection after recording mode')
  assert.ok(await page.getByRole('button', { name: 'Начать звонок', exact: true }).isEnabled())
  await page.getByRole('button', { name: 'Настройки', exact: true }).click()
  const help = page.getByRole('region', { name: 'Скрытый режим и запись', exact: true })
  await help.waitFor()
  assert.match(await help.innerText(), /OBS\/NVIDIA/)
  const exclusion = help.getByRole('checkbox', { name: 'Исключать окно из захвата', exact: true })
  await exclusion.click()
  await page.waitForFunction(() => document.querySelector('.privacy-settings input').checked)
  assert.equal((await snapshot()).nativeProtected, false, 'Choosing exclusion must not turn privacy on automatically')
  await help.getByRole('button', { name: 'Включить скрытый режим', exact: true }).click()
  assert.equal((await snapshot()).nativeProtected, true, 'Windows protection remains available only after explicit exclusion choice')
  if (process.platform === 'win32') {
    const excludedAffinity = await affinity()
    console.log(`INFO explicit exclusion: Windows affinity=${excludedAffinity}; Electron enabled=true. Hidden fixture does not establish exclusion from a real recording.`)
  }
  await exclusion.click()
  await page.waitForFunction(() => !document.querySelector('.privacy-settings input').checked)
  assert.equal((await snapshot()).nativeProtected, false, 'Switching back to recording must clear protection while privacy stays on')
  if (process.platform === 'win32') assert.equal(await affinity(), 0, 'Recording mode must clear Windows display affinity')
  assert.equal((await page.evaluate(() => window.sobesych.getConfig())).privacyEnabled, true)
  assert.deepEqual((await snapshot()).protectionCalls, [true, false])
  await page.reload()
  assert.equal((await page.evaluate(() => window.sobesych.getConfig())).captureExclusion, false)
  assert.equal((await snapshot()).nativeProtected, false)
  for (let index = 0; index < 10; index++) {
    await page.evaluate(() => window.sobesych.setCaptureProtection(false))
    await page.evaluate(() => window.sobesych.setCaptureProtection(true))
    await capture()
    assert.equal((await snapshot()).nativeProtected, false)
  }
  assert.deepEqual((await snapshot()).protectionCalls, [true, false], 'Repeated eye/capture operations must not silently re-enable exclusion')
  assert.ok((await page.evaluate(() => window.sobesych.setCaptureProtection(true, 'true'))).error)
  await page.getByRole('button', { name: 'Настройки', exact: true }).click()
  await page.getByRole('button', { name: 'Закрыть настройки', exact: true }).click()
  await page.getByRole('dialog', { name: 'Настройки', exact: true }).waitFor({ state: 'detached' })
  console.log(`PASS recording-compatible eye toggle, explicit exclusion opt-in/reset, 10 repeated captures, reload synchronization, validation and translucent overlay. Evidence: ${directory}; API cost $0, no recorder/devices`)
} finally {
  await application.close()
}
