export type VoiceDetector = { detectSpeech(samples: Float32Array): boolean; destroy(): void }
export function createVoiceDetector(sampleRate: number): Promise<VoiceDetector>
