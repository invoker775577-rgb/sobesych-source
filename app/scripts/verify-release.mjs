import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream, readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, normalize } from 'node:path'
import { createRequire } from 'node:module'
import { sameTextSource } from './source-bytes.mjs'

const require = createRequire(import.meta.url)
const asar = require('@electron/asar')
const directory = resolve(process.argv[2])
const archive = join(directory, 'resources', 'app.asar')
const names = asar.listPackage(archive).map(name => name.replaceAll('\\', '/').replace(/^\//u, ''))
const packageInfo = JSON.parse(asar.extractFile(archive, 'package.json'))
const expected = JSON.parse(readFileSync('package.json', 'utf8'))
const { installSpaceBytes } = require('../electron/updates.cjs')
function treeSize(directory) {
  return readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    const file = join(directory, entry.name)
    return total + (entry.isDirectory() ? treeSize(file) : statSync(file).size)
  }, 0)
}
assert.ok(treeSize(directory) * 3 + 256 * 1024 ** 2 <= installSpaceBytes, 'Installer workspace exceeds the preflight reserve; increase both native and updater guards')
assert.equal(packageInfo.version, expected.version)
assert.equal(packageInfo.main, expected.main)
const privateFiles = names.filter(name => !name.startsWith('node_modules/') && /(?:^|\/)(?:\.env(?:\..*)?|calls\.json|settings\.json|candidate-profiles\.json|attachments|tests|docs)(?:\/|$)/iu.test(name))
assert.deepEqual(privateFiles, [], 'User data or development fixtures must not be shipped')

assert.notEqual(packageInfo.practiceOnly, true, 'Main-channel updates must preserve call functionality')
for (const name of ['src/transcript.mjs', 'src/copilot.mjs', 'src/diagram.mjs', 'src/domain-knowledge.mjs', 'src/practice-score.mjs', 'dist/index.html', 'dist/runtimes/python/pyodide.asm.wasm', 'dist/runtimes/python/python_stdlib.zip', 'dist/runtimes/sql/sql-wasm.wasm']) assert.ok(names.includes(name), `Missing runtime module: ${name}`)
assert.ok(!names.includes('dist-practice/index.html'), 'Practice-only UI must not replace the main call application')
const sourceFiles = names.filter(name => name === 'server.mjs' || name.startsWith('src/') || name.startsWith('dist/') || name.startsWith('electron/'))
let checkedSources = 0
let lineEndingOnlySources = 0
let checkedTextFiles = 0
for (const name of names) {
  if (!/\.(?:mjs|cjs|js|json|html|md|txt|css|ps1)$/iu.test(name)) continue
  if ('files' in asar.statFile(archive, normalize(name))) continue
  const bytes = asar.extractFile(archive, normalize(name))
  assert.equal(/sk-or-v1-[a-f0-9]{32,}|sk-proj-[a-zA-Z0-9_-]{30,}/u.test(bytes.toString('utf8')), false, `Credential pattern found in ${name}`)
  checkedTextFiles++
  if (sourceFiles.includes(name)) {
    const source = readFileSync(name)
    assert.ok(sameTextSource(bytes, source), `Stale packaged source: ${name}`)
    if (!bytes.equals(source)) lineEndingOnlySources++
    checkedSources++
  }
}

async function hash(path, algorithm = 'sha256', encoding = 'hex') {
  const digest = createHash(algorithm)
  for await (const chunk of createReadStream(path)) digest.update(chunk)
  return digest.digest(encoding)
}
const model = join(directory, 'resources', 'local-stt', 'ggml-large-v3-turbo-q5_0.bin')
assert.ok(readFileSync(join(directory, 'resources', 'app.asar.unpacked', 'electron', 'screen-language.ps1')).equals(readFileSync('electron/screen-language.ps1')), 'Missing or stale external OCR script')
assert.equal(await hash(model), '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2')
for (const file of ['whisper-server.exe', 'whisper.dll', 'ggml.dll', 'ggml-base.dll', 'ggml-blas.dll', 'libopenblas.dll', 'ggml-cpu-x64.dll']) {
  assert.ok(existsSync(join(directory, 'resources', 'local-stt', 'cpu', 'Release', file)), `Missing bundled speech component: ${file}`)
}
assert.equal(existsSync(join(directory, 'resources', 'local-stt', 'cuda')), false, 'GPU package must not inflate the main installer')
assert.ok(sameTextSource(readFileSync(join(directory, 'resources', 'app.asar.unpacked', 'scripts', 'install-local-stt.ps1')), readFileSync('scripts/install-local-stt.ps1')), 'Missing or stale optional GPU installer')
const updateConfig = join(directory, 'resources', 'app-update.yml')
if (existsSync(updateConfig)) {
  const yaml = require('js-yaml')
  const feed = yaml.load(readFileSync(updateConfig, 'utf8'))
  assert.equal(feed.provider, 'github')
  assert.equal(feed.owner, 'invoker775577-rgb')
  assert.equal(feed.repo, 'sobesych-releases')
  assert.equal(feed.private, false)
  assert.equal(feed.token, undefined)
  const metadataPath = join(directory, '..', 'latest.yml')
  if (existsSync(metadataPath)) {
    const metadata = yaml.load(readFileSync(metadataPath, 'utf8'))
    assert.equal(metadata.version, expected.version)
    assert.equal(metadata.path, `Sobesych-Setup-${expected.version}-x64.exe`)
    const installer = join(directory, '..', metadata.path)
    const checksum = await hash(installer, 'sha512', 'base64')
    assert.equal(checksum, metadata.sha512)
    assert.equal(checksum, metadata.files[0].sha512)
  }
}
console.log(JSON.stringify({ version: packageInfo.version, checkedSources, lineEndingOnlySources, checkedTextFiles, privateFiles: privateFiles.length, modelVerified: true, exeSha256: await hash(join(directory, 'Sobesych.exe')), asarSha256: await hash(archive) }, null, 2))
