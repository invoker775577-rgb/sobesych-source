import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyPracticeQuestionAudience, extractPracticeQuestions, extractPracticeTranscript, mergePracticeTranscripts } from '../src/practice-import.mjs'

test('extracts editable Russian and English questions from plain interview transcripts', () => {
  const transcript = `(Transcribed by TurboScribe. Remove this line.)
Я сейчас вам позадаю вопросы. Если не секрет, почему вы решили найти другую работу? Там интересная история. У меня компания хорошая.
Давайте, если не против, расскажите коротко о своей работе.
The service was slow after release. How did you find the cause? I checked the logs first.`

  assert.deepEqual(extractPracticeQuestions(transcript), [
    'Если не секрет, почему вы решили найти другую работу?',
    'Давайте, если не против, расскажите коротко о своей работе.',
    'How did you find the cause?',
  ])
})

test('removes diarization labels, deduplicates, and ignores answer text without question cues', () => {
  const transcript = `Собеседник
14:48:29
Как безопасно откатить релиз в production?
Вы
14:48:42
Я сначала проверю состояние сервиса и логи.
Что ещё рассказать о проекте?
Interviewer
14:49:03
Как безопасно откатить релиз в production?
Candidate
14:49:15
I would check the last good version.`

  assert.deepEqual(extractPracticeQuestions(transcript), ['Как безопасно откатить релиз в production?'])
})

test('uses explicit speaker roles and supports inline labels with timestamps', () => {
  const transcript = `Интервьюер: Расскажите, как вы устроили выкладку в Kubernetes.
Вы: Как бы ты проверил проблему с сетью?
Собеседник 14:49:03: Как безопасно откатить релиз в production?
Кандидат 14:49:15: Я бы вернул прошлую версию.`

  assert.deepEqual(extractPracticeQuestions(transcript), [
    'Расскажите, как вы устроили выкладку в Kubernetes.',
    'Как безопасно откатить релиз в production?',
  ])
  assert.equal(extractPracticeTranscript(transcript).hasSpeakerLabels, true)
})

test('keeps unlabelled text and unknown numbered speakers editable instead of guessing roles', () => {
  const transcript = `Speaker 1: How do you check a failed deployment?
Speaker 2: What do you know about Kubernetes?`

  assert.deepEqual(extractPracticeQuestions(transcript), [
    'How do you check a failed deployment?',
    'What do you know about Kubernetes?',
  ])
  assert.equal(extractPracticeTranscript(transcript).hasSpeakerLabels, false)
})

test('unlabelled questions get conservative audience hints with Unicode-safe Russian boundaries', () => {
  assert.equal(classifyPracticeQuestionAudience('Если не секрет, почему вы решили искать работу?'), 'addressed')
  assert.equal(classifyPracticeQuestionAudience('Как бы ты проверил сбой в Kubernetes?'), 'addressed')
  assert.equal(classifyPracticeQuestionAudience('Давайте расскажите про последний инцидент.'), 'addressed')
  assert.equal(classifyPracticeQuestionAudience('Have you worked with gRPC?'), 'addressed')
  assert.equal(classifyPracticeQuestionAudience('Почему я про это говорю?'), 'review')
  assert.equal(classifyPracticeQuestionAudience('Что изменилось после релиза?'), 'review')
  assert.equal(classifyPracticeQuestionAudience('Какие проверки выкатили после деплоя?'), 'review')
})

test('filters transcript filler and questions addressed to another interview panelist', () => {
  const transcript = `Расскажите, как вы нашли причину production-инцидента?
Тимур, у тебя есть вопросы?
Thanks for watching?
У вас был опыт настройки GitLab CI?`

  assert.deepEqual(extractPracticeQuestions(transcript), [
    'Расскажите, как вы нашли причину production-инцидента?',
    'У вас был опыт настройки GitLab CI?',
  ])
})

test('drops meeting audio checks but keeps the technical question that follows', () => {
  const transcript = `Привет, как слышно?
Микрофон пропал у вас с кэшем?
Как вы проверяете кэш после изменения конфигурации?`

  assert.deepEqual(extractPracticeQuestions(transcript), [
    'Как вы проверяете кэш после изменения конфигурации?',
  ])
})

test('drops empty conversational follow-ups but keeps specific interview questions', () => {
  const transcript = `Расскажите, как вы нашли причину ошибки в проде?
Что еще рассказать?
Дальше что?
Есть ли что-то такое?
Как вы проверили, что после изменения ошибки ушли?`

  assert.deepEqual(extractPracticeQuestions(transcript), [
    'Расскажите, как вы нашли причину ошибки в проде?',
    'Как вы проверили, что после изменения ошибки ушли?',
  ])
})

test('does not guess questions from ordinary statements and rejects oversized transcript text', () => {
  assert.deepEqual(extractPracticeQuestions('I worked with Linux and Docker. Я проверял логи и метрики.'), [])
  assert.throws(() => extractPracticeQuestions('x'.repeat(2_000_001)), /2 МБ/)
})

test('merges multiple transcript files, deduplicates punctuation variants, and reports missing speaker labels', () => {
  const merged = mergePracticeTranscripts([
    { fileName: 'devops-a.txt', text: 'Собеседник: Расскажите, как вы работали с Argo CD?' },
    { fileName: 'devops-b.txt', text: 'Собеседник: Расскажите, как вы работали с Argo CD.\nВы: Я настраивал GitOps.' },
    { fileName: 'support.txt', text: 'Обычный текст без вопросов.' },
  ])

  assert.deepEqual(merged.questions, ['Расскажите, как вы работали с Argo CD?'])
  assert.deepEqual(merged.questionSources, [[0, 1]])
  assert.deepEqual(merged.sourceNames, ['devops-a.txt', 'devops-b.txt', 'support.txt'])
  assert.deepEqual(merged.sourceQuestionCounts, [1, 1, 0])
  assert.equal(merged.sourceCount, 3)
  assert.equal(merged.unlabelledFileCount, 1)
  assert.equal(merged.emptyFileCount, 1)
  assert.equal(merged.hasSpeakerLabels, false)
})

test('rejects transcript batches larger than the supported file count', () => {
  assert.throws(() => mergePracticeTranscripts(Array.from({ length: 51 }, () => ({ text: '' }))), /не больше 50 TXT/)
})
