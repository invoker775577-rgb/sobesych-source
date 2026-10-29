const stages = new Set(['clicked', 'ignored', 'waiting_speech', 'selected', 'requested', 'completed', 'failed', 'cancelled', 'released', 'deduplicated'])
const reasons = new Set(['no_call', 'busy', 'unavailable', 'practice_only', 'question', 'provider'])

function formatAnswerTrace(value) {
  if (!value || !stages.has(value.stage) || typeof value.requestId !== 'string'
    || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu.test(value.requestId)) return null
  const result = { requestId: value.requestId, stage: value.stage }
  if (reasons.has(value.reason)) result.reason = value.reason
  if (Number.isFinite(value.elapsedMs)) result.elapsedMs = Math.min(600_000, Math.max(0, Math.round(value.elapsedMs)))
  return JSON.stringify(result)
}

module.exports = { formatAnswerTrace }
