import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const yaml = createRequire(import.meta.url)('js-yaml')
const { installSpaceBytes } = createRequire(import.meta.url)('../electron/updates.cjs')
const read = name => yaml.load(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'))

test('main update channel packages the call interface, not practice-only', () => {
  const main = read('electron-builder.windows.yml')
  assert.equal(main.appId, 'local.sobesych.app')
  assert.equal(main.productName, 'Sobesych')
  assert.equal(main.extraMetadata.practiceOnly, false)
  assert.ok(main.files.includes('dist/**'))
  assert.ok(!main.files.includes('dist-practice/**'))
  assert.equal(main.nsis.include, 'build/installer-preflight.nsh')
  const script = readFileSync(new URL(`../${main.nsis.include}`, import.meta.url), 'utf8')
  assert.ok(script.includes(`SobesychCheckInstallSpace "$TEMP" ${installSpaceBytes}`))
  assert.ok(script.includes(`SobesychCheckInstallSpace "$INSTDIR" ${installSpaceBytes}`))
})

test('standalone practice keeps a separate identity and interface', () => {
  const main = read('electron-builder.windows.yml')
  const practice = read('electron-builder.practice.yml')
  assert.notEqual(practice.appId, main.appId)
  assert.notEqual(practice.productName, main.productName)
  assert.equal(practice.extraMetadata.practiceOnly, true)
  assert.ok(practice.files.includes('dist-practice/**'))
})

test('main builds bundle the unchanged speech model with CPU runtime, not optional CUDA or benchmark models', () => {
  const main = read('electron-builder.windows.yml')
  const portable = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).build
  for (const config of [main, portable]) {
    assert.deepEqual(config.extraResources, [{ from: 'vendor/local-stt-cpu', to: 'local-stt', filter: ['ggml-large-v3-turbo-q5_0.bin', 'cpu/Release/*.dll', 'cpu/Release/whisper-server.exe'] }])
    assert.ok(config.files.includes('scripts/install-local-stt.ps1'))
    assert.ok(config.asarUnpack.includes('scripts/install-local-stt.ps1'))
    assert.deepEqual(config.electronLanguages, ['en-US', 'ru'])
  }
})
