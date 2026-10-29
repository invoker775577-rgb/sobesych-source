const { gt, valid } = require('semver')
const fs = require('node:fs/promises')
const path = require('node:path')
const { tmpdir } = require('node:os')

const releasePage = 'https://github.com/invoker775577-rgb/sobesych-releases/releases/latest'
// Includes the embedded archive, temporary unpacked tree and destination copy.
const installSpaceBytes = 4 * 1024 ** 3
const installErrors = {
  SOBESYCH_INSTALL_SPACE: 'Для обновления нужно 4 ГБ свободного места на дисках временной папки и программы. Освободи место и повтори установку. Текущая версия не удалена.',
  SOBESYCH_INSTALL_TEMP: 'Не удалось записать временные файлы установщика. Проверь доступ к временной папке и журнал защиты Windows. Текущая версия не удалена.',
}

async function prepareInstaller({ tempRoot = tmpdir(), fallbackRoot, installDirectory = path.dirname(process.execPath), io = fs, requiredBytes = installSpaceBytes }) {
  let noSpace = false
  for (const root of new Set([tempRoot, fallbackRoot].filter(Boolean))) {
    let directory
    let handle
    try {
      await io.mkdir(root, { recursive: true })
      directory = await io.mkdtemp(path.join(root, 'sobesych-setup-'))
      const probe = path.join(directory, 'write-probe.tmp')
      handle = await io.open(probe, 'wx')
      await handle.writeFile(Buffer.alloc(256 * 1024))
      await handle.sync()
      await handle.close()
      handle = null
      await io.unlink(probe)
      for (const location of [directory, installDirectory]) {
        const space = await io.statfs(location, { bigint: true })
        if (space.bavail * space.bsize < BigInt(requiredBytes)) throw Object.assign(new Error(), { code: 'SOBESYCH_INSTALL_SPACE' })
      }
      return directory
    } catch (error) {
      noSpace ||= ['SOBESYCH_INSTALL_SPACE', 'ENOSPC', 'EDQUOT'].includes(error.code)
      await handle?.close().catch(() => {})
      if (directory) {
        // Only remove our probe and an empty directory, never other TEMP files.
        await io.unlink(path.join(directory, 'write-probe.tmp')).catch(() => {})
        await io.rmdir(directory).catch(() => {})
      }
    }
  }
  throw Object.assign(new Error(), { code: noSpace ? 'SOBESYCH_INSTALL_SPACE' : 'SOBESYCH_INSTALL_TEMP' })
}

function createWindowsUpdater(options) {
  const { NsisUpdater } = require('electron-updater')
  return new class extends NsisUpdater {
    async prepareInstall() {
      this.setupTemp = await prepareInstaller(options)
    }
    spawnLog(command, args, env, stdio) {
      // The pinned updater forwards this environment to both setup and elevate.
      // Do not change the user's or the running application's TEMP/TMP settings.
      return super.spawnLog(command, args, this.setupTemp ? { ...process.env, ...env, TEMP: this.setupTemp, TMP: this.setupTemp } : env, stdio)
    }
  }()
}

function createUpdates({ updater, version, enabled, publish = () => {}, isBusy = () => false, beforeInstall = () => {} }) {
  let state = { phase: enabled ? 'idle' : 'disabled', currentVersion: version, releasePage }
  let pending = null
  let installing = false
  let disposed = false
  let cancellation = null
  const listeners = []
  const snapshot = () => ({ ...state })
  function change(patch) {
    if (disposed) return
    state = { ...state, ...patch }
    publish(snapshot())
  }
  function fail(error) {
    const message = ['ENOSPC', 'EDQUOT'].includes(error?.code)
      ? 'Недостаточно места для скачивания обновления. Освободи место и повтори проверку.'
      : 'Не удалось получить обновление. Проверь интернет и повтори проверку.'
    change({ phase: 'error', error: message, percent: undefined })
  }
  function listen(event, listener) {
    updater.on(event, listener)
    listeners.push([event, listener])
  }
  if (enabled) {
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.allowPrerelease = false
    updater.allowDowngrade = false
    updater.disableWebInstaller = true
    updater.logger = null
    listen('error', fail)
    listen('download-progress', progress => {
      if (state.phase === 'downloading' && Number.isFinite(progress.percent)) {
        change({ percent: Math.max(0, Math.min(100, Math.round(progress.percent))) })
      }
    })
    listen('update-downloaded', info => {
      if (state.phase === 'downloading' && info.version === state.version) change({ phase: 'downloaded', percent: 100 })
    })
  }
  async function exclusive(operation) {
    if (pending) return pending
    pending = operation().catch(error => { fail(error); return snapshot() }).finally(() => { pending = null })
    return pending
  }
  return {
    snapshot,
    async check() {
      if (!enabled || disposed || ['downloaded', 'installing'].includes(state.phase)) return snapshot()
      return exclusive(async () => {
        change({ phase: 'checking', error: undefined, percent: undefined })
        const result = await updater.checkForUpdates()
        if (!result) throw new Error('No update metadata')
        cancellation = result.cancellationToken
        const next = result.updateInfo?.version
        if (result.isUpdateAvailable !== false && valid(next) && gt(next, version)) change({ phase: 'available', version: next })
        else change({ phase: 'idle', checked: true, version: undefined })
        return snapshot()
      })
    },
    async download() {
      if (!enabled || disposed || pending || state.phase !== 'available') return snapshot()
      return exclusive(async () => {
        change({ phase: 'downloading', percent: 0, error: undefined })
        await updater.downloadUpdate(cancellation)
        if (state.phase !== 'downloaded') throw new Error('Download did not complete')
        return snapshot()
      })
    },
    async install() {
      // The downloaded event can reach the button before cache finalization settles.
      if (pending) await pending
      if (!enabled || disposed || installing || state.phase !== 'downloaded') return { error: 'Обновление ещё не скачано или установка уже началась' }
      if (isBusy()) return { error: 'Сначала заверши тренировку, запись и генерацию ответа' }
      // Quitting must never implicitly install a downloaded update.
      installing = true
      try {
        await updater.prepareInstall?.()
        if (disposed) return { error: 'Приложение закрывается' }
        if (isBusy()) return { error: 'Приложение занято. Заверши текущую работу' }
        await beforeInstall()
        if (disposed) return { error: 'Приложение закрывается' }
        if (isBusy()) return { error: 'Приложение занято. Заверши текущую работу' }
        change({ phase: 'installing', error: undefined })
        updater.quitAndInstall(false, true)
        return { ok: true }
      } catch (error) {
        if (Object.hasOwn(installErrors, error?.code)) {
          change({ phase: 'downloaded', error: installErrors[error.code] })
          return { error: installErrors[error.code] }
        }
        fail(error)
        return { error: 'Не удалось запустить установку. Повтори проверку обновлений' }
      }
      finally { installing = false }
    },
    dispose() {
      disposed = true
      cancellation?.cancel()
      for (const [event, listener] of listeners) if (event !== 'error') updater.removeListener(event, listener)
    },
  }
}

module.exports = { createUpdates, createWindowsUpdater, prepareInstaller, installSpaceBytes, releasePage }
