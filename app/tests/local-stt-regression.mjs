import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { encodeWav, SpeechSegmenter } from '../src/audio.mjs'
import { createVoiceDetector } from '../src/voice-detector.mjs'
import { isTranscriptNoise, normalizeTranscriptText } from '../src/transcript.mjs'
import { technicalSpeechCases as cases } from './technical-speech-cases.mjs'

if (process.platform !== 'win32') throw new Error('This offline STT regression test requires Windows SAPI voices')

const MAX_WARM_TRANSCRIPTION_MS = 1_500
const roundsArg = process.argv.find(value => value.startsWith('--rounds='))?.slice('--rounds='.length)
const rounds = roundsArg === undefined ? 1 : Number(roundsArg)
assert.ok(Number.isSafeInteger(rounds) && rounds >= 1 && rounds <= 32, 'Sustained regression rounds must be 1-32')

function appAudio(wav) {
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
  assert.equal(wav.readUInt16LE(22), 1, 'SAPI fixture must be mono')
  assert.equal(wav.readUInt16LE(34), 16, 'SAPI fixture must use PCM16')
  const sampleRate = wav.readUInt32LE(24)
  let offset = 12
  while (offset + 8 <= wav.length && wav.toString('ascii', offset, offset + 4) !== 'data') {
    offset += 8 + wav.readUInt32LE(offset + 4)
  }
  assert.equal(wav.toString('ascii', offset, offset + 4), 'data', 'WAV data chunk is missing')
  const byteLength = wav.readUInt32LE(offset + 4)
  offset += 8
  const samples = Float32Array.from({ length: byteLength / 2 }, (_, index) => wav.readInt16LE(offset + index * 2) / 32768)
  return Buffer.from(encodeWav(samples, sampleRate))
}

function pcmSamples(wav) {
  let offset = 12
  while (offset + 8 <= wav.length && wav.toString('ascii', offset, offset + 4) !== 'data') {
    offset += 8 + wav.readUInt32LE(offset + 4)
  }
  assert.equal(wav.toString('ascii', offset, offset + 4), 'data')
  const length = wav.readUInt32LE(offset + 4)
  offset += 8
  return Float32Array.from({ length: length / 2 }, (_, index) => wav.readInt16LE(offset + index * 2) / 32768)
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const wavData = samples => `data:audio/wav;base64,${Buffer.from(encodeWav(samples, 16000)).toString('base64')}`

const directory = mkdtempSync(join(tmpdir(), 'sobesych-stt-regression-'))
const safeDirectory = resolve(directory)
assert.ok(safeDirectory.startsWith(resolve(tmpdir()) + sep), 'Temporary test directory must remain inside the system temp folder')
const { createLocalStt } = createRequire(import.meta.url)('../electron/local-stt.cjs')
const bundledRoot = resolve(process.env.SOBESYCH_STT_ROOT || 'vendor/local-stt')
const stt = createLocalStt(directory, bundledRoot)
const outputs = []
let voiceDetector

try {
  const startupStartedAt = performance.now()
  await stt.start()
  const serverStartupMs = Math.round(performance.now() - startupStartedAt)
  const warmupStartedAt = performance.now()
  await stt.warmup()
  const warmupMs = Math.round(performance.now() - warmupStartedAt)

  const captureQuestion = 'How would you check a Docker container that works locally but fails in CI/CD?'
  const capturePath = join(directory, 'capture-question.wav')
  const script = fileURLToPath(new URL('./make-tts.ps1', import.meta.url))
  execFileSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-Path', capturePath, '-Text', captureQuestion, '-Language', 'en',
  ], { stdio: 'ignore', windowsHide: true })
  const captureSamples = pcmSamples(appAudio(readFileSync(capturePath)))
  let firstPreview = null
  let firstPreviewResolve; let firstPreviewReject
  const firstPreviewPromise = new Promise((resolve, reject) => { firstPreviewResolve = resolve; firstPreviewReject = reject })
  let finalTranscriptResolve; let finalTranscriptReject
  const finalTranscriptPromise = new Promise((resolve, reject) => { finalTranscriptResolve = resolve; finalTranscriptReject = reject })
  let finalStarted = false
  let finalizationDelayMs = 0
  voiceDetector = await createVoiceDetector(16000)
  const segmenter = new SpeechSegmenter(16000, (samples, _utteranceId, _speechStartedAt, speechEndedAt) => {
    if (finalStarted) return
    finalStarted = true
    const startedAt = performance.now()
    finalizationDelayMs = Math.round(startedAt - speechEndedAt)
    void stt.transcribe({ audio: wavData(samples) }, 'en').then(result => {
      finalTranscriptResolve({ result, afterSpeechMs: Math.round(performance.now() - speechEndedAt) })
    }, finalTranscriptReject)
  }, {
    endSilenceSeconds: 0.45,
    detectSpeech: voiceDetector.detectSpeech,
    previewAfterSeconds: 0.5,
    previewEverySeconds: 0.5,
    onPreview(samples, _utteranceId, speechStartedAt) {
      if (firstPreview) return
      firstPreview = { startedAt: performance.now(), speechStartedAt }
      void stt.transcribe({ audio: wavData(samples), provisional: true }, 'en').then(result => {
        firstPreviewResolve({ result, fromSpeechStartMs: Math.round(performance.now() - speechStartedAt) })
      }, firstPreviewReject)
    },
  })
  for (let offset = 0; offset < captureSamples.length; offset += 320) {
    segmenter.push(captureSamples.subarray(offset, Math.min(offset + 320, captureSamples.length)))
    await delay(20)
  }
  for (let frame = 0; frame < 50 && !finalStarted; frame++) {
    segmenter.push(new Float32Array(320))
    await delay(20)
  }
  assert.ok(firstPreview, 'The live VAD should emit a provisional transcript while the interviewer is speaking')
  assert.ok(finalStarted, 'The live VAD should finalize the question after its short silence boundary')
  const preview = await Promise.race([firstPreviewPromise, delay(3000).then(() => { throw new Error('Live STT preview exceeded 3000 ms') })])
  const final = await Promise.race([finalTranscriptPromise, delay(3000).then(() => { throw new Error('Final live STT exceeded 3000 ms') })])
  const previewText = normalizeTranscriptText(preview.result.text)
  const finalText = normalizeTranscriptText(final.result.text)
  assert.ok(previewText && !isTranscriptNoise(previewText), `Live preview was empty or noise: ${previewText}`)
  assert.match(finalText, /docker/i, `Live final transcript missed the key term: ${finalText}`)
  assert.ok(preview.fromSpeechStartMs <= 2500, `Live draft took ${preview.fromSpeechStartMs} ms from speech start`)
  assert.ok(final.afterSpeechMs <= 2500, `Final transcript took ${final.afterSpeechMs} ms after speech ended`)

  const fixtureAudio = []
  for (const [index, fixture] of cases.entries()) {
    const path = join(directory, `question-${index}.wav`)
    execFileSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-Path', path, '-Text', fixture.text, '-Language', fixture.language,
    ], { stdio: 'ignore', windowsHide: true })

    fixtureAudio.push(`data:audio/wav;base64,${Buffer.from(appAudio(readFileSync(path))).toString('base64')}`)
    outputs.push({ language: fixture.language, expected: fixture.text, variants: [] })
  }
  const sustainedStartedAt = performance.now()
  for (let round = 0; round < rounds; round++) {
    for (const [index, fixture] of cases.entries()) {
      for (const language of ['auto', fixture.language]) {
        const started = performance.now()
        const result = await stt.transcribe({ audio: fixtureAudio[index] }, language, AbortSignal.timeout(5000))
        const elapsedMs = Math.round(performance.now() - started)
        assert.ok(elapsedMs <= MAX_WARM_TRANSCRIPTION_MS, `Warm local STT took ${elapsedMs} ms (${language}, round ${round + 1}) for: ${fixture.text}`)
        const transcript = normalizeTranscriptText(result.text)
        for (const pattern of fixture.expected) {
          assert.match(transcript, pattern, `Missed ${pattern} in ${fixture.language} fixture (${language}, round ${round + 1}): ${transcript}`)
        }
        outputs[index].variants.push({ ...(rounds > 1 ? { round: round + 1 } : {}), language, transcript, elapsedMs })
      }
    }
    if (rounds > 1 && (round + 1) % 4 === 0) console.log(`Sustained local STT: ${round + 1}/${rounds} rounds, ${(round + 1) * cases.length * 2} recognitions passed`)
  }
  const result = {
    test: 'offline local STT technical regressions', cost: 0,
    coldStart: { serverStartupMs, warmupMs },
    liveCapturePipeline: {
      question: captureQuestion,
      preview: { text: previewText, fromSpeechStartMs: preview.fromSpeechStartMs },
      final: { text: finalText, vadFinalizationMs: finalizationDelayMs, afterSpeechMs: final.afterSpeechMs },
    },
    cases: outputs,
  }
  if (rounds > 1) {
    const evidence = mkdtempSync(join(tmpdir(), 'sobesych-stt-sustained-'))
    const timings = outputs.flatMap(item => item.variants.map(variant => variant.elapsedMs)).sort((a, b) => a - b)
    const early = outputs.flatMap(item => item.variants.filter(variant => variant.round <= 4).map(variant => variant.elapsedMs))
    const late = outputs.flatMap(item => item.variants.filter(variant => variant.round > rounds - 4).map(variant => variant.elapsedMs))
    const mean = values => Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    const summary = { rounds, recognitions: timings.length, wallMs: Math.round(performance.now() - sustainedStartedAt), medianMs: timings[Math.floor(timings.length / 2)], p95Ms: timings[Math.ceil(timings.length * .95) - 1], maxMs: timings.at(-1), earlyMeanMs: mean(early), lateMeanMs: mean(late), cost: 0, realDevices: false }
    writeFileSync(join(evidence, 'results.json'), JSON.stringify({ ...result, summary }, null, 2))
    console.log(JSON.stringify({ ...summary, evidence }, null, 2))
  } else console.log(JSON.stringify(result, null, 2))
} finally {
  voiceDetector?.destroy()
  stt.stop()
  rmSync(safeDirectory, { recursive: true, force: true })
}
