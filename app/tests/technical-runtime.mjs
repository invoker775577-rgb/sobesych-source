// Runs packaged browser code in hidden Electron with a temporary profile; no hardware or provider.
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdtempSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'

const env = { ...process.env }
for (const key of Object.keys(env)) if (/^(?:OPENAI_|OPENROUTER_|SOBESYCH_)/.test(key)) delete env[key]
delete env.ELECTRON_RUN_AS_NODE
Object.assign(env, { SOBESYCH_DATA_DIR: mkdtempSync(join(tmpdir(), 'sobesych-code-fixture-')), SOBESYCH_HEADLESS: '1', SOBESYCH_SKIP_STT_WARMUP: '1' })
const chunk = readdirSync('dist/assets').find(name => /^code-sandbox-.+\.js$/.test(name))
let app
try {
  const executable = process.argv.find(arg => arg.startsWith('--exe='))?.slice(6)
  app = await electron.launch({ executablePath: executable ? resolve(executable) : createRequire(import.meta.url)('electron'), args: executable ? [] : [resolve('.')], env })
  const page = await app.firstWindow()
  const unexpected = []
  await page.route('https://**/*', route => { unexpected.push(route.request().url()); return route.abort() })
  await page.evaluate(async chunk => { window.runtime = await import(`./assets/${chunk}`) }, chunk)
  const run = (language, code) => page.evaluate(async ({ language, code }) => window.runtime.runCode(language, code), { language, code })
  let result = await run('javascript', 'console.assert(2 + 2 === 4); console.log("JS_PASS")')
  assert.equal(result.ok, true, JSON.stringify(result)); assert.match(result.output, /JS_PASS/)
  console.log('PASS JavaScript executes in the packaged sandbox')
  result = await run('javascript', 'console.log(undefined, 1n); console.warn("WARN", 3)')
  assert.equal(result.ok, true); assert.match(result.output, /undefined 1n\nWARN 3/)
  result = await run('sql', 'CREATE TABLE items(qty INTEGER); INSERT INTO items VALUES (3),(4),(NULL); SELECT SUM(qty) AS total FROM items;')
  assert.equal(result.ok, true, JSON.stringify(result)); assert.match(result.output, /total.*7/)
  console.log('PASS SQL runs a fresh in-memory SQLite database')
  result = await run('python', 'def add(a, b):\n    return a + b\nassert add(2, 3) == 5\nprint("PYTHON_PASS")')
  assert.equal(result.ok, true, JSON.stringify(result)); assert.match(result.output, /PYTHON_PASS/)
  console.log('PASS offline Python runtime executes self-contained assertions')
  result = await run('python', 'assert 1 == 2, "EXPECTED_FAILURE"')
  assert.equal(result.ok, false); assert.match(result.error, /EXPECTED_FAILURE/)
  result = await run('javascript', 'console.log(typeof process, typeof require, typeof window, typeof indexedDB); return fetch("https://forbidden.invalid/no-network")')
  assert.equal(result.ok, false); assert.match(result.output, /undefined undefined undefined undefined/)
  assert.match(result.error, /Сеть.*недоступна/)
  result = await run('javascript', 'console.log("x".repeat(17000))')
  assert.equal(result.ok, false); assert.match(result.error, /16 000/)
  result = await run('javascript', 'console.log("x".repeat(15999))')
  assert.equal(result.ok, true); assert.equal(result.output.length, 16000)
  result = await page.evaluate(async () => {
    const controller = new AbortController()
    const pending = window.runtime.runCode('python', 'print("unused")', controller.signal).catch(error => error.name)
    controller.abort()
    return pending
  })
  assert.equal(result, 'AbortError')
  result = await page.evaluate(async () => {
    const controller = new AbortController()
    const pending = window.runtime.runCode('javascript', 'while (true) {}', controller.signal).catch(error => error.name)
    setTimeout(() => controller.abort(), 100)
    return pending
  })
  assert.equal(result, 'AbortError')
  result = await run('javascript', 'while (true) {}')
  assert.equal(result.ok, false); assert.match(result.error, /10 секунд/)
  result = await run('javascript', 'console.log("RECOVERED")')
  assert.equal(result.ok, true); assert.match(result.output, /RECOVERED/)
  assert.equal(await page.locator('iframe').count(), 0)
  assert.deepEqual(unexpected, [])
  console.log('PASS assertion failures, blocked network/host access, output limit, cancel, timeout and recovery')
} finally { await app?.close() }
