export type CodeLanguage = 'python' | 'sql' | 'javascript'
export type CodeResult = { ok: boolean; output: string; error?: string; elapsedMs: number }
const runtimeFiles = { python: ['pyodide.js', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'], sql: ['sql-wasm.js', 'sql-wasm.wasm'], javascript: [] }

// This function is serialized into a worker owned by an opaque-origin sandboxed iframe.
// It receives source code and fixed runtime bytes, never Node, preload IPC, keys or documents.
function workerBootstrap() {
  self.onmessage = async event => {
    const { language, code, assets } = event.data
    const send = self.postMessage.bind(self)
    let output = ''; let started = 0
    const format = (value: unknown): string => {
      if (typeof value === 'string') return value
      if (typeof value === 'bigint') return `${value}n`
      try { return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? `${item}n` : item) ?? String(value) }
      catch { return String(value) }
    }
    const write = (value: unknown) => {
      const text = format(value)
      if (output.length + text.length + 1 > 16000) throw new Error('Вывод превысил 16 000 символов')
      output += `${text}\n`
    }
    const files = new Map<string, ArrayBuffer>(assets)
    const decode = (name: string) => new TextDecoder().decode(files.get(name))
    // Runtime loading is served from an allowlist in memory, not the network.
    self.fetch = async input => {
      const name = String(input).split('/').at(-1)!
      const bytes = files.get(name)
      if (!bytes) throw new Error('Сеть в песочнице недоступна')
      return new Response(bytes, { headers: { 'content-type': name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' } })
    }
    for (const name of ['XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker', 'indexedDB', 'caches']) {
      Object.defineProperty(self, name, { value: undefined, configurable: false, writable: false })
    }
    try {
      let execute: () => unknown
      if (language === 'python') {
        // Pinned Pyodide exposes the module constructor so its dynamic import can be avoided.
        const moduleSource = decode('pyodide.asm.mjs').replaceAll('import.meta.url', JSON.stringify('https://sandbox.invalid/pyodide.asm.mjs')).replace(/export default _createPyodideModule;?\s*$/, 'return _createPyodideModule;')
        const factory = new Function(moduleSource)()
        // Pinned local runtime only; user code runs later in this isolated worker.
        // eslint-disable-next-line no-eval
        ;(0, eval)(decode('pyodide.js'))
        const runtime = await (self as unknown as { loadPyodide: (options: unknown) => Promise<{ runPythonAsync: (code: string) => Promise<unknown> }> }).loadPyodide({
          indexURL: 'https://sandbox.invalid/', lockFileContents: JSON.parse(decode('pyodide-lock.json')),
          createPyodideModule: (options: Record<string, unknown>) => factory({ ...options, wasmBinary: files.get('pyodide.asm.wasm') }),
          stdout: write, stderr: write, stdin: () => null,
        })
        execute = () => runtime.runPythonAsync(code)
      } else if (language === 'sql') {
        // eslint-disable-next-line no-eval
        ;(0, eval)(decode('sql-wasm.js'))
        const runtime = await (self as unknown as { initSqlJs: (options: unknown) => Promise<{ Database: new () => { exec: (code: string) => unknown; close: () => void } }> }).initSqlJs({ wasmBinary: files.get('sql-wasm.wasm') })
        execute = () => { const db = new runtime.Database(); try { write(db.exec(code)) } finally { db.close() } }
      } else {
        const log = (...args: unknown[]) => write(args.map(format).join(' '))
        const console = { log, error: log, warn: log, info: log, debug: log, assert: (condition: unknown, message = 'Assertion failed') => { if (!condition) throw new Error(message) } }
        execute = () => new Function('console', `'use strict';\n${code}`)(console)
      }
      Object.defineProperty(self, 'postMessage', { value: undefined, configurable: false, writable: false })
      send({ type: 'started' }); started = performance.now()
      await execute()
      send({ type: 'result', result: { ok: true, output, elapsedMs: Math.round(performance.now() - started) } })
    } catch (error) {
      send({ type: 'result', result: { ok: false, output, error: error instanceof Error ? error.message : String(error), elapsedMs: started ? Math.round(performance.now() - started) : 0 } })
    }
  }
}

export async function runCode(language: CodeLanguage, code: string, signal?: AbortSignal): Promise<CodeResult> {
  if (code.length > 50000) throw new Error('Для проверки доступно до 50 000 символов кода')
  signal?.throwIfAborted()
  const preparingAt = performance.now()
  const preparingSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000)
  const assets = await Promise.all(runtimeFiles[language].map(async name => {
    const url = new URL(`./runtimes/${language === 'python' ? 'python' : 'sql'}/${name}`, document.baseURI)
    const response = await fetch(url, { signal: preparingSignal })
    if (!response.ok) throw new Error('Локальная среда проверки кода недоступна. Проверь сборку приложения.')
    return [name, await response.arrayBuffer()] as const
  })).catch(error => { if (signal?.aborted) throw new DOMException('Проверка отменена', 'AbortError'); if (preparingSignal.aborted) throw new Error('Не удалось подготовить локальную среду за 30 секунд'); throw error })
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const key = crypto.randomUUID(); const frame = document.createElement('iframe')
    frame.hidden = true; frame.sandbox.add('allow-scripts')
    frame.setAttribute('aria-label', 'Изолированная проверка кода')
    let timer: ReturnType<typeof setTimeout>; let finished = false; let started = false
    const finish = (result?: CodeResult, error?: unknown) => {
      if (finished) return
      finished = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); window.removeEventListener('message', receive)
      frame.contentWindow?.postMessage({ key, cancel: true }, '*'); frame.remove()
      if (error) reject(error); else resolve(result!)
    }
    const abort = () => finish(undefined, new DOMException('Проверка отменена', 'AbortError'))
    const deadline = (milliseconds: number, message: string) => { clearTimeout(timer); timer = setTimeout(() => finish({ ok: false, output: '', error: message, elapsedMs: milliseconds }), milliseconds) }
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data?.key !== key) return
      if (event.data.type === 'ready') frame.contentWindow?.postMessage({ key, language, code, assets, workerSource: `(${workerBootstrap.toString()})()` }, '*')
      else if (event.data.type === 'started' && !started) { started = true; deadline(10000, 'Выполнение остановлено через 10 секунд') }
      else if (event.data.type === 'result') {
        const value = event.data.result
        if (value && typeof value.ok === 'boolean' && typeof value.output === 'string' && value.output.length <= 16000 && Number.isFinite(value.elapsedMs) && (!value.error || typeof value.error === 'string' && value.error.length <= 16000)) finish(value)
        else finish({ ok: false, output: '', error: 'Среда вернула недопустимый результат', elapsedMs: 0 })
      }
    }
    window.addEventListener('message', receive); signal?.addEventListener('abort', abort, { once: true })
    frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; worker-src blob:; connect-src 'none'; img-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><script>
      (() => { const key = ${JSON.stringify(key)}; let worker;
      addEventListener('message', event => { if(event.source !== parent || event.data?.key !== key) return;
        if(event.data.cancel) { worker?.terminate(); return; }
        const { workerSource, ...job } = event.data;
        const url = URL.createObjectURL(new Blob([workerSource], {type:'text/javascript'}));
        worker = new Worker(url); URL.revokeObjectURL(url);
        worker.onmessage = event => parent.postMessage({...event.data,key}, '*');
        worker.onerror = () => parent.postMessage({key,type:'result',result:{ok:false,output:'',error:'Ошибка изолированной среды',elapsedMs:0}}, '*');
        worker.postMessage(job);
      }); parent.postMessage({key,type:'ready'}, '*'); })();
    </script>`
    deadline(Math.max(1, 30000 - (performance.now() - preparingAt)), 'Не удалось запустить локальную среду за 30 секунд')
    document.body.append(frame)
  })
}
