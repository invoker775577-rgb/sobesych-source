export function normalizeTranscriptText(value?: string): string
export function normalizeMessageText(message: { text: string; speaker: string; origin?: 'manual' }): string
export function insertTranscriptMessage<T extends { createdAt: string }>(messages: T[], next: T): T[]
export function isTranscriptNoise(value?: string): boolean
export function localSocialReply(value?: string): string
export function isCodeRequest(value?: string): boolean
export function isCodeChangeRequest(value?: string): boolean
export function isProseChangeRequest(value?: string): boolean
export function isLikelyInterviewQuestion(value?: string): boolean
export function usableQuestionDraft(value?: string): string
export const QUESTION_DRAFT_MAX_AGE_MS: number
export function isFreshQuestionDraft(createdAt?: string, now?: number, maxAgeMs?: number): boolean
export function selectLiveQuestionDraft(input?: {
  latestQuestion?: { createdAt?: string }
  partialText?: string
  partialCreatedAt?: string
  now?: number
}): string
export function selectQuestionFallback(input?: {
  initialQuestion?: { id?: string; text: string }
  currentQuestion?: { id?: string; text: string }
  partialText?: string
  partialCreatedAt?: string
  now?: number
  allowVisibleFallback?: boolean
}): { source: 'final' | 'draft' | 'visible'; text: string } | null
export function latestInterviewerMessage<T extends { speaker: string; text: string }>(messages?: T[], onMerge?: (firstIndex: number, lastIndex: number) => void): T | undefined
export function interviewerPreview<T extends { speaker: string; text: string; id?: string }>(messages?: T[], partialText?: string): { text: string; state: 'partial' | 'recognized' | 'correction' | 'review' | 'waiting'; messageId?: string }
export function isDiagnosticQuestion(value?: string): boolean
export function isExperienceQuestion(value?: string): boolean
export function isPersonalStoryQuestion(value?: string): boolean
