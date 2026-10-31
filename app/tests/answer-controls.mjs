// Actual renderer layout and click handling, with synthetic devices and mock IPC only.
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const directory = mkdtempSync(join(tmpdir(), 'sobesych-answer-controls-'))
const executable = process.argv.find(arg => arg.startsWith('--exe='))?.slice(6)
const env = { ...process.env }
for (const name of Object.keys(env)) {
  if (name.startsWith('OPENAI_') || name.startsWith('OPENROUTER_')) delete env[name]
}
delete env.ELECTRON_RUN_AS_NODE
delete env.PORTABLE_EXECUTABLE_DIR
delete env.SOBESYCH_DEV_SERVER_URL
Object.assign(env, { OPENAI_API_KEY: 'controls-fixture-key', OPENAI_BASE_URL: 'http://127.0.0.1:1', SOBESYCH_DATA_DIR: directory, SOBESYCH_HEADLESS: '1', SOBESYCH_SKIP_STT_WARMUP: '1' })
env.SOBESYCH_LAYOUT_TEST = '1'
let application
const measurements = []
const errors = []
const questions = ['Что такое DNS?', 'Как работает DNS, почему один и тот же адрес иногда открывается на одном компьютере, но не открывается на другом, и как ты проверишь причину?']
try {
  application = await electron.launch({ executablePath: executable ? resolve(executable) : resolve('node_modules/electron/dist/electron.exe'), args: executable ? [] : [resolve('.')], cwd: directory, env })
  const page = await application.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await application.evaluate(({ ipcMain, globalShortcut }) => {
    globalShortcut.unregisterAll()
    ipcMain.removeHandler('audio:source')
    ipcMain.handle('audio:source', () => ({ sourceId: 'controls-fixture' }))
    ipcMain.removeHandler('provider:assist')
    ipcMain.handle('provider:assist', () => ({ answer: 'DNS переводит имя сайта в IP-адрес сервера. Компьютер сначала проверяет свой кэш, а затем спрашивает DNS-сервер.\n\nЕсли сайт открывается только на одном компьютере, сравню ответы nslookup на обоих. Проверю, какой DNS-сервер они используют и нет ли старой записи в кэше или файле hosts. Так можно понять, проблема в DNS или уже в подключении к самому серверу.', usage: { cost: 0 } }))
    ipcMain.removeHandler('local-stt:warm')
    ipcMain.handle('local-stt:warm', () => ({ ok: true, backend: 'cpu', previewEnabled: false }))
  })
  await page.addInitScript(() => {
    const track = kind => ({ kind, enabled: true, readyState: 'live', stop() { this.readyState = 'ended' } })
    class Stream {
      constructor(tracks) { this.tracks = tracks }
      getTracks() { return this.tracks }
      getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio') }
      getVideoTracks() { return this.tracks.filter(track => track.kind === 'video') }
    }
    class Context {
      sampleRate = 16000; state = 'running'; destination = {}; audioWorklet = { addModule: async () => {} }
      createMediaStreamSource() { return { connect: node => node } }
      createGain() { return { gain: { value: 0 }, connect() {} } }
      async resume() {}
      async close() { this.state = 'closed' }
    }
    class Worklet {
      port = { postMessage: data => queueMicrotask(() => this.port.onmessage?.({ data: { type: 'flushed', id: data.id } })) }
      connect(node) { return node }
    }
    window.captureAttempts = 0
    navigator.mediaDevices.getUserMedia = async constraints => {
      window.captureAttempts++
      if (window.failCapture) throw new Error('Synthetic device unavailable')
      return new Stream([track('audio'), ...(constraints.video ? [track('video')] : [])])
    }
    navigator.mediaDevices.getDisplayMedia = async () => { throw new Error('Physical capture forbidden') }
    navigator.mediaDevices.enumerateDevices = async () => []
    window.AudioContext = Context; window.AudioWorkletNode = Worklet; window.MediaStream = Stream
  })
  await page.reload()
  await page.getByRole('button', { name: 'Начать звонок', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Практика', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Выделить задачу', exact: true }).count(), 0)
  assert.equal(await page.locator('.brand img').count(), 0)
  assert.equal(await page.evaluate(() => window.captureAttempts), 0)
  assert.equal(await page.evaluate(() => performance.getEntriesByType('resource').some(entry => entry.name.includes('practice-bank'))), false)
  await page.screenshot({ path: join(directory, 'start.png') })
  await page.evaluate(() => { window.failCapture = true })
  await page.getByRole('button', { name: 'Начать звонок', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Не удалось подключить звук собеседника' }).waitFor()
  assert.equal(await page.locator('.overlay-shell').count(), 0, 'Failed audio connection must keep the start screen')
  await page.evaluate(() => { window.failCapture = false })
  await page.getByRole('button', { name: 'Начать звонок', exact: true }).click()
  await page.getByRole('button', { name: 'Пауза', exact: true }).waitFor()
  await page.locator('.overlay-shell').waitFor()
  const compact = await application.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; return { opacity: win.getOpacity(), onTop: win.isAlwaysOnTop(), protected: win.isContentProtected() } })
  assert.deepEqual(compact, { opacity: 0.82, onTop: true, protected: false }, 'Explicit call start opens overlay without enabling privacy')
  await page.screenshot({ path: join(directory, 'call-auto-overlay.png') })
  await page.getByRole('button', { name: 'Выключить компактный оверлей', exact: true }).click()
  await page.locator('.shell:not(.overlay-shell)').waitFor()
  await page.getByRole('status', { name: 'Движок распознавания' }).filter({ hasText: 'CPU' }).waitFor()
  const bounds = () => page.locator('.ai-tools').evaluate(element => [...element.querySelectorAll('button')].map(button => {
    const { x, y, width, height } = button.getBoundingClientRect()
    return { x, y, width, height }
  }))
  for (const viewport of [{ width: 1320, height: 860 }, { width: 760, height: 760 }, { width: 560, height: 740 }, { width: 720, height: 540, overlay: true }]) {
    if (viewport.overlay) {
      await page.getByRole('button', { name: 'Включить компактный оверлей', exact: true }).click()
      await page.locator('.shell.overlay-shell').waitFor()
    }
    await page.setViewportSize(viewport)
    const initial = await bounds()
    for (const [index, question] of questions.entries()) {
      if (viewport.overlay) {
        await page.getByRole('button', { name: 'Выключить компактный оверлей', exact: true }).click()
        await page.locator('.shell:not(.overlay-shell)').waitFor()
      }
      await page.getByRole('textbox', { name: 'Реплика собеседника', exact: true }).fill(question)
      await page.getByRole('button', { name: 'Добавить реплику', exact: true }).click()
      await page.getByTestId('heard-question').getByText(question, { exact: true }).waitFor()
      if (viewport.overlay) {
        await page.getByRole('button', { name: 'Включить компактный оверлей', exact: true }).click()
        await page.locator('.shell.overlay-shell').waitFor()
        await page.setViewportSize(viewport)
      }
      const current = await bounds()
      measurements.push({ viewport, state: index ? 'wrapped-question' : 'short-question', initial, current })
      assert.equal(current.length, 2)
      for (let button = 0; button < 2; button++) {
        for (const axis of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(current[button][axis] - initial[button][axis]) <= 1, `Button ${button} ${axis} shifted at ${viewport.width}px (${current[button][axis]} vs ${initial[button][axis]})`)
        if (viewport.overlay) assert.ok(current[button].y >= 0 && current[button].y + current[button].height <= viewport.height, 'Compact controls must remain inside the viewport')
      }
    }
    if (!viewport.overlay) await page.locator('.ai-tools').scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(directory, `controls-${viewport.overlay ? 'overlay' : viewport.width}.png`) })
  }
  await page.getByRole('button', { name: 'Выключить компактный оверлей', exact: true }).click()
  await page.locator('.shell:not(.overlay-shell)').waitFor()
  await page.setViewportSize({ width: 1320, height: 860 })
  const started = performance.now()
  await page.getByRole('button', { name: 'Что сказать?', exact: true }).click()
  const clickMs = Math.round(performance.now() - started)
  await page.locator('.answer').waitFor()
  assert.ok(clickMs < 1000, `Idle answer click took ${clickMs} ms`)
  await page.getByRole('button', { name: 'Включить компактный оверлей', exact: true }).click()
  await page.locator('.overlay-shell').waitFor()
  await page.setViewportSize({ width: 720, height: 540 })
  await page.screenshot({ path: join(directory, 'answer-overlay.png') })
  await page.getByRole('button', { name: 'Исправить распознанную реплику', exact: true }).click()
  await page.locator('.shell:not(.overlay-shell)').waitFor()
  assert.equal(await page.getByRole('textbox', { name: 'Реплика собеседника', exact: true }).inputValue(), questions[1])
  await page.getByRole('button', { name: 'Включить компактный оверлей', exact: true }).click()
  await page.locator('.overlay-shell').waitFor()
  await page.getByRole('button', { name: 'Остановить звонок', exact: true }).click()
  await page.locator('.shell:not(.overlay-shell)').waitFor()
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getOpacity()), 1)
  assert.deepEqual(errors, [])
  writeFileSync(join(directory, 'results.json'), JSON.stringify({ completed: true, physicalDevices: false, apiSpendUsd: 0, clickMs, measurements }, null, 2))
  console.log(`PASS start screen, failed audio recovery, automatic compact call without privacy, fixed answer/task controls at three viewports and overlay, stop restores window. Click ${clickMs} ms. Evidence: ${directory}`)
} catch (error) {
  writeFileSync(join(directory, 'results.json'), JSON.stringify({ completed: false, error: error.message, measurements }, null, 2))
  console.log(`Control layout evidence: ${directory}`)
  throw error
} finally { await application?.close().catch(() => {}) }
