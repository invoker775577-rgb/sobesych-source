import { test } from 'node:test'
import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { encodeWav } from '../src/audio.mjs'

const require = createRequire(import.meta.url)
const modulePath = require.resolve('../electron/local-stt.cjs')
const audio = `data:audio/wav;base64,${Buffer.from(encodeWav(new Float32Array(8000), 16000)).toString('base64')}`
function setup(t, launch, fetchImpl, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sobesych-stt-unit-'))
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
  mkdirSync(join(root, 'cuda', 'Release'), { recursive: true })
  writeFileSync(join(root, 'cuda', 'Release', 'whisper-server.exe'), 'test placeholder, never executed')
  for (const name of ['cublas64_11.dll', 'cublasLt64_11.dll', 'ggml-cuda.dll', 'ggml.dll', 'ggml-base.dll', 'whisper.dll', 'cudart64_110.dll']) writeFileSync(join(root, 'cuda', 'Release', name), 'test placeholder')
  if (options.cpu) {
    mkdirSync(join(root, 'cpu', 'Release'), { recursive: true })
    writeFileSync(join(root, 'cpu', 'Release', 'whisper-server.exe'), 'test placeholder, never executed')
  }
  writeFileSync(join(root, 'ggml-large-v3-turbo-q5_0.bin'), 'test placeholder')
  t.mock.method(childProcess, 'spawn', launch)
  t.mock.method(globalThis, 'fetch', fetchImpl)
  delete require.cache[modulePath]
  const { createLocalStt } = require(modulePath)
  const stt = createLocalStt(root, root, options)
  t.after(() => { stt.stop(); delete require.cache[modulePath]; rmSync(root, { recursive: true, force: true }) })
  return stt
}

test('local recognizer spawn failure is a rejected startup, not an uncaught process error', async t => {
  let child
  let spawned
  const started = new Promise(resolve => { spawned = resolve })
  const stt = setup(t, () => {
    child = new EventEmitter()
    child.kill = () => {}
    spawned()
    return child
  }, async () => { throw new Error('The helper has no listening port') })
  // Verify the installed listener without deliberately emitting an unhandled error.
  const startup = stt.start()
  void startup.catch(() => {})
  await started
  assert.ok(child.listenerCount('error') > 0, 'The helper process needs an error listener before startup polling')
  child.emit('error', Object.assign(new Error('fixture access denied'), { code: 'EACCES' }))
  await assert.rejects(startup, /Локальная модель речи не запустилась/)
})

test('local recognizer rejects cancellation before spawning or submitting audio', async t => {
  let launches = 0
  const stt = setup(t, () => { launches++; throw new Error('Must not spawn') }, async () => { throw new Error('Must not fetch') })
  const controller = new AbortController()
  const reason = new Error('fixture canceled')
  controller.abort(reason)
  await assert.rejects(stt.transcribe({ audio: 'invalid' }, 'auto', controller.signal), error => error === reason)
  assert.equal(launches, 0)
})

test('stopping during port allocation cannot leave a newly spawned helper running', async t => {
  let launches = 0
  const stt = setup(t, () => { launches++; throw new Error('Must not spawn') }, async () => { throw new Error('Must not fetch') })
  const startup = stt.start()
  stt.stop()
  await assert.rejects(startup, /Локальное распознавание остановлено/)
  assert.equal(launches, 0)
})

test('cancellation during startup prevents inference once the shared helper becomes ready', async t => {
  const controller = new AbortController()
  const reason = new Error('fixture canceled during startup')
  let requests = 0
  const stt = setup(t, () => {
    const child = new EventEmitter()
    child.kill = () => {}
    return child
  }, async () => { requests++; controller.abort(reason); return new Response('ready') })
  await assert.rejects(stt.transcribe({ audio }, 'auto', controller.signal), error => error === reason)
  assert.equal(requests, 1, 'Only the helper readiness check is allowed')
})

test('malformed audio is rejected before allocating a helper process', async t => {
  let launches = 0
  const stt = setup(t, () => { launches++; throw new Error('Must not spawn') }, async () => { throw new Error('Must not fetch') })
  await assert.rejects(stt.transcribe({ audio: 'invalid' }, 'auto'), /Некорректный аудиофрагмент/)
  assert.equal(launches, 0)
})

test('final transcripts receive only technical vocabulary while previews remain unprompted', async t => {
  const prompts = []
  const stt = setup(t, () => {
    const child = new EventEmitter()
    child.kill = () => {}
    return child
  }, async (url, options) => {
    if (new URL(url).pathname === '/inference') prompts.push(options.body.get('prompt'))
    return Response.json({ text: 'fixture' })
  })
  await stt.transcribe({ audio, provisional: true }, 'auto')
  await stt.transcribe({ audio }, 'auto')
  assert.equal(prompts[0], null)
  assert.match(prompts[1], /Kubernetes.*Docker.*Terraform.*Kafka.*gRPC/)
  assert.doesNotMatch(prompts[1], /\d|Transactions|ShopID|Shop ID/i, 'Do not bias task-specific identifiers or values')
})

test('local recognizer restart invalidates its previous warmup and recovers after a failed launch', async t => {
  const children = []
  let inferenceRequests = 0
  let spawned
  const started = new Promise(resolve => { spawned = resolve })
  const stt = setup(t, () => {
    const child = new EventEmitter()
    child.kill = () => child.emit('exit', 0)
    children.push(child)
    spawned()
    return child
  }, async (url, options) => {
    if (children.length === 1) {
      throw new Error('Not ready')
    }
    if (new URL(url).pathname === '/inference') {
      inferenceRequests++
      assert.ok(options.body instanceof FormData)
      return Response.json({ text: '' })
    }
    return new Response('ready')
  })
  const warming = stt.warmup()
  void warming.catch(() => {})
  await started
  assert.ok(children[0].listenerCount('error') > 0)
  children[0].emit('error', new Error('fixture could not launch'))
  await assert.rejects(warming, /Локальная модель речи не запустилась/)
  await stt.warmup()
  assert.equal(inferenceRequests, 1)
  children[0].emit('exit', 1)
  await stt.warmup()
  assert.equal(children.length, 2, 'A late exit from an older helper cannot invalidate its replacement')
  assert.equal(inferenceRequests, 1)
  children[1].emit('exit', 1)
  await stt.warmup()
  assert.equal(children.length, 3)
  assert.equal(inferenceRequests, 2, 'A restarted helper must perform a new warmup')
})

test('CPU mode starts lazily, caps CPU/BLAS threads, and keeps the original model and decoding parameters', async t => {
  const launches = []
  const stt = setup(t, (exe, args, options) => {
    launches.push({ exe, args, options })
    const child = new EventEmitter()
    child.kill = () => child.emit('exit', 0)
    return child
  }, async (url, options) => {
    if (new URL(url).pathname === '/inference') {
      for (const name of ['audio_ctx', 'no_timestamps', 'token_timestamps']) assert.equal(options.body.get(name), null)
      assert.equal(options.body.get('language'), 'en')
    }
    return Response.json({ text: 'fixture' })
  }, { cpu: true, mode: 'cpu', threads: 100 })
  assert.equal(launches.length, 0)
  assert.equal(stt.status().running, false)
  await stt.transcribe({ audio }, 'en-US')
  assert.match(launches[0].exe, /cpu[\\/]Release/)
  assert.ok(launches[0].args.includes('--no-gpu'))
  assert.match(launches[0].args[launches[0].args.indexOf('-m') + 1], /large-v3-turbo/)
  const threads = launches[0].args[launches[0].args.indexOf('-t') + 1]
  assert.ok(Number(threads) >= 1 && Number(threads) <= 4)
  assert.equal(launches[0].options.env.OPENBLAS_NUM_THREADS, threads)
  assert.equal(launches[0].options.env.OMP_NUM_THREADS, threads)
})

test('CPU fallback disables expensive repeated previews and shares one concurrent startup', async t => {
  let launches = 0
  const stt = setup(t, () => {
    launches++
    const child = new EventEmitter()
    child.kill = () => child.emit('exit', 0)
    return child
  }, async () => Response.json({ text: '' }), { cpu: true, mode: 'cpu' })
  const first = stt.warmup()
  const second = stt.warmup()
  assert.equal(first, second)
  assert.deepEqual(await first, { ok: true, backend: 'cpu', previewEnabled: false })
  assert.equal(launches, 1)
})

test('a failed CUDA startup falls back to CPU once and retains the shared startup promise', async t => {
  const children = []
  const stt = setup(t, () => {
    const child = new EventEmitter()
    child.kill = () => child.emit('exit', 0)
    children.push(child)
    if (children.length === 1) setImmediate(() => child.emit('error', new Error('fixture CUDA unavailable')))
    return child
  }, async () => {
    if (children.length === 1) throw new Error('fixture not ready')
    return Response.json({ text: '' })
  }, { cpu: true, gpuAvailable: async () => true })
  const first = stt.warmup()
  const second = stt.transcribe({ audio }, 'auto')
  assert.equal((await first).backend, 'cpu')
  await second
  assert.equal(children.length, 2)
})

test('release aborts active inference and permits a new helper without stale exit interference', async t => {
  const children = []
  let submitted
  const pendingRequest = new Promise(resolve => { submitted = resolve })
  const stt = setup(t, () => {
    const child = new EventEmitter()
    child.kill = () => {}
    children.push(child)
    return child
  }, async (url, options) => {
    if (new URL(url).pathname === '/inference' && children.length === 1) {
      submitted()
      return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }))
    }
    return Response.json({ text: 'new session' })
  })
  const pending = stt.transcribe({ audio }, 'auto')
  await pendingRequest
  stt.release()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(stt.status().running, false)
  assert.equal((await stt.transcribe({ audio }, 'auto')).text, 'new session')
  children[0].emit('exit', 0)
  assert.equal(stt.status().running, true)
  assert.equal(children.length, 2)
})

test('release during startup rejects the old request and does not make stop terminal', async t => {
  let launches = 0
  const stt = setup(t, () => {
    launches++
    const child = new EventEmitter()
    child.kill = () => child.emit('exit', 0)
    return child
  }, async () => Response.json({ text: '' }))
  const pending = stt.warmup()
  stt.release()
  await assert.rejects(pending, /остановлено/)
  await stt.warmup()
  assert.equal(launches, 1)
  stt.stop()
  await assert.rejects(stt.warmup(), /остановлено/)
})

test('a stuck inference is bounded, releases its helper, and the next fragment can recover', async t => {
  const children = []
  let submissions = 0
  const stt = setup(t, () => {
    const child = new EventEmitter()
    child.kills = 0
    child.kill = () => { child.kills++ }
    children.push(child)
    return child
  }, async (url, options) => {
    if (new URL(url).pathname !== '/inference') return new Response('ready')
    if (++submissions === 1) return new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
    })
    return Response.json({ text: 'Recovered question' })
  }, { inferenceTimeoutMs: 20 })
  const pending = stt.transcribe({ audio }, 'auto')
  const guard = setTimeout(() => stt.release(), 500)
  try { await assert.rejects(pending, /Распознавание фрагмента превысило время ожидания/) }
  finally { clearTimeout(guard) }
  assert.equal(children[0].kills, 1)
  assert.equal(stt.status().running, false)
  assert.equal(submissions, 1, 'a timed-out inference must not start an automatic retry loop')
  assert.equal((await stt.transcribe({ audio }, 'auto')).text, 'Recovered question')
  children[0].emit('exit', 0)
  assert.equal(stt.status().running, true, 'a late exit must not invalidate the recovered helper')
})

test('a helper crash retries the same local audio once without losing the question', async t => {
  const children = []; const submitted = []
  const stt = setup(t, () => {
    const child = new EventEmitter()
    child.kill = () => child.emit('exit', 0)
    children.push(child)
    return child
  }, async (url, options) => {
    if (new URL(url).pathname !== '/inference') return new Response('ready')
    submitted.push(await options.body.get('file').arrayBuffer())
    if (children.length === 1) return new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
      children[0].emit('exit', 1)
    })
    return Response.json({ text: 'What is a reverse proxy?' })
  })
  assert.equal((await stt.transcribe({ audio }, 'en')).text, 'What is a reverse proxy?')
  assert.equal(children.length, 2)
  assert.deepEqual(submitted[0], submitted[1])
})

test('repeated helper crashes stop after one retry and never spin in the background', async t => {
  const children = []
  const stt = setup(t, () => {
    const child = new EventEmitter()
    child.kill = () => child.emit('exit', 0)
    children.push(child)
    return child
  }, async (url, options) => {
    if (new URL(url).pathname !== '/inference') return new Response('ready')
    return new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
      children.at(-1).emit('exit', 1)
    })
  })
  await assert.rejects(stt.transcribe({ audio }, 'auto'), /Движок распознавания завершился с ошибкой после повторного запуска/)
  assert.equal(children.length, 2)
  assert.equal(stt.status().running, false)
})

test('canceling local audio never retries it or kills the reusable helper', async t => {
  let launches = 0; let submissions = 0; let kills = 0
  const controller = new AbortController()
  const stt = setup(t, () => {
    launches++
    const child = new EventEmitter()
    child.kill = () => { kills++ }
    return child
  }, async (url, options) => {
    if (new URL(url).pathname !== '/inference') return new Response('ready')
    submissions++
    return new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
      controller.abort(new Error('fixture user cancellation'))
    })
  })
  await assert.rejects(stt.transcribe({ audio }, 'auto', controller.signal), /fixture user cancellation/)
  assert.equal(launches, 1)
  assert.equal(submissions, 1)
  assert.equal(kills, 0)
})
