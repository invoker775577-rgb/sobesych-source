import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { createUpdates, prepareInstaller, installSpaceBytes } = createRequire(import.meta.url)('../electron/updates.cjs')

function fixture(options = {}) {
  const updater = new EventEmitter()
  const calls = { check: 0, download: 0, install: 0, stop: 0 }
  updater.checkForUpdates = async () => { calls.check++; return { updateInfo: { version: options.next ?? '0.5.70' } } }
  updater.downloadUpdate = async () => {
    calls.download++
    updater.emit('download-progress', { percent: 43.9 })
    updater.emit('update-downloaded', { version: options.next ?? '0.5.70' })
    return ['installer.exe']
  }
  updater.quitAndInstall = (silent, run) => { assert.equal(silent, false); assert.equal(run, true); calls.install++ }
  const events = []
  const manager = createUpdates({ updater, enabled: true, version: '0.5.69', publish: value => events.push(value), beforeInstall: () => { calls.stop++ }, ...options })
  return { updater, calls, events, manager }
}

test('updates do not download, install, or make network calls on construction', () => {
  const { updater, calls, manager } = fixture()
  assert.equal(updater.autoDownload, false)
  assert.equal(updater.autoInstallOnAppQuit, false)
  assert.equal(updater.allowDowngrade, false)
  assert.deepEqual(calls, { check: 0, download: 0, install: 0, stop: 0 })
  manager.dispose()
})

test('check -> download with progress -> explicit install only', async () => {
  const { manager, calls, events } = fixture()
  assert.equal((await manager.check()).phase, 'available')
  assert.equal(calls.download, 0)
  assert.ok((await manager.install()).error)
  assert.equal((await manager.download()).phase, 'downloaded')
  assert.ok(events.some(event => event.phase === 'downloading' && event.percent === 44))
  assert.equal(calls.install, 0)
  assert.deepEqual(await manager.install(), { ok: true })
  assert.equal(calls.install, 1)
  assert.equal(calls.stop, 1)
  manager.dispose()
})

test('active session prevents installation, downloaded file remains available', async () => {
  let busy = true
  const { manager, calls } = fixture({ isBusy: () => busy })
  await manager.check(); await manager.download()
  assert.ok((await manager.install()).error)
  assert.equal(manager.snapshot().phase, 'downloaded')
  assert.equal(calls.stop, 0)
  busy = false
  await manager.install()
  assert.equal(calls.install, 1)
  manager.dispose()
})

test('offline and corrupt download fail safely and allow retry without leaking errors', async () => {
  const { manager, updater } = fixture()
  const check = updater.checkForUpdates
  updater.checkForUpdates = async () => { throw new Error('Authorization: SECRET_TOKEN') }
  assert.equal((await manager.check()).phase, 'error')
  assert.ok(!JSON.stringify(manager.snapshot()).includes('SECRET_TOKEN'))
  updater.checkForUpdates = check
  await manager.check()
  const download = updater.downloadUpdate
  updater.downloadUpdate = async () => { updater.emit('error', new Error('checksum mismatch')); throw new Error('checksum mismatch') }
  assert.equal((await manager.download()).phase, 'error')
  assert.ok((await manager.install()).error)
  await manager.check()
  updater.downloadUpdate = download
  assert.equal((await manager.download()).phase, 'downloaded')
  manager.dispose()
  updater.emit('error', new Error('late cancellation'))
})

test('checks are deduplicated; old, equal and invalid versions cannot install', async () => {
  for (const next of ['0.5.68', '0.5.69', 'not-a-version']) {
    const { manager } = fixture({ next })
    assert.equal((await manager.check()).phase, 'idle')
    assert.equal((await manager.download()).phase, 'idle')
    assert.ok((await manager.install()).error)
    manager.dispose()
  }
  const { manager, updater, calls } = fixture()
  const check = updater.checkForUpdates
  let release
  updater.checkForUpdates = async () => { await new Promise(resolve => { release = resolve }); return check() }
  const first = manager.check()
  const second = manager.check()
  release()
  await Promise.all([first, second])
  assert.equal(calls.check, 1)
  manager.dispose()
})

test('unpacked/development installs have no updater or network dependency', async () => {
  const manager = createUpdates({ updater: null, enabled: false, version: '0.5.69' })
  assert.equal((await manager.check()).phase, 'disabled')
  assert.equal((await manager.download()).phase, 'disabled')
  assert.ok((await manager.install()).error)
  manager.dispose()
})

test('unsupported or staged release cannot bypass updater eligibility checks', async () => {
  const { updater, manager, calls } = fixture()
  updater.checkForUpdates = async () => ({ isUpdateAvailable: false, updateInfo: { version: '1.0.0' } })
  assert.equal((await manager.check()).phase, 'idle')
  await manager.download()
  assert.equal(calls.download, 0)
  manager.dispose()
})

test('double install and closing during preparation never launch twice or after close', async () => {
  let finish
  const { manager, calls } = fixture({ beforeInstall: () => new Promise(resolve => { finish = resolve }) })
  await manager.check(); await manager.download()
  const first = manager.install()
  assert.ok((await manager.install()).error)
  manager.dispose()
  finish()
  assert.ok((await first).error)
  assert.equal(calls.install, 0)
})

test('first install click waits for the final download bookkeeping instead of failing', async () => {
  const { manager, updater, calls } = fixture()
  let finish
  updater.downloadUpdate = async () => {
    updater.emit('update-downloaded', { version: '0.5.70' })
    await new Promise(resolve => { finish = resolve })
  }
  await manager.check()
  const download = manager.download()
  assert.equal(manager.snapshot().phase, 'downloaded')
  const install = manager.install()
  assert.equal(calls.install, 0)
  finish()
  await download
  assert.deepEqual(await install, { ok: true })
  assert.equal(calls.install, 1)
  manager.dispose()
})

test('installer preflight writes and flushes a private probe without changing process TEMP', async t => {
  const root = await fs.mkdtemp(join(tmpdir(), 'sobesych-preflight-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const before = { TEMP: process.env.TEMP, TMP: process.env.TMP }
  const directory = await prepareInstaller({ tempRoot: root, installDirectory: root, requiredBytes: 1 })
  assert.equal(directory.startsWith(join(root, 'sobesych-setup-')), true)
  assert.deepEqual(await fs.readdir(directory), [])
  assert.deepEqual({ TEMP: process.env.TEMP, TMP: process.env.TMP }, before)
})

test('inaccessible Windows TEMP falls back to an independently checked private folder', async t => {
  const root = await fs.mkdtemp(join(tmpdir(), 'sobesych-preflight-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const blocked = join(root, 'blocked-temp')
  await fs.writeFile(blocked, 'keep me')
  const fallbackRoot = join(root, 'fallback')
  const directory = await prepareInstaller({ tempRoot: blocked, fallbackRoot, installDirectory: root, requiredBytes: 1 })
  assert.ok(directory.startsWith(join(fallbackRoot, 'sobesych-setup-')))
  assert.equal(await fs.readFile(blocked, 'utf8'), 'keep me')
  assert.deepEqual(await fs.readdir(directory), [])
})

test('low space, quota and failed write/flush are rejected and private probes are cleaned up', async t => {
  const root = await fs.mkdtemp(join(tmpdir(), 'sobesych-preflight-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  for (const code of ['ENOSPC', 'EDQUOT', 'EACCES']) {
    for (const operation of ['writeFile', 'sync']) {
      let closed = false
      const io = { ...fs, open: async (...args) => {
        const handle = await fs.open(...args)
        return {
          writeFile: operation === 'writeFile' ? async () => { throw Object.assign(new Error('SECRET'), { code }) } : value => handle.writeFile(value),
          sync: operation === 'sync' ? async () => { throw Object.assign(new Error('SECRET'), { code }) } : () => handle.sync(),
          close: async () => { closed = true; await handle.close() },
        }
      } }
      await assert.rejects(prepareInstaller({ tempRoot: root, installDirectory: root, io }), {
        code: code === 'EACCES' ? 'SOBESYCH_INSTALL_TEMP' : 'SOBESYCH_INSTALL_SPACE',
      })
      assert.equal(closed, true)
      assert.deepEqual(await fs.readdir(root), [])
    }
  }
})

test('both temporary and installation volumes need the full workspace, using 64-bit space counts', async t => {
  const root = await fs.mkdtemp(join(tmpdir(), 'sobesych-preflight-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  assert.equal(installSpaceBytes, 4294967296)
  for (const lowLocation of ['temporary', 'installed']) {
    const io = { ...fs, statfs: async location => ({ bsize: 1n, bavail: BigInt(installSpaceBytes) - BigInt((location === root) === (lowLocation === 'installed')) }) }
    await assert.rejects(prepareInstaller({ tempRoot: root, installDirectory: root, io }), { code: 'SOBESYCH_INSTALL_SPACE' })
    assert.deepEqual(await fs.readdir(root), [])
  }
  const io = { ...fs, statfs: async () => ({ bsize: 1n, bavail: BigInt(installSpaceBytes) }) }
  assert.ok(await prepareInstaller({ tempRoot: root, installDirectory: root, io }))
})

test('failed preflight keeps the downloaded update and running application available for retry', async () => {
  for (const code of ['SOBESYCH_INSTALL_SPACE', 'SOBESYCH_INSTALL_TEMP']) {
    const { updater, manager, calls } = fixture()
    updater.prepareInstall = async () => { throw Object.assign(new Error('SECRET'), { code }) }
    await manager.check(); await manager.download()
    const result = await manager.install()
    assert.ok(result.error)
    assert.ok(!result.error.includes('SECRET'))
    assert.equal(manager.snapshot().phase, 'downloaded')
    assert.equal(calls.stop, 0)
    assert.equal(calls.install, 0)
    updater.prepareInstall = async () => {}
    assert.deepEqual(await manager.install(), { ok: true })
    assert.equal(calls.install, 1)
    manager.dispose()
  }
})

test('starting a session or closing during preflight prevents shutdown and installer launch', async () => {
  for (const action of ['busy', 'dispose']) {
    let busy = false
    let finish
    const { updater, manager, calls } = fixture({ isBusy: () => busy })
    updater.prepareInstall = () => new Promise(resolve => { finish = resolve })
    await manager.check(); await manager.download()
    const install = manager.install()
    if (action === 'busy') busy = true
    else manager.dispose()
    finish()
    assert.ok((await install).error)
    assert.equal(calls.install, 0)
    assert.equal(calls.stop, 0)
    manager.dispose()
  }
})

test('download disk exhaustion is not reported as an internet error', async () => {
  const { updater, manager } = fixture()
  await manager.check()
  updater.downloadUpdate = async () => { throw Object.assign(new Error('SECRET'), { code: 'ENOSPC' }) }
  assert.match((await manager.download()).error, /Недостаточно места/)
  manager.dispose()
})
