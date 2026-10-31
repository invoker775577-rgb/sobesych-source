export type Speaker = 'interviewer' | 'me' | 'assistant' | 'note'
export type Message = { id: string; speaker: Speaker; text: string; createdAt: string; origin?: 'manual' }
import type { UsageRecord } from './usage.mjs'
import { normalizeUsageRecord } from './usage.mjs'
import { normalizePracticeScores } from './practice-score.mjs'
export type PracticeScores = { accuracy: number; directness: number; specificity: number; naturalness: number }
export type PracticeLibrary = { id: string; title: string; createdAt: string; sourceNames: string[]; sourceQuestionCounts: number[]; questions: string[]; questionSources: number[][]; unlabelledFileCount: number; emptyFileCount: number }
export type Call = { id: string; createdAt: string; duration: number; messages: Message[]; kind?: 'call' | 'practice'; practiceProfile?: 'devops' | 'support'; practiceScores?: PracticeScores; practiceTrackId?: string; practiceTrackStep?: number; practiceQuestionSet?: { title: string; questions: string[] }; practiceReportComplete?: boolean; usage?: UsageRecord[]; usageTracking?: 'complete' | 'partial'; transcriptionMode?: 'local' | 'openrouter' }
export type SavedState = { calls: Call[] }
export type Settings = { hasKey: boolean; baseUrl: string; model: string; language: string; microphoneId: string; practiceProfile: 'devops' | 'support'; autoAnswer: boolean; transcriptionMode: 'local' | 'openrouter'; transcriptionBaseUrl: string; transcriptionModel: string }
export type LocalSpeech = { running: boolean; backend: 'cpu' | 'cuda' | null; cudaInstalled: boolean; gpuSupported: boolean }
export type Model = { id: string; name: string; pricing?: { prompt: string; completion: string }; modalities?: string[] }
type Result = { error?: string; ok?: boolean }
type UsageResult = { model?: string; usage?: Record<string, unknown> }
export type UpdateState = { phase: 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error'; currentVersion: string; version?: string; percent?: number; error?: string; releasePage?: string; checked?: boolean }
declare global {
  interface Window {
    sobesych?: {
      getConfig(): Promise<Result & { settings: Settings; state: SavedState | null; practiceLibraries: PracticeLibrary[]; practiceLibrariesStatus: 'empty' | 'ready' | 'locked'; practiceLibrariesWarning?: string; historyWarning?: string; captureProtected?: boolean; overlayMode?: boolean; localSpeech?: LocalSpeech; practiceOnly: boolean; version: string }>
      getUpdateState(): Promise<UpdateState>
      checkUpdate(): Promise<UpdateState>
      downloadUpdate(): Promise<UpdateState>
      installUpdate(): Promise<Result>
      setUpdateBusy(value: boolean): Promise<Result>
      onUpdateState(callback: (value: UpdateState) => void): () => void
      saveSettings(value: Partial<Settings> & { apiKey?: string }): Promise<Result & { settings: Settings }>
      saveState(value: SavedState): Promise<Result>
      traceAnswer(value: { requestId: string; stage: string; reason?: string; elapsedMs: number }): Promise<Result>
      savePracticeLibraries(value: PracticeLibrary[]): Promise<Result>
      assist(value: { requestId: string; mode: string; messages: Message[]; focus?: string; screenshot?: string; screenLanguage?: 'ru' | 'en'; partialQuestion?: boolean; maxTokens?: number; singleAttempt?: boolean }): Promise<Result & { answer?: string } & UsageResult>
      onAnswerDelta(callback: (event: { requestId: string; text: string }) => void): () => void
      transcribe(value: { audio: string; localOnly?: boolean; provisional?: boolean; source?: 'me' | 'interviewer'; requestId?: string; language?: 'auto' | 'ru' | 'en' }): Promise<Result & { text?: string } & UsageResult & { text?: string }>
      warmLocalTranscription(): Promise<Result & { previewEnabled?: boolean; backend?: 'cpu' | 'cuda' }>
      releaseLocalTranscription?(): Promise<Result>
      installGpuSpeech(): Promise<Result>
      cancelGpuSpeech(): Promise<Result>
      getAudioSourceId(): Promise<Result & { sourceId?: string }>
      traceAudioCapture?(value: { stage: string; code: string }): Promise<Result>
      models(): Promise<Result & { models?: Model[] }>
      cancelRequests(requestId?: string): Promise<Result>
      captureScreen(): Promise<Result & { screenshot?: string }>
      selectScreenRegion(): Promise<Result & { screenshot?: string; width?: number; height?: number; screenLanguage?: 'ru' | 'en' }>
      setOverlayMode(enabled: boolean): Promise<Result & { enabled?: boolean }>
      onOverlayAction(callback: (event: { action: 'answer' | 'screen' }) => void): () => void
      setCaptureProtection(enabled: boolean): Promise<Result & { enabled?: boolean; cancelled?: boolean }>
      exportCall(value: Call): Promise<Result>
      openLogs(): Promise<Result>
      reportError(message: string): Promise<Result>
    }
  }
}
export function normalizeState(value: unknown): SavedState {
  const state = value as Partial<SavedState> | null
  const speakers = ['interviewer', 'me', 'assistant', 'note']
  const calls = Array.isArray(state?.calls) ? state.calls.filter(c => c && typeof c.id === 'string' && typeof c.createdAt === 'string' && !Number.isNaN(Date.parse(c.createdAt)) && Array.isArray(c.messages)).map(c => {
    const title = typeof c.practiceQuestionSet?.title === 'string' ? c.practiceQuestionSet.title.trim().slice(0, 120) : ''
    const questions = Array.isArray(c.practiceQuestionSet?.questions) ? c.practiceQuestionSet.questions : []
    const validQuestionSet = title && questions.length >= 2 && questions.length <= 20 && questions.every(question => typeof question === 'string' && question.trim().length >= 10 && question.trim().length <= 500)
      ? { title, questions: questions.map(question => question.trim()) }
      : undefined
    const validTrackId = typeof c.practiceTrackId === 'string' && /^[a-z0-9-]+:(?:ru|en)$/.test(c.practiceTrackId) && (c.practiceTrackId !== 'transcript:ru' || Boolean(validQuestionSet))
    const maxStep = validQuestionSet ? validQuestionSet.questions.length : validTrackId ? 32 : 0
    const validStep = typeof c.practiceTrackStep === 'number' && Number.isInteger(c.practiceTrackStep) && c.practiceTrackStep >= 0 && c.practiceTrackStep < maxStep
    return {
      ...c, duration: Number.isFinite(c.duration) ? Math.max(0, c.duration) : 0,
      usage: Array.isArray(c.usage) ? c.usage.map(normalizeUsageRecord).filter((record): record is UsageRecord => record !== undefined) : [],
      ...(c.usageTracking === 'complete' || c.usageTracking === 'partial' ? { usageTracking: c.usageTracking } : {}),
      ...(c.transcriptionMode === 'local' || c.transcriptionMode === 'openrouter' ? { transcriptionMode: c.transcriptionMode } : {}),
      practiceProfile: c.practiceProfile === 'devops' || c.practiceProfile === 'support' ? c.practiceProfile : undefined,
      practiceScores: normalizePracticeScores(c.practiceScores),
      practiceTrackId: validTrackId ? c.practiceTrackId : undefined,
      practiceTrackStep: validStep ? c.practiceTrackStep : undefined,
      practiceQuestionSet: validQuestionSet || undefined,
      ...(c.practiceReportComplete === true ? { practiceReportComplete: true } : {}),
      messages: c.messages.filter(m => m && typeof m.id === 'string' && typeof m.text === 'string' && speakers.includes(m.speaker) && !Number.isNaN(Date.parse(m.createdAt))),
    }
  }) : []
  return { calls }
}
