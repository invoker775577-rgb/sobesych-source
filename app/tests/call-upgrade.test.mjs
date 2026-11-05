import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { activeTask, copilotRequest, selectContextPassages } from '../src/copilot.mjs'
import { createCallBudget } from '../src/call-budget.mjs'
import { createService, resolveSettings } from '../server.mjs'
const { diagnosticSnapshot } = createRequire(import.meta.url)('../electron/diagnostics.cjs')
const ask = text => ({ speaker: 'interviewer', text, origin: 'manual' })
const prior = [ask('Write a SQL query to count invoices per customer.'), { speaker: 'assistant', text: '```sql\nSELECT customer_id, COUNT(*) FROM invoices GROUP BY customer_id;\n```' }]

test('transition words cannot attach complete new questions to a SQL solution', () => {
  for (const text of ['Now explain how JWT refresh tokens work.', 'Then what is TLS?', 'Теперь расскажи про DNS.', 'А теперь что такое OAuth?', 'Now write a Python function to sort IDs.']) {
    const task = activeTask([...prior, ask(text)])
    assert.equal(task.turns.length, 1, text); assert.equal(task.draft, '', text)
    assert.doesNotMatch(copilotRequest({ messages: [...prior, ask(text)] }, true).context, /FROM invoices/)
  }
  for (const text of ['Now preserve customers with no invoices.', 'А теперь только за семь дней.', 'Why use this count?', 'Can you make it faster?']) assert.equal(activeTask([...prior, ask(text)]).draft, prior[1].text, text)
})
test('natural SQL tasks request executable SQL; theory questions stay prose', () => {
  for (const text of ['SQLite events(user_id) may contain NULL. Return the number of distinct users.', 'In SQLite return SUM(qty) from invoices(qty).', 'SQLite tables customers(id). Return every customer ID.']) assert.equal(activeTask([ask(text)]).kind, 'code', text)
  assert.equal(activeTask([ask('What does COUNT(*) mean in SQL?')]).kind, 'general')
})

test('explicit selected references survive language changes and have a strict total bound', () => {
  const docs = [{ id: 'one', title: 'Retry policy', text: 'При повторной оплате сохраняйте прежний ключ идемпотентности для той же операции.' }, { id: 'hidden', title: 'Not selected', text: 'NEVER_SEND' }]
  for (const query of ['What is our payment retry policy?', 'Наша политика повтора оплаты', 'Unseen wording in another language']) {
    const parts = selectContextPassages(docs, ['one'], query)
    assert.equal(parts.length, 1); assert.match(parts[0].text, /идемпотентности/); assert.doesNotMatch(JSON.stringify(parts), /NEVER_SEND/)
  }
  const bounded = selectContextPassages([{ id: 'one', title: 'Synthetic', text: 'one '.repeat(6000) }], ['one'], 'unmatched', 7000)
  assert.ok(bounded.reduce((sum, part) => sum + part.text.length, 0) <= 7000)
})

const models = [{ id: 'm1', pricing: { prompt: '0.000001', completion: '0.000001' } }, { id: 'm2', pricing: { prompt: '0.000001', completion: '0.000001' } }]
const payload = () => ({ model: 'm1', messages: [{ role: 'user', content: 'Synthetic' }], max_tokens: 100 })
test('explicit context reset and a named return keep unrelated subjects out of the solution', () => {
  const history = [...prior, ask('Now explain JWT refresh tokens.'), { speaker: 'assistant', text: 'JWT_UNRELATED_ANSWER' }]
  const resumed = activeTask([...history, ask('Back to SQL. Use only paid invoices.')])
  assert.equal(resumed.kind, 'code'); assert.match(resumed.draft, /SELECT customer_id/)
  assert.doesNotMatch(JSON.stringify(resumed.turns), /JWT_UNRELATED_ANSWER|refresh tokens/)
  const reset = activeTask([...prior, { ...ask('Explain this.'), taskBoundary: true }])
  assert.equal(reset.turns.length, 1); assert.equal(reset.draft, '')
})
test('call budget reserves concurrent requests, retains unknown cost and survives reopen', () => {
  let disk = {}; const save = value => { disk = structuredClone(value) }
  const ledger = createCallBudget({ load: () => disk, save })
  const one = ledger.reserve('call-a', .03, payload(), models)
  assert.throws(() => ledger.reserve('call-a', .03, payload(), models), /исчерпан/)
  one.settle({ cost: .001 }); one.settle({ cost: 0 })
  assert.equal(ledger.status('call-a', .03).accountedUsd, .001)
  ledger.reserve('call-a', .03, payload(), models).settle()
  const restored = createCallBudget({ load: () => disk, save })
  assert.throws(() => restored.reserve('call-a', .03, payload(), models), /исчерпан/)
  assert.doesNotThrow(() => restored.reserve('call-b', .03, payload(), models))
})
test('unknown prices, unsupported fees and corrupt ledgers block only budgeted requests', () => {
  const ledger = createCallBudget()
  assert.throws(() => ledger.reserve('call-a', 1, payload(), []), /Цена/)
  assert.throws(() => ledger.reserve('call-a', 1, payload(), [{ id: 'm1', pricing: { ...models[0].pricing, request: .1 } }]), /Доплата/)
  const corrupt = createCallBudget({ load: () => { throw new Error('invalid data') } })
  assert.throws(() => corrupt.reserve('call-a', 1, payload(), models), /повреждён/)
  assert.doesNotThrow(() => corrupt.reserve('call-a', 0, payload(), []))
})
test('blank or boolean prices are unknown and blank reported cost cannot release a reservation', () => {
  for (const prompt of [' ', '\t', false, null]) assert.throws(() => createCallBudget().reserve('call-a', 1, payload(), [{ id: 'm1', pricing: { prompt, completion: 0 } }]), /Цена/)
  const ledger = createCallBudget(); const ticket = ledger.reserve('call-a', 1, payload(), models)
  const before = ledger.status('call-a', 1).accountedUsd
  for (const cost of [' ', '\t', false, null, undefined]) { ticket.settle({ cost }); assert.equal(ledger.status('call-a', 1).accountedUsd, before) }
  ticket.settle({ cost: '0.001' }); assert.ok(Math.abs(ledger.status('call-a', 1).accountedUsd - .001) < 1e-10)
})

test('production fallback is opt-in, bounded and included in the same call budget', async () => {
  for (const fallbackModel of ['', 'm2']) {
    const sent = []; const config = resolveSettings({ apiKey: 'fixture', model: 'm1', fallbackModel, callBudgetUsd: .1 })
    const service = createService({ getSettings: () => config, fetchImpl: async (_url, options) => {
      if (options.method === 'GET') return Response.json({ data: models })
      const body = JSON.parse(options.body); sent.push(body)
      if (sent.length === 1) return Response.json({ error: { message: 'busy' }, usage: { cost: .001 } }, { status: 503 })
      return Response.json({ model: body.model, choices: [{ message: { content: 'Useful answer.' } }], usage: { cost: .002 } })
    } })
    const input = { callId: 'call-a', messages: [ask('How does TLS work?')], presentation: 'layered' }
    if (!fallbackModel) await assert.rejects(service.assist(input), /busy/)
    else {
      const result = await service.assist(input)
      assert.equal(result.model, 'm2'); assert.deepEqual(result.attempts, ['m1', 'm2'])
      assert.equal(result.usage.cost, .003); assert.ok(Math.abs(result.budget.accountedUsd - .003) < 1e-10)
      assert.equal(sent[1].provider.allow_fallbacks, false)
    }
    assert.equal(sent.length, fallbackModel ? 2 : 1)
  }
})
test('a failed reservation never sends a paid request', async () => {
  let posts = 0
  const service = createService({ getSettings: () => resolveSettings({ apiKey: 'fixture', model: 'm1', callBudgetUsd: .00001 }), fetchImpl: async (_url, options) => {
    if (options.method === 'POST') posts++
    return Response.json({ data: models })
  } })
  await assert.rejects(service.assist({ callId: 'call-a', messages: [ask('Explain HTTP.')] }), /исчерпан/)
  assert.equal(posts, 0)
})
test('budget includes image fees and reasoning rates but ignores unrequested web search prices', () => {
  const ledger = createCallBudget()
  const catalog = [{ id: 'm1', pricing: { prompt: 0, completion: 0, internal_reasoning: .000001, image: .01, web_search: .1 } }]
  const text = payload(); ledger.reserve('text', 1, text, catalog)
  assert.ok(Math.abs(ledger.status('text', 1).accountedUsd - .0001) < 1e-10)
  const image = { ...payload(), messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] }] }
  ledger.reserve('image', 1, image, catalog)
  assert.ok(Math.abs(ledger.status('image', 1).accountedUsd - .0101) < 1e-10)
  assert.equal(image.provider.max_price.image, .01)
  assert.throws(() => ledger.reserve('web', 1, { ...payload(), plugins: [{ id: 'web' }] }, catalog), /Доплата web_search/)
})
test('diagnostic export excludes credentials, transcript, paths and arbitrary event fields', () => {
  const value = diagnosticSnapshot({ version: 'fixture', platform: 'win32', arch: 'x64', settings: { hasKey: true, apiKey: 'NEVER_EXPORT', contextIds: ['SECRET_DOCUMENT'] }, speech: { backend: 'cpu', pid: 123, path: 'PRIVATE_PATH' }, events: [{ requestId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', stage: 'failed', elapsedMs: 1234, reason: 'provider', transcript: 'PERSONAL_WORDS' }] })
  assert.equal(value.events[0].elapsedMs, 1234)
  assert.doesNotMatch(JSON.stringify(value), /NEVER_EXPORT|SECRET_DOCUMENT|PRIVATE_PATH|PERSONAL_WORDS|requestId/)
})
