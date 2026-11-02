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

test('0.5.72 call baseline stays unchanged outside scoped fixes and the requested technical copilot', () => {
  const additions = ['electron/context-store.cjs', 'electron/licenses/PYODIDE-MPL-2.0.txt', 'electron/licenses/CPYTHON.txt', 'electron/licenses/SQLJS.txt', 'electron/licenses/FFLATE.txt', 'electron/licenses/PDFJS.txt', 'src/ContextPanel.tsx', 'src/ModelProfiles.tsx', 'src/TechnicalAnswer.tsx', 'src/code-sandbox.ts', 'src/copilot.d.mts', 'src/copilot.mjs', 'src/diagram.d.mts', 'src/diagram.mjs', 'src/read-context-file.ts']
  const scopedFixFiles = new Set([...additions, 'electron/third-party-notices.txt', 'src/capture.ts', 'src/types.ts', 'src/transcript.mjs', 'src/domain-knowledge.mjs', 'electron/main.cjs', 'electron/store.cjs', 'electron/preload.cjs', 'electron/updates.cjs', 'electron/local-stt.cjs', 'server.mjs', 'src/App.tsx', 'src/App.css', 'src/index.css'])
  const actual = [...files('src/'), ...files('electron/'), 'server.mjs'].sort()
  assert.deepEqual(actual, [...Object.keys(baseline.files), ...additions].sort())
  for (const path of actual) {
    if (scopedFixFiles.has(path)) continue
    const bytes = readFileSync(new URL(path, root))
    const data = /\.(?:ico|png|jpg|woff2?)$/.test(path) ? bytes : Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'))
    assert.equal(createHash('sha256').update(data).digest('hex'), baseline.files[path], `Changed baseline runtime: ${path}`)
  }
})
