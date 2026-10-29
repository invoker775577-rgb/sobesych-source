export function detectPracticeSpeechLocale(text?: string): 'ru-RU' | 'en-US'
export function resolvePracticeTranscriptionLanguage(question?: string, preference?: string, knownLanguage?: string): 'auto' | 'ru' | 'en'
export function createPracticeUtterance(text: string, UtteranceCtor: new (text: string) => SpeechSynthesisUtterance, voices?: SpeechSynthesisVoice[]): SpeechSynthesisUtterance
