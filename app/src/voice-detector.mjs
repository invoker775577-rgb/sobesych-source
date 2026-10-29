import loadVad, { VADMode, VADEvent } from '@ozymandiasthegreat/vad'
import { encodeWav } from './audio.mjs'

let constructorPromise
function loadConstructor() {
  if (!constructorPromise) constructorPromise = loadVad().catch(error => { constructorPromise = undefined; throw error })
  return constructorPromise
}

export async function createVoiceDetector(sampleRate) {
  if (!Number.isSafeInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000 || sampleRate % 50 !== 0) {
    throw new Error('Неподдерживаемая частота звука для детектора речи')
  }
  const VAD = await loadConstructor()
  const detector = new VAD(VADMode.LOW_BITRATE, 16000)
  const frame = new Float32Array(sampleRate / 50)
  let size = 0; let previous = false; let destroyed = false
  return {
    detectSpeech(samples) {
      if (destroyed) throw new Error('Детектор речи остановлен')
      let voice = false; let processed = false
      for (let offset = 0; offset < samples.length;) {
        const length = Math.min(frame.length - size, samples.length - offset)
        frame.set(samples.subarray(offset, offset + length), size)
        size += length; offset += length
        if (size < frame.length) continue
        const wav = encodeWav(frame, sampleRate)
        // The library reads the whole backing buffer, so give it an owned PCM frame.
        const pcm = new Int16Array(wav.buffer, 44).slice()
        const result = detector.processFrame(pcm)
        if (result === VADEvent.ERROR) throw new Error('Детектор речи не смог обработать звук')
        previous = result === VADEvent.VOICE
        voice ||= previous; processed = true; size = 0
      }
      return processed ? voice : previous
    },
    destroy() {
      if (destroyed) return
      destroyed = true; size = 0; previous = false
      detector.destroy()
    },
  }
}
