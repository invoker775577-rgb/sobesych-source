export function rms(samples: Float32Array): number
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer>
export class SpeechSegmenter {
  constructor(sampleRate: number, onSegment: (samples: Float32Array, utteranceId: number | null, speechStartedAt: number, speechEndedAt: number) => void, options?: { onPreview?: (samples: Float32Array, utteranceId: number, speechStartedAt: number, speechEndedAt: number) => void; previewAfterSeconds?: number; previewEverySeconds?: number; endSilenceSeconds?: number; detectSpeech?: (samples: Float32Array) => boolean })
  push(samples: Float32Array): number
  hasBufferedSpeech(): boolean
  flush(): void
  reset(): void
}
