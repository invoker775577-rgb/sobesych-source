const { app, BrowserWindow, ipcMain, shell, session, desktopCapturer, safeStorage, dialog, screen, globalShortcut, nativeImage } = require('electron')
const dotenv = require('dotenv')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { randomUUID } = require('node:crypto')
const { spawn } = require('node:child_process')
const { createStore } = require('./store.cjs')
const { formatAnswerTrace } = require('./answer-trace.cjs')
const { createUpdates, createWindowsUpdater } = require('./updates.cjs')
const { createLocalStt, shouldUseLocalTranscription, formatTranscriptionTrace } = require('./local-stt.cjs')
const { isValidRegion, mapRegionToImage } = require('./screen-region.cjs')
const { prepareScreenLanguage } = require('./screen-language.cjs')
const packageMetadata = require('../package.json')
const practiceOnlyBuild = Boolean(app.isPackaged && packageMetadata.practiceOnly === true)
const practiceAssistModes = new Set(['review', 'extract-task', 'practice-next', 'practice-report'])
app.setName(practiceOnlyBuild ? 'Sobesych Practice' : 'Sobesych')
const layoutTest = Boolean(process.env.SOBESYCH_LAYOUT_TEST)
if (layoutTest) app.disableHardwareAcceleration()
app.setPath('userData', process.env.SOBESYCH_DATA_DIR || path.join(app.getPath('appData'), practiceOnlyBuild ? 'Sobesych Practice' : 'Sobesych'))
const directory = app.getPath('userData')
fs.mkdirSync(directory, { recursive: true })
let mainWindow = null
let store
let localStt
let gpuInstaller = null
let updates
let updateBusy = false
let updateCheckTimer
let overlayMode = false
let normalBounds = null
let normalMaximized = false
let screenCaptureBusy = false
const requests = new Map()
const closing = new AbortController()
function log(stage, message) {
  const file = path.join(directory, 'sobesych.log')
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > 2_000_000) fs.renameSync(file, `${file}.old`)
    fs.appendFileSync(file, `${new Date().toISOString()} ${stage} ${String(message).replace(/sk-[\w-]+/g, '[key]')}\n`)
  } catch { /* Logging must not stop the application. */ }
}
function warmLocalStt() {
  if (!localStt) return Promise.resolve({ error: 'Локальное распознавание не запущено' })
  if (gpuInstaller) return Promise.resolve({ error: 'Дождись установки GPU-пакета или отмени её' })
  if (process.env.SOBESYCH_SKIP_STT_WARMUP === '1') return Promise.resolve({ ok: true })
  return localStt.warmup()
    .then(info => { log('local-stt', `warmup ready backend=${info.backend || 'unknown'}`); return info })
    .catch(error => { log('local-stt', `warmup failed: ${error.message}`); return { error: error.message } })
}
function syntheticRegionSources(displays) {
  const fixturePath = process.env.SOBESYCH_TEST_SCREEN_FIXTURE
  return displays.map((display, index) => {
    const scale = Math.min(1, 2560 / display.bounds.width, 1440 / display.bounds.height)
    const width = Math.max(1, Math.round(display.bounds.width * scale))
    const height = Math.max(1, Math.round(display.bounds.height * scale))
    if (fixturePath) {
      const fixture = nativeImage.createFromPath(fixturePath)
      if (fixture.isEmpty()) throw new Error('Тестовый снимок экрана не удалось загрузить')
      return { display_id: String(display.id), thumbnail: fixture.resize({ width, height }) }
    }
    const bitmap = Buffer.alloc(width * height * 4)
    for (let offset = 0; offset < bitmap.length; offset += 4) {
      bitmap[offset] = 60 + index
      bitmap[offset + 1] = 120
      bitmap[offset + 2] = 220
      bitmap[offset + 3] = 255
    }
    return { display_id: String(display.id), thumbnail: nativeImage.createFromBitmap(bitmap, { width, height }) }
  })
}
function loadRuntimeEnv() {
  const env = { ...process.env }
  for (const candidate of [path.join(directory, '.env'), path.join(process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath), '.env'), path.join(__dirname, '..', '.env')]) {
    if (fs.existsSync(candidate)) for (const [key, value] of Object.entries(dotenv.parse(fs.readFileSync(candidate)))) if (!env[key]) env[key] = value
  }
  return env
}
function handle(channel, callback) {
  ipcMain.handle(channel, async (event, payload) => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) return { error: 'Недоверенное окно' }
    try { return await callback(payload) }
    catch (error) {
      log(channel, error.message)
      return { error: error.message, ...(error.model ? { model: error.model } : {}), ...(error.usage ? { usage: error.usage } : {}) }
    }
  })
}
function cancelRequests(requestId) {
  for (const [id, request] of requests) {
    if (requestId && request.requestId !== requestId) continue
    request.controller.abort(); requests.delete(id)
  }
}
function createWindow() {
  mainWindow = new BrowserWindow({ width: 1080, height: 740, minWidth: 560, minHeight: 360, show: !process.env.SOBESYCH_HEADLESS,
    backgroundColor: '#111116', titleBarStyle: 'hidden', titleBarOverlay: { color: '#17171e', symbolColor: '#edeaf5', height: 34 }, title: `${practiceOnlyBuild ? 'Sobesych Practice' : 'Sobesych'} ${app.getVersion()}`, icon: path.join(__dirname, 'app.ico'), webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: layoutTest, devTools: !practiceOnlyBuild } })
  mainWindow.setMenuBarVisibility(false)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) void shell.openExternal(url); return { action: 'deny' } })
  mainWindow.webContents.on('will-navigate', event => event.preventDefault())
  mainWindow.webContents.on('did-fail-load', (_event, code, description) => log('renderer-load', `${code} ${description}`))
  mainWindow.webContents.on('render-process-gone', (_event, details) => log('renderer-gone', details.reason))
  mainWindow.on('closed', () => { cancelRequests(); mainWindow = null; app.quit() })
  if (process.env.SOBESYCH_DEV_SERVER_URL) void mainWindow.loadURL(process.env.SOBESYCH_DEV_SERVER_URL)
  else void mainWindow.loadFile(path.join(__dirname, '..', practiceOnlyBuild ? 'dist-practice' : 'dist', 'index.html'))
}
function setOverlayMode(enabled) {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Окно приложения закрыто')
  if (Boolean(enabled) === overlayMode) return { ok: true, enabled: overlayMode }
  if (enabled) {
    normalBounds = mainWindow.getBounds()
    normalMaximized = mainWindow.isMaximized()
    if (normalMaximized) mainWindow.unmaximize()
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    const width = Math.min(720, area.width)
    const height = Math.min(540, area.height)
    const margin = Math.min(24, Math.max(0, area.width - width), Math.max(0, area.height - height))
    mainWindow.setBounds({ x: area.x + area.width - width - margin, y: area.y + margin, width, height })
    if (!mainWindow.isVisible() && !process.env.SOBESYCH_HEADLESS) mainWindow.showInactive()
    mainWindow.setAlwaysOnTop(true, 'pop-up-menu')
    mainWindow.setOpacity(0.82)
  } else {
    mainWindow.setAlwaysOnTop(false)
    mainWindow.setOpacity(1)
    if (normalBounds) mainWindow.setBounds(normalBounds)
    if (normalMaximized) mainWindow.maximize()
    normalBounds = null
    normalMaximized = false
  }
  overlayMode = Boolean(enabled)
  return { ok: true, enabled: overlayMode }
}
function publishOverlayAction(action, enabled) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('overlay:action', action, enabled)
}
async function withCaptureWindowHidden(capture) {
  if (screenCaptureBusy) throw new Error('Сначала заверши текущее выделение или снимок экрана')
  const win = mainWindow
  if (!win || win.isDestroyed()) throw new Error('Окно приложения закрыто')
  const restoreVisible = win.isVisible() && !win.isMinimized()
  screenCaptureBusy = true
  try {
    // Exclusion affinity can stop desktop recorders. Hide our window instead.
    if (restoreVisible) win.hide()
    return await capture()
  } finally {
    screenCaptureBusy = false
    if (restoreVisible && !win.isDestroyed()) win.showInactive()
  }
}
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus() } })
  app.whenReady().then(async () => {
    const { createService, resolveSettings } = await import(pathToFileURL(path.join(__dirname, '..', 'server.mjs')).href)
    const env = loadRuntimeEnv()
    store = createStore(directory, safeStorage, { apiKey: env.OPENAI_API_KEY || env.OPENROUTER_API_KEY || '', baseUrl: env.OPENAI_BASE_URL, model: env.OPENAI_MODEL }, resolveSettings)
    const service = createService({ getSettings: store.getSettings })
    const updateEnabled = app.isPackaged && process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_FILE &&
      fs.existsSync(path.join(path.dirname(process.execPath), `Uninstall ${app.getName()}.exe`)) &&
      fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))
    updates = createUpdates({
      updater: updateEnabled ? createWindowsUpdater({ fallbackRoot: path.join(directory, 'installer-temp') }) : null,
      version: app.getVersion(), enabled: updateEnabled,
      publish: value => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:state', value) },
      isBusy: () => updateBusy || requests.size > 0 || Boolean(gpuInstaller),
      beforeInstall: () => { localStt?.stop() },
    })
    handle('update:state', () => updates.snapshot())
    handle('update:check', () => updates.check())
    handle('update:download', () => updates.download())
    handle('update:install', () => updates.install())
    handle('update:busy', value => { updateBusy = value === true; return { ok: true } })
    const bundledStt = app.isPackaged ? path.join(process.resourcesPath, 'local-stt') : path.join(__dirname, '..', 'vendor', 'local-stt')
    localStt = createLocalStt(directory, bundledStt, { cpuRoot: app.isPackaged ? undefined : path.join(__dirname, '..', 'vendor', 'local-stt-cpu') })
    const permitted = (contents, permission) => contents === mainWindow?.webContents && (permission === 'media' || (!practiceOnlyBuild && permission === 'display-capture'))
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(permitted(contents, permission)))
    session.defaultSession.setPermissionCheckHandler(permitted)
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      try {
        if (practiceOnlyBuild) return callback({})
        if (!mainWindow || request.frame.top !== mainWindow.webContents.mainFrame) return callback({})
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
        if (!sources[0]) throw new Error('Экран для захвата звука не найден')
        callback({ video: sources[0], audio: 'loopback' })
      } catch (error) { log('loopback', error.message); callback({}) }
    })
    handle('app:config', () => {
      const { pid: _pid, ...localSpeech } = localStt.status()
      return { settings: store.publicConfig(), state: store.loadState(), practiceLibraries: store.getPracticeLibraries(), practiceLibrariesStatus: store.practiceLibrariesStatus(), practiceLibrariesWarning: store.practiceLibrariesWarning(), historyWarning: store.historyWarning(), captureProtected: mainWindow.isContentProtected(), overlayMode, localSpeech, practiceOnly: practiceOnlyBuild, version: app.getVersion() }
    })
    handle('settings:save', update => {
      const settings = store.saveSettings(update)
      return { settings }
    })
    handle('state:save', value => store.saveState(value))
    handle('practice-libraries:save', value => store.savePracticeLibraries(value))
    handle('audio:trace', value => {
      const stages = ['display', 'display-failed', 'desktop', 'desktop-failed', 'retry', 'ready', 'failed']
      const codes = ['none', 'other', 'NotReadableError', 'NotAllowedError', 'SecurityError', 'NotFoundError', 'AbortError', 'InvalidStateError', 'NotSupportedError']
      if (!stages.includes(value?.stage) || !codes.includes(value?.code)) return { ok: false }
      log('audio-start', `stage=${value.stage} code=${value.code}`)
      return { ok: true }
    })
    handle('audio:source', async () => {
      if (practiceOnlyBuild) throw new Error('Системное аудио доступно только в полной версии')
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      return { sourceId: sources[0]?.id }
    })
    handle('provider:cancel', payload => { cancelRequests(payload?.requestId); return { ok: true } })
    handle('local-stt:warm', () => warmLocalStt())
    handle('local-stt:release', () => { localStt.release(); return { ok: true } })
    handle('local-stt:gpu-cancel', () => { gpuInstaller?.kill(); return { ok: true } })
    handle('local-stt:gpu-install', async () => {
      if (gpuInstaller || updateBusy || requests.size || localStt.status().running) throw new Error('Сначала останови звонок и проверку звука')
      if (!localStt.status().gpuSupported) throw new Error('Для GPU-пакета нужен установленный драйвер NVIDIA')
      const script = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked', 'scripts', 'install-local-stt.ps1') : path.join(__dirname, '..', 'scripts', 'install-local-stt.ps1')
      const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      return new Promise(resolve => {
        const helper = spawn(executable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Target', path.join(directory, 'local-stt'), '-EngineOnly'], { windowsHide: true, stdio: 'ignore' })
        gpuInstaller = helper
        const finish = code => {
          if (gpuInstaller !== helper) return
          gpuInstaller = null
          resolve(code === 0 ? { ok: true } : { error: 'GPU-пакет не установлен. Проверь интернет, свободное место и повтори. CPU-распознавание сохранено.' })
        }
        helper.once('error', () => finish(-1))
        helper.once('exit', finish)
      })
    })
    for (const operation of ['assist', 'transcribe', 'models']) handle(`provider:${operation}`, async (payload = {}) => {
      if (practiceOnlyBuild && operation === 'assist' && !practiceAssistModes.has(payload.mode)) throw new Error('В тренировочной версии доступны только практика и разбор ответов')
      if (practiceOnlyBuild && operation === 'transcribe' && payload.localOnly !== true) throw new Error('В тренировочной версии разрешено только локальное распознавание речи')
      const id = randomUUID()
      const controller = new AbortController()
      requests.set(id, { controller, requestId: payload.requestId })
      try {
        const sender = mainWindow.webContents
        const onDelta = operation === 'assist' ? text => { if (!sender.isDestroyed() && !controller.signal.aborted) sender.send('provider:delta', { requestId: payload.requestId, text }) } : undefined
        const started = performance.now()
        const localLanguage = payload.localOnly === true && ['auto', 'ru', 'en'].includes(payload.language)
          ? payload.language
          : store.getSettings().language
        const result = operation === 'transcribe' && shouldUseLocalTranscription(payload.localOnly, store.getSettings().transcriptionMode)
          ? await localStt.transcribe(payload, localLanguage, controller.signal)
          : await service[operation](payload, controller.signal, onDelta)
        log(`provider:${operation}`, `ok ms=${Math.round(performance.now() - started)} model=${result.model || ''} characters=${(result.text || result.answer || '').length}`)
        if (operation === 'transcribe' && result.diagnostics) log('speech', formatTranscriptionTrace(payload, result.diagnostics))
        return result
      }
      finally { requests.delete(id) }
    })
    handle('privacy:set', enabled => {
      if (practiceOnlyBuild) throw new Error('Скрытый режим отсутствует в тренировочной версии')
      if (typeof enabled !== 'boolean') throw new Error('Состояние защиты должно быть true или false')
      if (mainWindow.isContentProtected() !== enabled) mainWindow.setContentProtection(enabled)
      return { ok: true, enabled: mainWindow.isContentProtected() }
    })
    handle('overlay:set', enabled => {
      if (practiceOnlyBuild) throw new Error('Оверлей отсутствует в тренировочной версии')
      return setOverlayMode(Boolean(enabled))
    })
    handle('screen:capture', () => {
      if (practiceOnlyBuild) throw new Error('Полный захват экрана отсутствует в тренировочной версии')
      return withCaptureWindowHidden(async () => {
        await new Promise(resolve => setTimeout(resolve, 180))
        const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.min(display.size.width, 2560), height: Math.min(display.size.height, 1440) } })
        const displayId = String(display.id)
        const source = sources.find(item => item.display_id === displayId) || sources[0]
        if (!source || source.thumbnail.isEmpty()) throw new Error('Не удалось снять экран')
        return { screenshot: source.thumbnail.toDataURL() }
      })
    })
    handle('screen:select-region', () => withCaptureWindowHidden(async () => {
      const displays = screen.getAllDisplays()
      const selectors = []
      let languageReader
      try {
        const preparationStarted = performance.now()
        languageReader = prepareScreenLanguage({ signal: closing.signal })
        await new Promise(resolve => setTimeout(resolve, 220))
        const sources = process.env.SOBESYCH_TEST_SCREEN === '1'
          ? syntheticRegionSources(displays)
          : await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 2560, height: 1440 } })
        if (!sources.length) throw new Error('Не удалось снять экран')
        const selection = await new Promise((resolve, reject) => {
          let done = false
          const finish = (error, value) => {
            if (done) return
            done = true
            ipcMain.removeListener('region:complete', complete)
            ipcMain.removeListener('region:cancel', cancel)
            for (const selector of selectors) if (!selector.isDestroyed()) selector.close()
            if (error) reject(error)
            else resolve(value)
          }
          const complete = (event, bounds) => {
            const index = selectors.findIndex(selector => selector.webContents === event.sender)
            if (index < 0) return
            const display = displays[index]
            if (!isValidRegion(bounds, display.bounds)) { finish(new Error('Некорректная область выделения. Выдели задачу ещё раз.')); return }
            finish(null, { display, bounds })
          }
          const cancel = event => { if (selectors.some(selector => selector.webContents === event.sender)) finish(new Error('Выделение отменено')) }
          ipcMain.on('region:complete', complete)
          ipcMain.on('region:cancel', cancel)
          for (const display of displays) {
            const selector = new BrowserWindow({ ...display.bounds, frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, movable: false, skipTaskbar: true, alwaysOnTop: true, show: false, webPreferences: { preload: path.join(__dirname, 'region-preload.cjs'), contextIsolation: true, nodeIntegration: false } })
            selectors.push(selector)
            selector.setAlwaysOnTop(true, 'screen-saver')
            selector.on('closed', () => { if (!done) finish(new Error('Выделение отменено')) })
            void selector.loadFile(path.join(__dirname, 'region.html')).then(() => { if (!process.env.SOBESYCH_HEADLESS) selector.show() }).catch(error => finish(error))
          }
        })
        const source = sources.find(item => item.display_id === String(selection.display.id)) || sources[displays.indexOf(selection.display)]
        if (!source || source.thumbnail.isEmpty()) throw new Error('Не удалось снять выбранный экран')
        const image = source.thumbnail
        const size = image.getSize()
        const crop = mapRegionToImage(selection.bounds, selection.display.bounds, size)
        if (!crop) throw new Error('Не удалось рассчитать границы выделенной области')
        const screenshot = image.crop(crop).toDataURL()
        const started = performance.now()
        const screenLanguage = await languageReader.detect(screenshot)
        log('screen-language', `ms=${Math.round(performance.now() - started)} preparedMs=${Math.round(started - preparationStarted)} language=${screenLanguage || 'unknown'}`)
        return { screenshot, width: crop.width, height: crop.height, ...(screenLanguage ? { screenLanguage } : {}) }
      } finally { languageReader?.stop() }
    }))
    handle('call:export', async call => {
      if (practiceOnlyBuild && call?.kind !== 'practice') throw new Error('В тренировочной версии можно экспортировать только тренировочные сессии')
      const result = await dialog.showSaveDialog(mainWindow, { defaultPath: `Sobesych-${call.createdAt.slice(0, 10)}.txt`, filters: [{ name: 'Текст', extensions: ['txt'] }] })
      if (!result.canceled && result.filePath) fs.writeFileSync(result.filePath, call.messages.map(m => `${m.createdAt} ${m.speaker}: ${m.text}`).join('\n\n'), 'utf8')
      return { ok: !result.canceled }
    })
    handle('app:logs', async () => { const error = await shell.openPath(directory); if (error) throw new Error(error); return { ok: true } })
    handle('answer:trace', value => { const trace = formatAnswerTrace(value); if (trace) log('answer-flow', trace); return { ok: true } })
    handle('app:error', message => { log('renderer-error', String(message).slice(0, 2000)); return { ok: true } })
    createWindow()
    if (updateEnabled && !process.env.SOBESYCH_HEADLESS) {
      updateCheckTimer = setTimeout(() => { void updates.check() }, 15_000)
      updateCheckTimer.unref()
    }
    if (!practiceOnlyBuild) {
      for (const [accelerators, action] of [
        [['Control+Shift+Enter', 'Control+Alt+Shift+Enter'], 'answer'],
        [['Control+Alt+Shift+S', 'Control+Alt+Shift+P'], 'screen'],
      ]) {
        const registered = accelerators.find(accelerator => globalShortcut.register(accelerator, () => publishOverlayAction(action)))
        if (!registered) log('shortcut', `registration failed: ${accelerators.join(', ')}`)
        else if (registered !== accelerators[0]) log('shortcut', `using fallback: ${registered}`)
      }
    }
    log('startup', `version=${app.getVersion()} key=${store.publicConfig().hasKey} model=${store.getSettings().model}`)
  }).catch(error => { log('startup-error', error.message); dialog.showErrorBox('Sobesych', error.message); app.quit() })
}
app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => { clearTimeout(updateCheckTimer); updates?.dispose(); closing.abort(); globalShortcut.unregisterAll(); cancelRequests(); gpuInstaller?.kill(); localStt?.stop() })
