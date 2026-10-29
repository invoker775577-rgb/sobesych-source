const scoreKeys = ['accuracy', 'directness', 'specificity', 'naturalness']
const scorecardPattern = /<scorecard>([\s\S]*?)<\/scorecard>/iu

/** @typedef {{ accuracy: number, directness: number, specificity: number, naturalness: number }} PracticeScores */
/** @typedef {{ count: number, accuracy: number, directness: number, specificity: number, naturalness: number, overall: number }} PracticeScoreBatch */

/** @param {unknown} value @returns {PracticeScores | undefined} */
export function normalizePracticeScores(value) {
  if (!value || typeof value !== 'object') return undefined
  const scores = /** @type {Record<string, unknown>} */ (value)
  if (!scoreKeys.every(key => Number.isInteger(scores[key]) && Number(scores[key]) >= 1 && Number(scores[key]) <= 4)) return undefined
  return /** @type {PracticeScores} */ (Object.fromEntries(scoreKeys.map(key => [key, scores[key]])))
}

/** Hide the private score marker, including while it is only partly streamed. @param {unknown} value */
export function visiblePracticeReport(value) {
  const text = typeof value === 'string' ? value : ''
  const markerAt = text.search(/<scorecard>/iu)
  if (markerAt >= 0) return text.slice(0, markerAt).trimEnd()
  const marker = '<scorecard>'
  for (let length = Math.min(marker.length - 1, text.length); length > 0; length--) {
    if (text.toLowerCase().endsWith(marker.slice(0, length))) return text.slice(0, -length).trimEnd()
  }
  return text.trimEnd()
}

/** @param {unknown} value */
export function extractPracticeScores(value) {
  const text = typeof value === 'string' ? value : ''
  const match = scorecardPattern.exec(text)
  if (!match) return { answer: visiblePracticeReport(text) }
  let parsed
  try { parsed = JSON.parse(match[1]) } catch { return { answer: visiblePracticeReport(text) } }
  return { answer: visiblePracticeReport(text), scores: normalizePracticeScores(parsed) }
}

/** @param {Array<{ kind?: string, practiceProfile?: string, practiceScores?: unknown, createdAt: string }>} calls @param {'devops' | 'support'} profile */
export function summarizePracticeScores(calls, profile) {
  const sessions = calls
    .filter(call => call.kind === 'practice' && call.practiceProfile === profile && normalizePracticeScores(call.practiceScores))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
  /** @param {typeof sessions} batch */
  const average = batch => {
    const scores = batch.map(call => normalizePracticeScores(call.practiceScores))
    if (!scores.length) return { count: 0, accuracy: 0, directness: 0, specificity: 0, naturalness: 0, overall: 0 }
    const mean = key => Math.round((scores.reduce((sum, score) => sum + Number(score?.[key]), 0) / scores.length) * 10) / 10
    return {
      count: scores.length,
      accuracy: mean('accuracy'),
      directness: mean('directness'),
      specificity: mean('specificity'),
      naturalness: mean('naturalness'),
      overall: Math.round((scores.reduce((sum, score) => sum + scoreKeys.reduce((total, key) => total + Number(score?.[key]), 0), 0) / (scores.length * scoreKeys.length)) * 10) / 10,
    }
  }
  const recent = average(sessions.slice(0, 5))
  const previous = sessions.length >= 10 ? average(sessions.slice(5, 10)) : undefined
  /** @type {PracticeScoreBatch} */
  const delta = previous ? {
    count: Math.min(recent.count, previous.count),
    accuracy: Math.round((recent.accuracy - previous.accuracy) * 10) / 10,
    directness: Math.round((recent.directness - previous.directness) * 10) / 10,
    specificity: Math.round((recent.specificity - previous.specificity) * 10) / 10,
    naturalness: Math.round((recent.naturalness - previous.naturalness) * 10) / 10,
    overall: Math.round((recent.overall - previous.overall) * 10) / 10,
  } : undefined
  return { total: sessions.length, recent, ...(previous ? { previous, delta } : {}) }
}
