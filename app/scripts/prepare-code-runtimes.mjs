import { mkdirSync, copyFileSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
const root = resolve(import.meta.dirname, '..')
const files = { pyodide: ['pyodide.js', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'], 'sql.js/dist': ['sql-wasm.js', 'sql-wasm.wasm'] }
let bytes = 0
for (const [source, names] of Object.entries(files)) {
  const target = join(root, 'public', 'runtimes', source.startsWith('sql') ? 'sql' : 'python')
  mkdirSync(target, { recursive: true })
  for (const name of names) {
    const file = join(root, 'node_modules', source, name)
    copyFileSync(file, join(target, name)); bytes += statSync(file).size
  }
  for (const name of source.startsWith('sql') ? ['SQLJS.txt'] : ['PYODIDE-MPL-2.0.txt', 'CPYTHON.txt']) copyFileSync(join(root, 'electron', 'licenses', name), join(target, name))
}
console.log(`Prepared offline code runtimes: ${(bytes / 1024 / 1024).toFixed(1)} MiB. Loaded only on explicit code execution.`)
