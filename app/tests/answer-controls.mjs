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
if (!executable) env.SOBESYCH_LAYOUT_TEST = '1'
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
    ipcMain.handle('provider:assist', () => ({ answer: 'DNS помогает найти адрес сервера по имени.', usage: { cost: 0 }, model: 'controls-fixture' }))
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
    navigator.mediaDevices.getUserMedia = async constraints => new Stream([track('audio'), ...(constraints.video ? [track('video')] : [])])
    navigator.mediaDevices.getDisplayMedia = async () => { throw new Error('Physical capture forbidden') }
    navigator.mediaDevices.enumerateDevices = async () => []
    window.AudioContext = Context; window.AudioWorkletNode = Worklet; window.MediaStream = Stream
  })
  await page.reload()
  await page.getByRole('button', { name: 'Начать звонок', exact: true }).click()
  await page.getByRole('button', { name: 'Пауза', exact: true }).waitFor()
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
  await page.getByRole('button', { name: 'Остановить звонок', exact: true }).click()
  assert.deepEqual(errors, [])
  writeFileSync(join(directory, 'results.json'), JSON.stringify({ completed: true, physicalDevices: false, apiSpendUsd: 0, clickMs, measurements }, null, 2))
  console.log(`PASS fixed answer/task controls across short and wrapped questions at three viewports and compact overlay. Click ${clickMs} ms. Evidence: ${directory}`)
} catch (error) {
  writeFileSync(join(directory, 'results.json'), JSON.stringify({ completed: false, error: error.message, measurements }, null, 2))
  console.log(`Control layout evidence: ${directory}`)
  throw error
} finally { await application?.close().catch(() => {}) }
