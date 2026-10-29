function nonNegativeNumber(value) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

export function normalizeProviderUsage(usage) {
  if (!usage || typeof usage !== 'object') return {}
  const costUsd = nonNegativeNumber(usage.cost ?? usage.total_cost ?? usage.totalCost)
  const inputTokens = nonNegativeNumber(usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens)
  const outputTokens = nonNegativeNumber(usage.completion_tokens ?? usage.output_tokens ?? usage.completionTokens)
  const totalTokens = nonNegativeNumber(usage.total_tokens ?? usage.totalTokens) ?? (inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined)
  return { ...(costUsd !== undefined ? { costUsd } : {}), ...(inputTokens !== undefined ? { inputTokens } : {}), ...(outputTokens !== undefined ? { outputTokens } : {}), ...(totalTokens !== undefined ? { totalTokens } : {}) }
}

export function createUsageRecord({ id, operation, provider, model, usage, status, createdAt = new Date().toISOString() }) {
  const normalized = normalizeProviderUsage(usage)
  const isLocal = provider === 'Local Ollama' || model === 'local-shortcut'
  const costStatus = status === 'reported' && !isLocal && normalized.costUsd === undefined ? 'unknown' : status || (isLocal || normalized.costUsd !== undefined ? 'reported' : 'unknown')
  return {
    id, operation, provider, model, createdAt, status: costStatus,
    ...(normalized.inputTokens !== undefined ? { inputTokens: normalized.inputTokens } : {}),
    ...(normalized.outputTokens !== undefined ? { outputTokens: normalized.outputTokens } : {}),
    ...(normalized.totalTokens !== undefined ? { totalTokens: normalized.totalTokens } : {}),
    ...(costStatus === 'reported' ? { costUsd: isLocal ? 0 : normalized.costUsd ?? 0 } : {}),
  }
}

export function normalizeUsageRecord(record) {
  const operations = ['answer', 'screen', 'review', 'practice-next', 'practice-report', 'expand', 'clarify', 'summary', 'transcription']
  const statuses = ['pending', 'reported', 'unknown', 'possibly-charged']
  if (!record || typeof record.id !== 'string' || !record.id || typeof record.createdAt !== 'string' || Number.isNaN(Date.parse(record.createdAt)) || typeof record.provider !== 'string' || typeof record.model !== 'string' || !operations.includes(record.operation) || !statuses.includes(record.status)) return undefined
  const costUsd = nonNegativeNumber(record.costUsd)
  if (record.status === 'reported' && costUsd === undefined) return { ...record, status: 'unknown', costUsd: undefined }
  return {
    ...record,
    ...(record.status === 'reported' ? { costUsd } : { costUsd: undefined }),
    ...(nonNegativeNumber(record.inputTokens) !== undefined ? { inputTokens: nonNegativeNumber(record.inputTokens) } : { inputTokens: undefined }),
    ...(nonNegativeNumber(record.outputTokens) !== undefined ? { outputTokens: nonNegativeNumber(record.outputTokens) } : { outputTokens: undefined }),
    ...(nonNegativeNumber(record.totalTokens) !== undefined ? { totalTokens: nonNegativeNumber(record.totalTokens) } : { totalTokens: undefined }),
  }
}

export function upsertUsageRecord(records, record) {
  const list = Array.isArray(records) ? records : []
  const index = list.findIndex(item => item.id === record.id)
  if (index < 0) return [...list, record]
  const next = [...list]
  next[index] = record
  return next
}

export function summarizeUsage(records) {
  const summary = { knownUsd: 0, reportedCount: 0, pendingCount: 0, unknownCount: 0, totalTokens: 0 }
  for (const record of Array.isArray(records) ? records : []) {
    if (record.status === 'reported' && Number.isFinite(record.costUsd) && record.costUsd >= 0) {
      summary.knownUsd += record.costUsd
      summary.reportedCount++
    } else if (record.status === 'pending') summary.pendingCount++
    else summary.unknownCount++
    if (Number.isFinite(record.totalTokens) && record.totalTokens >= 0) summary.totalTokens += record.totalTokens
  }
  summary.knownUsd = Math.round(summary.knownUsd * 1e10) / 1e10
  return summary
}

export function formatUsd(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 8 }).format(amount)
}

export function providerLabel(baseUrl) {
  try {
    const url = new URL(baseUrl)
    if (url.hostname === 'openrouter.ai') return 'OpenRouter'
    if (['localhost', '127.0.0.1', '::1'].includes(url.hostname) && url.port === '11434') return 'Local Ollama'
    return url.hostname
  } catch { return 'Провайдер' }
}
