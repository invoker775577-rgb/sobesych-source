import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'

const root = new URL('../', import.meta.url)
const baseline = JSON.parse(readFileSync(new URL('rollback-0.5.72.json', import.meta.url)))
function files(directory) {
  return readdirSync(new URL(directory, root), { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}${entry.name}`
    return entry.isDirectory() ? files(`${path}/`) : [path]
  })
}

test('0.5.72 runtime stays unchanged outside the scoped audio, recording, installer, answer clarity and requested UI changes', () => {
  const scopedFixFiles = new Set(['src/capture.ts', 'src/types.ts', 'src/transcript.mjs', 'src/domain-knowledge.mjs', 'electron/main.cjs', 'electron/preload.cjs', 'electron/updates.cjs', 'electron/local-stt.cjs', 'server.mjs', 'src/App.tsx', 'src/App.css', 'src/index.css'])
  const actual = [...files('src/'), ...files('electron/'), 'server.mjs'].sort()
  assert.deepEqual(actual, Object.keys(baseline.files).sort())
  for (const path of actual) {
    if (scopedFixFiles.has(path)) continue
    const bytes = readFileSync(new URL(path, root))
    const data = /\.(?:ico|png|jpg|woff2?)$/.test(path) ? bytes : Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'))
    assert.equal(createHash('sha256').update(data).digest('hex'), baseline.files[path], `Changed baseline runtime: ${path}`)
  }
})
