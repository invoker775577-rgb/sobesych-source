import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { buildPrompt, createService, localAnswer, resolveSettings } from '../server.mjs'

const { createStore } = createRequire(import.meta.url)('../electron/store.cjs')
const legacy = { profileContext: 'PRIVATE_LEGACY_RESUME', focus: 'PRIVATE_LEGACY_ROLE' }
const interviewer = text => ({ speaker: 'interviewer', text })

test('every answer mode ignores legacy resume, role and style fields at the provider boundary', async () => {
  const requests = []
  const service = createService({
    getSettings: () => resolveSettings({ apiKey: 'fixture-key' }),
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body))
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'Fixture answer' } }] }) }
    },
  })
  for (const question of [
    'Расскажи кейс работы с системой мониторинга.',
    'Как вы используете AI-инструменты в работе?',
    'Have you worked with a message queue?',
    'Что такое reverse proxy?',
    'Почему хлеб поднимается в духовке?',
  ]) {
    const input = { mode: 'answer', messages: [interviewer(question)] }
    assert.equal(localAnswer({ ...input, ...legacy }), '')
    assert.equal(buildPrompt({ ...input, ...legacy }), buildPrompt(input))
    const before = requests.length
    await service.assist({ ...input, ...legacy })
    assert.equal(requests.length, before + 1, 'one direct request, no resume check or classifier')
    const payload = JSON.stringify(requests.at(-1))
    assert.doesNotMatch(payload, /PRIVATE_LEGACY|Candidate background|Резюме и опыт|cannot confirm|подтвердить не могу|For unknown experience, stop/)
  }
})

test('work stories receive a concrete labelled example without checking a resume in RU and EN', () => {
  for (const [question, english] of [
    ['Расскажи последнюю задачу с Kubernetes.', false],
    ['Кейсы, как ты работал с системой мониторинга?', false],
    ['Tell me about your last task with a queue.', true],
    ['How do you use AI tools at work?', true],
  ]) {
    const prompt = buildPrompt({ mode: 'answer', messages: [interviewer(question)], ...legacy })
    assert.match(prompt, english ? /Example scenario/ : /Пример кейса/)
    assert.match(prompt, english ? /2-3 concrete actions/ : /2-3 действия/)
    assert.match(prompt, english ? /how to check the result/ : /как проверить результат/)
    assert.doesNotMatch(prompt, /PRIVATE_LEGACY|No relevant candidate facts|Подтверждённые факты/)
  }
})

test('more detail continues the same scenario after the caller reads the answer, including a repeated follow-up', () => {
  for (const english of [false, true]) {
    const question = english ? 'Tell me about your last Kubernetes task.' : 'Расскажи свою последнюю задачу с Kubernetes.'
    const draft = english ? 'Example scenario. I would add a readiness probe to the ticket app. SCENARIO_ANCHOR.' : 'Пример кейса. Я бы добавил readiness probe в сервис заявок. SCENARIO_ANCHOR.'
    const lines = [interviewer(question), { speaker: 'assistant', text: draft }, { speaker: 'me', text: english ? 'I would add a probe to the app.' : 'Я бы добавил пробу в сервис.' }, interviewer(english ? 'Can you give more details?' : 'А подробнее?')]
    const prompt = buildPrompt({ mode: 'answer', messages: lines })
    assert.match(prompt, /SCENARIO_ANCHOR/)
    assert.match(prompt, english ? /Keep its scenario and assumptions/ : /Сохрани ситуацию, технологию и условия/)
    assert.doesNotMatch(prompt, /cannot confirm|подтвердить не могу|Candidate background|Резюме и опыт/)
    const followup = buildPrompt({ mode: 'answer', messages: [...lines, interviewer(english ? 'Tell me more.' : 'Расскажи поподробнее.')] })
    assert.match(followup, /SCENARIO_ANCHOR/)
    const changed = buildPrompt({ mode: 'answer', messages: [...lines, interviewer(english ? 'What is DNS?' : 'Что такое DNS?')] })
    assert.doesNotMatch(changed, /SCENARIO_ANCHOR/)
  }
})

test('profile metadata remains recoverable and opaque without changing a locked API key', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sobesych-no-resume-'))
  const backups = `${directory}-backups`
  const backup = join(backups, 'before-update')
  mkdirSync(backup, { recursive: true })
  const saved = { settingsVersion: 8, encryptedKey: 'LOCKED_API_BYTES', encryptedProfiles: 'LOCKED_RESUME_BYTES', candidateProfiles: { devops: 'PRIVATE_PLAINTEXT' }, settings: { candidateProfile: 'support', model: 'fixture/model', language: 'en' } }
  const state = { calls: [{ id: 'kept-call', messages: [{ speaker: 'me', text: 'Keep the conversation' }] }], ...legacy }
  try {
    for (const folder of [directory, backup]) {
      writeFileSync(join(folder, 'settings.json'), JSON.stringify(saved))
      writeFileSync(join(folder, 'calls.json'), JSON.stringify(state))
      writeFileSync(join(folder, 'calls.json.bak'), JSON.stringify(state))
    }
    const locked = { isEncryptionAvailable: () => false, decryptString: () => { throw new Error('locked') } }
    const store = createStore(directory, locked, {}, resolveSettings)
    assert.equal(store.getSettings().practiceProfile, 'support')
    assert.equal(store.getSettings().model, 'fixture/model')
    assert.equal(store.getSettings().language, 'en')
    assert.equal('candidateProfile' in store.getSettings(), false)
    assert.deepEqual(store.loadState(), { calls: state.calls })
    for (const folder of [directory, backup]) {
      const settings = JSON.parse(readFileSync(join(folder, 'settings.json'), 'utf8'))
      assert.equal(settings.encryptedKey, saved.encryptedKey)
      assert.equal(settings.encryptedProfiles, saved.encryptedProfiles)
      assert.equal(settings.candidateProfiles.devops, saved.candidateProfiles.devops)
      for (const name of ['calls.json', 'calls.json.bak']) {
        assert.equal(JSON.parse(readFileSync(join(folder, name), 'utf8')).profileContext, legacy.profileContext)
      }
    }
    assert.doesNotMatch(JSON.stringify(store.publicConfig()), /LOCKED_RESUME|PRIVATE_/)
    store.saveSettings({ candidateProfiles: { devops: 'NEVER_SAVE_THIS' } })
    store.saveState({ calls: state.calls, profileContext: 'NEVER_SAVE_THIS' })
    assert.doesNotMatch(readFileSync(join(directory, 'settings.json'), 'utf8'), /NEVER_SAVE_THIS/)
    assert.doesNotMatch(readFileSync(join(directory, 'calls.json'), 'utf8'), /NEVER_SAVE_THIS/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
    rmSync(backups, { recursive: true, force: true })
  }
})
