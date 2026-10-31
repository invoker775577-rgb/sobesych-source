const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const { spawn } = require('node:child_process')
const os = require('node:os')

const vocabularyHint = 'Обсуждаем SQL JOIN, INNER JOIN и LEFT JOIN, Greenplum и PostgreSQL. Техническое собеседование. Kubernetes, Docker, Terraform, Ansible Vault, Kafka, gRPC.'

function shouldUseLocalTranscription(forceLocal, transcriptionMode) {
  return forceLocal === true || transcriptionMode === 'local'
}

function audioDiagnostics(wav) {
  let format
  for (let offset = 12; offset + 8 <= wav.length;) {
    const name = wav.toString('ascii', offset, offset + 4)
    const size = wav.readUInt32LE(offset + 4)
    const start = offset + 8
    if (start + size > wav.length) return {}
    if (name === 'fmt ' && size >= 16) format = {
      pcm: wav.readUInt16LE(start), channels: wav.readUInt16LE(start + 2),
      rate: wav.readUInt32LE(start + 4), bits: wav.readUInt16LE(start + 14),
    }
    if (name === 'data' && format?.pcm === 1 && format.bits === 16 && format.rate > 0 && format.channels > 0 && size >= 2) {
      let squares = 0; let peak = 0; let clipped = 0
      const count = Math.floor(size / 2)
      for (let index = 0; index < count; index++) {
        const value = Math.abs(wav.readInt16LE(start + index * 2)) / 32768
        squares += value * value
        peak = Math.max(peak, value)
        if (value >= 0.999) clipped++
      }
      const db = value => Math.round(Math.max(-120, 20 * Math.log10(value)) * 10) / 10
      return { durationMs: Math.round(count * 1000 / format.channels / format.rate), rmsDb: db(Math.sqrt(squares / count)), peakDb: db(peak), clippedFraction: clipped / count }
    }
    offset = start + size + size % 2
  }
  return {}
}

function formatTranscriptionTrace(input = {}, diagnostics = {}) {
  const trace = { source: ['me', 'interviewer'].includes(input.source) ? input.source : 'unknown', kind: input.provisional === true ? 'preview' : 'final' }
  if (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(input.requestId || '')) trace.requestId = input.requestId
  if (['cpu', 'cuda'].includes(diagnostics.backend)) trace.backend = diagnostics.backend
  if (/^[a-z]{2,16}$/.test(diagnostics.language || '')) trace.language = diagnostics.language
  for (const [key, min, max] of [['durationMs', 0, 600_000], ['rmsDb', -120, 0], ['peakDb', -120, 0], ['clippedFraction', 0, 1], ['avgLogprob', -100, 0], ['noSpeechProb', 0, 1]]) {
    if (Number.isFinite(diagnostics[key])) trace[key] = Math.round(Math.min(max, Math.max(min, diagnostics[key])) * 1000) / 1000
  }
  return JSON.stringify(trace)
}

function warmupAudio() {
  const sampleCount = 8000
  const wav = Buffer.alloc(44 + sampleCount * 2)
  wav.write('RIFF', 0, 'ascii'); wav.writeUInt32LE(36 + sampleCount * 2, 4); wav.write('WAVE', 8, 'ascii')
  wav.write('fmt ', 12, 'ascii'); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
  wav.write('data', 36, 'ascii'); wav.writeUInt32LE(sampleCount * 2, 40)
  return `data:audio/wav;base64,${wav.toString('base64')}`
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
  })
}

function createLocalStt(directory, bundledRoot, options = {}) {
  const roots = [...new Set([bundledRoot, path.join(directory, 'local-stt'), options.cpuRoot].filter(Boolean))]
  const find = (backend, modelName) => {
    const model = roots.map(root => path.join(root, modelName)).find(file => fs.existsSync(file))
    if (!model) return null
    for (const root of roots) {
      const exe = path.join(root, backend, 'Release', 'whisper-server.exe')
      const libraries = backend === 'cuda' ? ['cublas64_11.dll', 'cublasLt64_11.dll', 'ggml-cuda.dll', 'ggml.dll', 'ggml-base.dll', 'whisper.dll', 'cudart64_110.dll'] : []
      if (fs.existsSync(exe) && libraries.every(name => fs.existsSync(path.join(path.dirname(exe), name)))) return { exe, model, backend }
    }
    return null
  }
  const cpus = Math.max(1, (os.availableParallelism?.() || os.cpus().length) - 1)
  const cpuThreads = Math.max(1, Math.min(options.threads || Math.ceil((cpus + 1) / 2), 4, cpus))
  let child = null
  let startPromise = null
  let warmupPromise = null
  let port = null
  let closed = false
  let generation = 0
  let runtime = null
  let worker = new AbortController()

  async function start() {
    if (closed) throw new Error('Локальное распознавание остановлено')
    if (startPromise) return startPromise
    const current = generation
    const pending = (async () => {
      const cpu = find('cpu', options.cpuModel ? `ggml-${options.cpuModel}-q5_1.bin` : 'ggml-large-v3-turbo-q5_0.bin')
      const cuda = find('cuda', 'ggml-large-v3-turbo-q5_0.bin')
      const useCuda = options.mode !== 'cpu' && cuda && (!options.gpuAvailable || await options.gpuAvailable())
      if (closed || generation !== current) throw new Error('Локальное распознавание остановлено')
      const candidates = [useCuda && cuda, cpu].filter(Boolean)
      if (!candidates.length) throw new Error('Локальная модель речи не установлена. Переустанови версию с локальным распознаванием.')
      for (const candidate of candidates) {
        try { await launch(candidate, current); return }
        catch (error) {
          if (closed || generation !== current || candidate === candidates.at(-1)) throw error
        }
      }
    })().catch(error => { if (startPromise === pending) startPromise = null; throw error })
    startPromise = pending
    return pending
  }

  async function launch(candidate, current) {
    const { exe, model, backend } = candidate
    const currentPort = await freePort()
    if (closed || generation !== current) throw new Error('Локальное распознавание остановлено')
    port = currentPort
    worker = new AbortController()
    const controller = worker
    const helper = spawn(exe, ['--host', '127.0.0.1', '--port', String(currentPort), '-m', model, '-l', 'auto', '-t', String(backend === 'cpu' ? cpuThreads : Math.min(6, cpus)), ...(backend === 'cpu' ? ['--no-gpu'] : [])], {
      cwd: path.dirname(exe), windowsHide: true, stdio: 'ignore',
      ...(backend === 'cpu' ? { env: { ...process.env, OPENBLAS_NUM_THREADS: String(cpuThreads), OMP_NUM_THREADS: String(cpuThreads) } } : {}),
    })
    child = helper
    runtime = candidate
    let exited = false
    let ready = false
    const stopped = () => {
      exited = true
      controller.abort()
      if (child === helper) {
        child = null; runtime = null
        if (ready) { startPromise = null; warmupPromise = null }
      }
    }
    helper.once('error', stopped)
    helper.once('exit', stopped)
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      if (closed || generation !== current || exited) throw new Error('Локальная модель речи не запустилась')
      try {
        const response = await fetch(`http://127.0.0.1:${currentPort}/`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(500)]) })
        if (response.ok && !closed && generation === current && !exited) { ready = true; return }
      } catch { /* Model is still loading. */ }
      await new Promise(resolve => setTimeout(resolve, 150))
    }
    helper.kill()
    if (child === helper) { child = null; runtime = null }
    throw new Error('Локальная модель речи запускается слишком долго')
  }

  async function transcribe(input, language, signal) {
    const current = generation
    signal?.throwIfAborted()
    const match = /^data:audio\/wav;base64,([A-Za-z0-9+/=]+)$/.exec(input.audio || '')
    if (!match || match[1].length > 20_000_000) throw new Error('Некорректный аудиофрагмент')
    const wav = Buffer.from(match[1], 'base64')
    if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Ожидается WAV-аудио')
    for (let attempt = 0; attempt < 2; attempt++) {
      await start()
      if (current !== generation) throw new Error('Локальное распознавание остановлено')
      signal?.throwIfAborted()
      const controller = worker
      const deadline = new AbortController()
      const timer = setTimeout(() => deadline.abort(new Error('Распознавание фрагмента превысило время ожидания. Следующая реплика запустит движок заново.')), options.inferenceTimeoutMs ?? 60_000)
      try {
        const form = new FormData()
        form.set('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav')
        form.set('language', language === 'auto' ? 'auto' : language.split('-')[0])
        form.set('response_format', 'verbose_json')
        // Return existing decoder scores without a second language-probability pass.
        form.set('no_language_probabilities', 'true')
        form.set('temperature', '0')
        // A vocabulary prompt can overwhelm the first half-second of a live preview.
        if (input.provisional !== true) form.set('prompt', vocabularyHint)
        const response = await fetch(`http://127.0.0.1:${port}/inference`, { method: 'POST', body: form, signal: AbortSignal.any([controller.signal, deadline.signal, ...(signal ? [signal] : [])]) })
        if (!response.ok) throw new Error(`Локальное распознавание: HTTP ${response.status}`)
        const data = await response.json()
        if (current !== generation) throw new Error('Локальное распознавание остановлено')
        signal?.throwIfAborted()
        const segments = Array.isArray(data.segments) ? data.segments : []
        const scores = segments.map(segment => segment.avg_logprob).filter(Number.isFinite)
        const silence = segments.map(segment => segment.no_speech_prob).filter(Number.isFinite)
        return { text: String(data.text || '').replace(/\s+/g, ' ').trim(), usage: { cost: 0 }, diagnostics: {
          ...audioDiagnostics(wav), backend: runtime?.backend, language: data.language,
          ...(scores.length ? { avgLogprob: scores.reduce((sum, value) => sum + value, 0) / scores.length } : {}),
          ...(silence.length ? { noSpeechProb: Math.max(...silence) } : {}),
        } }
      } catch (error) {
        if (deadline.signal.aborted) {
          if (controller === worker && current === generation) release()
          throw deadline.signal.reason
        }
        // Retry only an unexpectedly exited local helper, never a canceled or paid request.
        if (controller.signal.aborted && current === generation && !closed && !signal?.aborted) {
          if (attempt === 0) continue
          throw new Error('Движок распознавания завершился с ошибкой после повторного запуска. Проверь локальное распознавание в настройках.')
        }
        throw error
      } finally { clearTimeout(timer) }
    }
  }

  function warmup() {
    if (!warmupPromise) {
      const current = generation
      const pending = (async () => {
        await start()
        if (closed || generation !== current) throw new Error('Локальное распознавание остановлено')
        if (runtime.backend === 'cuda') await transcribe({ audio: warmupAudio(), provisional: true }, 'auto')
        if (closed || generation !== current) throw new Error('Локальное распознавание остановлено')
        return { ok: true, previewEnabled: runtime.backend === 'cuda', backend: runtime.backend }
      })().catch(error => { if (warmupPromise === pending) warmupPromise = null; throw error })
      warmupPromise = pending
    }
    return warmupPromise
  }

  function release() {
    generation++
    worker.abort()
    child?.kill()
    child = null; runtime = null; port = null; startPromise = null; warmupPromise = null
  }
  function stop() { closed = true; release() }
  return { start, warmup, transcribe, release, stop, status: () => ({ running: Boolean(child), backend: runtime?.backend || null, pid: child?.pid || null,
    cudaInstalled: Boolean(find('cuda', 'ggml-large-v3-turbo-q5_0.bin')),
    gpuSupported: ['nvidia-smi.exe', 'nvapi64.dll'].some(name => fs.existsSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', name))),
  }) }
}

module.exports = { createLocalStt, shouldUseLocalTranscription, audioDiagnostics, formatTranscriptionTrace }
