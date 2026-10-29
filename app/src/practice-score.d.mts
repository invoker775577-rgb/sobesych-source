export type PracticeScores = {
  accuracy: number
  directness: number
  specificity: number
  naturalness: number
}

export type PracticeScoreBatch = PracticeScores & { count: number; overall: number }
export type PracticeScoreSummary = {
  total: number
  recent: PracticeScoreBatch
  previous?: PracticeScoreBatch
  delta?: PracticeScoreBatch
}

export function normalizePracticeScores(value: unknown): PracticeScores | undefined
export function visiblePracticeReport(value: unknown): string
export function extractPracticeScores(value: unknown): { answer: string; scores?: PracticeScores }
export function summarizePracticeScores(calls: Array<{ kind?: string; practiceProfile?: string; practiceScores?: unknown; createdAt: string }>, profile: 'devops' | 'support'): PracticeScoreSummary
