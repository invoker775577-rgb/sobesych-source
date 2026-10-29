import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Only replace Vite's asset URL; execute the actual CaptureSession and worklet code.
const source = readFileSync(new URL('../src/capture.ts', import.meta.url), 'utf8')
  .replace("import workletUrl from './pcm-worklet.js?url'", "const workletUrl = 'fixture-worklet'")
  .replace("'./audio.mjs'", JSON.stringify(new URL('../src/audio.mjs', import.meta.url).href))
  .replace("'./transcript.mjs'", JSON.stringify(new URL('../src/transcript.mjs', import.meta.url).href))
  .replace("'./voice-detector.mjs'", JSON.stringify(new URL('../src/voice-detector.mjs', import.meta.url).href))
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const { CaptureSession } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const worklet = readFileSync(new URL('../src/pcm-worklet.js', import.meta.url), 'utf8')
const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

function setup(t, transcribe, options = {}) {
  const saved = new Map(['navigator', 'window', 'AudioContext', 'AudioWorkletNode', 'MediaStream'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]))
  const nodes = []; const streams = []; const texts = []; const partials = []; const errors = []; const statuses = []; const contexts = []; const mediaRequests = []; const pendingCounts = []
  let systemSourceRequests = 0; let displayRequests = 0
  const track = (kind, source) => ({ kind, source, enabled: true, readyState: 'live', stop() { this.readyState = 'ended' } })
  class Stream {
    constructor(tracks) { this.tracks = tracks; streams.push(this) }
    getTracks() { return this.tracks }
    getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio') }
    getVideoTracks() { return this.tracks.filter(t => t.kind === 'video') }
  }
  class Context {
    sampleRate = 16000; state = 'running'; destination = {}; audioWorklet = { addModule: async () => {} }
    constructor() { contexts.push(this) }
    createMediaStreamSource(stream) { return { connect(node) { node.source = stream.getAudioTracks()[0].source; return node } } }
    createGain() { return { gain: { value: 0 }, connect() {} } }
    async resume() {}
    async close() { this.state = 'closed' }
  }
  class Node {
    constructor() {
      const node = this
      let Processor
      vm.runInNewContext(worklet, {
        AudioWorkletProcessor: class { constructor() { this.port = { postMessage(data) { queueMicrotask(() => node.port.onmessage?.({ data })) } } } },
        registerProcessor(_name, type) { Processor = type }, Float32Array,
      })
      this.processor = new Processor()
      this.port = { postMessage: data => queueMicrotask(() => this.processor.port.onmessage({ data })) }
      nodes.push(this)
    }
    connect(node) { return node }
    push(count = 8000) { this.processor.process([[new Float32Array(count).fill(.1)]]) }
    pushSilence(count = 12000) { this.processor.process([[new Float32Array(count)]]) }
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: {
    getUserMedia: async constraints => { mediaRequests.push(constraints); return new Stream([track('audio', constraints.video ? 'interviewer' : 'me'), ...(constraints.video ? [track('video', 'interviewer')] : [])]) },
    getDisplayMedia: async () => { displayRequests++; throw new Error('Practice must not request system audio') },
  } } })
  globalThis.window = { sobesych: { getAudioSourceId: async () => { systemSourceRequests++; return { sourceId: 'fixture' } } } }
  globalThis.AudioContext = Context; globalThis.AudioWorkletNode = Node; globalThis.MediaStream = Stream
  const session = new CaptureSession({ microphoneId: 'default', transcribe, createVoiceDetector: async () => ({ detectSpeech: samples => samples.some(value => Math.abs(value) > .004), destroy() {} }), ...options, onText: (...args) => texts.push(args), onPartial: (...args) => partials.push(args), onError: e => errors.push(e), onStatus: (...args) => statuses.push(args), onPending: count => pendingCounts.push(count) })
  t.after(() => {
    session.stop()
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] }
  })
  return { session, nodes, texts, partials, errors, statuses, streams, contexts, mediaRequests, pendingCounts, getSystemSourceRequests: () => systemSourceRequests, getDisplayRequests: () => displayRequests }
}

test('practice capture records only the microphone and forces local transcription', async t => {
  const requests = []
  const { session, nodes, texts, streams, mediaRequests, getSystemSourceRequests, getDisplayRequests } = setup(t, async (audio, localOnly) => {
    requests.push({ audio, localOnly })
    return { text: 'I checked the logs and found the cause.' }
  }, { localOnly: true })
  await session.startMicrophoneOnly()
  assert.equal(mediaRequests.length, 1)
  assert.equal(mediaRequests[0].audio, true)
  assert.equal(mediaRequests[0].video, undefined)
  assert.equal(getSystemSourceRequests(), 0)
  assert.equal(getDisplayRequests(), 0)
  nodes[0].push(16000)
  assert.deepEqual(await session.stopMicrophoneOnly(), [])
  assert.equal(requests.length, 1)
  assert.equal(requests[0].localOnly, true)
  assert.match(requests[0].audio, /^data:audio\/wav;base64,/)
  assert.deepEqual(texts.map(item => item.slice(0, 2)), [['me', 'I checked the logs and found the cause.']])
  assert.ok(streams.flatMap(stream => stream.getTracks()).every(track => track.readyState === 'ended'))
})

test('local source detectors are released on disconnect, reconnect and stop without double disposal', async t => {
  const detectors = []
  const { session, streams } = setup(t, async () => ({ text: '' }), {
    localOnly: true,
    createVoiceDetector: async () => {
      const detector = { disposals: 0, detectSpeech: () => false, destroy() { this.disposals++ } }
      detectors.push(detector); return detector
    },
  })
  await session.start()
  assert.equal(detectors.length, 2)
  const microphone = streams.flatMap(stream => stream.getAudioTracks()).find(track => track.source === 'me')
  microphone.readyState = 'ended'; microphone.onended()
  assert.equal(detectors.reduce((total, item) => total + item.disposals, 0), 1)
  session.setMicrophoneEnabled(true); await tick(); await tick()
  assert.equal(detectors.length, 3)
  session.stop(); session.stop()
  assert.deepEqual(detectors.map(item => item.disposals), [1, 1, 1])
})

test('stop during local detector initialization releases the late handle without starting audio', async t => {
  const gate = deferred(); let initializing = false; let disposals = 0
  const { session, nodes, streams, contexts } = setup(t, async () => ({ text: '' }), {
    localOnly: true, createVoiceDetector: async () => { initializing = true; return gate.promise },
  })
  const starting = session.startMicrophoneOnly()
  await tick(); assert.equal(initializing, true)
  session.stop()
  gate.resolve({ detectSpeech: () => false, destroy() { disposals++ } })
  await assert.rejects(starting, /Не удалось подключить микрофон/)
  assert.equal(disposals, 1)
  assert.equal(nodes.length, 0)
  assert.ok(contexts.every(context => context.state === 'closed'))
  assert.ok(streams.flatMap(stream => stream.getTracks()).every(track => track.readyState === 'ended'))
})

test('local detector load failure closes the source instead of silently restoring energy-only capture', async t => {
  const { session, nodes, streams, contexts, errors } = setup(t, async () => ({ text: '' }), {
    localOnly: true, createVoiceDetector: async () => { throw new Error('fixture detector unavailable') },
  })
  await assert.rejects(session.startMicrophoneOnly(), /Не удалось подключить микрофон/)
  assert.equal(nodes.length, 0)
  assert.ok(errors.some(error => error.includes('fixture detector unavailable')))
  assert.ok(contexts.every(context => context.state === 'closed'))
  assert.ok(streams.flatMap(stream => stream.getTracks()).every(track => track.readyState === 'ended'))
})

test('diagnostic stop flushes both microphone and interviewer audio before closing capture', async t => {
  const requests = []
  const { session, nodes, texts, streams } = setup(t, async audio => {
    requests.push(audio)
    return { text: 'Recognized diagnostic speech.' }
  }, { localOnly: true })
  const started = await session.start()
  assert.equal(started.microphone, true)
  assert.equal(started.interviewer, true)
  const microphone = nodes.find(node => node.source === 'me')
  const interviewer = nodes.find(node => node.source === 'interviewer')
  microphone.push(8000); interviewer.push(8000)
  microphone.pushSilence(8000); interviewer.pushSilence(8000)
  assert.deepEqual(await session.stopAndFlushAll(), [])
  assert.equal(requests.length, 2)
  assert.deepEqual(new Set(texts.map(item => item[0])), new Set(['me', 'interviewer']))
  assert.ok(streams.flatMap(stream => stream.getTracks()).every(track => track.readyState === 'ended'))
})

test('live capture reports a missing interviewer source instead of silently starting', async t => {
  const { session, errors, streams } = setup(t, async () => ({ text: '' }))
  window.sobesych.getAudioSourceId = async () => { throw new Error('fixture audio source failure') }
  const result = await session.start()
  assert.deepEqual(result, { microphone: true, interviewer: false, interviewerError: 'fixture audio source failure' })
  assert.ok(errors.some(error => error.includes('Системный звук не подключён')))
  session.stop()
  assert.ok(streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))
})

test('supported display loopback works even if legacy source lookup is broken', async t => {
  const { session, getSystemSourceRequests } = setup(t, async () => ({ text: '' }))
  const media = navigator.mediaDevices.getUserMedia
  const requests = []
  navigator.mediaDevices.getDisplayMedia = async constraints => { requests.push(constraints); return media({ audio: true, video: true }) }
  window.sobesych.getAudioSourceId = async () => { throw new Error('legacy lookup unavailable') }
  assert.equal((await session.start()).interviewer, true)
  assert.equal(getSystemSourceRequests(), 0)
  assert.equal(requests[0].audio.echoCancellation, false)
  assert.equal(requests[0].audio.noiseSuppression, false)
  assert.equal(requests[0].audio.autoGainControl, false)
})

test('Windows USB source-start failure retries once after the microphone settles, without stale errors', async t => {
  const { session, errors } = setup(t, async () => ({ text: '' }))
  const media = navigator.mediaDevices.getUserMedia
  let microphoneReady = false; let displayAttempts = 0; let legacyAttempts = 0
  navigator.mediaDevices.getUserMedia = async constraints => {
    if (constraints.video) { legacyAttempts++; throw new DOMException('Could not start audio source', 'NotReadableError') }
    await tick(); microphoneReady = true
    return media(constraints)
  }
  navigator.mediaDevices.getDisplayMedia = async () => {
    if (++displayAttempts === 1) throw new DOMException('Could not start audio source', 'NotReadableError')
    assert.equal(microphoneReady, true)
    return media({ audio: true, video: true })
  }
  assert.deepEqual(await session.start(), { microphone: true, interviewer: true, interviewerError: undefined })
  assert.equal(displayAttempts, 2)
  assert.equal(legacyAttempts, 1)
  assert.deepEqual(errors, [])
})

test('display stream without audio is released before the legacy fallback', async t => {
  const { session } = setup(t, async () => ({ text: '' }))
  const media = navigator.mediaDevices.getUserMedia
  let rejectedStream
  navigator.mediaDevices.getDisplayMedia = async () => {
    rejectedStream = await media({ audio: true, video: true })
    rejectedStream.tracks = rejectedStream.tracks.filter(track => track.kind === 'video')
    return rejectedStream
  }
  assert.equal((await session.start()).interviewer, true)
  assert.ok(rejectedStream.getTracks().every(track => track.readyState === 'ended'))
})

test('explicit display permission denial is not bypassed with a legacy capture request', async t => {
  const { session, getSystemSourceRequests, errors } = setup(t, async () => ({ text: '' }))
  let attempts = 0
  navigator.mediaDevices.getDisplayMedia = async () => { attempts++; throw new DOMException('User denied capture', 'NotAllowedError') }
  assert.equal((await session.start()).interviewer, false)
  assert.equal(attempts, 1)
  assert.equal(getSystemSourceRequests(), 0)
  assert.equal(errors.length, 1)
})

test('persistent USB start failure is bounded and stopping during retry never reopens capture', async t => {
  const { session, errors } = setup(t, async () => ({ text: '' }))
  const media = navigator.mediaDevices.getUserMedia
  let attempts = 0
  const failed = () => { attempts++; throw new DOMException('Could not start audio source', 'NotReadableError') }
  navigator.mediaDevices.getDisplayMedia = async () => failed()
  navigator.mediaDevices.getUserMedia = async constraints => constraints.video ? failed() : media(constraints)
  const result = await session.start()
  assert.equal(result.interviewer, false)
  assert.equal(attempts, 4)
  assert.equal(errors.length, 1)
  assert.match(result.interviewerError, /Windows|USB/)
  const starting = session.start()
  session.stop()
  const atStop = attempts
  await starting
  assert.equal(attempts, atStop)
})

test('Stop cancels the USB retry backoff and releases the microphone without a new attempt', async t => {
  const { session, streams } = setup(t, async () => ({ text: '' }))
  const media = navigator.mediaDevices.getUserMedia
  const retry = deferred()
  let attempts = 0
  const failed = () => { attempts++; throw new DOMException('Could not start audio source', 'NotReadableError') }
  navigator.mediaDevices.getDisplayMedia = async () => failed()
  navigator.mediaDevices.getUserMedia = async constraints => constraints.video ? failed() : media(constraints)
  window.sobesych.traceAudioCapture = async event => { if (event.stage === 'retry') retry.resolve(); return { ok: true } }
  const starting = session.start()
  await retry.promise
  session.stop()
  await starting
  assert.equal(attempts, 2)
  assert.ok(streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))
})

test('permission denial from a different realm does not use the legacy path', async t => {
  const { session, getSystemSourceRequests } = setup(t, async () => ({ text: '' }))
  navigator.mediaDevices.getDisplayMedia = async () => { throw { name: 'NotAllowedError', message: 'permission denied' } }
  assert.equal((await session.start()).interviewer, false)
  assert.equal(getSystemSourceRequests(), 0)
})

test('permission denial in the fallback stops USB recovery instead of reopening capture', async t => {
  const { session, errors } = setup(t, async () => ({ text: '' }))
  const media = navigator.mediaDevices.getUserMedia
  let attempts = 0
  navigator.mediaDevices.getDisplayMedia = async () => { attempts++; throw new DOMException('Could not start audio source', 'NotReadableError') }
  navigator.mediaDevices.getUserMedia = async constraints => {
    if (constraints.video) { attempts++; throw new DOMException('Capture denied', 'NotAllowedError') }
    return media(constraints)
  }
  assert.equal((await session.start()).interviewer, false)
  assert.equal(attempts, 2)
  assert.equal(errors.length, 1)
})

test('Stop completes an in-flight OS audio request and disposes its late stream', async t => {
  const { session, streams } = setup(t, async () => ({ text: '' }))
  const media = navigator.mediaDevices.getUserMedia
  const gate = deferred()
  navigator.mediaDevices.getDisplayMedia = async () => { await gate.promise; return media({ audio: true, video: true }) }
  let finished = false
  const starting = session.start().then(result => { finished = true; return result })
  await tick()
  session.stop()
  try {
    await tick(); await tick()
    assert.equal(finished, true, 'Stop must not wait for an OS capture dialog or driver')
  } finally { gate.resolve(); await starting; await tick() }
  assert.ok(streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))
})

test('USB endpoint reset after initial loopback success is recovered before reporting a running call', async t => {
  const { session, errors } = setup(t, async () => ({ text: '' }))
  const media = navigator.mediaDevices.getUserMedia
  const mic = deferred()
  let displayAttempts = 0; let firstStream
  navigator.mediaDevices.getDisplayMedia = async () => {
    const stream = await media({ audio: true, video: true })
    if (++displayAttempts === 1) firstStream = stream
    return stream
  }
  navigator.mediaDevices.getUserMedia = async constraints => { await mic.promise; return media(constraints) }
  const starting = session.start()
  await tick(); await tick()
  const audio = firstStream.getAudioTracks()[0]
  audio.readyState = 'ended'; audio.onended()
  mic.resolve()
  assert.deepEqual(await starting, { microphone: true, interviewer: true, interviewerError: undefined })
  assert.equal(displayAttempts, 2, 'A stream ended by microphone initialization is not a successful loopback')
  assert.deepEqual(errors, [], 'A recovered startup must not leave a stale disconnect error')
})

test('Stop completes a pending USB microphone request without reopening the session', async t => {
  const { session, streams } = setup(t, async () => ({ text: '' }))
  const media = navigator.mediaDevices.getUserMedia
  const gate = deferred()
  navigator.mediaDevices.getDisplayMedia = async () => media({ audio: true, video: true })
  navigator.mediaDevices.getUserMedia = async constraints => { await gate.promise; return media(constraints) }
  let finished = false
  const starting = session.start().then(result => { finished = true; return result })
  await tick()
  session.stop()
  try {
    await tick(); await tick()
    assert.equal(finished, true, 'Stop must also cancel the wait for the USB microphone')
  } finally { gate.resolve(); await starting; await tick() }
  assert.ok(streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))
})

test('live capture can start with interviewer audio when the optional microphone is unavailable', async t => {
  const { session, errors } = setup(t, async () => ({ text: '' }))
  const originalGetUserMedia = navigator.mediaDevices.getUserMedia
  navigator.mediaDevices.getUserMedia = async constraints => {
    if (!constraints.video) throw new Error('fixture microphone failure')
    return originalGetUserMedia(constraints)
  }
  const result = await session.start()
  assert.equal(result.microphone, false)
  assert.equal(result.interviewer, true)
  assert.ok(errors.some(error => error.includes('Микрофон не подключён')))
  session.stop()
})

test('resuming muted capture does not reopen the microphone until explicitly enabled', async t => {
  const { session, streams, nodes, texts, mediaRequests, statuses } = setup(t, async () => ({ text: 'A captured sentence.' }), { microphoneEnabled: false })
  const result = await session.start()
  assert.equal(result.microphone, false)
  assert.equal(result.interviewer, true)
  assert.equal(mediaRequests.filter(request => !request.video).length, 0, 'muted capture must not request microphone access')
  assert.deepEqual(statuses.findLast(([source]) => source === 'me')?.[1], { active: false, level: 0, message: 'Микрофон выключен' })
  session.setMicrophoneEnabled(true)
  await tick()
  assert.equal(mediaRequests.filter(request => !request.video).length, 1)
  const microphone = streams.find(stream => stream.getAudioTracks()[0]?.source === 'me')
  assert.equal(microphone.getAudioTracks()[0].enabled, true)
  session.setMicrophoneEnabled(false)
  assert.equal(microphone.getAudioTracks()[0].enabled, false)
  assert.equal(streams.find(stream => stream.getVideoTracks().length).getAudioTracks()[0].enabled, true, 'muting the microphone must not mute the interviewer')
  const microphoneNode = nodes.find(node => node.source === 'me')
  microphoneNode.push(); microphoneNode.pushSilence()
  await tick()
  assert.deepEqual(texts, [])
  session.stop()
  const statusCount = statuses.length
  session.setMicrophoneEnabled(true)
  await tick()
  assert.equal(statuses.length, statusCount, 'a closed session must not publish reconnecting status')
  assert.equal(mediaRequests.filter(request => !request.video).length, 1)
})

test('ended microphone releases its audio graph and ignores queued PCM before manual reconnection', async t => {
  const { session, nodes, streams, contexts, mediaRequests, statuses } = setup(t, async () => ({ text: '' }))
  await session.start()
  const microphone = streams.find(stream => stream.getAudioTracks()[0]?.source === 'me')
  const microphoneNode = nodes.find(node => node.source === 'me')
  const latePcm = microphoneNode.port.onmessage
  const track = microphone.getAudioTracks()[0]
  track.readyState = 'ended'; track.onended()
  await tick()
  assert.equal(contexts.filter(context => context.state !== 'closed').length, 1, 'only interviewer audio remains active')
  assert.equal(statuses.findLast(([source]) => source === 'me')[1].active, false)
  latePcm({ data: new Float32Array(16000).fill(.1) })
  assert.equal(statuses.findLast(([source]) => source === 'me')[1].active, false, 'a queued message must not revive the dead microphone')
  session.setMicrophoneEnabled(true)
  await tick()
  assert.equal(mediaRequests.filter(request => !request.video).length, 2)
  assert.equal(contexts.filter(context => context.state !== 'closed').length, 2)
  assert.equal(statuses.findLast(([source]) => source === 'me')[1].active, true)
  latePcm({ data: new Float32Array(16000).fill(.1) })
  assert.equal(statuses.findLast(([source]) => source === 'me')[1].active, true)
})

test('ending the display track closes interviewer audio and rejects a pending flush promptly', async t => {
  const { session, nodes, streams, contexts, statuses } = setup(t, async () => ({ text: '' }))
  await session.start()
  const stream = streams.find(item => item.getVideoTracks().length)
  const interviewer = nodes.find(node => node.source === 'interviewer')
  interviewer.port.postMessage = () => {}
  const waiting = session.flushPending(new AbortController().signal, 500)
  const rejected = assert.rejects(waiting, /Источник звука отключён/)
  await tick()
  const display = stream.getVideoTracks()[0]
  display.readyState = 'ended'; display.onended?.()
  await rejected
  assert.ok(stream.getTracks().every(track => track.readyState === 'ended'))
  assert.equal(contexts.filter(context => context.state !== 'closed').length, 1)
  assert.equal(statuses.findLast(([source]) => source === 'interviewer')[1].active, false)
  await assert.rejects(session.flushPending(new AbortController().signal), /Звук собеседника ещё не подключён/)
})

test('disconnecting a microphone aborts its active recognition and discards queued fragments before reconnecting', async t => {
  const pending = deferred(); const requests = []
  const { session, nodes, streams, texts } = setup(t, (_audio, _localOnly, signal) => {
    requests.push(signal)
    return requests.length === 1 ? pending.promise : Promise.resolve({ text: 'Fresh microphone sentence.' })
  }, { localOnly: true })
  await session.start()
  const microphone = nodes.find(node => node.source === 'me')
  microphone.push(); microphone.pushSilence(); await tick()
  microphone.push(); microphone.pushSilence(); await tick()
  assert.equal(requests.length, 1)
  const oldTrack = streams.find(stream => stream.getAudioTracks()[0]?.source === 'me').getAudioTracks()[0]
  oldTrack.readyState = 'ended'; oldTrack.onended(); await tick()
  assert.equal(requests[0].aborted, true, 'device loss must cancel already dispatched recognition')
  session.setMicrophoneEnabled(true); await tick()
  const freshMicrophone = nodes.filter(node => node.source === 'me').at(-1)
  freshMicrophone.push(); freshMicrophone.pushSilence(); await tick()
  assert.equal(requests.length, 2, 'the dead graph queue must not be replayed after reconnection')
  assert.deepEqual(texts.map(item => item.slice(0, 2)), [['me', 'Fresh microphone sentence.']])
  pending.resolve({ text: 'STALE_MICROPHONE_SENTENCE' }); await tick()
  assert.equal(texts.length, 1, 'a provider that completes after cancellation must not publish stale speech')
})

test('disconnecting interviewer audio cancels pending inference and rejects an acknowledged answer boundary', async t => {
  const pending = deferred(); let requestSignal
  const { session, nodes, streams, texts } = setup(t, (_audio, _localOnly, signal) => {
    requestSignal = signal
    return pending.promise
  }, { localOnly: true })
  await session.start()
  const interviewer = nodes.find(node => node.source === 'interviewer')
  interviewer.push(); interviewer.pushSilence(); await tick()
  const waiting = session.flushPending(new AbortController().signal, 200)
  const rejected = assert.rejects(waiting, /Источник звука отключён|Звук собеседника.*подключён/)
  void rejected.catch(() => {})
  await tick()
  const track = streams.find(stream => stream.getVideoTracks().length).getAudioTracks()[0]
  track.readyState = 'ended'; track.onended(); await tick()
  assert.equal(requestSignal.aborted, true)
  await rejected
  pending.resolve({ text: 'STALE_INTERVIEWER_QUESTION' }); await tick()
  assert.deepEqual(texts, [])
})

test('local preemption frees the interviewer queue even when canceled microphone IPC has not settled', async t => {
  const pending = deferred(); const requests = []
  const { session, nodes, texts } = setup(t, (_audio, _localOnly, signal) => {
    requests.push(signal)
    return requests.length === 1 ? pending.promise : Promise.resolve({ text: requests.length === 2 ? 'Fresh interviewer question?' : 'Retried microphone sentence.' })
  }, { localOnly: true })
  await session.start()
  const microphone = nodes.find(node => node.source === 'me')
  microphone.push(); microphone.pushSilence(); await tick()
  const interviewer = nodes.find(node => node.source === 'interviewer')
  interviewer.push(); interviewer.pushSilence(); await tick()
  assert.equal(requests[0].aborted, true)
  assert.equal(requests.length, 3, 'the interviewer and retried microphone must not wait for late IPC completion')
  assert.deepEqual(texts.map(item => item.slice(0, 2)), [
    ['interviewer', 'Fresh interviewer question?'], ['me', 'Retried microphone sentence.'],
  ])
  pending.resolve({ text: 'STALE_PREEMPTED_RESULT' }); await tick()
  assert.equal(texts.length, 2)
})

test('long two-source capture drains each turn and reconnects without retaining finished jobs or graphs', async t => {
  let round = 0
  const { session, nodes, streams, texts, errors, contexts, pendingCounts } = setup(t, async () => ({ text: round % 2 ? `Сначала проверю логи. Реплика ${round}.` : `First I check the logs. Turn ${round}.` }), { localOnly: true })
  await session.start()
  for (round = 0; round < 250; round++) {
    const microphone = nodes.filter(node => node.source === 'me').at(-1)
    const interviewer = nodes.find(node => node.source === 'interviewer')
    microphone.push(); microphone.pushSilence()
    interviewer.push(); interviewer.pushSilence()
    await tick()
    await session.flushPending(new AbortController().signal)
    await tick()
    assert.equal(texts.length, (round + 1) * 2)
    assert.deepEqual(new Set(texts.slice(-2).map(item => item[0])), new Set(['me', 'interviewer']))
    assert.ok(texts.slice(-2).every(item => item[1].endsWith(`${round}.`)), 'no earlier turn may arrive during a newer round')
    assert.equal(pendingCounts.at(-1), 0)
    assert.equal(session.jobs.size, 0)
    assert.equal(session.queue.length, 0)
    assert.equal(session.activeTranscriptions.size, 0)
    if (round % 25 === 24) {
      const track = streams.findLast(stream => stream.getAudioTracks()[0]?.source === 'me' && stream.getAudioTracks()[0].readyState === 'live').getAudioTracks()[0]
      track.readyState = 'ended'; track.onended(); await tick()
      session.setMicrophoneEnabled(true); await tick()
      assert.equal(contexts.filter(context => context.state !== 'closed').length, 2)
    }
  }
  assert.deepEqual(errors, [])
  assert.ok(Math.max(...pendingCounts) <= 4, 'this paced fixture must not accumulate a backlog')
  session.stop(); await tick()
  assert.ok(contexts.every(context => context.state === 'closed'))
  assert.equal(session.jobs.size, 0)
  assert.equal(pendingCounts.at(-1), 0)
})

for (const shutdown of ['disconnect', 'stop']) {
  test(`a preempted segment finishes if ${shutdown} occurs before it can be requeued`, async t => {
    const pending = deferred(); let requests = 0
    const { session, nodes, streams, texts } = setup(t, () => {
      requests++
      return requests === 1 ? pending.promise : Promise.resolve({ text: 'Fresh interviewer question?' })
    }, { localOnly: true })
    t.after(() => pending.resolve({ text: 'STALE_PREEMPTED_MIC' }))
    const transcribeSegment = session.transcribeSegment.bind(session)
    session.transcribeSegment = async item => {
      const retry = await transcribeSegment(item)
      if (retry) {
        if (shutdown === 'stop') session.stop()
        else {
          const track = streams.find(stream => stream.getAudioTracks()[0]?.source === 'me').getAudioTracks()[0]
          track.readyState = 'ended'; track.onended()
        }
      }
      return retry
    }
    await session.start()
    const microphone = nodes.find(node => node.source === 'me')
    microphone.push(); microphone.pushSilence(); await tick()
    const interviewer = nodes.find(node => node.source === 'interviewer')
    interviewer.push(); interviewer.pushSilence(); await tick()
    assert.equal(session.jobs.size, 0, 'the removed retry must finish its job even though it cannot be put back into the queue')
    assert.equal(session.queue.length, 0)
    assert.deepEqual(texts.map(item => item[0]), shutdown === 'stop' ? [] : ['interviewer'])
  })
}

test('live interviewer capture keeps a short pause inside one transcript segment', async t => {
  const requests = []; const { session, nodes, texts } = setup(t, async audio => {
    requests.push(audio)
    return { text: 'How would you debug a gRPC timeout between two services?' }
  })
  await session.start()
  const interviewer = nodes.find(node => node.source === 'interviewer')
  interviewer.push(8000)
  interviewer.pushSilence(6400)
  await tick()
  assert.equal(requests.length, 0, '400ms of silence is not enough to end an interviewer question')
  interviewer.push(8000)
  interviewer.pushSilence(8000)
  await session.flushPending(new AbortController().signal)
  assert.equal(requests.length, 1)
  assert.deepEqual(texts.map(item => item.slice(0, 2)), [['interviewer', 'How would you debug a gRPC timeout between two services?']])
})

test('local interviewer preview is provisional and only the final transcript is committed', async t => {
  const requests = []
  const provisionalFlags = []
  const { session, nodes, partials, texts } = setup(t, async (audio, _localOnly, _signal, provisional) => {
    requests.push(audio)
    provisionalFlags.push(provisional)
    return { text: requests.length === 1 ? 'How would you diagnose intermittent' : 'How would you diagnose intermittent 502 errors behind Nginx Ingress in Kubernetes?' }
  }, { previewEnabled: true })
  await session.start()
  const interviewer = nodes.find(n => n.source === 'interviewer')
  interviewer.push(8192)
  await tick()
  assert.equal(requests.length, 1, 'first provisional recognition starts after 0.5 seconds of voiced speech')
  assert.deepEqual(partials.map(item => item.slice(0, 2)), [['interviewer', 'How would you diagnose intermittent']])
  interviewer.push(8192)
  await tick()
  assert.equal(requests.length, 2, 'the provisional text refreshes after another 0.5 seconds')
  assert.deepEqual(partials.map(item => item.slice(0, 2)), [
    ['interviewer', 'How would you diagnose intermittent'],
    ['interviewer', 'How would you diagnose intermittent 502 errors behind Nginx Ingress in Kubernetes?'],
  ])
  assert.deepEqual(texts, [], 'a preview is not a saved transcript message')
  interviewer.pushSilence(4800)
  await session.flushPending(new AbortController().signal)
  assert.equal(requests.length, 3)
  assert.deepEqual(provisionalFlags, [true, true, false], 'early previews must bypass final-transcript vocabulary hints')
  assert.deepEqual(texts.map(item => item.slice(0, 2)), [['interviewer', 'How would you diagnose intermittent 502 errors behind Nginx Ingress in Kubernetes?']])
  assert.ok(Number.isFinite(texts[0][3].speechToTextMs) && texts[0][3].speechToTextMs >= texts[0][3].processingMs, 'final transcript measures from speech onset as well as total processing time')
  assert.ok(Number.isFinite(texts[0][3].speechDurationMs) && texts[0][3].speechDurationMs >= 0, 'final transcript reports how long the speaker actually spoke')
  assert.ok(Number.isFinite(texts[0][3].afterSpeechMs) && texts[0][3].afterSpeechMs >= texts[0][3].transcriptionMs, 'post-speech time includes the final inference and VAD silence boundary')
  assert.ok(Number.isFinite(texts[0][3].queueMs) && Number.isFinite(texts[0][3].transcriptionMs), 'recognition latency separates queue delay from transcription time')
  assert.ok(texts[0][3].processingMs + 2 >= texts[0][3].queueMs + texts[0][3].transcriptionMs)
  assert.equal(partials.length, 2)
})

test('local interviewer audio preempts mic inference and retries the same mic segment afterward', async t => {
  const requests = []
  let microphoneAborted = false
  const { session, nodes, partials, texts } = setup(t, (audio, _localOnly, signal) => {
    requests.push(audio)
    if (requests.length === 1) return new Promise((resolve, reject) => signal.addEventListener('abort', () => {
      microphoneAborted = true
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true }))
    return Promise.resolve({ text: requests.length === 2 ? 'What would you check next?' : 'I would check the logs.' })
  }, { previewEnabled: true })
  await session.start()
  const microphone = nodes.find(node => node.source === 'me')
  const interviewer = nodes.find(node => node.source === 'interviewer')
  microphone.push()
  microphone.pushSilence()
  await tick()
  assert.equal(requests.length, 1, 'candidate speech started local inference first')

  interviewer.push(32000)
  for (let i = 0; i < 20 && requests.length < 3; i++) await tick()

  assert.equal(microphoneAborted, true, "the interviewer's preview interrupts low-priority mic inference")
  assert.equal(requests.length, 3, 'interviewer preview runs before the saved mic segment is retried')
  assert.equal(requests[0], requests[2], 'preemption must preserve and retry the exact candidate audio')
  assert.deepEqual(partials.map(item => item.slice(0, 2)), [['interviewer', 'What would you check next?']])
  assert.deepEqual(texts.map(item => item.slice(0, 2)), [['me', 'I would check the logs.']])
  session.stop()
})

test('final transcript cancels an in-flight draft and skips queued stale previews', async t => {
  const requests = []; let previewAborted = false
  const { session, nodes, partials, texts } = setup(t, async (audio, _localOnly, signal) => {
    requests.push(audio)
    if (requests.length === 1) return new Promise(resolve => signal.addEventListener('abort', () => {
      previewAborted = true
      resolve({ text: 'Early provisional text' })
    }, { once: true }))
    return { text: 'Complete final question' }
  }, { previewEnabled: true })
  await session.start()
  const interviewer = nodes.find(n => n.source === 'interviewer')
  for (let i = 0; i < 7; i++) interviewer.push()
  await tick()
  assert.equal(requests.length, 1, 'first draft is in flight')
  for (let i = 0; i < 10; i++) interviewer.push()
  await tick()
  interviewer.pushSilence(4800)
  const flushed = session.flushPending(new AbortController().signal)
  await flushed
  assert.equal(previewAborted, true, 'the speculative request is canceled as soon as its final audio exists')
  assert.equal(requests.length, 2, 'the final segment runs next, without queued preview requests')
  assert.deepEqual(partials, [], 'a draft superseded by final audio is never shown')
  assert.deepEqual(texts.map(item => item[1]), ['Complete final question'])
})

test('preview is disabled by default so paid transcription does not receive extra requests', async t => {
  let requests = 0
  const { session, nodes, partials, texts } = setup(t, async () => {
    requests++
    return { text: 'What is gRPC?' }
  })
  await session.start()
  const interviewer = nodes.find(n => n.source === 'interviewer')
  for (let i = 0; i < 8; i++) interviewer.push()
  interviewer.pushSilence(4800)
  await session.flushPending(new AbortController().signal)
  assert.equal(requests, 1)
  assert.deepEqual(partials, [])
  assert.deepEqual(texts.map(item => item[1]), ['What is gRPC?'])
})

test('optional preview failure does not block final transcription', async t => {
  let requests = 0
  const { session, nodes, partials, texts, errors } = setup(t, async () => {
    requests++
    return requests === 1 ? { error: 'temporary preview failure' } : { text: 'What is gRPC?' }
  }, { previewEnabled: true })
  await session.start()
  const interviewer = nodes.find(n => n.source === 'interviewer')
  interviewer.push(8192)
  await tick()
  interviewer.push(8192)
  await tick()
  interviewer.pushSilence(4800)
  await session.flushPending(new AbortController().signal)
  assert.equal(requests, 3, 'a failed draft is retried on the next preview and the final segment still runs')
  assert.deepEqual(partials.map(item => item[1]), ['What is gRPC?'])
  assert.deepEqual(texts.map(item => item[1]), ['What is gRPC?'])
  assert.deepEqual(errors, [])
})

test('stopping while a preview is in flight drops its late transcript', async t => {
  const response = deferred()
  let aborted = false
  const { session, nodes, partials, texts } = setup(t, (_audio, _localOnly, signal) => {
    signal.addEventListener('abort', () => { aborted = true }, { once: true })
    return response.promise
  }, { previewEnabled: true })
  await session.start()
  const interviewer = nodes.find(n => n.source === 'interviewer')
  for (let i = 0; i < 7; i++) interviewer.push()
  await tick()
  session.stop()
  assert.equal(aborted, true, 'stopping the call cancels the active speech request')
  response.resolve({ text: 'late draft' })
  await tick()
  assert.deepEqual(partials, [])
  assert.deepEqual(texts, [])
})

test('flush includes worklet tail and waits for outstanding STT', async t => {
  const response = deferred(); const requests = []
  const { session, nodes, texts } = setup(t, audio => { requests.push(audio); return response.promise })
  await session.start()
  // Both sources pass through the same production worklet. A sub-buffer tail must survive.
  nodes.find(n => n.source === 'interviewer').push(6000)
  let finished = false
  const waiting = session.flushPending(new AbortController().signal).then(() => { finished = true })
  await tick()
  assert.equal(requests.length, 1); assert.equal(finished, false)
  const wav = Buffer.from(requests[0].split(',')[1], 'base64')
  assert.equal(wav.readUInt32LE(40), 12000)
  response.resolve({ text: 'А если два?' })
  await waiting
  assert.equal(texts[0][1], 'А если два?')
  await session.flushPending(new AbortController().signal)
  assert.equal(requests.length, 1)
})

test('flush waits for a fixed boundary, not audio arriving later', async t => {
  const first = deferred(); const second = deferred(); let requests = 0
  const { session, nodes } = setup(t, () => (++requests === 1 ? first.promise : second.promise))
  await session.start(); nodes.find(n => n.source === 'interviewer').push()
  const waiting = session.flushPending(new AbortController().signal)
  await tick()
  const interviewer = nodes.find(n => n.source === 'interviewer')
  interviewer.push(); interviewer.pushSilence()
  await tick()
  first.resolve({ text: 'Нет, памяти 2 ГБ' })
  await waiting
  assert.equal(requests, 2)
  session.stop(); second.resolve({ text: 'Поздний текст' }); await tick()
})

test('canceling the wait keeps capture alive; stop rejects wait and drops late text', async t => {
  const response = deferred()
  const { session, nodes, texts, streams, contexts } = setup(t, () => response.promise)
  await session.start(); nodes.find(n => n.source === 'interviewer').push()
  const controller = new AbortController()
  const waiting = session.flushPending(controller.signal)
  await tick(); controller.abort()
  await assert.rejects(waiting, { name: 'AbortError' })
  assert.ok(streams.some(s => s.getTracks().some(t => t.readyState === 'live')))
  const next = session.flushPending(new AbortController().signal)
  await tick(); session.stop()
  await assert.rejects(next, { name: 'AbortError' })
  response.resolve({ text: 'Не должен попасть в другой звонок' }); await tick()
  assert.deepEqual(texts, [])
  assert.ok(streams.every(s => s.getTracks().every(t => t.readyState === 'ended')))
  assert.ok(contexts.every(c => c.state === 'closed'))
})

test('STT failure blocks stale answers and timeout does not stop audio', async t => {
  const response = deferred()
  const { session, nodes, streams } = setup(t, () => response.promise)
  await session.start(); nodes.find(n => n.source === 'interviewer').push()
  await assert.rejects(session.flushPending(new AbortController().signal, 20), /не завершилось/)
  assert.ok(streams.some(s => s.getTracks().some(t => t.readyState === 'live')))
  const waiting = session.flushPending(new AbortController().signal)
  await tick(); response.resolve({ error: 'network' })
  await assert.rejects(waiting, /network/)
})

test('a request already transcribing before the click is included in the boundary', async t => {
  const response = deferred(); let sent = 0
  const { session, nodes, texts } = setup(t, () => { sent++; return response.promise })
  await session.start()
  const interviewer = nodes.find(n => n.source === 'interviewer')
  interviewer.push(); interviewer.pushSilence()
  await tick(); assert.equal(sent, 1)
  let finished = false
  const waiting = session.flushPending(new AbortController().signal).then(() => { finished = true })
  await tick(); assert.equal(finished, false)
  response.resolve({ text: 'Без Kubernetes' }); await waiting
  assert.deepEqual(texts.map(t => t.slice(0, 2)), [['interviewer', 'Без Kubernetes']])
})

test('failed interviewer STT blocks an old answer; empty audio is treated as silence', async t => {
  let result = { text: 'Что такое DNS?' }
  const { session, nodes } = setup(t, async () => result)
  await session.start()
  const interviewer = nodes.find(n => n.source === 'interviewer')
  interviewer.push(); await session.flushPending(new AbortController().signal)
  for (const failure of [{ error: 'network' }]) {
    result = failure; interviewer.push(96256); await tick()
    await assert.rejects(session.flushPending(new AbortController().signal), /Вопрос распознан не полностью/)
  }
  result = { text: 'А что с DNS?' }; interviewer.push(96256); await tick()
  await session.flushPending(new AbortController().signal)
  for (const silence of [{ text: '' }, { text: 'Субтитры делал DimaTorzok' }]) {
    result = silence; interviewer.push(96256); await tick()
    await session.flushPending(new AbortController().signal)
  }
  result = { text: 'Нет, памяти 2 ГБ' }; interviewer.push()
  await session.flushPending(new AbortController().signal)
})

test('missing worklet acknowledgement times out and a stopped session cannot flush', async t => {
  const { session, nodes } = setup(t, async () => ({ text: 'Q' }))
  await session.start()
  nodes.find(n => n.source === 'interviewer').port.postMessage = () => {}
  await assert.rejects(session.flushPending(new AbortController().signal, 20), /не завершилось/)
  session.stop()
  await assert.rejects(session.flushPending(new AbortController().signal), { name: 'AbortError' })
})

test('slow microphone cannot block interviewer STT; each source retains order', async t => {
  const responses = []; let inFlight = 0; let peak = 0; let microphoneSignal
  const { session, nodes, texts } = setup(t, (_audio, _localOnly, signal) => {
    const response = deferred(); responses.push(response)
    if (responses.length === 1) microphoneSignal = signal
    peak = Math.max(peak, ++inFlight)
    return response.promise.finally(() => { inFlight-- })
  })
  await session.start()
  const mic = nodes.find(n => n.source === 'me')
  const interviewer = nodes.find(n => n.source === 'interviewer')
  mic.push(); mic.pushSilence(); await tick()
  interviewer.push(); interviewer.pushSilence(); await tick()
  assert.equal(responses.length, 2, 'interviewer starts while microphone is unresolved')
  assert.equal(microphoneSignal.aborted, false, 'cloud requests are never preempted or repeated')
  interviewer.push(); interviewer.pushSilence(); await tick()
  assert.equal(responses.length, 2, 'second interviewer segment waits for the first')
  responses[1].resolve({ text: 'Что такое DNS?' }); await tick()
  assert.equal(responses.length, 3)
  assert.deepEqual(texts.map(t => t.slice(0, 2)), [['interviewer', 'Что такое DNS?']])
  responses[2].resolve({ text: 'А если два?' }); await tick()
  responses[0].resolve({ text: 'Сейчас отвечу' }); await tick()
  assert.equal(peak, 2)
  assert.deepEqual(texts.filter(t => t[0] === 'interviewer').map(t => t[1]), ['Что такое DNS?', 'А если два?'])
  await session.flushPending(new AbortController().signal)
})

test('local STT preempts active mic, handles interviewer, and retries mic segments in capture order', async t => {
  const requests = []; let microphoneAborted = false; let previewAborted = false; let inFlight = 0; let peak = 0
  const { session, nodes, texts } = setup(t, (audio, _localOnly, signal) => {
    const number = requests.push(audio)
    peak = Math.max(peak, ++inFlight)
    if (number === 1 || number === 2) return new Promise(resolve => signal.addEventListener('abort', () => {
      if (number === 1) microphoneAborted = true
      else previewAborted = true
      resolve({ text: 'stale result must be discarded' })
    }, { once: true })).finally(() => { inFlight-- })
    const answer = number === 3 ? 'How would you diagnose a 502 error?'
      : number === 4 ? 'I finished my answer.'
        : 'I added the second detail.'
    return Promise.resolve({ text: answer }).finally(() => { inFlight-- })
  }, { previewEnabled: true })
  await session.start()
  const mic = nodes.find(n => n.source === 'me')
  const interviewer = nodes.find(n => n.source === 'interviewer')

  mic.push(8000); mic.pushSilence(12000)
  await tick()
  assert.equal(requests.length, 1)
  mic.push(16000); mic.pushSilence(12000)
  await tick()
  assert.equal(requests.length, 1, 'the second mic segment should wait in the local queue')
  interviewer.push(32000)
  for (let i = 0; i < 20 && requests.length < 2; i++) await tick()
  assert.equal(requests.length, 2)
  assert.equal(microphoneAborted, true, 'interviewer speech interrupts active candidate inference')
  interviewer.pushSilence(12000)
  await session.flushPending(new AbortController().signal)
  for (let i = 0; i < 20 && requests.length < 5; i++) await tick()

  assert.equal(peak, 1)
  assert.equal(previewAborted, true, 'the final question replaces its in-flight provisional transcript')
  assert.equal(requests[3], requests[0], 'the retried first mic segment keeps its original position')
  assert.notEqual(requests[4], requests[0], 'the later, longer mic segment is processed second')
  assert.deepEqual(texts.map(item => item.slice(0, 2)), [
    ['interviewer', 'How would you diagnose a 502 error?'],
    ['me', 'I finished my answer.'],
    ['me', 'I added the second detail.'],
  ])
})

test('a stuck microphone request does not hold the interviewer answer boundary', async t => {
  const microphone = deferred(); let requests = 0
  const { session, nodes, texts } = setup(t, () => ++requests === 1 ? microphone.promise : Promise.resolve({ text: 'Как работает DNS?' }))
  await session.start()
  const mic = nodes.find(n => n.source === 'me'); mic.push(); mic.pushSilence(); await tick()
  const interviewer = nodes.find(n => n.source === 'interviewer'); interviewer.push(); interviewer.pushSilence(); await tick()
  assert.equal(session.hasPendingInterviewer(), false)
  await session.flushPending(new AbortController().signal, 100)
  assert.deepEqual(texts.filter(item => item[0] === 'interviewer').map(item => item[1]), ['Как работает DNS?'])
  microphone.resolve({ text: 'Сейчас отвечу' })
})

test('a hung interviewer IPC expires without blocking the next question or accepting late text', async t => {
  const late = deferred(); const signals = []; let requests = 0
  const { session, nodes, texts, errors } = setup(t, (_audio, _localOnly, signal) => {
    signals.push(signal)
    return ++requests === 1 ? late.promise : Promise.resolve({ text: 'How does DNS work?' })
  }, { localOnly: true, transcriptionTimeoutMs: 20 })
  await session.start()
  const interviewer = nodes.find(node => node.source === 'interviewer')
  interviewer.push()
  await assert.rejects(session.flushPending(new AbortController().signal, 500), /Распознавание фрагмента превысило время ожидания/)
  assert.equal(signals[0].aborted, true)
  assert.equal(errors.length, 1)
  interviewer.push()
  await session.flushPending(new AbortController().signal, 500)
  late.resolve({ text: 'STALE QUESTION' }); await tick()
  assert.deepEqual(texts.map(item => item.slice(0, 2)), [['interviewer', 'How does DNS work?']])
  assert.equal(session.hasPendingInterviewer(), false)
})

test('microphone overload never evicts queued interviewer questions', async t => {
  const first = deferred(); let requests = 0
  const { session, nodes, texts, errors } = setup(t, () => ++requests === 1 ? first.promise : Promise.resolve({ text: 'How does DNS work?' }), { localOnly: true })
  await session.start()
  const interviewer = nodes.find(node => node.source === 'interviewer')
  const microphone = nodes.find(node => node.source === 'me')
  for (let index = 0; index < 21; index++) { interviewer.push(); interviewer.pushSilence() }
  await tick()
  for (let index = 0; index < 25; index++) { microphone.push(); microphone.pushSilence() }
  await tick()
  first.resolve({ text: 'How does DNS work?' })
  await session.flushPending(new AbortController().signal, 1000)
  assert.equal(texts.filter(item => item[0] === 'interviewer').length, 21, 'candidate audio must not displace a question')
  assert.equal(errors.length, 1, 'one overload episode must not flood the interface with repeated errors')
})
