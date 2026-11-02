// Real renderer + preload + provider service; synthetic documents, task image and local SSE provider only.
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { createRequire } from 'node:module'

const directory = mkdtempSync(join(tmpdir(), 'sobesych-technical-fixture-'))
const question = 'How would you evaluate a RAG system?'
const now = new Date().toISOString()
writeFileSync(join(directory, 'calls.json'), JSON.stringify({ calls: [{ id: 'copilot-call', kind: 'call', createdAt: now, duration: 0, messages: [{ id: 'initial-question', speaker: 'interviewer', origin: 'manual', text: question, createdAt: now }] }] }))
const received = []; const plans = []
const catalog = ['qwen/qwen3.7-flash', 'fixture/code', 'fixture/design'].map(id => ({ id, name: id, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, pricing: { prompt: '0.000001', completion: '0.000002' }, context_length: 100000 }))
let releasePartial
const server = createServer(async (req, res) => {
  if (req.method === 'GET') { res.end(JSON.stringify({ data: catalog })); return }
  let raw = ''; for await (const part of req) raw += part
  const body = JSON.parse(raw); received.push(body)
  assert.equal(req.headers.authorization, 'Bearer technical-fixture-key')
  const plan = plans.shift()
  if (!plan) { res.statusCode = 500; res.end('{}'); return }
  res.setHeader('Content-Type', 'text/event-stream')
  const send = text => res.write(`data: ${JSON.stringify({ model: body.model, choices: [{ delta: { content: text } }] })}\n\n`)
  if (plan.hold) { send(':::ki'); await new Promise(resolve => { releasePartial = resolve }); send(plan.text.slice(5)) }
  else for (const text of plan.text.match(/.{1,90}(?:\n|$)|[\s\S]{1,90}/g) || []) send(text)
  res.end(`data: ${JSON.stringify({ choices: [], usage: { cost: 0, prompt_tokens: 100, completion_tokens: 100 } })}\n\ndata: [DONE]\n\n`)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const baseUrl = `http://127.0.0.1:${server.address().port}`
const env = { ...process.env }
for (const key of Object.keys(env)) if (/^(?:OPENAI_|OPENROUTER_|SOBESYCH_)/.test(key)) delete env[key]
delete env.ELECTRON_RUN_AS_NODE
Object.assign(env, { OPENAI_API_KEY: 'technical-fixture-key', OPENAI_BASE_URL: baseUrl, SOBESYCH_DATA_DIR: directory, SOBESYCH_HEADLESS: '1', SOBESYCH_SKIP_STT_WARMUP: '1' })
let app
try {
  const executable = process.argv.find(arg => arg.startsWith('--exe='))?.slice(6)
  app = await electron.launch({ executablePath: executable ? resolve(executable) : createRequire(import.meta.url)('electron'), args: executable ? [] : [resolve('.')], env })
  const page = await app.firstWindow(); const errors = []
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ ipcMain, dialog }, { models, directory }) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: `${directory}/architecture.svg` })
    ipcMain.removeHandler('provider:models'); ipcMain.handle('provider:models', () => ({ models }))
    ipcMain.removeHandler('screen:select-region'); ipcMain.handle('screen:select-region', () => ({ screenshot: 'data:image/png;base64,AA==', screenLanguage: 'en' }))
  }, { models: catalog.map(model => ({ ...model, modalities: ['text', 'image'] })), directory })
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new Error('Real audio forbidden in this fixture') }
    navigator.mediaDevices.getDisplayMedia = async () => { throw new Error('Real display forbidden in this fixture') }
    navigator.mediaDevices.enumerateDevices = async () => []
  })
  const config = await page.evaluate(baseUrl => window.sobesych.saveSettings({ apiKey: 'technical-fixture-key', baseUrl, model: 'qwen/qwen3.7-flash', codeModel: '', designModel: '', contextIds: [] }), baseUrl)
  assert.ok(!config.error)
  await page.reload()
  await page.getByRole('button', { name: 'История', exact: true }).click()
  await page.getByRole('button', { name: new RegExp(question.replace('?', '\\?')) }).click()
  const ask = () => page.getByRole('button', { name: 'Что сказать?', exact: true }).click()
  const addQuestion = async text => { await page.getByRole('textbox', { name: 'Реплика собеседника', exact: true }).fill(text); await page.getByRole('button', { name: 'Добавить реплику', exact: true }).click() }
  const openSettings = () => page.getByRole('button', { name: 'Настройки', exact: true }).click()
  plans.push({ hold: true, text: ':::kind general\n:::answer\nI would measure retrieval quality first.\n:::details\nUse a labelled evaluation set. Keep a separate test set.\n:::questions\nWhat is the target latency?\n:::assumptions\nThe documents are text.' })
  await ask()
  await page.waitForFunction(() => document.querySelector('.streaming-answer'))
  assert.doesNotMatch(await page.locator('.streaming-answer').innerText(), /:::ki/)
  releasePartial()
  await page.locator('.answer .spoken-answer').getByText('I would measure retrieval quality first.').waitFor()
  assert.equal(received.length, 1)
  assert.equal(await page.locator('.answer-details').getAttribute('open'), null)
  await page.locator('.answer-details summary').click()
  await page.getByText('Use a labelled evaluation set. Keep a separate test set.').waitFor()
  await page.getByText('Что уточнить у собеседника').click()
  await page.getByText('What is the target latency?').waitFor()
  console.log('PASS one streamed request renders spoken answer, expandable details, clarifications and assumptions')

  await openSettings()
  await page.getByLabel('Модель для кода и экрана', { exact: true }).fill('fixture/code')
  await page.getByLabel('Модель для system design', { exact: true }).fill('fixture/design')
  const material = join(directory, 'synthetic-context.md')
  writeFileSync(material, 'RAG evaluation fixture. REFERENCE_ANCHOR_CONTEXT.\n\nUnrelated recipe note.')
  await page.getByLabel('Загрузить материалы').setInputFiles(material)
  await page.getByText(/synthetic-context.md ·/).waitFor()
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await page.getByText('Настройки сохранены', { exact: true }).waitFor()
  assert.equal(readFileSync(join(directory, 'context-library.enc')).includes(Buffer.from('REFERENCE_ANCHOR_CONTEXT')), false)
  assert.doesNotMatch(readFileSync(join(directory, 'settings.json'), 'utf8'), /REFERENCE_ANCHOR_CONTEXT/)
  const savedConfig = await page.evaluate(() => window.sobesych.getConfig())
  assert.equal(savedConfig.settings.model, 'qwen/qwen3.7-flash'); assert.equal(savedConfig.settings.contextIds.length, 1)
  await addQuestion('How should I measure RAG evaluation quality?')
  plans.push({ text: ':::kind general\n:::answer\nUse a held-out test set.\n:::details\nCheck retrieval recall and answer faithfulness.' })
  await ask(); await page.locator('.answer').getByText('Use a held-out test set.').waitFor()
  assert.match(JSON.stringify(received.at(-1)), /REFERENCE_ANCHOR_CONTEXT/)
  assert.doesNotMatch(JSON.stringify(received.at(-1)), /Unrelated recipe/)
  await openSettings()
  await page.getByRole('button', { name: 'Добавить текст', exact: true }).click()
  assert.equal(await page.locator('.context-document').count(), 2)
  await page.getByRole('button', { name: 'Закрыть настройки', exact: true }).click()
  await openSettings()
  assert.equal(await page.locator('.context-document').count(), 1, 'cancelled document edits must not survive reopening settings')
  await page.getByRole('button', { name: 'Не использовать материалы', exact: true }).click()
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await page.getByText('Настройки сохранены', { exact: true }).waitFor()
  console.log('PASS explicit document import, local encryption, saved model profiles and relevant passage selection')

  await addQuestion('Write a Python function to deduplicate IDs and include tests.')
  const codeText = ':::kind code\n:::answer\nI would use a set.\n:::details\n```python\ndef unique(items):\n    return list(dict.fromkeys(items))\nassert unique([2, 1, 2]) == [2, 1]\nprint("UI_CODE_PASS")\n```\nTime O(n), memory O(n).'
  plans.push({ text: codeText }); await ask()
  const codeAnswer = page.locator('.answer').filter({ hasText: 'I would use a set.' })
  await codeAnswer.getByRole('button', { name: 'Проверить код', exact: true }).click()
  await codeAnswer.getByRole('button', { name: 'Запустить локально', exact: true }).click()
  await codeAnswer.getByRole('status').getByText('Выполнено без ошибки').waitFor({ timeout: 30000 })
  assert.match(await codeAnswer.getByRole('status').innerText(), /UI_CODE_PASS/)
  assert.equal(received.at(-1).model, 'fixture/code'); assert.doesNotMatch(JSON.stringify(received.at(-1)), /REFERENCE_ANCHOR_CONTEXT/)
  await addQuestion('Can you make it faster?')
  plans.push({ text: codeText }); await ask()
  await page.waitForFunction(() => document.querySelectorAll('.answer.code, .answer .technical-answer.code').length >= 2)
  assert.match(JSON.stringify(received.at(-1)), /make it faster/); assert.match(JSON.stringify(received.at(-1)), /deduplicate IDs/)
  console.log('PASS editable Python check runs from the answer and follow-up retains task constraints')

  const requestsBeforeId = received.length
  await addQuestion('Write a SQLite query for transactions with shop_id 1.0.3 and status 4. The ID came from speech recognition.')
  await ask()
  await page.locator('.answer .spoken-answer').getByText('I need the exact ID before writing the query.', { exact: false }).waitFor()
  assert.equal(received.length, requestsBeforeId, 'an ambiguous ID must be clarified without a paid request')
  await addQuestion('103')
  plans.push({ text: ':::kind code\n:::answer\nUse the confirmed shop ID.\n:::details\n```sql\nSELECT * FROM transactions WHERE shop_id = 103 AND status = 4;\n```' })
  await ask(); await page.locator('.answer').getByText('Use the confirmed shop ID.', { exact: true }).waitFor()
  assert.equal(received.length, requestsBeforeId + 1)
  assert.match(JSON.stringify(received.at(-1)), /transactions/); assert.match(JSON.stringify(received.at(-1)), /status 4/)
  assert.match(JSON.stringify(received.at(-1)), /103/)
  assert.doesNotMatch(received.at(-1).messages[0].content, /CRITICAL unresolved/)
  console.log('PASS an unconfirmed ID stays local and a typed number resumes the original SQL task')

  await openSettings()
  await page.locator('.context-document summary').click()
  await page.getByRole('checkbox', { name: 'Использовать в ответах', exact: true }).check()
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await page.getByText('Настройки сохранены', { exact: true }).waitFor()
  plans.push({ text: ':::kind code\n:::answer\nThe sum is 7. SCREEN_SOLUTION_ANCHOR\n:::details\n```sql\nSELECT 3 + 4 AS total;\n```' })
  await page.getByRole('button', { name: 'Выделить задачу', exact: true }).click()
  await page.locator('.answer').getByText('The sum is 7. SCREEN_SOLUTION_ANCHOR', { exact: true }).waitFor()
  assert.equal(received.at(-1).model, 'fixture/code')
  assert.equal(received.at(-1).messages[1].content[1].type, 'image_url')
  assert.match(JSON.stringify(received.at(-1)), /REFERENCE_ANCHOR_CONTEXT/, 'explicitly selected documents must accompany the image')
  await addQuestion('What if the table is empty?')
  plans.push({ text: ':::kind general\n:::answer\nAn aggregate over an empty table returns NULL.' }); await ask()
  await page.locator('.answer').getByText('An aggregate over an empty table returns NULL.', { exact: true }).waitFor()
  assert.match(JSON.stringify(received.at(-1)), /SCREEN_SOLUTION_ANCHOR/)
  console.log('PASS screen action sends a synthetic image once and follow-up retains the selected task and solution')

  await addQuestion('Design Facebook feed for 10 million daily users.')
  plans.push({ text: ':::kind design\n:::answer\nI would separate reads from feed updates.\n:::details\nAssume 10 reads per user per day. 100 million reads per day is about 1157 reads/s on average.\n:::questions\nDo we need a ranked feed?\n:::assumptions\nReads can be eventually consistent.\n:::diagram\nflowchart LR\nA[Client] --> B[API]\nB --> C[Feed cache]\nB --> D[Posts DB]' })
  await ask()
  const diagram = page.getByRole('img', { name: 'Схема архитектуры' })
  await diagram.waitFor(); assert.equal(await diagram.locator('rect').count(), 4)
  assert.equal(received.at(-1).model, 'fixture/design'); assert.doesNotMatch(JSON.stringify(received.at(-1)), /deduplicate IDs/)
  await page.getByRole('button', { name: 'Сохранить схему SVG' }).click()
  const exportDeadline = Date.now() + 5000
  while (!existsSync(join(directory, 'architecture.svg'))) { if (Date.now() > exportDeadline) throw new Error('SVG export did not reach the native save handler'); await new Promise(resolve => setTimeout(resolve, 20)) }
  assert.match(readFileSync(join(directory, 'architecture.svg'), 'utf8'), /<svg.*Client/)
  console.log('PASS design routes to its selected model, drops old code task and exports a safe SVG diagram')

  const beforeReload = received.length
  const saveDeadline = Date.now() + 5000
  while (!readFileSync(join(directory, 'calls.json'), 'utf8').includes('Posts DB')) { if (Date.now() > saveDeadline) throw new Error('Current answer was not persisted'); await new Promise(resolve => setTimeout(resolve, 20)) }
  await page.reload(); await page.getByRole('button', { name: 'История', exact: true }).click()
  await page.getByRole('button', { name: new RegExp(question.replace('?', '\\?')) }).click()
  await page.getByRole('img', { name: 'Схема архитектуры' }).waitFor()
  assert.equal(received.length, beforeReload)
  await page.locator('.answer').filter({ hasText: 'UI_CODE_PASS' }).first().getByRole('button', { name: 'Проверить код', exact: true }).click()
  assert.match(await page.getByRole('textbox', { name: 'Код для проверки', exact: true }).inputValue(), /assert unique/)

  // Use the built lazy reader, not the source or a Node substitute.
  const reader = readdirSync('dist/assets').find(name => /^read-context-file-.+\.js$/.test(name))
  const docx = zipSync({ 'word/document.xml': strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DOCX_FIXTURE</w:t></w:r></w:p></w:body></w:document>') })
  const pdfObjects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Length 44 >>\nstream\nBT /F1 12 Tf 10 700 Td (PDF_FIXTURE) Tj ET\nendstream']
  let pdf = '%PDF-1.4\n'; const offsets = [0]
  for (const [index, object] of pdfObjects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n` }
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  const texts = await page.evaluate(async ({ reader, docx, pdf }) => {
    const { readContextFile } = await import(`./assets/${reader}`)
    const result = []
    for (const [name, data] of [['synthetic.docx', docx], ['synthetic.pdf', pdf], ['utf16.txt', [255, 254, 84, 0, 69, 0, 83, 0, 84, 0]]]) result.push(await readContextFile(new File([new Uint8Array(data)], name)))
    try { await readContextFile(new File(['x'.repeat(20001)], 'too-long.txt')); result.push('UNEXPECTED') } catch (error) { result.push(error.message) }
    return result
  }, { reader, docx: [...docx], pdf: [...Buffer.from(pdf)] })
  assert.match(texts[0], /DOCX_FIXTURE/); assert.match(texts[1], /PDF_FIXTURE/); assert.equal(texts[2], 'TEST'); assert.match(texts[3], /20 000/)
  assert.deepEqual(errors, [])
  console.log('PASS history survives reload; packaged DOCX/PDF readers extract synthetic text and reject oversized text')
} finally { releasePartial?.(); await app?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
