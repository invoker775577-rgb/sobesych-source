import assert from 'node:assert/strict'
import test from 'node:test'
import { createPracticeUtterance, detectPracticeSpeechLocale, resolvePracticeTranscriptionLanguage } from '../src/practice-voice.mjs'

class MockUtterance {
  constructor(text) { this.text = text }
}

test('selects speech language from the question rather than technical acronyms', () => {
  assert.equal(detectPracticeSpeechLocale('Что такое gRPC и когда он нужен?'), 'ru-RU')
  assert.equal(detectPracticeSpeechLocale('When would you use gRPC instead of a message queue?'), 'en-US')
  assert.equal(detectPracticeSpeechLocale(''), 'ru-RU')
})

test('practice transcription uses the known question language without being misled by technology names', () => {
  assert.equal(resolvePracticeTranscriptionLanguage('Как работает gRPC и когда он нужен?'), 'ru')
  assert.equal(resolvePracticeTranscriptionLanguage('When would you use gRPC instead of a message queue?'), 'en')
  assert.equal(resolvePracticeTranscriptionLanguage('gRPC and Kubernetes', 'auto'), 'auto')
  assert.equal(resolvePracticeTranscriptionLanguage('Короткий вопрос', 'auto', 'en'), 'en')
  assert.equal(resolvePracticeTranscriptionLanguage('How does Docker work?', 'ru', 'en'), 'ru')
})

test('creates a natural-rate utterance and prefers a matching installed system voice', () => {
  const russianVoice = { lang: 'ru-RU', name: 'Russian voice' }
  const utterance = createPracticeUtterance('  Как работает Kubernetes?  ', MockUtterance, [
    { lang: 'en-US', name: 'English voice' },
    russianVoice,
  ])

  assert.equal(utterance.text, 'Как работает Kubernetes?')
  assert.equal(utterance.lang, 'ru-RU')
  assert.equal(utterance.voice, russianVoice)
  assert.equal(utterance.rate, 0.95)
})

test('falls back to the browser-selected system voice if no locale match is installed', () => {
  const utterance = createPracticeUtterance('How do you debug a failed deployment?', MockUtterance, [{ lang: 'fr-FR' }])
  assert.equal(utterance.lang, 'en-US')
  assert.equal(utterance.voice, null)
})
