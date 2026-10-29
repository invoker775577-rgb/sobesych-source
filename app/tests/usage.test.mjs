import assert from 'node:assert/strict'
import test from 'node:test'
import { createUsageRecord, formatUsd, normalizeProviderUsage, normalizeUsageRecord, summarizeUsage, upsertUsageRecord } from '../src/usage.mjs'

test('provider usage preserves exact cost and token counters', () => {
  assert.deepEqual(normalizeProviderUsage({ prompt_tokens: 120, completion_tokens: 18, total_tokens: 138, cost: '0.000123' }), { costUsd: 0.000123, inputTokens: 120, outputTokens: 18, totalTokens: 138 })
  assert.equal(createUsageRecord({ id: 'a', operation: 'answer', provider: 'OpenRouter', model: 'qwen/test', usage: { cost: 0, prompt_tokens: 5 } }).status, 'reported')
  assert.equal(normalizeUsageRecord(createUsageRecord({ id: 'report', operation: 'practice-report', provider: 'OpenRouter', model: 'qwen/test' }))?.operation, 'practice-report')
})

test('missing or invalid provider cost stays unknown, never becomes zero', () => {
  for (const usage of [undefined, {}, { cost: 'not-a-number' }, { cost: -1 }]) {
    const record = createUsageRecord({ id: 'a', operation: 'answer', provider: 'openai.example', model: 'custom/model', usage })
    assert.equal(record.status, 'unknown')
    assert.equal('costUsd' in record, false)
  }
  assert.equal(normalizeUsageRecord({ id: 'bad', operation: 'answer', provider: 'OpenRouter', model: 'x', createdAt: new Date().toISOString(), status: 'reported' })?.status, 'unknown')
})

test('local inference is recorded as zero API spend', () => {
  const record = createUsageRecord({ id: 'local', operation: 'answer', provider: 'Local Ollama', model: 'local/model' })
  assert.equal(record.status, 'reported')
  assert.equal(record.costUsd, 0)
})

test('usage upsert is idempotent and summary separates unknown from known cost', () => {
  const reported = createUsageRecord({ id: 'one', operation: 'answer', provider: 'OpenRouter', model: 'qwen/test', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.000123 } })
  const pending = createUsageRecord({ id: 'two', operation: 'transcription', provider: 'OpenRouter', model: 'whisper/test', status: 'pending' })
  const unknown = createUsageRecord({ id: 'three', operation: 'screen', provider: 'OpenRouter', model: 'vision/test' })
  const records = upsertUsageRecord(upsertUsageRecord([reported], reported), pending)
  assert.equal(records.length, 2)
  assert.deepEqual(summarizeUsage([...records, unknown]), { knownUsd: 0.000123, reportedCount: 1, pendingCount: 1, unknownCount: 1, totalTokens: 15 })
  const completed = createUsageRecord({ id: 'two', operation: 'transcription', provider: 'OpenRouter', model: 'whisper/test', usage: { cost: 0.000042, total_tokens: 8 } })
  assert.equal(summarizeUsage(upsertUsageRecord(records, completed)).knownUsd, 0.000165)
  assert.equal(formatUsd(0.000123), '$0.000123')
})
