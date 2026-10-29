export type UsageOperation = 'answer' | 'screen' | 'review' | 'practice-next' | 'practice-report' | 'expand' | 'clarify' | 'summary' | 'transcription'
export type UsageStatus = 'pending' | 'reported' | 'unknown' | 'possibly-charged'
export type UsageRecord = {
  id: string
  operation: UsageOperation
  provider: string
  model: string
  createdAt: string
  status: UsageStatus
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  costUsd?: number
}
export type ProviderUsage = Record<string, unknown>
export function normalizeProviderUsage(usage: unknown): { costUsd?: number; inputTokens?: number; outputTokens?: number; totalTokens?: number }
export function createUsageRecord(input: { id: string; operation: UsageOperation; provider: string; model: string; usage?: unknown; status?: UsageStatus; createdAt?: string }): UsageRecord
export function normalizeUsageRecord(record: unknown): UsageRecord | undefined
export function upsertUsageRecord(records: UsageRecord[] | undefined, record: UsageRecord): UsageRecord[]
export function summarizeUsage(records: UsageRecord[] | undefined): { knownUsd: number; reportedCount: number; pendingCount: number; unknownCount: number; totalTokens: number }
export function formatUsd(amount: number): string
export function providerLabel(baseUrl: string): string
