import { Copy, Download, Eye, EyeOff, History, Mic, MicOff, Monitor, Pause, Pencil, Phone, PictureInPicture2, Play, Scan, Search, Send, Settings as SettingsIcon, Sparkles, Square, Trash2, Upload, Volume2, VolumeX, X } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CaptureSession } from './capture'
import type { AudioStatus, CaptureStartResult, Source } from './capture'
import { insertTranscriptMessage, interviewerPreview, isFreshQuestionDraft, isTranscriptNoise, latestInterviewerMessage, normalizeTranscriptText, selectLiveQuestionDraft, selectQuestionFallback } from './transcript.mjs'
import { createStreamUpdates } from './stream-updates.mjs'
import { classifyPracticeQuestionAudience, mergePracticeTranscripts } from './practice-import.mjs'
import { createPracticeUtterance, resolvePracticeTranscriptionLanguage } from './practice-voice.mjs'
import { extractPracticeScores, summarizePracticeScores } from './practice-score.mjs'
import { screenTaskFollowupMessages } from './screen-task.mjs'
import { normalizeState } from './types'
import type { Call, LocalSpeech, Message, Model, PracticeLibrary, SavedState, Settings, Speaker } from './types'
import { UpdatePanel } from './UpdatePanel'
import { createUsageRecord, formatUsd, providerLabel, summarizeUsage, upsertUsageRecord } from './usage.mjs'
import type { UsageOperation, UsageRecord, UsageStatus } from './usage.mjs'
import './App.css'

const fallbackSettings: Settings = { hasKey: false, baseUrl: 'https://openrouter.ai/api/v1', model: 'qwen/qwen3-30b-a3b-instruct-2507', language: 'auto', microphoneId: 'default', practiceProfile: 'devops', autoAnswer: false, transcriptionMode: 'local', transcriptionBaseUrl: 'https://openrouter.ai/api/v1', transcriptionModel: 'openai/whisper-large-v3-turbo' }
const slowSpeechNotice = 'Распознавание задерживается. Подсказка появится после готовности вопроса; запрос уже принят.'
const presets: Model[] = [{ id: 'qwen/qwen3-30b-a3b-instruct-2507', name: 'Qwen3 30B · рекомендуется' }, { id: 'mistralai/mistral-nemo', name: 'Mistral Nemo · эконом' }, { id: 'openrouter/free', name: 'Бесплатный роутер' }]
const labels: Record<Speaker, string> = { interviewer: 'Собеседник', me: 'Вы', assistant: 'AI', note: 'Система' }
const inactive: AudioStatus = { active: false, level: 0, message: 'Отключён' }
const maxTranscriptRoundQuestions = 20
const maxVisibleTranscriptQuestions = 300
const maxTranscriptBatchBytes = 10_000_000
const maxSavedPracticeLibraries = 10
const practiceOnlyBuild = import.meta.env.MODE === 'practice'
const emptyPracticeBank: typeof import('./practice-bank.mjs') = { getPracticeQuestion: () => undefined, getPracticeTrack: () => undefined, getPracticeQuestions: () => [], getPracticeTracks: () => [] }
type LatencyStats = { callId: string; speechToTextMs?: number; speechDurationMs?: number; afterSpeechMs?: number; processingMs?: number; queueMs?: number; transcriptionMs?: number; questionWaitMs?: number; transcriptFinal?: boolean; firstTokenMs?: number; answerMs?: number; buttonToAnswerMs?: number }
type AudioDiagnostic = { state: 'idle' | 'warming' | 'recording' | 'processing'; text: Record<Source, string>; draft: string; latency: Partial<Record<Source, LatencyStats>>; sources: Record<Source, AudioStatus>; pending: boolean; error: string }
type StreamingAnswer = { callId: string; text: string; mode: string; status: 'streaming' | 'partial' }
const duration = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
const formatLatency = (milliseconds: number) => milliseconds < 1000 ? `${milliseconds} мс` : `${(milliseconds / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} с`
function toTranscriptQuestions(library: PracticeLibrary) {
  return {
    id: library.id,
    fileName: library.title,
    questions: library.questions,
    questionSources: library.questionSources,
    sourceNames: library.sourceNames,
    sourceQuestionCounts: library.sourceQuestionCounts,
    hasSpeakerLabels: library.unlabelledFileCount === 0,
    sourceCount: library.sourceNames.length,
    unlabelledFileCount: library.unlabelledFileCount,
    emptyFileCount: library.emptyFileCount,
  }
}
function formatLatencyStats(stats: LatencyStats) {
  return [
    stats.speechToTextMs !== undefined && `От начала ${formatLatency(stats.speechToTextMs)}`,
    stats.speechDurationMs !== undefined && `Речь ${formatLatency(stats.speechDurationMs)}`,
    stats.afterSpeechMs !== undefined && `${stats.transcriptFinal ? 'После конца речи' : 'Черновик после фрагмента'} ${formatLatency(stats.afterSpeechMs)}`,
    stats.queueMs !== undefined && `Очередь ${formatLatency(stats.queueMs)}`,
    stats.transcriptionMs !== undefined && `Распознавание ${formatLatency(stats.transcriptionMs)}`,
    stats.questionWaitMs !== undefined && `Ожидание вопроса ${formatLatency(stats.questionWaitMs)}`,
    stats.firstTokenMs !== undefined && `Первый ответ ${formatLatency(stats.firstTokenMs)}`,
    stats.answerMs !== undefined && `Весь ответ ${formatLatency(stats.answerMs)}`,
    stats.buttonToAnswerMs !== undefined && `Кнопка → ответ ${formatLatency(stats.buttonToAnswerMs)}`,
  ].filter(Boolean).join(' · ')
}
function formatQuestionCount(count: number) {
  const lastTwo = count % 100
  const last = count % 10
  const word = lastTwo >= 11 && lastTwo <= 14 ? 'вопросов' : last === 1 ? 'вопрос' : last >= 2 && last <= 4 ? 'вопроса' : 'вопросов'
  return `${count} ${word}`
}
const message = (speaker: Speaker, text: string, createdAt = new Date().toISOString()): Message => ({ id: crypto.randomUUID(), speaker, text: speaker === 'assistant' ? text : text.trim(), createdAt })
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)
const clockNow = () => performance.now()
const isRecent = (createdAt: string, windowMs: number) => Date.now() - Date.parse(createdAt) < windowMs
const usageOperationLabels: Record<UsageOperation, string> = { answer: 'Ответ', screen: 'Экранная задача', review: 'Разбор тренировки', 'practice-next': 'Уточняющий вопрос', 'practice-report': 'Итог тренировки', expand: 'Подробнее', clarify: 'Уточнения', summary: 'Итоги', transcription: 'Распознавание речи' }
function usageRecordStatus(record: UsageRecord) {
  if (record.status === 'reported') return `${formatUsd(record.costUsd || 0)}${record.totalTokens ? ` · ${record.totalTokens} токенов` : ''}`
  if (record.status === 'pending') return 'Запрос идёт, стоимость ещё не получена'
  if (record.status === 'possibly-charged') return 'Запрос отменён или завершился ошибкой; стоимость неизвестна'
  return 'Провайдер не вернул стоимость'
}
function IconButton({ title, action, icon, disabled = false, pressed, hint }: { title: string; action: () => void; icon: React.ReactNode; disabled?: boolean; pressed?: boolean; hint?: string }) {
  return <button className="icon-button" type="button" title={hint || title} aria-label={title} aria-pressed={pressed} onClick={action} disabled={disabled}>{icon}</button>
}

function usePracticeQuestionSpeech(onError: (message: string) => void) {
  const [speakingText, setSpeakingText] = useState('')
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const stop = useCallback(() => {
    utteranceRef.current = null
    window.speechSynthesis?.cancel()
    setSpeakingText('')
  }, [])
  const toggle = useCallback((value: string) => {
    const text = value.trim()
    if (!text) return
    if (utteranceRef.current?.text === text) {
      stop()
      return
    }
    stop()
    if (typeof SpeechSynthesisUtterance === 'undefined' || !window.speechSynthesis) {
      onError('В этой версии Windows нет системного озвучивания текста.')
      return
    }
    const utterance = createPracticeUtterance(text, SpeechSynthesisUtterance, window.speechSynthesis.getVoices())
    utteranceRef.current = utterance
    setSpeakingText(text)
    const finish = () => {
      if (utteranceRef.current !== utterance) return
      utteranceRef.current = null
      setSpeakingText('')
    }
    utterance.onend = finish
    utterance.onerror = event => {
      finish()
      if (!['canceled', 'interrupted'].includes(event.error)) onError('Не удалось озвучить вопрос. Проверь системные голоса Windows.')
    }
    try {
      window.speechSynthesis.speak(utterance)
    } catch {
      finish()
      onError('Не удалось озвучить вопрос. Проверь системные голоса Windows.')
    }
  }, [onError, stop])
  useEffect(() => () => {
    utteranceRef.current = null
    window.speechSynthesis?.cancel()
  }, [])
  return { speakingText, stop, toggle }
}

function AnswerContent({ text }: { text: string }) {
  const blocks = [...text.matchAll(/```([a-z0-9_-]*)\r?\n([\s\S]*?)```/gi)]
  const content: React.ReactNode[] = []
  let cursor = 0
  for (const [index, block] of blocks.entries()) {
    const start = block.index ?? cursor
    if (text.slice(cursor, start).trim()) content.push(<p key={`text-${index}`}>{text.slice(cursor, start)}</p>)
    content.push(<pre key={`code-${index}`}><code className={block[1] ? `language-${block[1]}` : undefined}>{block[2].replace(/\n$/, '')}</code></pre>)
    cursor = start + block[0].length
  }
  const tail = text.slice(cursor)
  const openBlock = tail.match(/```([a-z0-9_-]*)\r?\n([\s\S]*)$/i)
  if (openBlock) {
    if (tail.slice(0, openBlock.index).trim()) content.push(<p key="text-tail">{tail.slice(0, openBlock.index)}</p>)
    content.push(<pre key="code-open"><code className={openBlock[1] ? `language-${openBlock[1]}` : undefined}>{openBlock[2]}</code></pre>)
  } else if (tail.trim()) content.push(<p key="text-tail">{tail}</p>)
  return <>{content}</>
}

const TranscriptMessages = memo(function TranscriptMessages({ messages, partialText = '' }: { messages: Message[]; partialText?: string }) {
  return <>{messages.filter(m => m.speaker !== 'assistant').map(m => <article className={`bubble ${m.speaker}`} key={m.id}><div><strong>{labels[m.speaker]}</strong><time>{new Date(m.createdAt).toLocaleTimeString('ru-RU')}</time></div><p>{m.text}</p></article>)}{partialText && <article className="bubble interviewer preview" aria-label="Черновик распознавания" aria-live="polite"><div><strong>Собеседник · черновик</strong><time>сейчас</time></div><p>{partialText}</p></article>}{!messages.length && !partialText && <p className="empty">Речь пока не распознана</p>}</>
})
const AnswerHistory = memo(function AnswerHistory({ messages }: { messages: Message[] }) {
  return <>{messages.filter(m => m.speaker === 'assistant').map(m => <article className="answer" key={m.id}><small>{new Date(m.createdAt).toLocaleTimeString('ru-RU')}</small><AnswerContent text={m.text} /></article>).reverse()}</>
})

function App() {
  const [practiceBank, setPracticeBank] = useState(emptyPracticeBank)
  const [data, setData] = useState<SavedState>({ calls: [] })
  const dataRef = useRef(data)
  const [settings, setSettings] = useState(fallbackSettings)
  const settingsRef = useRef(settings)
  const [ready, setReady] = useState(false)
  const readyRef = useRef(false)
  const [callStarting, setCallStarting] = useState(false)
  const callStartingRef = useRef(false)
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [version, setVersion] = useState('')
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const { speakingText: speakingPracticeQuestion, stop: stopPracticeQuestionSpeech, toggle: togglePracticeQuestionSpeech } = usePracticeQuestionSpeech(setNotice)
  const [view, setView] = useState<'history' | 'call' | 'practice'>(practiceOnlyBuild ? 'practice' : 'call')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedRef = useRef<string | null>(null)
  const [phase, setPhase] = useState<'idle' | 'running' | 'paused'>('idle')
  const [practiceTimerRunningId, setPracticeTimerRunningId] = useState<string | null>(null)
  const phaseRef = useRef(phase)
  const liveId = useRef<string | null>(null)
  const [liveCallId, setLiveCallId] = useState<string | null>(null)
  const capture = useRef<CaptureSession | null>(null)
  const localPreviewEnabled = useRef(true)
  const [audio, setAudio] = useState<Record<Source, AudioStatus>>({ me: inactive, interviewer: inactive })
  const [interviewerSignalSeen, setInterviewerSignalSeen] = useState(false)
  const [micEnabled, setMicEnabled] = useState(true)
  const micEnabledRef = useRef(true)
  const [pendingTranscriptions, setPendingTranscriptions] = useState(0)
  const [partialTranscript, setPartialTranscript] = useState('')
  const [partialTranscriptCreatedAt, setPartialTranscriptCreatedAt] = useState('')
  const partialTranscriptRef = useRef<{ text: string; createdAt: string }>({ text: '', createdAt: '' })
  const [draft, setDraft] = useState('')
  const [draftSource, setDraftSource] = useState<{ text: string; messageId?: string } | null>(null)
  const [practiceQuestion, setPracticeQuestion] = useState('')
  const [practiceQuestionChoice, setPracticeQuestionChoice] = useState('')
  const [practiceLibraries, setPracticeLibraries] = useState<PracticeLibrary[]>([])
  const [activePracticeLibraryId, setActivePracticeLibraryId] = useState('')
  const [deletePracticeLibraryId, setDeletePracticeLibraryId] = useState('')
  const [practiceLibrarySaving, setPracticeLibrarySaving] = useState(false)
  const [transcriptQuestions, setTranscriptQuestions] = useState<ReturnType<typeof toTranscriptQuestions> | null>(null)
  const [practiceRoundSelection, setPracticeRoundSelection] = useState<number[]>([])
  const [screenPracticeSelecting, setScreenPracticeSelecting] = useState(false)
  const transcriptFileInput = useRef<HTMLInputElement>(null)
  const [practiceMode, setPracticeMode] = useState<'question' | 'track'>('question')
  const [practiceTrackChoice, setPracticeTrackChoice] = useState('')
  const [practiceAnswer, setPracticeAnswer] = useState('')
  const [practiceMicState, setPracticeMicState] = useState<'idle' | 'warming' | 'recording' | 'processing'>('idle')
  const [practicePending, setPracticePending] = useState(false)
  const practiceCapture = useRef<CaptureSession | null>(null)
  const [search, setSearch] = useState('')
  const [practiceTranscriptSearch, setPracticeTranscriptSearch] = useState('')
  const [practiceTranscriptSource, setPracticeTranscriptSource] = useState('all')
  const [practiceTranscriptAudience, setPracticeTranscriptAudience] = useState<'all' | 'addressed' | 'review'>('all')
  const matchingTranscriptQuestions = useMemo(() => {
    if (!transcriptQuestions) return []
    const query = practiceTranscriptSearch.trim().toLocaleLowerCase('ru-RU')
    const sourceIndex = practiceTranscriptSource === 'all' ? null : Number(practiceTranscriptSource)
    return transcriptQuestions.questions.flatMap((question, index) => {
      const inSource = sourceIndex === null || transcriptQuestions.questionSources[index]?.includes(sourceIndex)
      return inSource && question.toLocaleLowerCase('ru-RU').includes(query)
        ? [{ question, index, audience: classifyPracticeQuestionAudience(question) }]
        : []
    })
  }, [practiceTranscriptSearch, practiceTranscriptSource, transcriptQuestions])
  const audienceHintsEnabled = Boolean(transcriptQuestions && transcriptQuestions.unlabelledFileCount === transcriptQuestions.sourceCount && transcriptQuestions.sourceCount > 0)
  const addressedTranscriptQuestions = matchingTranscriptQuestions.filter(item => item.audience === 'addressed').length
  const audienceFilteredTranscriptQuestions = audienceHintsEnabled && practiceTranscriptAudience !== 'all'
    ? matchingTranscriptQuestions.filter(item => item.audience === practiceTranscriptAudience)
    : matchingTranscriptQuestions
  const visibleTranscriptQuestions = audienceFilteredTranscriptQuestions.slice(0, maxVisibleTranscriptQuestions)
  const [busy, setBusy] = useState(false)
  const [requestMode, setRequestMode] = useState('')
  const busyRef = useRef(false)
  const currentRequest = useRef<{ id: string; callId: string; generation: number; mode: string; controller: AbortController; usageStarted: boolean; requestedAt: number; questionWaitMs?: number; generationStartedAt?: number; firstTokenMs?: number } | null>(null)
  const answered = useRef(new Map<string, string>())
  const screenTask = useRef<{ callId: string; answerId: string; screenshot: string; capturedAt: string } | null>(null)
  const [waitingForSpeech, setWaitingForSpeech] = useState(false)
  const [streamingAnswer, setStreamingAnswer] = useState<StreamingAnswer | null>(null)
  const streamingAnswerRef = useRef<StreamingAnswer | null>(null)
  const [streamUpdates] = useState(() => createStreamUpdates<StreamingAnswer>(setStreamingAnswer))
  const updateStreamingAnswer = useCallback((answer: StreamingAnswer | null) => { streamingAnswerRef.current = answer; streamUpdates.push(answer) }, [streamUpdates])
  useEffect(() => () => streamUpdates.cancel(), [streamUpdates])
  const clearIncompleteAnswer = () => { if (streamingAnswerRef.current?.status === 'partial') updateStreamingAnswer(null) }
  const [timing, setTiming] = useState<LatencyStats | null>(null)
  const epoch = useRef(0)
  const askRef = useRef<(mode: string, automatic?: boolean) => Promise<void>>(async () => {})
  const [protectedCapture, setProtectedCapture] = useState(false)
  const [privacyBusy, setPrivacyBusy] = useState(false)
  const [overlayMode, setOverlayModeState] = useState(false)
  const overlayRequest = useRef(0)
  const [modal, setModal] = useState<'settings' | null>(null)
  const [configDraft, setConfigDraft] = useState<Settings & { apiKey: string }>({ ...settings, apiKey: '' })
  const [saving, setSaving] = useState(false)
  const [localSpeech, setLocalSpeech] = useState<LocalSpeech | null>(null)
  const [installingGpu, setInstallingGpu] = useState(false)
  const [modelTestArmed, setModelTestArmed] = useState(false)
  const [models, setModels] = useState<Model[]>(presets)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [audioDiagnostic, setAudioDiagnostic] = useState<AudioDiagnostic>({ state: 'idle', text: { me: '', interviewer: '' }, draft: '', latency: {}, sources: { me: inactive, interviewer: inactive }, pending: false, error: '' })
  const audioDiagnosticCapture = useRef<CaptureSession | null>(null)
  const audioDiagnosticGeneration = useRef(0)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const transcriptEnd = useRef<HTMLDivElement>(null)

  const selected = data.calls.find(c => c.id === selectedId)
  useEffect(() => {
    if (!practiceOnlyBuild && selected?.kind !== 'practice') return
    let alive = true
    void import('./practice-bank.mjs').then(bank => { if (alive) setPracticeBank(bank) }).catch(error => { if (alive) setError(errorText(error)) })
    return () => { alive = false }
  }, [selected?.kind])
  const microphoneAction = micEnabled ? audio.me.active ? 'Выключить микрофон' : 'Подключить микрофон' : 'Включить микрофон'
  const questionPreview = useMemo(() => {
    if (!selected || selected.kind === 'practice') return null
    const partial = selectedId === liveCallId && phase === 'running' ? partialTranscript : ''
    return interviewerPreview(selected.messages, partial)
  }, [selected, selectedId, liveCallId, phase, partialTranscript])
  const liveAnswerDraft = selected && selected.kind !== 'practice' && selectedId === liveCallId && phase === 'running'
    ? selectLiveQuestionDraft({
      latestQuestion: latestInterviewerMessage(selected.messages),
      partialText: partialTranscript,
      partialCreatedAt: partialTranscriptCreatedAt,
    })
    : ''
  const lastAnswer = selected?.messages.findLast(m => m.speaker === 'assistant')
  const practiceCanContinue = selected?.kind === 'practice' && selected.messages.findLastIndex(m => m.speaker === 'me') > selected.messages.findLastIndex(m => m.speaker === 'interviewer')
  const practiceNeedsReview = selected?.kind === 'practice' && selected.messages.findLastIndex(m => m.speaker === 'me') > selected.messages.findLastIndex(m => m.speaker === 'assistant')
  const selectedPracticeQuestionSet = selected?.kind === 'practice' ? selected.practiceQuestionSet : undefined
  const selectedPracticePrompt = selected?.kind === 'practice' ? latestInterviewerMessage(selected.messages)?.text || '' : ''
  const selectedPracticeTrack = selected?.kind === 'practice' && selected.practiceTrackId ? practiceBank.getPracticeTrack(selected.practiceTrackId) : undefined
  const selectedPracticeTitle = selectedPracticeQuestionSet ? `Из TXT: ${selectedPracticeQuestionSet.title}` : selectedPracticeTrack?.title
  const selectedPracticeQuestionCount = selectedPracticeQuestionSet?.questions.length ?? selectedPracticeTrack?.questionIds.length ?? 0
  const hasPracticeScenario = Boolean(selectedPracticeQuestionSet || selectedPracticeTrack)
  const selectedPracticeStep = selected?.practiceTrackStep ?? 0
  const practiceReportAttempted = selected?.usage?.some(record => record.operation === 'practice-report') ?? false
  const practiceCanReport = Boolean(hasPracticeScenario && selected && selectedPracticeStep === selectedPracticeQuestionCount - 1 && practiceCanContinue && !practiceNeedsReview && practiceMicState === 'idle' && !busy && !practiceReportAttempted && !selected.practiceReportComplete)
  const historyUsage = useMemo(() => summarizeUsage(data.calls.flatMap(call => call.usage || [])), [data.calls])
  const practiceProgress = useMemo(() => summarizePracticeScores(data.calls, settings.practiceProfile), [data.calls, settings.practiceProfile])
  const selectedUsage = summarizeUsage(selected?.usage)
  const untrackedCalls = useMemo(() => data.calls.filter(call => !call.usageTracking && call.messages.some(item => item.speaker === 'assistant')).length, [data.calls])
  function persist(next: SavedState) {
    if (persistTimer.current) clearTimeout(persistTimer.current)
    persistTimer.current = setTimeout(() => {
      persistTimer.current = null
      void window.sobesych?.saveState(next).then(result => { if (result.error) setError(`История не сохранена: ${result.error}`) }).catch(e => setError(errorText(e)))
    }, 350)
  }
  function commit(next: SavedState, save = true) { dataRef.current = next; setData(next); if (save && readyRef.current) persist(next) }
  function choose(id: string | null) {
    stopPracticeQuestionSpeech()
    if (selectedRef.current !== id) { setDraft(''); setDraftSource(null); screenTask.current = null }
    selectedRef.current = id; setSelectedId(id)
  }
  function changePhase(next: typeof phase) { phaseRef.current = next; setPhase(next) }
  const updateBusy = !ready || Boolean(liveCallId) || phase !== 'idle' || busy || callStarting || practiceMicState !== 'idle' || audioDiagnostic.state !== 'idle' || saving || screenPracticeSelecting || practiceLibrarySaving || Boolean(practiceTimerRunningId)
  useEffect(() => { void window.sobesych?.setUpdateBusy(updateBusy).catch(() => {}) }, [updateBusy])
  useEffect(() => window.sobesych?.onUpdateState(value => setUpdateAvailable(['available', 'downloading', 'downloaded'].includes(value.phase))), [])
  async function saveBeforeUpdate() {
    if (updateBusy || liveId.current || busyRef.current || callStartingRef.current) return false
    stopPracticeQuestionSpeech()
    if (persistTimer.current) { clearTimeout(persistTimer.current); persistTimer.current = null }
    const result = await window.sobesych!.saveState(dataRef.current)
    if (result.error) { setError(`История не сохранена: ${result.error}`); return false }
    return !liveId.current && !busyRef.current && !callStartingRef.current
  }
  function updateConfig(next: Settings) { settingsRef.current = next; setSettings(next) }
  function updateCall(id: string, update: (call: Call) => Call, save = true) { commit({ ...dataRef.current, calls: dataRef.current.calls.map(c => c.id === id ? update(c) : c) }, save) }
  function togglePracticeTimer(id: string) {
    if (practiceTimerRunningId === id) {
      setPracticeTimerRunningId(null)
      persist(dataRef.current)
      return
    }
    if (view === 'call' && selectedRef.current === id && dataRef.current.calls.some(call => call.id === id && call.kind === 'practice')) setPracticeTimerRunningId(id)
  }
  function trackUsage(callId: string, record: UsageRecord) {
    updateCall(callId, call => ({ ...call, usageTracking: call.usageTracking || 'partial', usage: upsertUsageRecord(call.usage, record) }))
  }
  function setUsageStatus(callId: string, requestId: string, status: UsageStatus) {
    const existing = dataRef.current.calls.find(item => item.id === callId)?.usage?.find(item => item.id === requestId)
    if (existing?.status === 'pending') trackUsage(callId, { ...existing, status, costUsd: undefined })
  }
  function recordCloudTranscription(callId: string, audio: string, localOnly = false, signal?: AbortSignal, provisional = false, source?: 'me' | 'interviewer') {
    const config = settingsRef.current
    const counted = !localOnly && config.transcriptionMode === 'openrouter'
    const id = crypto.randomUUID()
    const provider = providerLabel(config.transcriptionBaseUrl)
    if (signal?.aborted) throw new DOMException('Распознавание отменено', 'AbortError')
    if (counted) trackUsage(callId, createUsageRecord({ id, operation: 'transcription', provider, model: config.transcriptionModel, status: 'pending' }))
    const cancel = () => { void window.sobesych?.cancelRequests(id).catch(() => {}) }
    signal?.addEventListener('abort', cancel, { once: true })
    return window.sobesych!.transcribe({ audio, localOnly, provisional, source, requestId: id }).then(result => {
      if (result.error) throw new Error(result.error)
      if (counted) trackUsage(callId, createUsageRecord({ id, operation: 'transcription', provider, model: result.model || config.transcriptionModel, usage: result.usage }))
      return result
    }).catch(error => {
      if (counted) setUsageStatus(callId, id, 'possibly-charged')
      throw error
    }).finally(() => signal?.removeEventListener('abort', cancel))
  }
  function cancelAnswer() {
    const request = currentRequest.current
    if (request?.usageStarted) setUsageStatus(request.callId, request.id, 'possibly-charged')
    currentRequest.current = null; request?.controller.abort()
    busyRef.current = false; setBusy(false); setRequestMode(''); setWaitingForSpeech(false); updateStreamingAnswer(null)
    setNotice(current => current === slowSpeechNotice ? '' : current)
    if (request) void window.sobesych?.cancelRequests(request.id)
  }
  function cancel() {
    cancelAnswer()
    capture.current?.stop(); capture.current = null
    epoch.current++
    busyRef.current = false; setBusy(false)
    currentRequest.current = null; updateStreamingAnswer(null)
    setAudio({ me: inactive, interviewer: inactive })
    setPendingTranscriptions(0); clearPartialTranscript()
    void window.sobesych?.cancelRequests()
  }

  function clearPartialTranscript() {
    partialTranscriptRef.current = { text: '', createdAt: '' }
    setPartialTranscript('')
    setPartialTranscriptCreatedAt('')
  }

  useEffect(() => {
    let alive = true
    async function initialize() {
      if (!window.sobesych) throw new Error('Открой Sobesych.exe: подключение к десктоп-приложению отсутствует')
      const config = await window.sobesych.getConfig()
      if (!alive) return
      if (config.error) throw new Error(config.error)
      setProtectedCapture(Boolean(config.captureProtected))
      setOverlayModeState(Boolean(config.overlayMode))
      if (config.historyWarning) setError(config.historyWarning)
      const savedLibraries = Array.isArray(config.practiceLibraries) ? config.practiceLibraries : []
      setPracticeLibraries(savedLibraries)
      if (savedLibraries[0]) {
        setTranscriptQuestions(toTranscriptQuestions(savedLibraries[0]))
        setActivePracticeLibraryId(savedLibraries[0].id)
      }
      if (config.practiceLibrariesStatus === 'locked' && config.practiceLibrariesWarning) setNotice(config.practiceLibrariesWarning)
      let saved = config.state
      if (!saved) {
        try {
          const previous = JSON.parse(localStorage.getItem('sobesych:v3') || 'null')
          if (previous) saved = { calls: Array.isArray(previous.messages) ? [{ id: crypto.randomUUID(), createdAt: new Date().toISOString(), duration: 0, messages: previous.messages }] : [] }
        } catch { /* Corrupt legacy data must not prevent startup. */ }
      }
      localStorage.removeItem('sobesych:v3')
      commit(normalizeState(saved)); updateConfig({ ...config.settings, autoAnswer: false }); setVersion(config.version); setLocalSpeech(config.localSpeech || null); readyRef.current = true; setReady(true)
      if (config.settings.autoAnswer) void window.sobesych.saveSettings({ autoAnswer: false })
    }
    void initialize().catch(e => { if (alive) setError(errorText(e)) })
    return () => { alive = false; capture.current?.stop(); practiceCapture.current?.stop(); audioDiagnosticCapture.current?.stop(); void window.sobesych?.releaseLocalTranscription?.() }
  }, [])
  useEffect(() => {
    if (modal === 'settings') return
    audioDiagnosticGeneration.current++
    audioDiagnosticCapture.current?.stop()
    audioDiagnosticCapture.current = null
    if (audioDiagnostic.state !== 'idle') void window.sobesych?.releaseLocalTranscription?.()
  }, [modal, audioDiagnostic.state])
  useEffect(() => window.sobesych?.onAnswerDelta(event => {
    const request = currentRequest.current
    if (request?.id === event.requestId && request.generation === epoch.current) {
      if (request.firstTokenMs === undefined && request.generationStartedAt !== undefined) {
        request.firstTokenMs = Math.max(0, Math.round(clockNow() - request.generationStartedAt))
        const firstTokenMs = request.firstTokenMs
        setTiming(current => ({ ...(current?.callId === request.callId ? current : { callId: request.callId }), firstTokenMs }))
      }
      updateStreamingAnswer({ callId: request.callId, text: event.text, mode: request.mode, status: 'streaming' })
    }
  }), [updateStreamingAnswer])
  useEffect(() => {
    if (practiceOnlyBuild) return
    return window.sobesych?.onOverlayAction(({ action }) => { void askRef.current(action) })
  }, [])
  useEffect(() => {
    if (!ready) return
    persist(dataRef.current)
    const timer = setInterval(() => persist(dataRef.current), 10000)
    return () => {
      clearInterval(timer)
      if (persistTimer.current) { clearTimeout(persistTimer.current); persistTimer.current = null }
    }
  }, [ready])
  useEffect(() => {
    if (phase !== 'running') return
    let previous = clockNow()
    const timer = setInterval(() => {
      const now = clockNow(); const delta = (now - previous) / 1000; previous = now
      if (liveId.current) updateCall(liveId.current, c => ({ ...c, duration: c.duration + delta }), false)
    }, 500)
    return () => clearInterval(timer)
  }, [phase])
  useEffect(() => {
    if (!practiceTimerRunningId) return
    if (view !== 'call' || selectedId !== practiceTimerRunningId || !dataRef.current.calls.some(call => call.id === practiceTimerRunningId && call.kind === 'practice')) {
      setPracticeTimerRunningId(null)
      persist(dataRef.current)
      return
    }
    let previous = clockNow()
    const timer = setInterval(() => {
      const now = clockNow()
      const delta = Math.max(0, (now - previous) / 1000)
      previous = now
      if (delta) updateCall(practiceTimerRunningId, call => ({ ...call, duration: call.duration + delta }), false)
    }, 500)
    return () => clearInterval(timer)
  }, [practiceTimerRunningId, selectedId, view])
  useEffect(() => { transcriptEnd.current?.scrollIntoView({ block: 'end' }) }, [selected?.messages.length, partialTranscript, view])
  useEffect(() => {
    if (!partialTranscript) return
    const timer = window.setInterval(() => {
      if (partialTranscriptRef.current.text && !isFreshQuestionDraft(partialTranscriptRef.current.createdAt)) {
        partialTranscriptRef.current = { text: '', createdAt: '' }
        setPartialTranscript('')
        setPartialTranscriptCreatedAt('')
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [partialTranscript])
  useEffect(() => {
    const saveOnExit = () => {
      capture.current?.stop()
      practiceCapture.current?.stop()
      if (!ready) return
      if (persistTimer.current) { clearTimeout(persistTimer.current); persistTimer.current = null }
      void window.sobesych?.saveState(dataRef.current)
    }
    window.addEventListener('beforeunload', saveOnExit)
    return () => window.removeEventListener('beforeunload', saveOnExit)
  }, [ready])

  function append(id: string, speaker: Speaker, text: string, createdAt?: string, origin?: Message['origin']) {
    if (!text.trim()) return
    const next = { ...message(speaker, text, createdAt), ...(origin ? { origin, text } : {}) }
    updateCall(id, c => ({ ...c, messages: insertTranscriptMessage(c.messages, next) }))
    return next
  }
  async function startAudio(id: string): Promise<CaptureStartResult> {
    const generation = epoch.current
    const session = new CaptureSession({ microphoneId: settingsRef.current.microphoneId,
      microphoneEnabled: micEnabledRef.current,
      localOnly: settingsRef.current.transcriptionMode === 'local',
      previewEnabled: settingsRef.current.transcriptionMode === 'local' && localPreviewEnabled.current,
      transcribe: (audio, localOnly, signal, provisional, source) => recordCloudTranscription(id, audio, localOnly, signal, provisional, source),
      onStatus: (source, status) => {
        if (generation !== epoch.current) return
        if (source === 'interviewer') {
          if (!status.active) { clearPartialTranscript(); setInterviewerSignalSeen(false) }
          else if (status.level >= 0.004) setInterviewerSignalSeen(true)
        }
        setAudio(current => ({ ...current, [source]: status }))
      },
      onError: text => { if (generation === epoch.current) { setError(text); void window.sobesych?.reportError(`audio: ${text}`) } },
      onPending: count => { if (generation === epoch.current) setPendingTranscriptions(count) },
      onText: (source, text, createdAt, latency) => {
        if (generation !== epoch.current || phaseRef.current !== 'running') return
        if (source === 'interviewer') { clearPartialTranscript(); clearIncompleteAnswer() }
        const clean = normalizeTranscriptText(text)
        if (isTranscriptNoise(clean)) return
        if (source === 'interviewer') setTiming({ callId: id, speechToTextMs: latency.speechToTextMs, speechDurationMs: latency.speechDurationMs, afterSpeechMs: latency.afterSpeechMs, processingMs: latency.processingMs, queueMs: latency.queueMs, transcriptionMs: latency.transcriptionMs, transcriptFinal: true })
        append(id, source, clean, createdAt)
      },
      onPartial: (source, text, createdAt, latency) => {
        if (source === 'interviewer' && generation === epoch.current && phaseRef.current === 'running') {
          const normalized = normalizeTranscriptText(text)
          const nextAt = Date.parse(createdAt)
          const currentAt = Date.parse(partialTranscriptRef.current.createdAt)
          if (Number.isFinite(nextAt) && (!Number.isFinite(currentAt) || nextAt >= currentAt)) {
            partialTranscriptRef.current = { text: normalized, createdAt }
            setPartialTranscript(normalized)
            setPartialTranscriptCreatedAt(createdAt)
          }
          setTiming({ callId: id, speechToTextMs: latency.speechToTextMs, speechDurationMs: latency.speechDurationMs, afterSpeechMs: latency.afterSpeechMs, processingMs: latency.processingMs, queueMs: latency.queueMs, transcriptionMs: latency.transcriptionMs, transcriptFinal: false })
        }
      },
    })
    capture.current = session
    const result = await session.start()
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      setDevices(list.filter(d => d.kind === 'audioinput'))
    } catch (error) { setError(errorText(error)) }
    return result
  }
  async function startCall() {
    if (!ready || practiceOnlyBuild) return
    if (liveId.current) { choose(liveId.current); setView('call'); return }
    if (callStartingRef.current || installingGpu) return
    callStartingRef.current = true
    setCallStarting(true)
    setError('')
    try {
      if (settingsRef.current.transcriptionMode === 'local') {
        if (!window.sobesych) throw new Error('Открой Sobesych.exe: подключение к десктоп-приложению отсутствует')
        const warmup = await window.sobesych.warmLocalTranscription()
        if (warmup.error || !warmup.ok) throw new Error(warmup.error || 'Не удалось подготовить локальное распознавание')
        localPreviewEnabled.current = warmup.previewEnabled !== false
        setLocalSpeech(current => current && ({ ...current, running: true, backend: warmup.backend || null }))
      }
      if (liveId.current) { choose(liveId.current); setView('call'); return }
      cancel(); setNotice(''); setDraft(''); setDraftSource(null)
      micEnabledRef.current = true; setMicEnabled(true)
      setInterviewerSignalSeen(false)
      const call: Call = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), duration: 0, kind: 'call', messages: [], usage: [], usageTracking: 'complete', transcriptionMode: settingsRef.current.transcriptionMode }
      const audioResult = await startAudio(call.id)
      if (!audioResult.interviewer) {
        capture.current?.stop(); capture.current = null
        setAudio({ me: inactive, interviewer: inactive })
        throw new Error(`Не удалось подключить звук собеседника${audioResult.interviewerError ? `: ${audioResult.interviewerError}` : '. Проверь источник системного звука и попробуй ещё раз.'}`)
      }
      commit({ ...dataRef.current, calls: [call, ...dataRef.current.calls] })
      liveId.current = call.id; setLiveCallId(call.id); choose(call.id); changePhase('running'); setView('call')
      await setCompactMode(true)
    } catch (error) {
      void window.sobesych?.releaseLocalTranscription?.()
      setError(errorText(error))
    } finally {
      callStartingRef.current = false
      setCallStarting(false)
    }
  }
  function pauseCall() { if (phaseRef.current !== 'running') return; cancel(); changePhase('paused'); persist(dataRef.current) }
  function toggleMicrophone() {
    const enabled = !micEnabledRef.current || !audio.me.active
    micEnabledRef.current = enabled; setMicEnabled(enabled)
    capture.current?.setMicrophoneEnabled(enabled)
  }
  async function resumeCall() {
    if (phaseRef.current !== 'paused' || !liveId.current || callStartingRef.current) return
    const id = liveId.current
    callStartingRef.current = true; setCallStarting(true); setError('')
    cancel()
    const generation = epoch.current
    try {
      const audioResult = await startAudio(id)
      if (generation !== epoch.current || liveId.current !== id || phaseRef.current !== 'paused') {
        capture.current?.stop(); capture.current = null
        return
      }
      if (!audioResult.interviewer) {
        capture.current?.stop(); capture.current = null
        setAudio({ me: inactive, interviewer: inactive })
        throw new Error(`Не удалось подключить звук собеседника${audioResult.interviewerError ? `: ${audioResult.interviewerError}` : '. Проверь источник системного звука и попробуй ещё раз.'}`)
      }
      changePhase('running')
    } catch (error) {
      if (generation === epoch.current) setError(errorText(error))
    } finally {
      callStartingRef.current = false; setCallStarting(false)
    }
  }
  function stopCall() {
    cancel(); changePhase('idle'); liveId.current = null; setLiveCallId(null)
    void window.sobesych?.releaseLocalTranscription?.()
    void setCompactMode(false)
    screenTask.current = null
    setNotice('Звонок завершён'); setError('')
    void window.sobesych?.saveState(dataRef.current)
  }
  function addDraft() {
    const id = selectedRef.current
    if (!id || !draft.trim()) return
    append(id, 'interviewer', draft, undefined, 'manual'); clearIncompleteAnswer(); setDraft(''); setDraftSource(null)
  }
  async function editInterviewerPreview() {
    if (!questionPreview?.text) return
    setDraft(questionPreview.text)
    setDraftSource({
      text: questionPreview.text,
      messageId: questionPreview.state === 'review' ? undefined : questionPreview.messageId,
    })
    if (overlayMode) await setCompactMode(false)
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[aria-label="Реплика собеседника"]')?.focus())
  }
  function createQuietCall() {
    const call: Call = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), duration: 0, messages: [], usage: [], usageTracking: 'complete', transcriptionMode: settingsRef.current.transcriptionMode }
    commit({ ...dataRef.current, calls: [call, ...dataRef.current.calls] })
    choose(call.id); setView('call')
    return call.id
  }
  const ask = async function requestAnswer(mode: string, automatic = false, suppliedScreenshot?: string, maxTokens?: number, singleAttempt = false) {
    const traceId = crypto.randomUUID()
    const traceStartedAt = clockNow()
    const trace = (stage: string, reason?: string) => {
      if (mode === 'answer') void window.sobesych?.traceAnswer?.({ requestId: traceId, stage, reason, elapsedMs: clockNow() - traceStartedAt }).catch(() => {})
    }
    trace('clicked')
    if (mode === 'practice-next') stopPracticeQuestionSpeech()
    if (practiceOnlyBuild && !['review', 'extract-task', 'practice-next', 'practice-report'].includes(mode)) {
      trace('ignored', 'practice_only')
      setError('В тренировочной версии доступны только практика и разбор твоих ответов.')
      return
    }
    const id = (automatic ? liveId.current : selectedRef.current) || (mode === 'screen' ? createQuietCall() : null)
    if (!id || busyRef.current || !window.sobesych) { trace('ignored', !id ? 'no_call' : busyRef.current ? 'busy' : 'unavailable'); return }
    const manualText = !automatic && !['expand', 'review', 'extract-task'].includes(mode) && draft.trim() ? draft : ''
    if (manualText) {
      const sourceStillInCall = Boolean(draftSource?.messageId && draftSource.text === manualText && dataRef.current.calls.find(c => c.id === id)?.messages.some(item => item.id === draftSource.messageId))
      if (!sourceStillInCall) { append(id, 'interviewer', manualText, undefined, 'manual'); setTiming({ callId: id }) }
      setDraft(''); setDraftSource(null)
    }
    if (!dataRef.current.calls.some(c => c.id === id)) { trace('ignored', 'no_call'); return }
    const generation = epoch.current
    busyRef.current = true; setBusy(true); setError('')
    setRequestMode(mode)
    const requestId = traceId
    const controller = new AbortController()
    currentRequest.current = { id: requestId, callId: id, generation, mode, controller, usageStarted: false, requestedAt: clockNow() }; updateStreamingAnswer(null)
    const isCurrent = () => generation === epoch.current && currentRequest.current?.id === requestId && !controller.signal.aborted
    try {
      const latestQuestion = latestInterviewerMessage(dataRef.current.calls.find(c => c.id === id)?.messages || [])
      const visibleQuestion = latestQuestion && isRecent(latestQuestion.createdAt, 45_000)
      const pendingQuestion = capture.current?.hasPendingInterviewer()
      const partialDraft = id === liveId.current ? partialTranscriptRef.current : { text: '', createdAt: '' }
      const liveDraft = mode === 'answer' && !automatic && !manualText && id === liveId.current && phaseRef.current === 'running'
        ? selectLiveQuestionDraft({ latestQuestion, partialText: partialDraft.text, partialCreatedAt: partialDraft.createdAt })
        : ''
      if (liveDraft) setNotice('Отвечаю по черновику распознавания. Полный текст появится отдельно; проверь формулировку.')
      if (!manualText && !liveDraft && (!visibleQuestion || pendingQuestion) && id === liveId.current && phaseRef.current === 'running' && !['screen', 'extract-task', 'expand'].includes(mode)) {
        trace('waiting_speech')
        setWaitingForSpeech(true)
        const questionWaitStartedAt = clockNow()
        const slowSpeech = window.setTimeout(() => {
          if (isCurrent()) setNotice(slowSpeechNotice)
        }, 2500)
        try { await capture.current?.flushPending(controller.signal, 90_000) }
        catch (error) {
          if (controller.signal.aborted) throw error
          const currentMessages = dataRef.current.calls.find(c => c.id === id)?.messages || []
          const currentQuestion = latestInterviewerMessage(currentMessages)
          const partialDraft = id === liveId.current ? partialTranscriptRef.current : { text: '', createdAt: '' }
          const fallback = selectQuestionFallback({
            initialQuestion: latestQuestion,
            currentQuestion,
            partialText: partialDraft.text,
            partialCreatedAt: partialDraft.createdAt,
          })
          if (!fallback) throw error
          if (fallback.source === 'final') setNotice('Свежий вопрос распознан. Отвечаю на него.')
          else if (fallback.source === 'visible') setNotice('Распознавание отстаёт. Отвечаю на последний видимый вопрос.')
          else {
            append(id, 'interviewer', fallback.text)
            clearPartialTranscript()
            setError('')
            setNotice('Распознавание задержалось. Отвечаю по черновику; проверь формулировку.')
          }
        }
        finally {
          clearTimeout(slowSpeech)
          const request = currentRequest.current
          if (request?.id === requestId) {
            setNotice(current => current === slowSpeechNotice ? '' : current)
            request.questionWaitMs = Math.max(0, Math.round(clockNow() - questionWaitStartedAt))
            setTiming(current => ({ ...(current?.callId === id ? current : { callId: id }), questionWaitMs: request.questionWaitMs }))
          }
        }
        if (!isCurrent()) return
        setWaitingForSpeech(false)
      }
      const call = dataRef.current.calls.find(c => c.id === id)
      if (!call || !isCurrent()) return
      let requestMessages = liveDraft
        ? [...call.messages, message('interviewer', liveDraft, partialDraft.createdAt)]
        : call.messages
      const task = mode === 'answer' && screenTask.current?.callId === id ? screenTask.current : null
      const followupMessages = task ? screenTaskFollowupMessages(requestMessages, task.answerId, task.capturedAt) : null
      if (!['screen', 'extract-task', 'summary', 'expand'].includes(mode) && !followupMessages && !latestInterviewerMessage(requestMessages)) {
        throw new Error('Не удалось разобрать свежую реплику собеседника. Повтори вопрос или введи его вручную.')
      }
      const fingerprint = JSON.stringify([requestMessages.filter(m => m.speaker !== 'assistant'), followupMessages ? task?.answerId : '', settingsRef.current.model, settingsRef.current.baseUrl])
      trace('selected')
      const answerKey = `${id}:${mode}`
      if (mode === 'answer' && answered.current.get(answerKey) === fingerprint) {
        trace('deduplicated')
        setNotice('Подсказка для этого вопроса уже готова'); return
      }
      let screenshot = suppliedScreenshot || (followupMessages ? task?.screenshot : undefined)
      let screenLanguage: 'ru' | 'en' | undefined
      if (followupMessages) requestMessages = followupMessages
      if (['screen', 'extract-task'].includes(mode) && !screenshot) {
        const shot = await window.sobesych.selectScreenRegion()
        if (shot.error) throw new Error(shot.error)
        screenshot = shot.screenshot
        screenLanguage = shot.screenLanguage
      }
      if (!isCurrent()) return
      const capturedAt = new Date().toISOString()
      const requestSettings = settingsRef.current
      const provider = providerLabel(requestSettings.baseUrl)
      const operation: UsageOperation = mode === 'extract-task' ? 'screen' : mode as UsageOperation
      currentRequest.current.usageStarted = true
      currentRequest.current.generationStartedAt = clockNow()
      currentRequest.current.firstTokenMs = undefined
      setTiming(current => current?.callId === id ? {
        callId: id, speechToTextMs: current.speechToTextMs, speechDurationMs: current.speechDurationMs, afterSpeechMs: current.afterSpeechMs, processingMs: current.processingMs, queueMs: current.queueMs,
        transcriptionMs: current.transcriptionMs, questionWaitMs: currentRequest.current?.questionWaitMs ?? current.questionWaitMs,
        transcriptFinal: current.transcriptFinal,
      } : { callId: id })
      trackUsage(id, createUsageRecord({ id: requestId, operation, provider, model: requestSettings.model, status: 'pending' }))
      trace('requested')
      const result = await window.sobesych.assist({
        requestId, mode, messages: requestMessages, partialQuestion: Boolean(liveDraft),
        ...(Number.isSafeInteger(maxTokens) ? { maxTokens } : {}), ...(singleAttempt ? { singleAttempt: true } : {}),
        focus: mode === 'practice-report' && selectedPracticeTitle
          ? `Тренировочный сценарий: ${selectedPracticeTitle}; ${selectedPracticeQuestionCount} основных вопросов.`
          : '',
        screenshot, ...(screenLanguage ? { screenLanguage } : {}),
      })
      if (!isCurrent()) return
      if (result.error) {
        if (result.usage) trackUsage(id, createUsageRecord({ id: requestId, operation, provider, model: result.model || requestSettings.model, usage: result.usage }))
        throw new Error(result.error)
      }
      if (!result.answer) throw new Error('Ответ не получен')
      const request = currentRequest.current
      const generationMs = Math.max(0, Math.round(clockNow() - (request?.generationStartedAt ?? clockNow())))
      const firstTokenMs = request?.firstTokenMs
      const buttonToAnswerMs = request?.mode === 'answer' ? Math.max(0, Math.round(clockNow() - request.requestedAt)) : undefined
      setTiming(current => ({ ...(current?.callId === id ? current : { callId: id }), firstTokenMs, answerMs: generationMs, buttonToAnswerMs }))
      trackUsage(id, createUsageRecord({ id: requestId, operation, provider, model: result.model || requestSettings.model, usage: result.usage }))
      const practiceReport = mode === 'practice-report' ? extractPracticeScores(result.answer) : undefined
      const visibleAnswer = practiceReport?.answer ?? result.answer
      if (mode === 'extract-task') {
        append(id, 'interviewer', visibleAnswer)
        setNotice('Условие распознано. Реши задачу и отправь свой ответ на разбор.')
      } else {
        const savedAnswer = append(id, mode === 'practice-next' ? 'interviewer' : 'assistant', visibleAnswer)
        if (mode === 'screen' && screenshot && savedAnswer && selectedRef.current === id) screenTask.current = { callId: id, answerId: savedAnswer.id, screenshot, capturedAt }
      }
      if (mode === 'practice-report') updateCall(id, call => ({ ...call, practiceReportComplete: true, ...(practiceReport?.scores ? { practiceScores: practiceReport.scores } : {}) }))
      if (result.model && result.model !== 'local-shortcut' && result.model !== settingsRef.current.model) {
        const fallbackNotice = screenshot ? `Снимок обработала vision-модель ${result.model}` : `${mode === 'practice-report' ? 'Итоги' : mode === 'review' ? 'Разбор' : mode === 'practice-next' ? 'Уточняющий вопрос' : 'Ответ'} дала резервная модель ${result.model}`
        setNotice(current => current.startsWith('Распознавание отстаёт.') ? `${current} ${fallbackNotice}` : fallbackNotice)
      }
      if (mode === 'answer') answered.current.set(answerKey, fingerprint)
      trace('completed')
    } catch (e) { if (isCurrent()) {
      trace('failed', currentRequest.current?.usageStarted ? 'provider' : 'question')
      if (currentRequest.current?.usageStarted) setUsageStatus(id, requestId, 'possibly-charged')
      const partial = streamingAnswerRef.current
      if (partial?.callId === id && partial.status === 'streaming' && partial.text.trim()) updateStreamingAnswer({ ...partial, status: 'partial' })
      if (errorText(e) === 'Выделение отменено') setNotice('Выделение отменено'); else setError(errorText(e))
    } else trace('cancelled') }
    finally {
      if (isCurrent()) {
        busyRef.current = false; setBusy(false)
        setRequestMode('')
        setWaitingForSpeech(false)
        currentRequest.current = null
        trace('released')
        if (streamingAnswerRef.current?.status !== 'partial') updateStreamingAnswer(null)
      }
    }
  }
  async function startScreenPractice() {
    if (!ready || busyRef.current || liveCallId || practiceMicState !== 'idle' || screenPracticeSelecting || !window.sobesych) return
    setScreenPracticeSelecting(true); setError(''); setNotice('')
    try {
      const shot = await window.sobesych.selectScreenRegion()
      if (shot.error) throw new Error(shot.error)
      if (!shot.screenshot) throw new Error('Снимок выбранной области не получен')
      const createdAt = new Date().toISOString()
      const call: Call = { id: crypto.randomUUID(), createdAt, duration: 0, kind: 'practice', practiceProfile: settingsRef.current.practiceProfile, messages: [], usage: [], usageTracking: 'complete', transcriptionMode: 'local' }
      commit({ ...dataRef.current, calls: [call, ...dataRef.current.calls] })
      choose(call.id); setView('call')
      await ask('extract-task', false, shot.screenshot)
      const saved = dataRef.current.calls.find(item => item.id === call.id)
      if (!saved?.messages.some(item => item.speaker === 'interviewer')) {
        commit({ ...dataRef.current, calls: dataRef.current.calls.filter(item => item.id !== call.id) })
        choose(null); setView('practice')
      }
    } catch (error) {
      if (errorText(error) === 'Выделение отменено') setNotice('Выделение отменено')
      else setError(errorText(error))
    } finally { setScreenPracticeSelecting(false) }
  }
  async function startPracticeRecording() {
    if (!window.sobesych || practiceMicState !== 'idle' || busyRef.current || liveCallId) return
    stopPracticeQuestionSpeech()
    setPracticeMicState('warming'); setPracticePending(false); setError('')
    let session: CaptureSession | null = null
    try {
      const warmup = await window.sobesych.warmLocalTranscription()
      if (warmup.error || !warmup.ok) throw new Error(warmup.error || 'Не удалось запустить локальное распознавание')
      const question = selected?.kind === 'practice' ? selectedPracticePrompt : practiceQuestion
      const knownLanguage = selected?.kind === 'practice'
        ? selectedPracticeTrack?.language || selected.practiceTrackId?.match(/:(ru|en)$/)?.[1] || ''
        : practiceMode === 'track'
          ? practiceTracks.find(track => track.id === practiceTrackChoice)?.language || ''
          : practiceQuestions.find(item => item.id === practiceQuestionChoice)?.language || ''
      const language = resolvePracticeTranscriptionLanguage(question, settingsRef.current.language, knownLanguage)
      session = new CaptureSession({
        microphoneId: settingsRef.current.microphoneId,
        localOnly: true,
        onStatus() {},
        onText(source, text) {
          if (source === 'me') setPracticeAnswer(current => `${current} ${text}`.trim())
        },
        onError: setError,
        onPending: count => setPracticePending(count > 0),
        transcribe: audio => window.sobesych!.transcribe({ audio, localOnly: true, language }),
      })
      practiceCapture.current = session
      await session.startMicrophoneOnly()
      if (practiceCapture.current !== session) return
      setPracticeMicState('recording')
    } catch (error) {
      session?.stop()
      if (practiceCapture.current === session) practiceCapture.current = null
      void window.sobesych?.releaseLocalTranscription?.()
      setPracticeMicState('idle')
      setError(errorText(error))
    }
  }
  async function stopPracticeRecording() {
    const session = practiceCapture.current
    if (!session || practiceMicState !== 'recording') return
    setPracticeMicState('processing')
    try {
      const errors = await session.stopMicrophoneOnly()
      if (errors.length) setError(errors[0])
    } catch (error) { setError(errorText(error)) }
    finally {
      if (practiceCapture.current === session) {
        practiceCapture.current = null; setPracticeMicState('idle'); setPracticePending(false)
        void window.sobesych?.releaseLocalTranscription?.()
      }
    }
  }
  function reviewPracticeAnswer() {
    const question = practiceQuestion.trim()
    const answer = practiceAnswer.trim()
    if (!question || !answer) { setError('Введи вопрос и свой ответ'); return }
    if (liveCallId || busyRef.current || practiceMicState !== 'idle') return
    const createdAt = new Date().toISOString()
    const track = practiceTracks.find(item => item.id === practiceTrackChoice)
    const call: Call = { id: crypto.randomUUID(), createdAt, duration: 0, kind: 'practice', practiceProfile: settingsRef.current.practiceProfile, ...(track ? { practiceTrackId: track.id, practiceTrackStep: 0 } : {}), messages: [message('interviewer', question, createdAt), message('me', answer, createdAt)], usage: [], usageTracking: 'complete', transcriptionMode: 'local' }
    commit({ ...dataRef.current, calls: [call, ...dataRef.current.calls] })
    choose(call.id); setDraft(''); setPracticeQuestion(''); setPracticeQuestionChoice(''); setPracticeTrackChoice(''); setPracticeAnswer(''); setView('call')
    void ask('review')
  }
  function activatePracticeLibrary(library: PracticeLibrary) {
    setActivePracticeLibraryId(library.id)
    setTranscriptQuestions(toTranscriptQuestions(library))
    setPracticeRoundSelection([])
    setPracticeQuestionChoice('')
    setPracticeTrackChoice('')
    setPracticeTranscriptSearch('')
    setPracticeTranscriptSource('all')
    setPracticeTranscriptAudience('all')
    setNotice(`Открыта подборка «${library.title}».`)
  }
  async function confirmDeletePracticeLibrary() {
    const library = practiceLibraries.find(item => item.id === deletePracticeLibraryId)
    if (!library || practiceLibrarySaving) return
    setPracticeLibrarySaving(true)
    try {
      const nextLibraries = practiceLibraries.filter(item => item.id !== library.id)
      const result = await window.sobesych!.savePracticeLibraries(nextLibraries)
      if (result.error) throw new Error(result.error)
      setPracticeLibraries(nextLibraries)
      setDeletePracticeLibraryId('')
      if (activePracticeLibraryId === library.id) {
        if (nextLibraries[0]) activatePracticeLibrary(nextLibraries[0])
        else {
          setActivePracticeLibraryId('')
          setTranscriptQuestions(null)
          setPracticeRoundSelection([])
        }
      }
      setNotice('Подборка удалена с этого компьютера.')
      setError('')
    } catch (error) { setError(errorText(error)) }
    finally { setPracticeLibrarySaving(false) }
  }
  async function importPracticeTranscript(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const files = Array.from(input.files || [])
    input.value = ''
    if (!files.length) return
    if (files.length > 50) { setError('Можно выбрать не больше 50 TXT за раз.'); return }
    if (files.some(file => file.size > 2_000_000)) { setError('Один из файлов больше 2 МБ. Убери его из набора.'); return }
    if (files.reduce((total, file) => total + file.size, 0) > maxTranscriptBatchBytes) { setError('Общий размер файлов больше 10 МБ. Раздели их на несколько наборов.'); return }
    if (practiceLibraries.length >= maxSavedPracticeLibraries) { setError(`Сохранено уже ${maxSavedPracticeLibraries} подборок. Удали одну перед новым импортом.`); return }
    setPracticeLibrarySaving(true)
    try {
      const inputs = await Promise.all(files.map(async file => ({ fileName: file.name.slice(0, 120), text: await file.text() })))
      const { questions, questionSources, sourceNames, sourceQuestionCounts, sourceCount, unlabelledFileCount, emptyFileCount } = mergePracticeTranscripts(inputs)
      if (!questions.length) throw new Error('Не нашёл вопросов. Можно вставить нужный вопрос вручную.')
      const fileName = files.length === 1 ? files[0].name.slice(0, 120) : `${sourceCount} TXT-файлов`
      const createdAt = new Date().toISOString()
      const library: PracticeLibrary = {
        id: crypto.randomUUID(),
        title: `${fileName} · ${new Date(createdAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}`,
        createdAt,
        questions,
        questionSources,
        sourceNames,
        sourceQuestionCounts,
        unlabelledFileCount,
        emptyFileCount,
      }
      setTranscriptQuestions(toTranscriptQuestions(library))
      setActivePracticeLibraryId('')
      setPracticeRoundSelection([])
      setPracticeQuestionChoice('')
      setPracticeTrackChoice('')
      setPracticeTranscriptSearch('')
      setPracticeTranscriptSource('all')
      setPracticeTranscriptAudience('all')
      setPracticeMode('question')
      setPracticeQuestion('')
      setPracticeAnswer('')
      const nextLibraries = [library, ...practiceLibraries]
      const saveResult = await window.sobesych!.savePracticeLibraries(nextLibraries)
      if (saveResult.error) {
        setError(`Вопросы разобраны, но не сохранены в подборках: ${saveResult.error}`)
        setNotice('Эти вопросы доступны до закрытия приложения. Исходные TXT не сохранены.')
        return
      }
      setPracticeLibraries(nextLibraries)
      setActivePracticeLibraryId(library.id)
      setError('')
      const details = [
        unlabelledFileCount > 0 && `в ${unlabelledFileCount} файлах нет меток говорящих, проверь вопросы`,
        emptyFileCount > 0 && `${emptyFileCount} файлов без распознанных вопросов пропущено`,
      ].filter(Boolean).join('; ')
      setNotice(`Импортировано ${formatQuestionCount(questions.length)} из ${sourceCount} TXT и сохранено на этом компьютере${details ? `. ${details}.` : '.'}`)
    } catch (error) { setError(errorText(error)) }
    finally { setPracticeLibrarySaving(false) }
  }
  function togglePracticeRoundQuestion(index: number, checked: boolean) {
    if (checked && practiceRoundSelection.length >= maxTranscriptRoundQuestions) {
      setNotice(`В одном сценарии можно выбрать не больше ${maxTranscriptRoundQuestions} вопросов.`)
      return
    }
    setPracticeRoundSelection(current => checked
      ? [...new Set([...current, index])].sort((a, b) => a - b)
      : current.filter(item => item !== index))
  }
  function startImportedPracticeRound() {
    if (!transcriptQuestions || practiceRoundSelection.length < 2 || liveCallId || busyRef.current || practiceMicState !== 'idle') return
    const questions = practiceRoundSelection
      .map(index => transcriptQuestions.questions[index])
      .filter((question): question is string => Boolean(question))
    if (questions.length < 2) return
    const createdAt = new Date().toISOString()
    const call: Call = {
      id: crypto.randomUUID(), createdAt, duration: 0, kind: 'practice',
      practiceProfile: settingsRef.current.practiceProfile,
      practiceTrackId: 'transcript:ru', practiceTrackStep: 0,
      practiceQuestionSet: {
        title: practiceTranscriptSource === 'all' ? transcriptQuestions.fileName : transcriptQuestions.sourceNames[Number(practiceTranscriptSource)] || transcriptQuestions.fileName,
        questions,
      },
      messages: [message('interviewer', questions[0], createdAt)],
      usage: [], usageTracking: 'complete', transcriptionMode: 'local',
    }
    commit({ ...dataRef.current, calls: [call, ...dataRef.current.calls] })
    choose(call.id); setDraft(''); setPracticeQuestion(''); setPracticeQuestionChoice(''); setPracticeTrackChoice(''); setPracticeAnswer(''); setView('call')
  }
  function startPracticeTrack() {
    const track = practiceTracks.find(item => item.id === practiceTrackChoice)
    const firstQuestion = practiceBank.getPracticeQuestion(track?.questionIds[0] || '')
    if (!track || !firstQuestion || liveCallId || busyRef.current || practiceMicState !== 'idle') return
    const createdAt = new Date().toISOString()
    const call: Call = {
      id: crypto.randomUUID(), createdAt, duration: 0, kind: 'practice',
      practiceProfile: settingsRef.current.practiceProfile,
      practiceTrackId: track.id, practiceTrackStep: 0,
      messages: [message('interviewer', firstQuestion.question, createdAt)],
      usage: [], usageTracking: 'complete', transcriptionMode: 'local',
    }
    commit({ ...dataRef.current, calls: [call, ...dataRef.current.calls] })
    choose(call.id); setDraft(''); setPracticeQuestion(''); setPracticeQuestionChoice(''); setPracticeTrackChoice(''); setPracticeAnswer(''); setView('call')
  }
  function advancePracticeTrack() {
    if (!selected || selected.kind !== 'practice' || !hasPracticeScenario || !practiceCanContinue || busyRef.current) return
    stopPracticeQuestionSpeech()
    const nextStep = selectedPracticeStep + 1
    const nextQuestion = selectedPracticeQuestionSet?.questions[nextStep] || practiceBank.getPracticeQuestion(selectedPracticeTrack?.questionIds[nextStep] || '')?.question
    if (!nextQuestion) { setNotice('Сценарий завершён'); return }
    append(selected.id, 'interviewer', nextQuestion)
    updateCall(selected.id, call => ({ ...call, practiceTrackStep: nextStep }))
    setPracticeAnswer('')
    setNotice('')
  }
  function submitPracticeAnswer() {
    const answer = practiceAnswer.trim()
    if (!selected || selected.kind !== 'practice' || !answer || busyRef.current || practiceMicState !== 'idle') return
    append(selected.id, 'me', answer)
    setPracticeAnswer('')
    void ask('review')
  }
  function closeSettings() {
    setModal(null)
  }
  useEffect(() => { askRef.current = ask })
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!event.isComposing && event.ctrlKey && event.key === 'Enter' && view === 'call' && !modal) { event.preventDefault(); if (selected?.kind === 'practice' && practiceAnswer.trim()) submitPracticeAnswer(); else void ask(selected?.kind === 'practice' ? 'review' : 'answer') }
      if (event.key === 'Escape') { if (!saving) closeSettings(); setDeleteId(null) }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  })
  async function togglePrivacy(enabled = !protectedCapture) {
    if (privacyBusy || !window.sobesych) return
    setPrivacyBusy(true)
    try {
      const result = await window.sobesych.setCaptureProtection(enabled)
      if (result.error || !result.ok) throw new Error(result.error || 'Не удалось переключить скрытый режим')
      setProtectedCapture(Boolean(result.enabled))
    } catch (e) { setError(errorText(e)) } finally { setPrivacyBusy(false) }
  }
  async function setCompactMode(enabled: boolean) {
    if (!window.sobesych) return
    const request = ++overlayRequest.current
    try {
      const result = await window.sobesych.setOverlayMode(enabled)
      if (result.error) throw new Error(result.error)
      if (request === overlayRequest.current) setOverlayModeState(Boolean(result.enabled))
    } catch (e) { setError(errorText(e)) }
  }
  function openSettings() {
    setConfigDraft({ ...settings, apiKey: '' }); setModelTestArmed(false); setAudioDiagnostic(current => ({ ...current, state: 'idle', sources: { me: inactive, interviewer: inactive }, pending: false })); setModal('settings')
    void navigator.mediaDevices.enumerateDevices().then(list => setDevices(list.filter(d => d.kind === 'audioinput'))).catch(e => setError(errorText(e)))
    void window.sobesych?.models().then(result => { if (result.models?.length) setModels(result.models); else if (result.error) setNotice(`Каталог недоступен: ${result.error}`) }).catch(e => setNotice(errorText(e)))
  }
  async function startAudioDiagnostic() {
    if (!window.sobesych || !ready || phase !== 'idle' || liveCallId || busyRef.current || practiceMicState !== 'idle' || audioDiagnostic.state !== 'idle') return
    const generation = ++audioDiagnosticGeneration.current
    setAudioDiagnostic({ state: 'warming', text: { me: '', interviewer: '' }, draft: '', latency: {}, sources: { me: inactive, interviewer: inactive }, pending: false, error: '' })
    let session: CaptureSession | null = null
    try {
      const warmup = await window.sobesych.warmLocalTranscription()
      if (generation !== audioDiagnosticGeneration.current) return
      if (warmup.error || !warmup.ok) throw new Error(warmup.error || 'Не удалось запустить локальное распознавание')
      const language = configDraft.language === 'ru' || configDraft.language === 'en' ? configDraft.language : 'auto'
      session = new CaptureSession({
        microphoneId: configDraft.microphoneId,
        previewEnabled: warmup.previewEnabled !== false,
        localOnly: true,
        onStatus(source, status) {
          if (generation === audioDiagnosticGeneration.current) setAudioDiagnostic(current => ({ ...current, sources: { ...current.sources, [source]: status } }))
        },
        onPartial(source, text, _createdAt, latency) {
          if (source !== 'interviewer' || generation !== audioDiagnosticGeneration.current) return
          setAudioDiagnostic(current => ({ ...current, draft: text, latency: { ...current.latency, interviewer: { callId: 'audio-diagnostic', ...latency, transcriptFinal: false } } }))
        },
        onText(source, text, _createdAt, latency) {
          if (generation !== audioDiagnosticGeneration.current) return
          setAudioDiagnostic(current => ({
            ...current,
            text: { ...current.text, [source]: [current.text[source], text].filter(Boolean).join(' ') },
            draft: source === 'interviewer' ? '' : current.draft,
            latency: { ...current.latency, [source]: { callId: 'audio-diagnostic', ...latency, transcriptFinal: true } },
            error: '',
          }))
        },
        onError(error) {
          if (generation === audioDiagnosticGeneration.current) setAudioDiagnostic(current => ({ ...current, error }))
        },
        onPending(count) {
          if (generation === audioDiagnosticGeneration.current) setAudioDiagnostic(current => ({ ...current, pending: count > 0 }))
        },
        transcribe(audio, _localOnly, signal, provisional) {
          const requestId = crypto.randomUUID()
          const cancel = () => { void window.sobesych?.cancelRequests(requestId).catch(() => {}) }
          signal?.addEventListener('abort', cancel, { once: true })
          return window.sobesych!.transcribe({ audio, localOnly: true, language, provisional, requestId }).finally(() => signal?.removeEventListener('abort', cancel))
        },
      })
      audioDiagnosticCapture.current = session
      const started = await session.start()
      if (generation !== audioDiagnosticGeneration.current || audioDiagnosticCapture.current !== session) { session.stop(); return }
      if (!started.microphone) throw new Error('Не подключился выбранный микрофон. Проверь разрешение Windows и устройство ввода.')
      if (!started.interviewer) throw new Error(started.interviewerError || 'Не подключился звук компьютера.')
      setAudioDiagnostic(current => ({ ...current, state: 'recording', error: '' }))
    } catch (error) {
      session?.stop()
      if (generation === audioDiagnosticGeneration.current) {
        if (audioDiagnosticCapture.current === session) audioDiagnosticCapture.current = null
        void window.sobesych?.releaseLocalTranscription?.()
        setAudioDiagnostic(current => ({ ...current, state: 'idle', sources: { me: inactive, interviewer: inactive }, pending: false, error: errorText(error) }))
      }
    }
  }
  async function stopAudioDiagnostic() {
    if (audioDiagnostic.state === 'warming') {
      audioDiagnosticGeneration.current++
      void window.sobesych?.releaseLocalTranscription?.()
      setAudioDiagnostic(current => ({ ...current, state: 'idle', sources: { me: inactive, interviewer: inactive }, pending: false }))
      return
    }
    const session = audioDiagnosticCapture.current
    if (!session || audioDiagnostic.state !== 'recording') return
    const generation = audioDiagnosticGeneration.current
    setAudioDiagnostic(current => ({ ...current, state: 'processing', sources: { me: inactive, interviewer: inactive } }))
    try {
      const errors = await session.stopAndFlushAll()
      if (generation !== audioDiagnosticGeneration.current) return
      if (errors.length) setAudioDiagnostic(current => ({ ...current, error: errors[0] }))
      else setAudioDiagnostic(current => ({ ...current, error: current.text.me || current.text.interviewer ? '' : 'Речь не распознана. Проверь уровни обоих источников и повтори тест.' }))
    } catch (error) {
      if (generation === audioDiagnosticGeneration.current) setAudioDiagnostic(current => ({ ...current, error: errorText(error) }))
    } finally {
      if (audioDiagnosticCapture.current === session) {
        audioDiagnosticCapture.current = null
        void window.sobesych?.releaseLocalTranscription?.()
        if (generation === audioDiagnosticGeneration.current) setAudioDiagnostic(current => ({ ...current, state: 'idle', sources: { me: inactive, interviewer: inactive }, pending: false }))
      }
    }
  }
  async function installGpuSpeech() {
    if (!window.sobesych || installingGpu || phase !== 'idle' || audioDiagnostic.state !== 'idle' || practiceMicState !== 'idle') return
    setInstallingGpu(true); setError('')
    try {
      const result = await window.sobesych.installGpuSpeech()
      if (result.error) throw new Error(result.error)
      const config = await window.sobesych.getConfig()
      setLocalSpeech(config.localSpeech || null)
      setNotice('GPU-пакет установлен')
    } catch (error) { setError(errorText(error)) }
    finally { setInstallingGpu(false) }
  }
  async function saveSettings() {
    if (saving) return
    setSaving(true)
    try {
      const result = await window.sobesych!.saveSettings({ ...configDraft, autoAnswer: false })
      if (result.error) throw new Error(result.error)
      const inferenceChanged = result.settings.model !== settingsRef.current.model
        || result.settings.baseUrl !== settingsRef.current.baseUrl
        || result.settings.practiceProfile !== settingsRef.current.practiceProfile
        || Boolean(configDraft.apiKey.trim())
      if (inferenceChanged) { cancelAnswer(); answered.current.clear() }
      updateConfig(result.settings); setConfigDraft({ ...result.settings, apiKey: '' }); setModelTestArmed(false); setModal(null); setError(''); setNotice('Настройки сохранены')
    } catch (e) { setError(errorText(e)) } finally { setSaving(false) }
  }
  function testSelectedModel() {
    if (!modelTestArmed) { setModelTestArmed(true); return }
    const requestSettings = settingsRef.current
    if (!requestSettings.hasKey || configDraft.apiKey.trim() || configDraft.model !== requestSettings.model || configDraft.baseUrl !== requestSettings.baseUrl) {
      setModelTestArmed(false)
      setNotice('Сначала сохрани ключ, модель и адрес провайдера.')
      return
    }
    if (!ready || busyRef.current || liveCallId || practiceMicState !== 'idle') return
    const createdAt = new Date().toISOString()
    const question = 'Что делает EXPOSE 8080 в Dockerfile и открывает ли он порт на хосте?'
    const attempt = 'EXPOSE 8080 публикует порт контейнера на хосте, поэтому отдельный проброс через docker run не нужен.'
    const call: Call = {
      id: crypto.randomUUID(), createdAt, duration: 0, kind: 'practice', practiceProfile: requestSettings.practiceProfile,
      practiceQuestionSet: { title: 'Проверка модели', questions: [question, 'Как опубликовать порт контейнера на хосте?'] },
      messages: [message('interviewer', question, createdAt), message('me', attempt, createdAt)],
      usage: [], usageTracking: 'complete', transcriptionMode: 'local',
    }
    setModelTestArmed(false)
    commit({ ...dataRef.current, calls: [call, ...dataRef.current.calls] })
    choose(call.id); setModal(null); setView('call')
    void ask('review', false, undefined, 220, true)
  }
  const historyCalls = useMemo(() => practiceOnlyBuild ? data.calls.filter(call => call.kind === 'practice') : data.calls, [data.calls])
  const filtered = useMemo(() => view === 'history' ? historyCalls.filter(c => !search || c.messages.some(m => m.text.toLowerCase().includes(search.toLowerCase())) || new Date(c.createdAt).toLocaleDateString('ru-RU').includes(search)) : [], [historyCalls, search, view])
  const practiceQuestions = practiceOnlyBuild ? practiceBank.getPracticeQuestions(settings.practiceProfile) : []
  const practiceTracks = practiceOnlyBuild ? practiceBank.getPracticeTracks(settings.practiceProfile) : []
  const practiceQuestionsRu = practiceQuestions.filter(question => question.language === 'ru')
  const practiceQuestionsEn = practiceQuestions.filter(question => question.language === 'en')
  const practiceTracksRu = practiceTracks.filter(track => track.language === 'ru')
  const practiceTracksEn = practiceTracks.filter(track => track.language === 'en')
  const modelInfo = models.find(m => m.id === configDraft.model)
  const interviewerNoSignal = Boolean(selectedId === liveCallId && phase === 'running' && selected && selected.kind !== 'practice' && selected.duration >= 8 && audio.interviewer.active && !interviewerSignalSeen)
  const iconButton = (title: string, action: () => void, icon: React.ReactNode, disabled = false) => <IconButton title={title} action={action} icon={icon} disabled={disabled} />

  return <main className={`shell${overlayMode ? ' overlay-shell' : ''}`}>
    <header className="app-header">
      <strong className="brand">Sobesych <small>{version}</small></strong>
      <nav aria-label="Разделы">
        <button className={view === 'history' ? 'selected' : ''} onClick={() => { stopPracticeQuestionSpeech(); setView('history') }} disabled={practiceMicState !== 'idle'}><History size={16} />История</button>
        {!practiceOnlyBuild && <button className={view === 'call' ? 'selected' : ''} onClick={() => { choose(liveCallId); setView('call') }} disabled={!ready || practiceMicState !== 'idle'}><Phone size={16} />{liveCallId ? 'Текущий звонок' : 'Звонок'}</button>}
        {practiceOnlyBuild && <button className={view === 'practice' ? 'selected' : ''} onClick={() => { stopPracticeQuestionSpeech(); setView('practice') }} disabled={!ready || Boolean(liveCallId) || practiceMicState !== 'idle'}><Sparkles size={16} />Практика</button>}
      </nav>
      <div className="header-tools">
        {updateAvailable && <button onClick={openSettings} title="Открыть обновление приложения"><Download size={18} />Обновление</button>}
        {!practiceOnlyBuild && <><IconButton title={protectedCapture ? 'Выключить скрытый режим' : 'Включить скрытый режим'} action={() => void togglePrivacy()} icon={protectedCapture ? <EyeOff size={18} /> : <Eye size={18} />} pressed={protectedCapture} hint={`${protectedCapture ? 'Скрытый режим включён' : 'Скрытый режим выключен'}. Защита окна может блокировать запись OBS/NVIDIA.`} disabled={!ready || privacyBusy || (!protectedCapture && (busy || practiceMicState !== 'idle'))} />
        <IconButton title={overlayMode ? 'Выключить компактный оверлей' : 'Включить компактный оверлей'} action={() => void setCompactMode(!overlayMode)} icon={<PictureInPicture2 size={18} />} pressed={overlayMode} disabled={!ready || practiceMicState !== 'idle'} /></>}
        {iconButton('Настройки', openSettings, <SettingsIcon size={18} />, !ready || practiceMicState !== 'idle')}
      </div>
    </header>
    {error && <div className="global-status error" role="alert"><span>{error}</span>{iconButton('Закрыть ошибку', () => setError(''), <X size={16} />)}</div>}
    {notice && <div className="global-status notice" role="status"><span>{notice}</span>{iconButton('Закрыть уведомление', () => setNotice(''), <X size={16} />)}</div>}
    {view === 'practice' ? <section className="practice-page">
      <div className="section-heading"><h1>Тренировка собеседования</h1></div>
      {practiceProgress.total > 0 && <section className="practice-progress" role="region" aria-label="Динамика тренировок">
        <div className="practice-progress-heading"><div><h2 id="practice-progress-title">Оценка тренировок</h2><small>По тексту ответов, это ориентир, а не оценка голоса</small></div><strong>{practiceProgress.recent.overall.toFixed(1)} / 4</strong></div>
        <div className="practice-score-grid">{([
          ['accuracy', 'Техническая точность'], ['directness', 'Прямой ответ'], ['specificity', 'Конкретика'], ['naturalness', 'Естественность'],
        ] as const).map(([key, label]) => <div className="practice-score-row" key={key}><span>{label}</span><meter min="1" max="4" value={practiceProgress.recent[key]} aria-label={`${label}: ${practiceProgress.recent[key]} из 4`} /><strong>{practiceProgress.recent[key].toFixed(1)}</strong>{practiceProgress.delta && <small>{practiceProgress.delta[key] > 0 ? '+' : ''}{practiceProgress.delta[key].toFixed(1)}</small>}</div>)}</div>
        <p>{practiceProgress.recent.count} последних оценённых сценариев{practiceProgress.previous ? ` · изменение к предыдущим ${practiceProgress.previous.count}: ${practiceProgress.delta!.overall > 0 ? '+' : ''}${practiceProgress.delta!.overall.toFixed(1)}` : ' · сравнение появится после ещё одной серии из пяти сценариев'}</p>
      </section>}
      <div className="practice-mode" role="group" aria-label="Формат тренировки">
        <button type="button" aria-pressed={practiceMode === 'question'} className={practiceMode === 'question' ? 'selected' : ''} disabled={practiceMicState !== 'idle'} onClick={() => { setPracticeMode('question'); setPracticeTrackChoice(''); setPracticeQuestion(''); setPracticeQuestionChoice(''); setPracticeAnswer('') }}>Один вопрос</button>
        <button type="button" aria-pressed={practiceMode === 'track'} className={practiceMode === 'track' ? 'selected' : ''} disabled={practiceMicState !== 'idle'} onClick={() => { setPracticeMode('track'); setPracticeQuestion(''); setPracticeQuestionChoice(''); setPracticeTrackChoice(''); setPracticeAnswer('') }}>Сценарий интервью</button>
      </div>
      {practiceMode === 'question' ? <div className="practice-picker">
        <label htmlFor="practice-question-bank">Вопрос из набора</label>
        <div className="practice-import">
          <button type="button" onClick={() => transcriptFileInput.current?.click()} disabled={practiceMicState !== 'idle' || practiceLibrarySaving}><Upload size={16} />{practiceLibrarySaving ? 'Сохраняю…' : 'Загрузить вопросы из TXT'}</button>
          <button type="button" onClick={() => void startScreenPractice()} disabled={!ready || busy || Boolean(liveCallId) || practiceMicState !== 'idle' || screenPracticeSelecting}><Scan size={16} />{screenPracticeSelecting ? 'Выбираю область…' : 'Задача с экрана'}</button>
          <input ref={transcriptFileInput} hidden type="file" accept=".txt,text/plain" multiple aria-label="Загрузить вопросы из TXT" onChange={event => void importPracticeTranscript(event)} />
          {transcriptQuestions && <small>{transcriptQuestions.questions.length} вопросов · {transcriptQuestions.fileName}</small>}
          {practiceLibraries.length > 0 && <label className="practice-library-picker"><span>Сохранённые наборы</span><select aria-label="Сохранённая подборка" value={activePracticeLibraryId} disabled={practiceLibrarySaving} onChange={event => { const library = practiceLibraries.find(item => item.id === event.target.value); if (library) activatePracticeLibrary(library) }}><option value="">Не сохранённый набор</option>{practiceLibraries.map(library => <option key={library.id} value={library.id}>{library.title}</option>)}</select>{practiceLibraries.some(library => library.id === activePracticeLibraryId) && iconButton('Удалить подборку', () => setDeletePracticeLibraryId(activePracticeLibraryId), <Trash2 size={16} />, practiceLibrarySaving)}</label>}
        </div>
        {transcriptQuestions && transcriptQuestions.sourceCount > 1 && <label className="practice-transcript-source"><span>Запись</span><select aria-label="Фильтр по записи" value={practiceTranscriptSource} onChange={event => { setPracticeTranscriptSource(event.target.value); setPracticeRoundSelection([]) }}><option value="all">Все записи</option>{transcriptQuestions.sourceNames.map((name, index) => <option key={`${index}-${name}`} value={String(index)}>{name} · {transcriptQuestions.sourceQuestionCounts[index]} вопр.</option>)}</select></label>}
        {transcriptQuestions && <label className="practice-transcript-search"><Search size={16} /><input aria-label="Поиск по вопросам из TXT" placeholder="Найти вопрос в загруженных TXT" value={practiceTranscriptSearch} onChange={event => setPracticeTranscriptSearch(event.target.value)} /></label>}
        {audienceHintsEnabled && <label className="practice-transcript-filter"><span>Подсказка по роли</span><select aria-label="Фильтр фраз без меток" value={practiceTranscriptAudience} onChange={event => setPracticeTranscriptAudience(event.target.value as typeof practiceTranscriptAudience)}><option value="all">Все фразы ({matchingTranscriptQuestions.length})</option><option value="addressed">Есть обращение к тебе ({addressedTranscriptQuestions})</option><option value="review">Проверить вручную ({matchingTranscriptQuestions.length - addressedTranscriptQuestions})</option></select></label>}
        {transcriptQuestions && matchingTranscriptQuestions.length > maxVisibleTranscriptQuestions && <small>Совпадений: {matchingTranscriptQuestions.length}. Показаны первые {maxVisibleTranscriptQuestions}, уточни поиск.</small>}
        <select id="practice-question-bank" aria-label="Вопрос из набора" disabled={practiceMicState !== 'idle'} value={practiceQuestionChoice} onChange={event => {
        const choice = practiceQuestions.find(question => question.id === event.target.value)
        const importedIndex = /^transcript:(\d+)$/u.exec(event.target.value)
        const imported = importedIndex && transcriptQuestions?.questions[Number(importedIndex[1])]
        stopPracticeQuestionSpeech()
        setPracticeQuestionChoice(choice?.id || (imported ? event.target.value : ''))
        setPracticeTrackChoice('')
        if (choice || imported) { setPracticeQuestion(choice?.question || imported || ''); setPracticeAnswer('') }
      }}>
        <option value="">Выбрать вопрос…</option>
        <optgroup label="Русский">{practiceQuestionsRu.map(question => <option key={question.id} value={question.id}>{question.label}</option>)}</optgroup>
        <optgroup label="English">{practiceQuestionsEn.map(question => <option key={question.id} value={question.id}>{question.label}</option>)}</optgroup>
        {transcriptQuestions && <optgroup label={`Из ${transcriptQuestions.fileName}`}>{matchingTranscriptQuestions.slice(0, maxVisibleTranscriptQuestions).map(({ question, index }) => <option key={`${index}-${question}`} value={`transcript:${index}`}>{question.slice(0, 110)}</option>)}</optgroup>}
        </select>
        {transcriptQuestions && <>
          {!transcriptQuestions.hasSpeakerLabels && <p className="practice-import-warning" role="note">В {transcriptQuestions.unlabelledFileCount} из {transcriptQuestions.sourceCount} TXT нет меток говорящих. Подсказка по обращению эвристическая; проверь вопросы и распознавание вручную.</p>}
          <div className="practice-transcript-round"><details open>
            <summary>Сценарий из TXT · выбрано {practiceRoundSelection.length}/{maxTranscriptRoundQuestions}</summary>
            <p>Отметь вопросы, которые хочешь пройти подряд.</p>
            <div className="practice-transcript-list">
              {visibleTranscriptQuestions.map(({ question, index, audience }) => <label key={`${index}-${question}`}><input type="checkbox" aria-label={`Добавить в сценарий: ${question}`} checked={practiceRoundSelection.includes(index)} disabled={practiceMicState !== 'idle' || (!practiceRoundSelection.includes(index) && practiceRoundSelection.length >= maxTranscriptRoundQuestions)} onChange={event => togglePracticeRoundQuestion(index, event.target.checked)} /><span className="practice-transcript-question"><span>{question}</span>{audienceHintsEnabled && <small>{audience === 'addressed' ? 'Есть обращение к тебе' : 'Проверь, кто спрашивает'}</small>}</span></label>)}
              {!visibleTranscriptQuestions.length && <p>По этому фильтру ничего не найдено.</p>}
            </div>
            {audienceFilteredTranscriptQuestions.length > maxVisibleTranscriptQuestions && <small>Показаны первые {maxVisibleTranscriptQuestions} совпадений. Уточни поиск.</small>}
            <button className="primary" type="button" onClick={startImportedPracticeRound} disabled={!ready || busy || Boolean(liveCallId) || practiceMicState !== 'idle' || practiceRoundSelection.length < 2}><Play size={16} />Начать сценарий из TXT</button>
          </details></div>
        </>}</div> : <div className="practice-picker"><label htmlFor="practice-track-bank">Сценарий</label><select id="practice-track-bank" aria-label="Сценарий интервью" disabled={practiceMicState !== 'idle'} value={practiceTrackChoice} onChange={event => {
        const track = practiceTracks.find(item => item.id === event.target.value)
        stopPracticeQuestionSpeech()
        setPracticeTrackChoice(track?.id || '')
        setPracticeQuestionChoice('')
        const firstQuestion = practiceBank.getPracticeQuestion(track?.questionIds[0] || '')
        setPracticeQuestion(firstQuestion?.question || '')
        setPracticeAnswer('')
      }}>
        <option value="">Выбрать сценарий…</option>
        <optgroup label="Русский">{practiceTracksRu.map(track => <option key={track.id} value={track.id}>{track.title}</option>)}</optgroup>
        <optgroup label="English">{practiceTracksEn.map(track => <option key={track.id} value={track.id}>{track.title}</option>)}</optgroup>
      </select></div>}
      <div className="practice-fields">
        <div className="practice-question-field"><div className="practice-question-heading"><label htmlFor="practice-question">Вопрос</label>{iconButton(speakingPracticeQuestion === practiceQuestion.trim() ? 'Остановить озвучивание' : 'Прослушать вопрос', () => togglePracticeQuestionSpeech(practiceQuestion), speakingPracticeQuestion === practiceQuestion.trim() ? <VolumeX size={16} /> : <Volume2 size={16} />, !practiceQuestion.trim() || (practiceMicState !== 'idle' && speakingPracticeQuestion !== practiceQuestion.trim()))}</div><textarea id="practice-question" aria-label="Вопрос для тренировки" rows={3} disabled={practiceMicState !== 'idle'} readOnly={practiceMode === 'track'} value={practiceQuestion} onChange={e => { stopPracticeQuestionSpeech(); setPracticeQuestion(e.target.value); setPracticeQuestionChoice(''); setPracticeTrackChoice(''); setPracticeMode('question') }} placeholder="Вставь вопрос собеседника" /></div>
        {practiceMode === 'question' && <label>Твой ответ<textarea aria-label="Твой ответ для тренировки" rows={7} disabled={practiceMicState !== 'idle'} value={practiceAnswer} onChange={e => setPracticeAnswer(e.target.value)} placeholder="Сначала ответь своими словами" /></label>}
      </div>
      {practiceMode === 'question' ? <div className="practice-actions"><div className="practice-voice">
        <button className={practiceMicState === 'recording' ? 'practice-recording' : ''} onClick={() => void (practiceMicState === 'recording' ? stopPracticeRecording() : startPracticeRecording())} disabled={!ready || busy || Boolean(liveCallId) || ['warming', 'processing'].includes(practiceMicState)}>
          {practiceMicState === 'recording' ? <Square size={16} /> : <Mic size={16} />}
          {practiceMicState === 'recording' ? 'Остановить запись' : practiceMicState === 'warming' ? 'Подготовка распознавания…' : practiceMicState === 'processing' ? 'Распознаю…' : 'Надиктовать ответ'}
        </button>
        <span role="status" aria-live="polite">{practiceMicState === 'warming' ? 'Запись ещё не началась' : practiceMicState === 'recording' ? practicePending ? 'Распознаю фрагмент…' : 'Идёт запись' : practiceMicState === 'processing' ? 'Завершаю распознавание…' : 'Микрофон выключен'}</span>
      </div><button className="primary" onClick={reviewPracticeAnswer} disabled={!ready || busy || Boolean(liveCallId) || practiceMicState !== 'idle' || !practiceQuestion.trim() || !practiceAnswer.trim()}><Sparkles size={16} />Разобрать попытку</button></div> : <div className="practice-actions"><span>{practiceTrackChoice ? 'Ответишь после начала сценария' : 'Выбери сценарий интервью'}</span><button className="primary" onClick={startPracticeTrack} disabled={!ready || busy || Boolean(liveCallId) || practiceMicState !== 'idle' || !practiceTrackChoice}><Play size={16} />Начать сценарий</button></div>}
      {practiceMode === 'question' && <p className="practice-privacy">Для голосового ответа используется только микрофон. Распознавание идёт локально, аудиофайл не сохраняется. Задача с экрана сначала только распознаётся; разбор появится после твоей попытки.</p>}
    </section> : view === 'history' ? <section className="history-page">
      <div className="section-heading"><h1>{practiceOnlyBuild ? 'История тренировок' : 'История звонков'}</h1><button className="primary" onClick={() => practiceOnlyBuild ? setView('practice') : void startCall()} disabled={!ready || callStarting}><Play size={16} />{practiceOnlyBuild ? 'Новая тренировка' : callStarting ? 'Подготовка распознавания…' : liveCallId ? 'Открыть звонок' : 'Начать'}</button></div>
      <div className="stats"><span><strong>{historyCalls.length}</strong> {practiceOnlyBuild ? 'тренировок' : 'звонков'}</span><span><strong>{Math.floor(historyCalls.reduce((s, c) => s + c.duration, 0) / 60)}</strong> минут</span><span><strong>{historyCalls.reduce((s, c) => s + c.messages.filter(m => m.speaker === 'assistant').length, 0)}</strong> {practiceOnlyBuild ? 'разборов' : 'подсказок'}</span></div>
      <div className="usage-summary" aria-label="Учтённые расходы"><strong>Учтённые расходы: {formatUsd(historyUsage.knownUsd)}</strong><small>{historyUsage.reportedCount} операций с ценой · {historyUsage.pendingCount} в процессе · {historyUsage.unknownCount} без цены{untrackedCalls ? ` · ${untrackedCalls} старых звонков не учитывались` : ''}</small></div>
      <label className="search"><Search size={18} /><input aria-label="Поиск звонков" placeholder="Поиск звонков" value={search} onChange={e => setSearch(e.target.value)} /></label>
      {!filtered.length && <p className="empty">{ready ? 'Нет звонков' : 'Загрузка…'}</p>}
      <div className="call-list">{filtered.map(c => <article className="call-row" key={c.id}>
        {practiceOnlyBuild ? <Sparkles size={20} /> : <Phone size={20} />}<button className="call-description" onClick={() => { choose(c.id); setDraft(''); setView('call') }}><strong>{c.messages.find(m => m.speaker === 'interviewer')?.text.slice(0, 110) || (c.kind === 'practice' ? 'Тренировка' : 'Живой звонок')}</strong><small>{new Date(c.createdAt).toLocaleString('ru-RU')} · {duration(c.duration)}{liveCallId === c.id ? ' · Активен' : ''}</small></button>
        {iconButton('Экспорт звонка', () => void window.sobesych!.exportCall(c).then(r => { if (r.error) setError(r.error) }), <Download size={17} />)}
        {iconButton('Удалить звонок', () => setDeleteId(c.id), <Trash2 size={17} />, liveCallId === c.id)}
      </article>)}</div>
    </section> : !selected ? <section className="start-page" aria-label="Новый звонок"><div className="start-card"><h1>Новый звонок</h1><p>После старта откроется компактное окно с подсказками и задачами с экрана.</p><button className="primary start-button" onClick={() => void startCall()} disabled={!ready || callStarting}><Mic size={18} />{callStarting ? 'Подготовка распознавания…' : 'Начать звонок'}</button><small>{!settings.hasKey ? 'Добавь ключ OpenRouter в настройках для AI-подсказок' : 'Микрофон включится после нажатия'}</small></div></section> : <section className="call-page" aria-label="Живой звонок">
      <div className="call-toolbar"><div className="call-heading"><h1>{selected.kind === 'practice' ? 'Разбор тренировки' : selectedId === liveCallId ? phase === 'paused' ? 'Пауза' : 'Живой звонок' : 'Завершённый звонок'}</h1>{hasPracticeScenario && <small>{selectedPracticeTitle} · Вопрос {selectedPracticeStep + 1} из {selectedPracticeQuestionCount}</small>}</div>
        {selectedId === liveCallId && settings.transcriptionMode === 'local' && localSpeech?.backend && <span className={`compact-backend ${localSpeech.backend}`} title={localSpeech.backend === 'cpu' ? 'Распознавание на процессоре. Возможны задержки; NVIDIA-пакет можно скачать в настройках.' : 'Распознавание на NVIDIA GPU'}>{localSpeech.backend === 'cpu' ? 'CPU' : 'GPU'}</span>}
        <div className="timer-controls">
          {selectedId === liveCallId && phase !== 'idle' && <><IconButton title={phase === 'paused' ? 'Продолжить' : 'Пауза'} action={() => { if (phase === 'paused') void resumeCall(); else pauseCall() }} icon={phase === 'paused' ? <Play size={18} /> : <Pause size={18} />} disabled={callStarting} /><IconButton title="Остановить звонок" action={stopCall} icon={<Square size={18} />} /></>}
          {selected.kind === 'practice' ? <><IconButton title={practiceTimerRunningId === selected.id ? 'Пауза таймера тренировки' : 'Запустить таймер тренировки'} action={() => togglePracticeTimer(selected.id)} icon={practiceTimerRunningId === selected.id ? <Pause size={18} /> : <Play size={18} />} /><time data-testid="practice-timer">{duration(selected.duration || 0)}</time></> : <time data-testid="timer">{duration(selected?.duration || 0)}</time>}
        </div>
        {pendingTranscriptions > 0 && selectedId === liveCallId && <small role="status">Распознаю речь… {pendingTranscriptions}</small>}
        <IconButton title="Закрыть звонок" action={() => { if (selectedId === liveCallId) stopCall(); else screenTask.current = null; setView('history') }} icon={<X size={18} />} disabled={selected.kind === 'practice' && practiceMicState !== 'idle'} />
      </div>
      <div className="audio-strip">
        {(['me', 'interviewer'] as Source[]).map(source => <div className={`audio-source ${audio[source].active && selectedId === liveCallId ? 'active' : ''}${source === 'interviewer' && interviewerNoSignal ? ' missing-signal' : ''}`} key={source} data-source={source} title={source === 'interviewer' && interviewerNoSignal ? 'Системный звук подключён, но сигнал собеседника не обнаружен.' : audio[source].message}>
          {source === 'me' ? <Mic size={16} /> : <Monitor size={16} />}<span>{source === 'me' ? 'Микрофон' : 'Собеседник'}</span><meter min="0" max="0.1" value={selectedId === liveCallId ? audio[source].level : 0} aria-label={source === 'me' ? 'Уровень микрофона' : 'Уровень собеседника'} /><small>{selectedId === liveCallId ? audio[source].active ? source === 'interviewer' && interviewerNoSignal ? 'Нет сигнала' : 'Подключён' : audio[source].message : 'Отключён'}</small>
        </div>)}
        {selectedId === liveCallId && phase !== 'idle' && settings.transcriptionMode === 'local' && localSpeech?.backend && <div className={`speech-backend ${localSpeech.backend}`} role="status" aria-label="Движок распознавания">
          <span>{localSpeech.backend === 'cuda' ? 'Распознавание · NVIDIA GPU' : 'Распознавание · CPU · возможна задержка'}</span>
          {localSpeech.backend === 'cpu' && localSpeech.gpuSupported && <button onClick={openSettings}><SettingsIcon size={15} />NVIDIA</button>}
        </div>}
      </div>
      <div className="workspace">
        <section className="transcript-pane" aria-label="Транскрипт">
          <div className="pane-heading"><h2>Разговор</h2><div className="pane-heading-tools"><small>{selected?.messages.filter(m => m.speaker !== 'assistant').length || 0} реплик</small>{selected.kind === 'practice' && selectedPracticePrompt && iconButton(speakingPracticeQuestion === selectedPracticePrompt ? 'Остановить озвучивание' : 'Прослушать вопрос', () => togglePracticeQuestionSpeech(selectedPracticePrompt), speakingPracticeQuestion === selectedPracticePrompt ? <VolumeX size={16} /> : <Volume2 size={16} />)}</div></div>
          <div className="transcript-list"><TranscriptMessages messages={selected.messages} partialText={selectedId === liveCallId && phase === 'running' ? partialTranscript : ''} /><div ref={transcriptEnd} /></div>
          <div className="composer">{selected.kind === 'practice' ? <>
            <div className="practice-live-voice">
              <button className={`practice-composer-mic ${practiceMicState === 'recording' ? 'practice-recording' : ''}`} title={practiceMicState === 'recording' ? 'Остановить запись' : 'Надиктовать ответ'} aria-label={practiceMicState === 'recording' ? 'Остановить запись' : 'Надиктовать ответ'} disabled={!ready || busy || ['warming', 'processing'].includes(practiceMicState)} onClick={() => void (practiceMicState === 'recording' ? stopPracticeRecording() : startPracticeRecording())}>{practiceMicState === 'recording' ? <Square size={16} /> : <Mic size={16} />}<span>{practiceMicState === 'recording' ? 'Стоп' : 'Голос'}</span></button>
              <small role="status" aria-live="polite">{practiceMicState === 'warming' ? 'Подготовка…' : practiceMicState === 'recording' ? practicePending ? 'Распознаю…' : 'Запись' : practiceMicState === 'processing' ? 'Распознаю…' : ''}</small>
            </div>
            <input placeholder="Ответ на вопрос интервьюера" aria-label="Ответ на вопрос" value={practiceAnswer} disabled={practiceMicState !== 'idle'} onChange={event => setPracticeAnswer(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.ctrlKey) submitPracticeAnswer() }} />
            <IconButton title="Отправить ответ на разбор" action={submitPracticeAnswer} icon={<Send size={18} />} disabled={!practiceAnswer.trim() || busy || practiceMicState !== 'idle'} />
          </> : <>
            <button className={`mic-button ${micEnabled && audio.me.active ? 'active' : ''}`} title={microphoneAction} aria-label={microphoneAction} disabled={phase !== 'running' || selectedId !== liveCallId} onClick={toggleMicrophone}>{micEnabled ? <Mic size={18} /> : <MicOff size={18} />}<span>Микрофон</span></button>
            <textarea placeholder="Реплика собеседника" aria-label="Реплика собеседника" rows={Math.min(5, draft.split('\n').length)} value={draft} onChange={e => { setDraft(e.target.value); if (draftSource && draftSource.text !== e.target.value) setDraftSource(null) }} onKeyDown={e => { if (e.key === 'Enter' && !e.ctrlKey && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); addDraft() } }} />
            <IconButton title="Добавить реплику" action={addDraft} icon={<Send size={18} />} disabled={!draft.trim() || !selected} />
          </>}</div>
        </section>
        <aside className="ai-pane" aria-label={selected.kind === 'practice' ? 'Разбор ответа' : 'AI Подсказки'}><div className="pane-heading"><h2><Sparkles size={17} />{selected.kind === 'practice' ? 'Разбор ответа' : 'AI Подсказки'}</h2>{iconButton('Скопировать ответ', () => void navigator.clipboard.writeText(lastAnswer?.text || '').catch(e => setError(errorText(e))), <Copy size={17} />, !lastAnswer)}</div>
          {selected.kind !== 'practice' && questionPreview && <div className={`heard-question ${questionPreview.state}`} data-testid="heard-question" aria-live="polite">
            <div><small>{questionPreview.state === 'partial' ? 'Черновик распознавания' : questionPreview.state === 'recognized' ? 'Распознанный вопрос' : questionPreview.state === 'correction' ? 'Последнее уточнение' : questionPreview.state === 'review' ? 'Проверьте распознавание' : 'Собеседник'}</small><p>{questionPreview.text || (pendingTranscriptions ? 'Распознаю…' : 'Жду реплику собеседника')}</p></div>
            {questionPreview.text && <IconButton title="Исправить распознанную реплику" action={() => void editInterviewerPreview()} icon={<Pencil size={15} />} />}
          </div>}
          <div className="ai-tools"><button className="primary" title={liveAnswerDraft ? 'Ответить по черновику распознавания' : undefined} disabled={busy || !selected || (selected.kind === 'practice' && !practiceNeedsReview)} onClick={() => void ask(selected.kind === 'practice' ? 'review' : 'answer')}><Sparkles size={16} />{selected.kind === 'practice' ? 'Разобрать ответ' : 'Что сказать?'}</button>{selected.kind === 'practice' && <><button disabled={busy || !practiceCanContinue || practiceNeedsReview || practiceMicState !== 'idle'} onClick={() => void ask('practice-next')}>{hasPracticeScenario ? 'Уточнение' : 'Следующий вопрос'}</button>{hasPracticeScenario && <button disabled={busy || !practiceCanContinue || practiceNeedsReview || practiceMicState !== 'idle' || selectedPracticeStep >= selectedPracticeQuestionCount - 1} onClick={advancePracticeTrack}>Дальше по сценарию</button>}{hasPracticeScenario && <button disabled={!practiceCanReport} onClick={() => void ask('practice-report')}>{selected.practiceReportComplete ? 'Итоги готовы' : practiceReportAttempted ? 'Отчёт уже запрошен' : 'Итоговый разбор'}</button>}</>}{selected.kind !== 'practice' && <button disabled={busy} onClick={() => void ask('screen')}><Scan size={17} />Выделить задачу</button>}</div>
          {busy && <div className="thinking" role="status">{waitingForSpeech ? 'Распознаю вопрос…' : requestMode === 'practice-next' ? 'Готовлю уточнение…' : requestMode === 'practice-report' ? 'Собираю итог тренировки…' : 'Готовлю ответ…'}<IconButton title="Отменить подсказку" action={cancelAnswer} icon={<X size={16} />} /></div>}
          <div className="answers">{streamingAnswer?.callId === selectedId && streamingAnswer.text && <article className={`streaming-answer${streamingAnswer.status === 'partial' ? ' incomplete' : ''}`} aria-label={streamingAnswer.status === 'partial' ? 'Незавершённый ответ' : 'Ответ формируется'}>{streamingAnswer.status === 'partial' ? <small>Ответ оборвался · черновик</small> : streamingAnswer.mode === 'screen' && <small>Ответ по снимку · ещё формируется</small>}<AnswerContent text={streamingAnswer.text} /></article>}<AnswerHistory messages={selected.messages} />{!lastAnswer && !busy && streamingAnswer?.callId !== selectedId && <p className="empty">Пока нет подсказок</p>}</div>
          <footer className="model-footer"><span>{settings.model}{!settings.hasKey && <span className="key-warning"> · Ключ не сохранён</span>}</span>{timing?.callId === selectedId && formatLatencyStats(timing) && <span className="latency-stats" data-testid="latency-stats" aria-label="Время распознавания и ответа">{formatLatencyStats(timing)}</span>}</footer>
          <details className="usage-details">
            <summary>{!selected.usageTracking ? 'Расход старого звонка не записывался' : `${selected.usageTracking === 'complete' ? 'Расход звонка' : 'Частичный учёт'}: ${formatUsd(selectedUsage.knownUsd)} · ${selectedUsage.pendingCount} в процессе · ${selectedUsage.unknownCount} без цены`}</summary>
            {selected.transcriptionMode === 'local' && <p>Локальный Whisper: $0 за API-распознавание.</p>}
            {selected.transcriptionMode === 'openrouter' && <p>Облачное распознавание включено; расходы показаны отдельными операциями ниже.</p>}
            {selected.usageTracking !== 'complete' && <p>Суммы до включения учёта восстановить нельзя.</p>}
            {!!selected.usage?.length && <ul>{selected.usage.map(record => <li key={record.id}><span>{usageOperationLabels[record.operation]} · {record.provider} · {record.model}</span><small>{usageRecordStatus(record)}</small></li>)}</ul>}
            {selected.usageTracking === 'complete' && !selected.usage?.length && <p>Платных запросов пока не было.</p>}
          </details>
        </aside>
      </div>
    </section>}
    {modal && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="Настройки">
      <header><h2>Настройки</h2>{iconButton('Закрыть настройки', () => closeSettings(), <X size={18} />, saving)}</header>
        <UpdatePanel version={version} busy={updateBusy} beforeInstall={saveBeforeUpdate} />
        {!practiceOnlyBuild && <section className="privacy-settings" aria-label="Скрытый режим и запись"><h3>Скрытый режим</h3><p>Защита окна может блокировать запись OBS/NVIDIA. Для записи выключи скрытый режим кнопкой с глазом. Прозрачность оверлея работает отдельно.</p><button onClick={() => void togglePrivacy()} disabled={privacyBusy || (!protectedCapture && busy)}>{protectedCapture ? 'Выключить скрытый режим' : 'Включить скрытый режим'}</button></section>}
        <label>Ключ OpenRouter <small>{settings.hasKey ? 'Сохранён на этом компьютере' : 'Не сохранён'}</small><input type="password" autoComplete="off" value={configDraft.apiKey} placeholder={settings.hasKey ? 'Новый ключ (необязательно)' : 'Ключ OpenRouter'} onChange={e => { setModelTestArmed(false); setConfigDraft({ ...configDraft, apiKey: e.target.value }) }} /></label>
        <label>Модель<input list="model-catalog" value={configDraft.model} onChange={e => { setModelTestArmed(false); setConfigDraft({ ...configDraft, model: e.target.value }) }} /></label>
        <datalist id="model-catalog">{models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</datalist>
        <div className="preset-buttons">{presets.map(m => <button className={configDraft.model === m.id ? 'selected' : ''} key={m.id} onClick={() => { setModelTestArmed(false); setConfigDraft({ ...configDraft, model: m.id }) }}>{m.name}</button>)}</div>
        {modelInfo?.pricing && <p className="price">За 1 млн токенов: ввод ${Number(modelInfo.pricing.prompt) * 1_000_000}, вывод ${Number(modelInfo.pricing.completion) * 1_000_000}{modelInfo.modalities?.includes('image') ? ' · Поддерживает картинки' : ''}</p>}
        {practiceOnlyBuild && <section className="model-test" aria-label="Проверка модели">
          <h3>Проверить выбранную модель</h3>
          <p>Один короткий разбор. Ответ ограничен 220 токенами; автоповтора и запасной модели не будет. Если провайдер вернёт стоимость, она появится в истории.</p>
          <div>
            <button onClick={testSelectedModel} disabled={!settings.hasKey || !ready || busy || Boolean(liveCallId) || practiceMicState !== 'idle' || Boolean(configDraft.apiKey.trim()) || configDraft.model !== settings.model || configDraft.baseUrl !== settings.baseUrl}>{modelTestArmed ? 'Отправить один запрос' : 'Подготовить проверку'}</button>
            {modelTestArmed && <button onClick={() => setModelTestArmed(false)} disabled={busy}>Отмена</button>}
          </div>
          {!settings.hasKey && <small>Сначала сохрани ключ OpenRouter.</small>}
          {(configDraft.model !== settings.model || configDraft.baseUrl !== settings.baseUrl || configDraft.apiKey.trim()) && <small>Сначала сохрани изменения настроек.</small>}
        </section>}
        {practiceOnlyBuild && <label>Тема тренировки<select value={configDraft.practiceProfile} onChange={e => setConfigDraft({ ...configDraft, practiceProfile: e.target.value as Settings['practiceProfile'] })}><option value="devops">DevOps</option><option value="support">Technical Support</option></select></label>}
        <label>Микрофон<select value={configDraft.microphoneId} disabled={phase !== 'idle' || audioDiagnostic.state !== 'idle'} onChange={e => setConfigDraft({ ...configDraft, microphoneId: e.target.value })}><option value="default">По умолчанию Windows</option>{devices.filter(d => d.deviceId !== 'default' && d.deviceId !== 'communications').map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Микрофон ${i + 1}`}</option>)}</select></label>
        <section className="audio-diagnostic" aria-label="Проверка микрофона и системного звука">
          <h3>Проверка звука</h3>
          <p>Скажи фразу в микрофон и включи речь через этот компьютер. Результат и задержка будут показаны отдельно для двух источников.</p>
          <div className="audio-diagnostic-controls">
            <button type="button" onClick={() => audioDiagnostic.state === 'warming' || audioDiagnostic.state === 'recording' ? void stopAudioDiagnostic() : void startAudioDiagnostic()} disabled={audioDiagnostic.state === 'processing' || phase !== 'idle' || Boolean(liveCallId) || busy || practiceMicState !== 'idle'}>
              {audioDiagnostic.state === 'warming' ? 'Отменить' : audioDiagnostic.state === 'recording' ? 'Остановить и распознать' : audioDiagnostic.state === 'processing' ? 'Распознаю…' : 'Начать проверку'}
            </button>
            {audioDiagnostic.state !== 'idle' && <span>{audioDiagnostic.state === 'warming' ? 'Запускаю локальную модель и источники…' : audioDiagnostic.state === 'recording' ? 'Говори в микрофон и включи речь на компьютере' : 'Обрабатываю обе дорожки…'}</span>}
          </div>
          <div className="audio-diagnostic-sources">
            {([['me', 'Микрофон'], ['interviewer', 'Звук компьютера']] as const).map(([source, title]) => (
              <div className="audio-diagnostic-source" key={source}>
                <div className="audio-diagnostic-source-heading"><strong>{title}</strong><span>{audioDiagnostic.sources[source].active ? audioDiagnostic.sources[source].message : 'Не подключён'}{audioDiagnostic.state === 'recording' && <meter min="0" max="1" value={audioDiagnostic.sources[source].level} aria-label={`Уровень: ${title}`} />}</span></div>
                {(audioDiagnostic.text[source] || (source === 'interviewer' && audioDiagnostic.draft)) && <p aria-live="polite">{[audioDiagnostic.text[source], source === 'interviewer' ? audioDiagnostic.draft : ''].filter(Boolean).join(' ')}</p>}
                {audioDiagnostic.latency[source] && <small>{formatLatencyStats(audioDiagnostic.latency[source]!)}</small>}
              </div>
            ))}
          </div>
          <small>Аудио не сохраняется и не отправляется в OpenRouter. Распознавание выполняется локально.</small>
          {audioDiagnostic.error && <p className="audio-diagnostic-error" role="alert">{audioDiagnostic.error}</p>}
        </section>
        <label>Распознавание речи<select value={configDraft.transcriptionMode} disabled={phase !== 'idle'} onChange={e => setConfigDraft({ ...configDraft, transcriptionMode: e.target.value as Settings['transcriptionMode'] })}><option value="local">Локально · бесплатно</option><option value="openrouter">OpenRouter · платно</option></select></label>
        {localSpeech?.gpuSupported && <section aria-label="Ускорение распознавания NVIDIA"><h3>NVIDIA</h3>
          <p>{localSpeech.cudaInstalled ? 'GPU-пакет установлен' : 'Необязательный пакет ускорения · загрузка около 720 МБ · на диске около 1,23 ГБ'}</p>
          {!localSpeech.cudaInstalled && <button onClick={() => void installGpuSpeech()} disabled={installingGpu || phase !== 'idle' || audioDiagnostic.state !== 'idle' || practiceMicState !== 'idle'}><Download size={16} />{installingGpu ? 'Загрузка…' : 'Скачать GPU-пакет'}</button>}
          {installingGpu && <button onClick={() => void window.sobesych?.cancelGpuSpeech()}><X size={16} />Отменить загрузку</button>}
        </section>}
        <details><summary>Дополнительно</summary><label>Адрес модели<input value={configDraft.baseUrl} onChange={e => { setModelTestArmed(false); setConfigDraft({ ...configDraft, baseUrl: e.target.value }) }} /></label>{configDraft.transcriptionMode === 'openrouter' && <><label>Адрес распознавания<input value={configDraft.transcriptionBaseUrl} onChange={e => setConfigDraft({ ...configDraft, transcriptionBaseUrl: e.target.value })} /></label><label>Модель распознавания<input value={configDraft.transcriptionModel} onChange={e => setConfigDraft({ ...configDraft, transcriptionModel: e.target.value })} /></label></>}<label>Язык<select value={configDraft.language} onChange={e => setConfigDraft({ ...configDraft, language: e.target.value })}><option value="auto">Авто: русский и английский</option><option value="ru">Русский</option><option value="en">English</option></select></label></details>
        <footer><a href="https://openrouter.ai/settings/credits" target="_blank" rel="noreferrer">Баланс OpenRouter</a><button onClick={() => void window.sobesych!.openLogs().then(r => { if (r.error) setError(r.error) })}>Логи</button><button onClick={() => closeSettings()} disabled={saving}>Отмена</button><button className="primary" onClick={() => void saveSettings()} disabled={saving || audioDiagnostic.state !== 'idle'}>{saving ? 'Сохраняю…' : 'Сохранить'}</button></footer>
    </section></div>}
    {deleteId && <div className="modal-backdrop"><section className="modal confirm" role="dialog" aria-modal="true" aria-label="Удалить звонок"><h2>Удалить звонок?</h2><footer><button onClick={() => setDeleteId(null)}>Отмена</button><button className="danger" onClick={() => { commit({ ...dataRef.current, calls: dataRef.current.calls.filter(c => c.id !== deleteId) }); if (selectedId === deleteId) choose(null); setDeleteId(null) }}>Удалить</button></footer></section></div>}
    {deletePracticeLibraryId && <div className="modal-backdrop"><section className="modal confirm" role="dialog" aria-modal="true" aria-label="Удалить подборку вопросов"><h2>Удалить сохранённую подборку?</h2><p>Удалится этот набор. Уже начатые тренировки останутся в истории, а исходные TXT не затрагиваются.</p><footer><button onClick={() => setDeletePracticeLibraryId('')} disabled={practiceLibrarySaving}>Отмена</button><button className="danger" onClick={() => void confirmDeletePracticeLibrary()} disabled={practiceLibrarySaving}>{practiceLibrarySaving ? 'Удаляю…' : 'Удалить'}</button></footer></section></div>}
  </main>
}
export default App
