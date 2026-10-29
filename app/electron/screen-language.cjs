const { spawn } = require('node:child_process')
const path = require('node:path')
const { StringDecoder } = require('node:string_decoder')

function screenLanguageFromLines(lines) {
  if (!Array.isArray(lines)) return undefined
  for (const value of lines.slice(0, 6)) {
    if (typeof value !== 'string') continue
    const line = value.trim()
    if (/^(?:SELECT|FROM|WHERE|JOIN|GROUP|ORDER|WITH|CREATE|def|function|return|class)\b/i.test(line)) continue
    if (/^(?:what|how|which|why|write|find|give|calculate|implement)\b/i.test(line)) return 'en'
    if (/^(?:как|что|какой|какие|какая|чему|почему|напиши|напишите|найди|найдите|выведи|выведите|посчитай|реализуй)(?:\s|[?!,.]|$)/iu.test(line)) return 'ru'
  }
  return undefined
}

function imagePayload(screenshot) {
  const image = typeof screenshot === 'string' && screenshot.match(/^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/=]+)$/)
  return image && image[1].length <= Math.ceil(4 * 1024 * 1024 * 4 / 3) ? image[1] : undefined
}

// Prepare only after an explicit selection request; no image is supplied yet.
function prepareScreenLanguage({ signal, timeoutMs = 1200, startupTimeoutMs = timeoutMs * 2, spawnImpl = spawn } = {}) {
  const root = path.dirname(__dirname)
  const script = path.join(path.basename(root) === 'app.asar' ? `${root}.unpacked` : root, 'electron', 'screen-language.ps1')
  let child; let timer; let finished = false; let supplied = false; let ready = false; let deadline = 0; let output = ''; let bytes = 0; let resolveResult
  const decoder = new StringDecoder('utf8')
  const result = new Promise(resolve => { resolveResult = resolve })
  const finish = language => {
    if (finished) return
    finished = true
    clearTimeout(timer)
    signal?.removeEventListener('abort', stopped)
    if (child && child.exitCode === null) {
      try { child.kill() } catch { /* Cleanup must not hold a completed OCR result. */ }
    }
    resolveResult(language)
  }
  const stopped = () => finish(undefined)
  const receive = payload => {
    if (finished) return
    if (payload?.ready === true && !('lines' in payload)) {
      if (ready) return
      ready = true
      if (supplied) {
        clearTimeout(timer)
        const remaining = deadline - Date.now()
        if (remaining <= 0) stopped()
        else timer = setTimeout(stopped, Math.min(timeoutMs, remaining))
      }
      return
    }
    finish(supplied && Array.isArray(payload?.lines) ? screenLanguageFromLines(payload.lines) : undefined)
  }
  if (signal?.aborted) finish(undefined)
  else try {
    child = spawnImpl(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
    child.on('error', stopped)
    child.stdin.on('error', stopped)
    child.stdout.on('error', stopped)
    child.stdout.on('data', chunk => {
      if (finished) return
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytes += buffer.length
      if (bytes > 64_000) { stopped(); return }
      output += decoder.write(buffer)
      let newline
      while (!finished && (newline = output.indexOf('\n')) >= 0) {
        const line = output.slice(0, newline).trim()
        output = output.slice(newline + 1)
        if (!line) continue
        try { receive(JSON.parse(line)) }
        catch { stopped(); return }
      }
      if (finished || !output.trim()) return
      let payload
      try { payload = JSON.parse(output) }
      catch { return }
      output = ''
      receive(payload)
    })
    child.on('close', stopped)
    signal?.addEventListener('abort', stopped, { once: true })
    if (signal?.aborted) stopped()
  } catch { stopped() }
  return {
    detect(screenshot) {
      if (supplied) return Promise.resolve(undefined)
      supplied = true
      if (finished) return result
      const image = imagePayload(screenshot)
      if (!image) { stopped(); return result }
      const allowance = ready ? timeoutMs : Math.max(timeoutMs, startupTimeoutMs)
      deadline = Date.now() + allowance
      timer = setTimeout(stopped, allowance)
      try { child.stdin.end(JSON.stringify({ image })) }
      catch { stopped() }
      return result
    },
    stop: stopped,
  }
}

function detectScreenLanguage(screenshot, options = {}) {
  if (!imagePayload(screenshot) || options.signal?.aborted) return Promise.resolve(undefined)
  const reader = prepareScreenLanguage(options)
  return reader.detect(screenshot).finally(reader.stop)
}

module.exports = { detectScreenLanguage, prepareScreenLanguage, screenLanguageFromLines }
