import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import { activeTask, copilotRequest, parseAnswerSections, selectContextPassages } from '../src/copilot.mjs'
import { parseDiagram, diagramSvg } from '../src/diagram.mjs'
import { createService, defaults, resolveSettings } from '../server.mjs'
const { createContextStore, normalizeDocuments } = createRequire(import.meta.url)('../electron/context-store.cjs')
const turn = (speaker, text, seconds = 0) => ({ speaker, text, createdAt: new Date(1_700_000_000_000 + seconds * 1000).toISOString() })
const ask = text => turn('interviewer', text)
const draft = text => turn('assistant', text)

test('section parser preserves fences, legacy prose and partial streamed markers', () => {
  assert.equal(parseAnswerSections('Legacy answer').answer, 'Legacy answer')
  assert.equal(parseAnswerSections('Legacy answer').layered, false)
  const response = ':::kind code\n:::answer\nUse a set.\n:::details\n```python\nprint(":::questions")\n```\n:::questions\nAre IDs unique?\n:::assumptions\nIDs are strings.'
  const parsed = parseAnswerSections(response)
  assert.equal(parsed.kind, 'code'); assert.equal(parsed.answer, 'Use a set.')
  assert.match(parsed.details, /print\(":::questions"\)/)
  assert.equal(parsed.questions, 'Are IDs unique?')
  const tolerant = parseAnswerSections(' :::KIND screen\n :::ANSWER Inline result\n :::DETAILS\nUseful detail')
  assert.equal(tolerant.answer, 'Inline result'); assert.equal(tolerant.kind, 'code'); assert.equal(tolerant.details, 'Useful detail')
  for (const marker of [':::answer', ':::details', ':::questions', ':::assumptions', ':::diagram', ':::kind design']) {
    for (let i = 1; i < marker.length; i++) assert.equal(parseAnswerSections(`:::answer\nVisible\n${marker.slice(0, i)}`).answer, 'Visible', marker.slice(0, i))
  }
})

test('independent questions do not send earlier tasks or their drafts', () => {
  const task = activeTask([ask('Write Python to deduplicate IDs.'), draft('OLD_TASK_PRIVATE'), ask('What is DNS?')])
  assert.equal(task.kind, 'general'); assert.equal(task.turns.length, 1); assert.equal(task.draft, '')
  assert.doesNotMatch(copilotRequest({ messages: task.turns }, true).context, /OLD_TASK_PRIVATE/)
})
test('a fully specified why question on another topic starts a new task', () => {
  for (const question of ['Why does the sky look blue?', 'Почему браузер не открывает новый сайт?']) {
    const task = activeTask([ask('Write SQL to count payments.'), draft('OLD_SQL_DRAFT'), ask(question)])
    assert.equal(task.kind, 'general'); assert.equal(task.draft, ''); assert.equal(task.turns.length, 1)
  }
})
test('natural optimization and failure follow-ups retain the solution and original requirements', () => {
  for (const [root, question, kind] of [
    ['Write a Python function that removes duplicate IDs without changing their order.', 'Can you make it faster?', 'code'],
    ['Write a Python function that removes duplicate IDs.', 'А можно быстрее?', 'code'],
    ['Write a SQL query to count payments for the past day.', 'А теперь только за последние семь дней.', 'code'],
    ['Design a feed service for ten million users.', 'What happens if one node fails?', 'design'],
    ['Спроектируй сервис ленты для десяти миллионов пользователей.', 'Что будет, если один узел упадёт?', 'design'],
  ]) {
    const request = copilotRequest({ messages: [ask(root), draft('SOLUTION_ANCHOR'), ask(question)] }, true)
    assert.equal(request.kind, kind); assert.equal(request.draft, 'SOLUTION_ANCHOR'); assert.match(request.context, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    if (kind === 'code') assert.equal(request.maxTokens, 3200, 'an optimization request needs a complete revised solution')
  }
  for (const question of ['Can you make pasta?', 'What happens during a TLS handshake?', 'What would you check if a Docker container that works locally fails in CI/CD?', 'How does Docker handle a file that does not exist?']) {
    assert.equal(activeTask([ask('Write Python code to remove duplicates.'), draft('OLD_CODE'), ask(question)]).draft, '')
  }
  for (const question of ['How does it work?', 'How would you improve it?', 'Could you check this?']) {
    assert.equal(activeTask([ask('Write Python code to remove duplicates.'), draft('CURRENT_CODE'), ask(question)]).draft, 'CURRENT_CODE')
  }
})
test('selected documents accompany a new screenshot and its follow-up without attaching an old topic', () => {
  const schema = { id: 'schema', title: 'Table schema', text: `${'SCHEMA_DATA '.repeat(1400)} UNIQUE_COLUMN_AT_END` }
  const hidden = { id: 'hidden', title: 'Not selected', text: 'UNSELECTED_SECRET' }
  const request = copilotRequest({ mode: 'screen', screenshot: 'synthetic-image', contextIds: ['schema'], messages: [ask('Explain DNS.')] }, true, [schema, hidden])
  assert.deepEqual(request.usedContextIds, ['schema']); assert.match(request.context, /UNIQUE_COLUMN_AT_END/)
  assert.doesNotMatch(request.context, /UNSELECTED_SECRET|Explain DNS/)
  const followup = copilotRequest({ screenshot: 'synthetic-image', contextIds: ['schema'], messages: [draft('SELECT COUNT(*) FROM orders;'), ask('What if there are no rows?')] }, true, [schema])
  assert.match(followup.context, /UNIQUE_COLUMN_AT_END/)
})

test('an ambiguous spoken numeric ID asks for its value without paying or guessing; a correction resumes the same query', async () => {
  const sent = []
  const service = createService({ getSettings: () => resolveSettings({ apiKey: 'fixture' }), fetchImpl: async (_url, options) => { sent.push(JSON.parse(options.body)); return Response.json({ choices: [{ message: { content: 'fixture query' } }] }) } })
  const root = ask('Write a SQLite query for transactions with shop_id 1.0.3 and status 4. The ID came from speech recognition.')
  const input = { mode: 'answer', presentation: 'layered', messages: [root] }
  const first = await service.assist(input)
  assert.equal(sent.length, 0); assert.equal(first.usage.cost, 0)
  assert.match(first.answer, /exact.*ID/); assert.match(first.answer, /1\.0\.3/)
  assert.doesNotMatch(first.answer, /\b103\b|\bIN\s*\(/i)
  await service.assist({ ...input, messages: [root, draft(first.answer), ask('Correction, shop_id is 103.')] })
  assert.equal(sent.length, 1); assert.match(sent[0].messages[1].content, /status 4/)
  assert.doesNotMatch(sent[0].messages[0].content, /CRITICAL unresolved/)
  const number = { ...ask('103'), origin: 'manual' }
  await service.assist({ ...input, messages: [root, draft(first.answer), number] })
  assert.equal(sent.length, 2); assert.match(sent[1].messages[1].content, /status 4/)
  assert.match(sent[1].messages[1].content, /103/); assert.doesNotMatch(sent[1].messages[0].content, /CRITICAL unresolved/)
  for (const question of ["Write SQL where event_id = '1.2.3'.", 'Write SQL for versions with version = "1.2.3".', 'What is DNS?']) {
    await service.assist({ ...input, messages: [root, draft(first.answer), ask(question)] })
  }
  assert.equal(sent.length, 5, 'quoted literals, version strings and an independent topic remain provider tasks')
})

test('follow-up requirements survive repeated answers and spoken fragments', () => {
  const lines = [ask('Write a Python function to deduplicate IDs.'), draft('DRAFT_A'), ask('Now preserve the original order.'), turn('me', 'Keep the first ID.'), draft('DRAFT_B'), ask('Without extra libraries.')]
  const task = activeTask(lines)
  assert.equal(task.kind, 'code'); assert.equal(task.turns.length, 6); assert.equal(task.draft, 'DRAFT_B')
  const prompt = copilotRequest({ messages: lines }, true)
  assert.match(prompt.context, /original order/); assert.match(prompt.context, /Keep the first ID/); assert.match(prompt.context, /Without extra libraries/)
  const split = activeTask([turn('interviewer', 'How would you design a feed', 0), turn('interviewer', 'for 100 million users', 2)])
  assert.match(split.question, /feed.*100 million/); assert.equal(split.turns.length, 2)
})

test('manual turns, literal values and corrections retain exact bytes', () => {
  const first = { ...ask('Write a SQL query for items(id, qty). Keep `id = 00017` literally.'), origin: 'manual' }
  const lines = [first, draft('SELECT * FROM items;'), { ...ask('Correction: use qty >= 3 and keep NULL rows.'), origin: 'manual' }]
  const prompt = copilotRequest({ messages: lines }, true)
  assert.match(prompt.context, /id = 00017/); assert.match(prompt.context, /qty >= 3/); assert.match(prompt.context, /NULL rows/)
})

test('code rationale keeps task context but requests an explanation rather than new code', () => {
  const request = copilotRequest({ messages: [ask('Write a SQL query for shops(id) and orders(id, shop_id). Both id columns are non-NULL keys. Keep shops with no orders and count their orders.'), draft('SELECT COUNT(orders.id) FROM shops LEFT JOIN orders ON shops.id = orders.shop_id;'), ask('Why not use COUNT(*)?')] }, true)
  assert.equal(request.kind, 'code'); assert.equal(request.maxTokens, 900)
  assert.match(request.system, /do not regenerate the whole code/)
  assert.match(request.context, /COUNT\(orders.id\)/)
  assert.match(request.context, /NULL/)
  assert.match(request.context, /Topic sql-aggregate-null/)
  assert.match(request.context, /joined values are not aggregate results/)
  const screen = copilotRequest({ screenshot: 'synthetic-image', messages: [draft('SCREEN_SOLUTION_ANCHOR'), ask('Why use this count?')] }, true)
  assert.equal(screen.draft, 'SCREEN_SOLUTION_ANCHOR'); assert.equal(screen.maxTokens, 900)
  const afterThanks = activeTask([ask('Write Python code to sort IDs.'), draft('CODE_ANCHOR'), turn('me', 'I would sort the IDs.'), ask('Thank you.'), ask('More details?')])
  assert.equal(afterThanks.kind, 'code'); assert.match(afterThanks.turns[0].text, /sort IDs/)
})

test('system design and AI questions retain technical depth with simple English', () => {
  const design = copilotRequest({ messages: [ask('Design Facebook news feed for 10 million daily users.')] }, true)
  assert.equal(design.kind, 'design'); assert.equal(design.maxTokens, 2400)
  assert.match(design.system, /worked load estimate with units/)
  assert.match(design.system, /consistency, bottlenecks, failure recovery/)
  const ai = copilotRequest({ messages: [ask('How would you evaluate RAG retrieval and prevent prompt injection?')] }, true)
  assert.equal(ai.kind, 'general'); assert.match(ai.system, /Keep technical depth/)
  assert.match(ai.context, /RAG retrieval/)
  const clarified = copilotRequest({ messages: [ask('Design Facebook feed.'), draft('DESIGN_DRAFT'), ask('We have 10 million users. The target is 300ms p95.')] }, true)
  assert.equal(clarified.kind, 'design'); assert.match(clarified.context, /DESIGN_DRAFT/)
  assert.equal(copilotRequest({ messages: [ask('Implement a bounded queue.')] }, true).maxTokens, 3200)
})

test('a code revision after a prose explanation recovers the original solution, including screen tasks', () => {
  for (const screenshot of [undefined, 'synthetic-image']) {
    for (const solution of ['```sql\nSELECT COUNT(id) FROM payments;\n```', 'SELECT COUNT(id) FROM payments;']) {
      const request = copilotRequest({ screenshot, messages: [ask('Write SQL to count payments.'), draft(solution), ask('Why?'), draft('EXPLANATION_ONLY_MARKER'), ask('Now rewrite the query to use the name total.')] }, true)
      assert.equal(request.draft, solution); assert.equal(request.maxTokens, 3200)
      assert.match(request.context, /Write SQL to count payments/); assert.match(request.context, /name total/)
      assert.doesNotMatch(request.context, /EXPLANATION_ONLY_MARKER/)
    }
  }
  const longSolution = 'SELECT id FROM payments;\n' + Array.from({ length: 1000 }, (_, index) => `-- retained condition ${index} for the original input\n`).join('')
  assert.throws(() => copilotRequest({ messages: [ask('Write SQL.'), draft(longSolution), ask('Why?'), draft('short explanation'), ask('Now rewrite the query.')] }, true), /24 000/)
})

test('long completed conversations do not displace the current task; oversized current conditions fail explicitly', () => {
  const history = Array.from({ length: 150 }, (_, i) => [ask(`What is old topic ${i}?`), draft('x'.repeat(1000))]).flat()
  const current = copilotRequest({ messages: [...history, ask('Explain embeddings.')] }, true)
  assert.ok(current.context.length < 4000); assert.doesNotMatch(current.context, /old topic/)
  assert.throws(() => copilotRequest({ messages: [ask(`Write Python code. ${'condition '.repeat(2500)}`)] }, true), /24 000/)
})

test('experience examples stay labelled and follow-ups preserve their scenario without old resume fields', () => {
  const result = copilotRequest({ messages: [ask('Расскажи кейс с мониторингом.'), draft('Пример кейса. SCENARIO_ANCHOR'), ask('А подробнее?')], candidateContext: 'OLD_RESUME_SECRET' }, false)
  assert.match(result.system, /Пример кейса/); assert.match(result.context, /SCENARIO_ANCHOR/)
  assert.doesNotMatch(result.context, /OLD_RESUME_SECRET/)
})

test('only explicit documents and matching passages are selected', () => {
  const docs = [{ id: 'one', title: 'Selected', text: 'RAG evaluation measures recall.\n\nUNRELATED_OTHER_PASSAGE' }, { id: 'two', title: 'Not selected', text: 'PRIVATE_RAG_SECRET' }]
  const passages = selectContextPassages(docs, ['one'], 'Explain RAG evaluation')
  assert.equal(passages.length, 1); assert.equal(passages[0].id, 'one'); assert.doesNotMatch(JSON.stringify(passages), /PRIVATE|UNRELATED/)
  assert.deepEqual(selectContextPassages(docs, [], 'RAG'), [])
})

test('long uninterrupted document data is chunked without losing its prefix', () => {
  const text = 'x'.repeat(1400) + ' needle'
  const parts = selectContextPassages([{ id: 'one', title: 'Document', text }], ['one'], 'Tell me about your experience', 7000)
  assert.equal(parts.map(part => part.text).join(''), text)
})

test('document limits reject invalid IDs, empty documents, duplicates and oversized text', () => {
  const valid = { id: 'one', title: 'Synthetic', text: 'x'.repeat(20000) }
  assert.equal(normalizeDocuments([valid])[0].text.length, 20000)
  for (const data of [[{ ...valid, text: `${valid.text}x` }], [valid, valid], [{ ...valid, id: '../escape' }], [{ ...valid, text: '' }], Array(9).fill(valid)]) assert.throws(() => normalizeDocuments(data))
})

function encryption(key = randomBytes(32)) {
  return {
    isEncryptionAvailable: () => true,
    encryptString(text) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); const bytes = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), bytes]) },
    decryptString(bytes) { if (bytes.length < 28) throw new Error('Invalid ciphertext'); const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8') },
  }
}
test('context files stay encrypted, survive reopen and retain previous ciphertext as backup', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sobesych-context-fixture-')); const crypto = encryption()
  const store = createContextStore(directory, crypto)
  const doc = { id: 'one', title: 'Synthetic', text: 'SYNTHETIC_CONTEXT_SECRET' }
  store.save([doc])
  const original = readFileSync(join(directory, 'context-library.enc'))
  assert.equal(original.includes(Buffer.from(doc.text)), false)
  assert.deepEqual(createContextStore(directory, crypto).forRequest(['one']), [doc])
  assert.throws(() => store.forRequest(['missing']), /недоступны/)
  store.save([])
  assert.deepEqual(readFileSync(join(directory, 'context-library.enc.bak')), original)
})
test('corrupt or locked context never silently resets or overwrites the file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sobesych-locked-context-')); const file = join(directory, 'context-library.enc')
  writeFileSync(file, 'ORIGINAL_CORRUPT_CIPHERTEXT')
  const store = createContextStore(directory, encryption())
  assert.equal(store.status().locked, true); assert.throws(() => store.save([])); assert.throws(() => store.forRequest(['one']))
  assert.deepEqual(store.forRequest([]), []); assert.equal(readFileSync(file, 'utf8'), 'ORIGINAL_CORRUPT_CIPHERTEXT')
})

function mockService(settings = {}, documents = []) {
  const requests = []
  const config = resolveSettings({ apiKey: 'synthetic-fixture-key', baseUrl: 'http://127.0.0.1:1', ...settings })
  const service = createService({ getSettings: () => config, getContextDocuments: () => documents, fetchImpl: async (_url, options) => {
    const body = options?.body && JSON.parse(options.body)
    if (!body) return { ok: true, json: async () => ({ data: [{ id: config.codeModel || config.model, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, pricing: { prompt: '0.000001', completion: '0.000002' }, context_length: 100000 }] }) }
    requests.push(body)
    return { ok: true, json: async () => ({ model: body.model, choices: [{ message: { content: ':::kind general\n:::answer\nFixture answer\n:::details\nDetail' } }], usage: { cost: 0 } }) }
  } })
  return { service, requests }
}
test('per-task model routing is explicit and empty profiles preserve the current cheap model', async () => {
  const fixture = mockService({ codeModel: 'fixture/code', designModel: 'fixture/design' })
  for (const [question, expected] of [['Explain RAG.', defaults.model], ['Write Python code to reverse a list.', 'fixture/code'], ['Design Facebook feed.', 'fixture/design']]) {
    const before = fixture.requests.length
    const answer = await fixture.service.assist({ mode: 'answer', presentation: 'layered', messages: [ask(question)] })
    assert.equal(answer.model, expected); assert.equal(fixture.requests.length, before + 1)
  }
  const original = mockService()
  await original.service.assist({ presentation: 'layered', messages: [ask('Write Python code.')] })
  assert.equal(original.requests[0].model, defaults.model)
  assert.equal(resolveSettings({ codeModel: '' }, { codeModel: 'fixture/old' }).codeModel, '')
})
test('enhanced screen tasks preserve explicit screenshot language and use the code model', async () => {
  const { service, requests } = mockService({ codeModel: 'fixture/vision' })
  const answer = await service.assist({ mode: 'screen', presentation: 'layered', screenLanguage: 'ru', screenshot: 'data:image/png;base64,AA==', messages: [ask('What is the result?')] })
  assert.equal(answer.model, 'fixture/vision'); assert.equal(answer.answerKind, 'screen')
  assert.match(requests[0].messages[0].content, /только по-русски/)
  assert.match(requests[0].messages[0].content, /Never assume omitted rows mean an empty table/)
  assert.match(requests[0].messages[1].content[0].text, /If required table rows, schema, or conditions are missing, return ONLY one short sentence/)
  assert.match(requests[0].messages[1].content[0].text, /For multiple choice, return the supported option/)
  assert.match(requests[0].messages[1].content[0].text, /Do not repeat the given query or add a code block when only its result is requested/)
  assert.match(requests[0].messages[1].content[0].text, /только по-русски/)
  assert.equal(requests[0].max_tokens, 3200); assert.equal(requests[0].messages[1].content[1].type, 'image_url')
})
test('selected reference data is sent only in enhanced mode and reports the used IDs', async () => {
  const doc = { id: 'one', title: 'Selected', text: 'RAG_SYNTHETIC private example' }
  const { service, requests } = mockService({ contextIds: ['one'] }, [doc])
  const answer = await service.assist({ presentation: 'layered', messages: [ask('Explain RAG_SYNTHETIC.')] })
  assert.deepEqual(answer.usedContextIds, ['one']); assert.match(JSON.stringify(requests[0]), /RAG_SYNTHETIC private example/)
  await service.assist({ messages: [ask('Explain RAG_SYNTHETIC.')] })
  assert.doesNotMatch(JSON.stringify(requests[1]), /private example/)
})
test('live draft status and existing clarity/accuracy rules survive layered prompting', async () => {
  const { service, requests } = mockService()
  await service.assist({ presentation: 'layered', partialQuestion: true, messages: [ask('How would you check runner logs?')] })
  assert.match(requests[0].messages[1].content, /fresh live transcription draft/)
  assert.match(requests[0].messages[0].content, /essential action or subject/)
  assert.match(requests[0].messages[0].content, /Working locally does not prove/)
  await service.assist({ presentation: 'layered', messages: [ask('How would you check runner logs?')] })
  assert.doesNotMatch(requests[1].messages[1].content, /fresh live transcription draft/)
})
test('safe diagrams reject commands, links, invalid syntax and unbounded graphs', () => {
  assert.equal(parseDiagram('flowchart LR\nA[Client] --> B[API]\nB --> C[DB]').nodes.length, 3)
  assert.equal(parseDiagram('```mermaid\nflowchart TD\nA[Client]\n```').nodes[0].label, 'Client')
  for (const source of ['click A "https://evil.invalid"', 'A --> B\n<script>alert(1)</script>', Array.from({ length: 25 }, (_, i) => `N${i}[Node]`).join('\n')]) assert.equal(parseDiagram(source), null)
  const svg = diagramSvg('flowchart LR\nA[<script>alert & test</script>] --> B[DB]')
  assert.match(svg, /&lt;script&gt;/); assert.doesNotMatch(svg, /<script>/)
  assert.throws(() => diagramSvg('click A "javascript:alert(1)"'))
})
