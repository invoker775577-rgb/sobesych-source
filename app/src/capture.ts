import { encodeWav, SpeechSegmenter } from './audio.mjs'
import { isTranscriptNoise } from './transcript.mjs'
import { createVoiceDetector } from './voice-detector.mjs'
import type { VoiceDetector } from './voice-detector.mjs'
import type { ProviderUsage } from './usage.mjs'
import workletUrl from './pcm-worklet.js?url'
export type Source = 'me' | 'interviewer'
export type AudioStatus = { active: boolean; level: number; message: string }
type RecognitionLatency = { speechToTextMs: number; speechDurationMs: number; afterSpeechMs: number; processingMs: number; queueMs: number; transcriptionMs: number }
export type CaptureStartResult = { microphone: boolean; interviewer: boolean; interviewerError?: string }
type Options = {
  microphoneId: string
  microphoneEnabled?: boolean
  previewEnabled?: boolean
  transcriptionTimeoutMs?: number
  onStatus: (source: Source, status: AudioStatus) => void
  onPartial?: (source: Source, text: string, createdAt: string, latency: RecognitionLatency) => void
  onText: (source: Source, text: string, createdAt: string, latency: RecognitionLatency) => void
  onError: (message: string) => void
  onPending: (count: number) => void
  localOnly?: boolean
  createVoiceDetector?: (sampleRate: number) => Promise<VoiceDetector>
  transcribe: (audio: string, localOnly?: boolean, signal?: AbortSignal, provisional?: boolean, source?: Source) => Promise<{ text?: string; error?: string; model?: string; usage?: ProviderUsage }>
}
type Segment = { source: Source; kind: 'preview' | 'final'; sourceStopped: AbortSignal; utteranceId: number | null; audio: string; createdAt: string; speechStartedAt: number; speechEndedAt: number; queuedAt: number; finish: (error?: string) => void }
type Job = { source: Source; kind: Segment['kind'] }

function audioErrorCode(error: unknown) {
  const name = error && typeof error === 'object' && 'name' in error ? error.name : ''
  const names = ['NotReadableError', 'NotAllowedError', 'SecurityError', 'NotFoundError', 'AbortError', 'InvalidStateError', 'NotSupportedError']
  return typeof name === 'string' && names.includes(name) ? name : /Could not start audio source/i.test(String(error)) ? 'NotReadableError' : 'other'
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => { cleanup(); reject(signal.reason) }
    const cleanup = () => signal.removeEventListener('abort', aborted)
    if (signal.aborted) { reject(signal.reason); return }
    signal.addEventListener('abort', aborted, { once: true })
    promise.then(value => { cleanup(); resolve(value) }, error => { cleanup(); reject(error) })
  })
}
export class CaptureSession {
  private closed = false
  private streams: MediaStream[] = []
  private contexts: AudioContext[] = []
  private voiceDetectors = new Set<VoiceDetector>()
  private queue: Segment[] = []
  private jobs = new Map<Promise<string | undefined>, Job>()
  private activeTranscriptions = new Map<Source, { kind: Segment['kind']; controller: AbortController; preempted: boolean }>()
  private flushers = new Map<Source, (signal: AbortSignal) => Promise<void>>()
  private stopped = new AbortController()
  private interviewerStart: Promise<boolean> = Promise.resolve(false)
  private interviewerError = ''
  private starting = false
  private systemStartRetryable = false
  private interviewerBuffered = false
  private finalizedInterviewerUtterance = 0
  private pending = new Set<Source>()
  private localDrainRunning = false
  private micEnabled = true
  private micPending = false
  private microphoneReady = false
  private overflowReported = false
  private options: Options
  constructor(options: Options) { this.options = options; this.micEnabled = options.microphoneEnabled !== false }
  hasPendingInterviewer() {
    return this.interviewerBuffered || this.pending.has('interviewer') || this.queue.some(item => item.source === 'interviewer')
  }
  private reportOverflow(message: string) {
    if (!this.overflowReported) this.options.onError(message)
    this.overflowReported = true
  }
  setMicrophoneEnabled(enabled: boolean) {
    if (this.closed) return
    this.micEnabled = enabled
    const microphones = this.streams.filter(s => !s.getVideoTracks().length)
    microphones.forEach(s => s.getAudioTracks().forEach(t => { t.enabled = enabled }))
    const live = microphones.some(s => s.getAudioTracks().some(t => t.readyState === 'live'))
    this.options.onStatus('me', { active: enabled && live, level: 0, message: enabled ? live ? 'Микрофон' : 'Подключение…' : 'Микрофон выключен' })
    if (enabled && !live) void this.attachMicrophone()
  }
  private openMicrophone() {
    const audio = this.options.microphoneId === 'default' ? true : { deviceId: { exact: this.options.microphoneId } }
    return navigator.mediaDevices.getUserMedia({ audio }).catch(error => {
      if (audio !== true && ['NotFoundError', 'OverconstrainedError'].includes(error.name)) return navigator.mediaDevices.getUserMedia({ audio: true })
      throw error
    })
  }
  private async attachMicrophone() {
    if (this.closed) return false
    if (this.micPending) return this.microphoneReady
    this.micPending = true
    try {
      this.microphoneReady = await this.attach('me', this.openMicrophone())
      return this.microphoneReady
    } finally { this.micPending = false }
  }
  private async openSystemAudio() {
    this.systemStartRetryable = false
    const checked = (stream: MediaStream) => {
      if (!this.closed && stream.getAudioTracks().some(track => track.readyState === 'live')) {
        this.systemStartRetryable = false
        return stream
      }
      stream.getTracks().forEach(track => track.stop())
      throw new Error(this.closed ? 'Сессия закрыта' : 'Источник не содержит работающей звуковой дорожки')
    }
    const failed = (stage: string, error: unknown) => {
      this.systemStartRetryable ||= audioErrorCode(error) === 'NotReadableError'
      this.traceSystemAudio(stage, error)
    }
    if (this.closed) throw new Error('Сессия закрыта')
    try {
      this.traceSystemAudio('display')
      // Loopback should not use microphone echo cancellation or noise removal.
      return checked(await navigator.mediaDevices.getDisplayMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: { frameRate: 1 },
      }))
    } catch (error) {
      failed('display-failed', error)
      if (this.closed || ['NotAllowedError', 'SecurityError'].includes(audioErrorCode(error))) throw error
    }
    if (this.closed) throw new Error('Сессия закрыта')
    try {
      this.traceSystemAudio('desktop')
      const source = await window.sobesych?.getAudioSourceId()
      if (this.closed) throw new Error('Сессия закрыта')
      if (!source?.sourceId) throw new Error(source?.error || 'Экран для захвата звука не найден')
      return checked(await navigator.mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: 'desktop' }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } as MediaTrackConstraints,
        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: source.sourceId } } as MediaTrackConstraints,
      }))
    } catch (error) {
      failed('desktop-failed', error)
      if (['NotAllowedError', 'SecurityError'].includes(audioErrorCode(error))) {
        this.systemStartRetryable = false
        throw error
      }
      if (this.systemStartRetryable && !this.closed) throw new Error('Windows не запустила системный звук (NotReadableError). Проверь устройство вывода по умолчанию и отключи звуковые улучшения USB-наушников в Windows. Затем нажми «Начать звонок» ещё раз.')
      throw error
    }
  }
  private traceSystemAudio(stage: string, error?: unknown) {
    const code = error === undefined ? 'none' : audioErrorCode(error)
    const trace = window.sobesych?.traceAudioCapture?.({ stage, code })
    if (trace) void trace.catch(() => {})
  }
  async start() {
    if (this.closed) return { microphone: false, interviewer: false } satisfies CaptureStartResult
    this.starting = true
    try {
      this.interviewerStart = this.attach('interviewer', this.openSystemAudio(), false)
      if (!this.micEnabled) this.options.onStatus('me', { active: false, level: 0, message: 'Микрофон выключен' })
      const [microphone, firstInterviewer] = await Promise.all([this.micEnabled ? this.attachMicrophone() : false, this.interviewerStart])
      let interviewer = firstInterviewer && this.flushers.has('interviewer')
      // A USB render endpoint may reset even after loopback initially opened.
      if (firstInterviewer && !interviewer) this.systemStartRetryable = true
      if (!interviewer && this.systemStartRetryable && !this.closed) {
        this.traceSystemAudio('retry')
        try {
          await abortable(new Promise(resolve => setTimeout(resolve, 150)), this.stopped.signal)
          if (!this.closed) {
            this.interviewerStart = this.attach('interviewer', this.openSystemAudio(), false)
            interviewer = await this.interviewerStart
          }
        } catch { /* Stop cancels the bounded retry. */ }
      }
      if (!this.closed) {
        this.traceSystemAudio(interviewer ? 'ready' : 'failed')
        if (!interviewer) this.options.onError(`Системный звук не подключён: ${this.interviewerError}`)
      }
      if (this.closed) return { microphone: false, interviewer: false } satisfies CaptureStartResult
      return { microphone, interviewer, interviewerError: this.interviewerError || undefined } satisfies CaptureStartResult
    } finally { this.starting = false }
  }
  async startMicrophoneOnly() {
    await this.attachMicrophone()
    if (!this.streams.some(stream => stream.getAudioTracks().some(track => track.readyState === 'live'))) {
      throw new Error('Не удалось подключить микрофон')
    }
  }
  async stopMicrophoneOnly() {
    if (this.closed) return []
    try {
      const flush = this.flushers.get('me')
      if (flush) {
        const deadline = new AbortController()
        const timer = setTimeout(() => deadline.abort(new Error('Не удалось завершить запись микрофона')), 5000)
        try { await flush(deadline.signal) } finally { clearTimeout(timer) }
      }
      const jobs = [...this.jobs].filter(([, job]) => job.source === 'me' && job.kind === 'final').map(([promise]) => promise)
      return (await Promise.all(jobs)).filter((error): error is string => Boolean(error))
    } finally { this.stop() }
  }
  async stopAndFlushAll(timeoutMs = 6000) {
    if (this.closed) return []
    const deadline = new AbortController()
    const timer = setTimeout(() => deadline.abort(new Error('Не удалось завершить проверку звука')), timeoutMs)
    const signal = AbortSignal.any([this.stopped.signal, deadline.signal])
    try {
      await abortable(this.interviewerStart, signal)
      for (const source of ['me', 'interviewer'] as const) {
        const flush = this.flushers.get(source)
        if (flush) await flush(signal)
      }
      const jobs = [...this.jobs].filter(([, job]) => job.kind === 'final').map(([promise]) => promise)
      return (await abortable(Promise.all(jobs), signal)).filter((error): error is string => Boolean(error))
    } finally {
      clearTimeout(timer)
      this.stop()
    }
  }
  async flushPending(signal: AbortSignal, timeoutMs = 6000) {
    const deadline = new AbortController()
    const timer = setTimeout(() => deadline.abort(new Error('Распознавание вопроса не завершилось. Дождись текста и нажми ещё раз или введи вопрос вручную.')), timeoutMs)
    const combined = AbortSignal.any([signal, this.stopped.signal, deadline.signal])
    try {
      await abortable(this.interviewerStart, combined)
      if (!this.flushers.has('interviewer')) throw new Error('Звук собеседника ещё не подключён. Дождись подключения или введи вопрос вручную.')
      // Worklet acknowledgements include the PCM tail not yet delivered to the renderer.
      await this.flushers.get('interviewer')!(combined)
      const interviewerJobs = [...this.jobs].filter(([, job]) => job.source === 'interviewer' && job.kind === 'final').map(([job]) => job)
      const errors = await abortable(Promise.all(interviewerJobs), combined)
      const error = errors.find(Boolean) || this.interviewerError
      if (error) throw new Error(`Вопрос распознан не полностью: ${error}. Введи его вручную или повтори реплику.`)
    } finally { clearTimeout(timer) }
  }
  private async attach(source: Source, promise: Promise<MediaStream>, reportErrors = true): Promise<boolean> {
    let stream: MediaStream | undefined
    let context: AudioContext | undefined
    let voiceDetector: VoiceDetector | undefined
    try {
      stream = await abortable<MediaStream>(promise.then(value => {
        if (this.closed) value.getTracks().forEach(track => track.stop())
        return value
      }), this.stopped.signal)
      if (this.closed) { stream.getTracks().forEach(t => t.stop()); return false }
      this.streams.push(stream)
      if (!stream.getAudioTracks().length) throw new Error('Источник не содержит звука')
      if (source === 'me') stream.getAudioTracks().forEach(t => { t.enabled = this.micEnabled })
      context = new AudioContext()
      this.contexts.push(context)
      await context.audioWorklet.addModule(workletUrl)
      if (this.closed) return false
      if (this.options.localOnly === true) {
        voiceDetector = await (this.options.createVoiceDetector || createVoiceDetector)(context.sampleRate)
        if (this.closed) { voiceDetector.destroy(); return false }
        this.voiceDetectors.add(voiceDetector)
      }
      const sourceStopped = new AbortController()
      const enqueue = (samples: Float32Array, utteranceId: number | null, kind: Segment['kind'], speechStartedAt: number, speechEndedAt: number) => {
        if (this.closed || sourceStopped.signal.aborted || (source === 'me' && !this.micEnabled)) return
        if (source === 'interviewer' && (this.options.previewEnabled || this.options.localOnly === true)) {
          const microphone = this.activeTranscriptions.get('me')
          if (microphone?.kind === 'final' && !microphone.preempted) {
            microphone.preempted = true
            microphone.controller.abort()
          }
        }
        if (kind === 'final') {
          const active = this.activeTranscriptions.get(source)
          if (active?.kind === 'preview') active.controller.abort()
        }
        const bytes = encodeWav(samples, context!.sampleRate)
        let binary = ''
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
        for (let index = this.queue.length - 1; index >= 0; index--) {
          const queued = this.queue[index]
          if (queued.source === source && queued.kind === 'preview' && queued.utteranceId === utteranceId) {
            this.queue.splice(index, 1)
            queued.finish()
          }
        }
        if (kind === 'preview' && this.queue.length >= 20) return
        if (this.queue.length >= 20) {
          const previewIndex = this.queue.findIndex(item => item.kind === 'preview')
          const microphoneIndex = this.queue.findIndex(item => item.source === 'me')
          if (previewIndex < 0 && microphoneIndex < 0 && source === 'me') {
            this.reportOverflow('Распознавание отстаёт: фрагмент микрофона пропущен, вопросы собеседника сохранены')
            return
          }
          const lost = this.queue.splice(previewIndex >= 0 ? previewIndex : microphoneIndex >= 0 ? microphoneIndex : 0, 1)[0]
          const error = 'Распознавание отстаёт: один фрагмент пропущен'
          if (lost.kind === 'final') {
            if (lost.source === 'interviewer') this.interviewerError = error
            lost.finish(error); this.reportOverflow(error)
          } else lost.finish()
        }
        let finish!: Segment['finish']
        const job = new Promise<string | undefined>(resolve => { finish = resolve })
        this.jobs.set(job, { source, kind })
        void job.then(() => this.jobs.delete(job))
        this.queue.push({ source, kind, sourceStopped: sourceStopped.signal, utteranceId, audio: `data:audio/wav;base64,${btoa(binary)}`, createdAt: new Date().toISOString(), speechStartedAt, speechEndedAt, queuedAt: performance.now(), finish })
        this.options.onPending(this.queue.length + this.pending.size)
        void this.drain(source)
      }
      const onPreview = this.options.previewEnabled && source === 'interviewer'
        ? (samples: Float32Array, utteranceId: number, speechStartedAt: number, speechEndedAt: number) => enqueue(samples, utteranceId, 'preview', speechStartedAt, speechEndedAt)
        : undefined
      const segmenter = new SpeechSegmenter(context.sampleRate,
        (samples, utteranceId, speechStartedAt, speechEndedAt) => enqueue(samples, utteranceId, 'final', speechStartedAt, speechEndedAt),
        {
          endSilenceSeconds: source === 'interviewer' ? 0.45 : 0.3,
          ...(voiceDetector ? { detectSpeech: voiceDetector.detectSpeech } : {}),
          ...(onPreview ? { previewAfterSeconds: 0.5, previewEverySeconds: 0.5, onPreview } : {}),
        })
      const input = context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()))
      const node = new AudioWorkletNode(context, 'pcm-collector')
      const acknowledgements = new Map<string, () => void>()
      const flushSource = async (signal: AbortSignal) => {
        const id = crypto.randomUUID()
        try {
          await abortable(new Promise<void>(resolve => {
            acknowledgements.set(id, resolve)
            node.port.postMessage({ type: 'flush', id })
          }), AbortSignal.any([signal, sourceStopped.signal]))
        } finally { acknowledgements.delete(id) }
      }
      this.flushers.set(source, flushSource)
      const mute = context.createGain(); mute.gain.value = 0
      let lastStatus = 0
      node.port.onmessage = event => {
        if (this.closed || sourceStopped.signal.aborted) return
        if (event.data?.type === 'flushed') {
          if (source !== 'me' || this.micEnabled) segmenter.flush()
          if (source === 'interviewer') this.interviewerBuffered = false
          acknowledgements.get(event.data.id)?.()
          return
        }
        if (source === 'me' && !this.micEnabled) { segmenter.reset(); return }
        const level = segmenter.push(event.data)
        if (source === 'interviewer') this.interviewerBuffered = segmenter.hasBufferedSpeech()
        if (performance.now() - lastStatus > 100) {
          lastStatus = performance.now()
          this.options.onStatus(source, { active: true, level, message: source === 'me' ? 'Микрофон' : 'Звук собеседника' })
        }
      }
      input.connect(node).connect(mute).connect(context.destination)
      await context.resume()
      if (this.closed) return false
      const ended = () => {
        if (this.closed || sourceStopped.signal.aborted) return
        const message = source === 'me' ? 'Микрофон отключён' : 'Источник звука отключён'
        sourceStopped.abort(new Error(message))
        for (let index = this.queue.length - 1; index >= 0; index--) {
          if (this.queue[index].sourceStopped === sourceStopped.signal) this.queue.splice(index, 1)[0].finish(message)
        }
        if (this.flushers.get(source) === flushSource) this.flushers.delete(source)
        if (voiceDetector && this.voiceDetectors.delete(voiceDetector)) voiceDetector.destroy()
        if (source === 'me') this.microphoneReady = false
        else { this.interviewerBuffered = false; this.interviewerError = message; if (!this.starting) this.options.onError(message) }
        node.port.onmessage = null
        stream!.getTracks().forEach(track => { track.onended = null; track.stop() })
        this.streams = this.streams.filter(item => item !== stream)
        this.contexts = this.contexts.filter(item => item !== context)
        if (context!.state !== 'closed') void context!.close().catch(() => {})
        this.options.onStatus(source, { active: false, level: 0, message })
        this.options.onPending(this.queue.length + this.pending.size)
      }
      stream.getTracks().forEach(track => { track.onended = ended })
      if (stream.getTracks().some(track => track.readyState === 'ended')) { ended(); return false }
      if (source === 'interviewer') this.interviewerError = ''
      this.options.onStatus(source, { active: source !== 'me' || this.micEnabled, level: 0, message: source === 'me' ? this.micEnabled ? 'Микрофон' : 'Микрофон выключен' : 'Звук собеседника' })
      return true
    } catch (error) {
      if (voiceDetector) { this.voiceDetectors.delete(voiceDetector); voiceDetector.destroy() }
      this.flushers.delete(source)
      stream?.getTracks().forEach(t => t.stop())
      if (context && context.state !== 'closed') await context.close().catch(() => {})
      this.streams = this.streams.filter(s => s !== stream)
      this.contexts = this.contexts.filter(c => c !== context)
      if (!this.closed) {
        const detail = error instanceof Error ? error.message : String(error)
        this.options.onStatus(source, { active: false, level: 0, message: `${source === 'me' ? 'Микрофон' : 'Звук собеседника'}: ${detail}` })
        if (source === 'interviewer') this.interviewerError = detail
        if (reportErrors) this.options.onError(`${source === 'me' ? 'Микрофон' : 'Системный звук'} не подключён: ${detail}`)
      }
      return false
    }
  }
  private async transcribeSegment(item: Segment): Promise<boolean> {
    const controller = new AbortController()
    const deadline = new AbortController()
    const timer = setTimeout(() => deadline.abort(new Error('Распознавание фрагмента превысило время ожидания. Следующие реплики продолжат обрабатываться.')), this.options.transcriptionTimeoutMs ?? 65_000)
    const signal = AbortSignal.any([controller.signal, deadline.signal, item.sourceStopped, this.stopped.signal])
    const active = { kind: item.kind, controller, preempted: false }
    let retry = false
    this.activeTranscriptions.set(item.source, active)
    try {
      const transcriptionStartedAt = performance.now()
      const result = await abortable(this.options.transcribe(item.audio, this.options.localOnly === true, signal, item.kind === 'preview', item.source), signal)
      if (this.closed || signal.aborted) {
        retry = active.preempted && !this.closed && !item.sourceStopped.aborted
        return retry
      }
      if (result.error) throw new Error(result.error)
      const completedAt = performance.now()
      const latency = {
        speechToTextMs: Math.max(0, Math.round(completedAt - item.speechStartedAt)),
        speechDurationMs: Math.max(0, Math.round(item.speechEndedAt - item.speechStartedAt)),
        afterSpeechMs: Math.max(0, Math.round(completedAt - item.speechEndedAt)),
        processingMs: Math.max(0, Math.round(completedAt - item.queuedAt)),
        queueMs: Math.max(0, Math.round(transcriptionStartedAt - item.queuedAt)),
        transcriptionMs: Math.max(0, Math.round(completedAt - transcriptionStartedAt)),
      }
      if (result.text?.trim() && !isTranscriptNoise(result.text)) {
        if (item.kind === 'preview') {
          if (item.source === 'interviewer' && (item.utteranceId || 0) > this.finalizedInterviewerUtterance) {
            this.options.onPartial?.(item.source, result.text.trim(), item.createdAt, latency)
          }
        } else {
          if (item.source === 'interviewer' && item.utteranceId) this.finalizedInterviewerUtterance = Math.max(this.finalizedInterviewerUtterance, item.utteranceId)
          this.options.onText(item.source, result.text.trim(), item.createdAt, latency)
          if (item.source === 'interviewer') this.interviewerError = ''
        }
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      if (active.preempted && !this.closed && !item.sourceStopped.aborted) {
        retry = true
        return retry
      }
      if (!this.closed && (!signal.aborted || deadline.signal.aborted) && item.kind === 'final') {
        if (item.source === 'interviewer') this.interviewerError = detail
        this.options.onError(detail)
      }
      item.finish(item.kind === 'final' && (!signal.aborted || !this.closed && (item.sourceStopped.aborted || deadline.signal.aborted)) ? detail : undefined)
    } finally {
      clearTimeout(timer)
      if (this.activeTranscriptions.get(item.source)?.controller === controller) this.activeTranscriptions.delete(item.source)
      if (!retry) item.finish()
    }
    return retry
  }
  private async drainLocal() {
    if (this.localDrainRunning || this.closed) return
    this.localDrainRunning = true
    try {
      while (!this.closed && this.queue.length) {
        if (this.queue.length < 10) this.overflowReported = false
        let index = this.queue.findIndex(item => item.source === 'interviewer' && item.kind === 'final')
        if (index < 0) index = this.queue.findIndex(item => item.source === 'interviewer' && item.kind === 'preview')
        if (index < 0) index = this.queue.findIndex(item => item.kind === 'final')
        if (index < 0) break
        const [item] = this.queue.splice(index, 1)
        this.pending.add(item.source)
        this.options.onPending(this.queue.length + this.pending.size)
        const retry = await this.transcribeSegment(item)
        if (retry && !this.closed && !item.sourceStopped.aborted) {
          const nextCandidate = this.queue.findIndex(queued => queued.source === item.source && queued.kind === 'final' && queued.speechStartedAt > item.speechStartedAt)
          this.queue.splice(nextCandidate < 0 ? this.queue.length : nextCandidate, 0, item)
        } else if (retry) item.finish(this.closed ? 'Сессия закрыта' : item.sourceStopped.reason instanceof Error ? item.sourceStopped.reason.message : 'Источник звука отключён')
        this.pending.delete(item.source)
        if (!this.closed) this.options.onPending(this.queue.length + this.pending.size)
      }
    } finally {
      this.localDrainRunning = false
      if (!this.closed && this.queue.length) void this.drainLocal()
    }
  }
  private async drain(source: Source) {
    if (this.options.previewEnabled || this.options.localOnly === true) {
      await this.drainLocal()
      return
    }
    if (this.pending.has(source) || this.closed) return
    this.pending.add(source)
    try {
      // One in-flight request per source preserves its order without blocking the other.
      while (!this.closed) {
        if (this.queue.length < 10) this.overflowReported = false
        const index = this.queue.findIndex(item => item.source === source)
        if (index === -1) break
        const [item] = this.queue.splice(index, 1)
        this.options.onPending(this.queue.length + this.pending.size)
        await this.transcribeSegment(item)
      }
    } finally {
      this.pending.delete(source)
      if (!this.closed) this.options.onPending(this.queue.length + this.pending.size)
    }
  }
  stop() {
    if (this.closed) return
    this.closed = true; this.stopped.abort(); this.flushers.clear(); this.interviewerBuffered = false
    for (const { controller } of this.activeTranscriptions.values()) controller.abort()
    this.activeTranscriptions.clear()
    for (const detector of this.voiceDetectors) detector.destroy()
    this.voiceDetectors.clear()
    this.queue.forEach(item => item.finish('Сессия закрыта')); this.queue = []
    this.options.onPending(0)
    this.streams.forEach(s => s.getTracks().forEach(t => t.stop()))
    this.contexts.forEach(c => { if (c.state !== 'closed') void c.close().catch(() => {}) })
    this.streams = []; this.contexts = []
  }
}
