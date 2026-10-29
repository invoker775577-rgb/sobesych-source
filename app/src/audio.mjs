export function rms(samples) {
  let sum = 0
  for (const sample of samples) sum += sample * sample
  return Math.sqrt(sum / Math.max(1, samples.length))
}
export function encodeWav(samples, sampleRate) {
  const rate = 16000
  const length = Math.floor(samples.length * rate / sampleRate)
  const buffer = new ArrayBuffer(44 + length * 2)
  const view = new DataView(buffer)
  const text = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)) }
  text(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); text(8, 'WAVE'); text(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, length * 2, true)
  // Average source samples while downsampling to avoid aliasing from point sampling.
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * sampleRate / rate)
    const end = Math.max(start + 1, Math.floor((i + 1) * sampleRate / rate))
    let sum = 0
    for (let j = start; j < end && j < samples.length; j++) sum += samples[j]
    const value = Math.max(-1, Math.min(1, sum / (end - start)))
    view.setInt16(44 + i * 2, value * (value < 0 ? 32768 : 32767), true)
  }
  return new Uint8Array(buffer)
}
const MAX_SPEECH_SECONDS = 20
export class SpeechSegmenter {
  constructor(sampleRate, onSegment, { onPreview, previewAfterSeconds = 3, previewEverySeconds = 0, endSilenceSeconds = 0.3, detectSpeech } = {}) {
    this.rate = sampleRate; this.onSegment = onSegment; this.onPreview = onPreview
    this.detectSpeech = detectSpeech
    this.previewAfter = sampleRate * previewAfterSeconds
    this.previewEvery = sampleRate * previewEverySeconds
    this.endSilence = sampleRate * endSilenceSeconds
    this.nextUtteranceId = 0; this.reset()
  }
  reset() { this.parts = []; this.pre = []; this.preSize = 0; this.size = 0; this.voiced = 0; this.silent = 0; this.noise = 0.001; this.voiceEnergy = 0; this.peak = 0; this.utteranceId = null; this.speechStartedAt = null; this.speechEndedAt = null; this.nextPreviewAt = this.previewAfter }
  hasBufferedSpeech() { return this.parts.length > 0 && this.voiced >= this.rate * 0.32 }
  snapshot() {
    const samples = new Float32Array(this.size)
    let offset = 0
    for (const part of this.parts) { samples.set(part, offset); offset += part.length }
    return samples
  }
  push(samples) {
    const level = rms(samples)
    const speech = this.detectSpeech ? this.detectSpeech(samples) : level > Math.max(0.004, Math.min(0.02, this.noise * 3))
    if (!this.parts.length && !speech) {
      this.noise = this.noise * 0.98 + Math.min(level, 0.006) * 0.02
      this.pre.push(samples); this.preSize += samples.length
      while (this.preSize > this.rate * 0.25 && this.pre.length > 1) this.preSize -= this.pre.shift().length
      return level
    }
    if (!this.parts.length) {
      this.speechStartedAt = performance.now()
      this.parts = this.pre; this.size = this.preSize; this.pre = []; this.preSize = 0
      this.utteranceId = ++this.nextUtteranceId
    }
    this.parts.push(samples); this.size += samples.length
    if (speech) {
      this.speechEndedAt = performance.now()
      this.voiced += samples.length; this.voiceEnergy += level * samples.length; this.peak = Math.max(this.peak, level); this.silent = 0
      if (this.onPreview && this.voiced >= this.nextPreviewAt) {
        const next = this.nextPreviewAt + this.previewEvery
        this.nextPreviewAt = this.previewEvery > 0 ? Math.max(next, this.voiced + this.previewEvery) : Infinity
        this.onPreview(this.snapshot(), this.utteranceId, this.speechStartedAt, this.speechEndedAt)
      }
    } else this.silent += samples.length
    if (this.silent >= this.endSilence || this.size >= this.rate * MAX_SPEECH_SECONDS) this.flush()
    return level
  }
  flush() {
    const averageVoice = this.voiceEnergy / Math.max(1, this.voiced)
    if (this.voiced >= this.rate * 0.32 && (this.detectSpeech || this.peak >= 0.01 && averageVoice >= 0.005)) {
      this.onSegment(this.snapshot(), this.utteranceId, this.speechStartedAt, this.speechEndedAt ?? performance.now())
    }
    this.parts = []; this.size = 0; this.voiced = 0; this.silent = 0; this.voiceEnergy = 0; this.peak = 0; this.utteranceId = null; this.nextPreviewAt = this.previewAfter
  }
}
