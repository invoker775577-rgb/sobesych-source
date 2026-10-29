const fs = require('node:fs')
const path = require('node:path')
const CURRENT_SETTINGS_VERSION = 8
const MAX_HISTORY_BYTES = 20_000_000
const MAX_PRACTICE_LIBRARY_BYTES = 8_000_000
const MAX_PRACTICE_LIBRARIES = 10
const MAX_PRACTICE_QUESTIONS = 5_000
const MAX_TOTAL_PRACTICE_QUESTIONS = 10_000
const MAX_PRACTICE_SOURCES = 50
const HISTORY_BACKUP_INTERVAL_MS = 60_000
const MAX_PROFILE_CHARS = 30_000
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}
function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.tmp`
  try {
    fs.writeFileSync(temporary, content, { mode: 0o600 })
    fs.renameSync(temporary, file)
  } catch (error) {
    try { fs.unlinkSync(temporary) } catch { /* The temporary file may not exist. */ }
    throw error
  }
}
function writeJson(file, value) {
  atomicWrite(file, JSON.stringify(value))
}
function serializeHistory(value) {
  if (!Array.isArray(value?.calls) || value.calls.length > 1000) throw new Error('История слишком большая или повреждена')
  let serialized
  try { serialized = JSON.stringify(value) } catch { throw new Error('История слишком большая или повреждена') }
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > MAX_HISTORY_BYTES) {
    throw new Error('История слишком большая или повреждена')
  }
  return serialized
}
function normalizeCandidateProfiles(value) {
  const source = value && typeof value === 'object' ? value : {}
  const profiles = {}
  for (const name of ['devops', 'support']) {
    const text = typeof source[name] === 'string' ? source[name].trim() : ''
    if (text.length > MAX_PROFILE_CHARS) throw new Error('Профиль слишком большой')
    profiles[name] = text
  }
  return profiles
}
function normalizePracticeLibraries(value) {
  if (!Array.isArray(value) || value.length > MAX_PRACTICE_LIBRARIES) throw new Error('Наборы вопросов повреждены или превышают лимит')
  const ids = new Set()
  let totalQuestions = 0
  const libraries = value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Набор вопросов повреждён')
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    const title = typeof item.title === 'string' ? item.title.trim().slice(0, 120) : ''
    const createdAt = typeof item.createdAt === 'string' && !Number.isNaN(Date.parse(item.createdAt)) ? item.createdAt : ''
    const sourceNames = Array.isArray(item.sourceNames) ? item.sourceNames : []
    const questions = Array.isArray(item.questions) ? item.questions : []
    const questionSources = Array.isArray(item.questionSources) ? item.questionSources : []
    const unlabelledFileCount = item.unlabelledFileCount
    const emptyFileCount = item.emptyFileCount
    if (!/^[\w-]{1,80}$/u.test(id) || ids.has(id) || !title || !createdAt || !sourceNames.length || sourceNames.length > MAX_PRACTICE_SOURCES) throw new Error('Набор вопросов повреждён')
    if (!questions.length || questions.length > MAX_PRACTICE_QUESTIONS || questionSources.length !== questions.length) throw new Error('В наборе недопустимое число вопросов')
    if (!Number.isInteger(unlabelledFileCount) || unlabelledFileCount < 0 || unlabelledFileCount > sourceNames.length || !Number.isInteger(emptyFileCount) || emptyFileCount < 0 || emptyFileCount > sourceNames.length) throw new Error('Метаданные набора повреждены')
    if (!sourceNames.every(name => typeof name === 'string' && name.trim().length > 0 && name.length <= 120)) throw new Error('Имена записей в наборе повреждены')
    ids.add(id)
    totalQuestions += questions.length
    const sourceQuestionCounts = Array.from({ length: sourceNames.length }, () => 0)
    const normalizedQuestionSources = questionSources.map(sources => {
      if (!Array.isArray(sources) || !sources.length || sources.some(index => !Number.isInteger(index) || index < 0 || index >= sourceNames.length)) throw new Error('Связи вопросов с записями повреждены')
      const uniqueSources = [...new Set(sources)]
      for (const index of uniqueSources) sourceQuestionCounts[index] += 1
      return uniqueSources
    })
    if (!questions.every(question => typeof question === 'string' && question.trim().length >= 10 && question.trim().length <= 500)) throw new Error('Текст вопросов в наборе повреждён')
    return {
      id, title, createdAt,
      sourceNames: sourceNames.map(name => name.trim()),
      sourceQuestionCounts,
      questions: questions.map(question => question.trim()),
      questionSources: normalizedQuestionSources,
      unlabelledFileCount,
      emptyFileCount,
    }
  })
  if (totalQuestions > MAX_TOTAL_PRACTICE_QUESTIONS || Buffer.byteLength(JSON.stringify(libraries), 'utf8') > MAX_PRACTICE_LIBRARY_BYTES) throw new Error('Сохранённая база вопросов превышает допустимый размер')
  return libraries
}
function readHistory(file) {
  if (fs.statSync(file).size > MAX_HISTORY_BYTES) throw new Error('Файл истории больше допустимого размера')
  const value = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!Array.isArray(value?.calls) || value.calls.length > 1000) throw new Error('В файле истории нет допустимого списка звонков')
  return value
}
function preserveBrokenFile(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  let destination = `${file}.corrupt-${stamp}`
  let suffix = 1
  while (fs.existsSync(destination)) destination = `${file}.corrupt-${stamp}-${suffix++}`
  try { fs.renameSync(file, destination) } catch { fs.copyFileSync(file, destination) }
  return path.basename(destination)
}
function createStore(directory, safeStorage, initial, normalize) {
  const file = path.join(directory, 'settings.json')
  const historyFile = path.join(directory, 'calls.json')
  const historyBackup = `${historyFile}.bak`
  const practiceLibraryFile = path.join(directory, 'practice-library.enc')
  let historyWarning = ''
  let lastSavedHistory = null
  let lastBackupAt = 0
  let practiceLibraries = []
  let practiceLibrariesLocked = false
  let practiceLibrariesWarning = ''
  const saved = readJson(file, {})
  let apiKey = initial.apiKey || ''
  try { if (saved.encryptedKey) apiKey = safeStorage.decryptString(Buffer.from(saved.encryptedKey, 'base64')) } catch { /* Migration can use the local environment key. */ }
  let settings
  try { settings = normalize(saved.settings || {}, { ...initial, apiKey }) } catch { settings = normalize({}, { ...initial, apiKey }) }
  let candidateProfiles = { devops: '', support: '' }
  let profilesLocked = false
  let encryptedProfiles = typeof saved.encryptedProfiles === 'string' ? saved.encryptedProfiles : ''
  if (encryptedProfiles) {
    try {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows encryption is unavailable')
      candidateProfiles = normalizeCandidateProfiles(JSON.parse(safeStorage.decryptString(Buffer.from(encryptedProfiles, 'base64'))))
    } catch { profilesLocked = true }
  }
  if (fs.existsSync(practiceLibraryFile)) {
    try {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows encryption is unavailable')
      const encrypted = fs.readFileSync(practiceLibraryFile, 'utf8')
      if (Buffer.byteLength(encrypted, 'utf8') > MAX_PRACTICE_LIBRARY_BYTES * 2) throw new Error('Practice library file is too large')
      practiceLibraries = normalizePracticeLibraries(JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, 'base64'))))
    } catch {
      practiceLibrariesLocked = true
      practiceLibrariesWarning = 'Сохранённые наборы вопросов не удалось расшифровать или проверить. Исходный файл оставлен без изменений.'
    }
  }
  if (Number(saved.settingsVersion || 0) < 2) settings = normalize({ autoAnswer: false }, settings)
  if (Number(saved.settingsVersion || 0) < 3 && settings.transcriptionBaseUrl === 'https://openrouter.ai/api/v1' && settings.transcriptionModel === 'openai/whisper-1') {
    settings = normalize({ transcriptionModel: 'openai/whisper-large-v3-turbo' }, settings)
  }
  if (Number(saved.settingsVersion || 0) < 4 && settings.baseUrl === 'https://openrouter.ai/api/v1' && settings.model === 'mistralai/mistral-nemo') {
    settings = normalize({ model: 'qwen/qwen3.7-flash' }, settings)
  }
  if (Number(saved.settingsVersion || 0) < 5 && settings.language === 'ru') settings = normalize({ language: 'auto' }, settings)
  const publicConfig = () => { const { apiKey, ...rest } = settings; return { ...rest, hasKey: Boolean(apiKey) } }
  const saveSettings = update => {
    const { candidateProfiles: profileUpdate, ...settingsUpdate } = update || {}
    const next = normalize(settingsUpdate, settings)
    if (next.apiKey && !safeStorage.isEncryptionAvailable()) throw new Error('Windows не может зашифровать ключ. Настройки не сохранены.')
    let nextProfiles = candidateProfiles
    let nextEncryptedProfiles = encryptedProfiles
    if (profileUpdate !== undefined) {
      if (profilesLocked) throw new Error('Профиль не расшифрован Windows. Он не был изменён.')
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows не может зашифровать профиль. Настройки не сохранены.')
      nextProfiles = normalizeCandidateProfiles(profileUpdate)
      nextEncryptedProfiles = safeStorage.encryptString(JSON.stringify(nextProfiles)).toString('base64')
    }
    const { apiKey, ...rest } = next
    writeJson(file, { settings: rest, encryptedKey: apiKey ? safeStorage.encryptString(apiKey).toString('base64') : '', encryptedProfiles: nextEncryptedProfiles, settingsVersion: CURRENT_SETTINGS_VERSION })
    settings = next
    candidateProfiles = nextProfiles
    encryptedProfiles = nextEncryptedProfiles
    return publicConfig()
  }
  const savePracticeLibraries = value => {
    if (practiceLibrariesLocked) throw new Error('Наборы вопросов не расшифрованы Windows и не были изменены')
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows не может зашифровать наборы вопросов')
    const next = normalizePracticeLibraries(value)
    const encrypted = safeStorage.encryptString(JSON.stringify(next)).toString('base64')
    atomicWrite(practiceLibraryFile, encrypted)
    practiceLibraries = next
    return { ok: true }
  }
  if ((settings.apiKey || Number(saved.settingsVersion || 0) < CURRENT_SETTINGS_VERSION) && (!settings.apiKey || safeStorage.isEncryptionAvailable())) saveSettings({})
  const loadState = () => {
    if (fs.existsSync(historyFile)) {
      try {
        const state = readHistory(historyFile)
        lastSavedHistory = JSON.stringify(state)
        lastBackupAt = Date.now()
        return state
      } catch {
        const preserved = preserveBrokenFile(historyFile)
        try {
          const recovered = readHistory(historyBackup)
          atomicWrite(historyFile, JSON.stringify(recovered))
          lastSavedHistory = JSON.stringify(recovered)
          lastBackupAt = Date.now()
          historyWarning = `Файл истории был повреждён. Восстановлена резервная копия, исходный файл сохранён как ${preserved}. Последние изменения могли не попасть в копию.`
          return recovered
        } catch {
          let backupNote = ''
          if (fs.existsSync(historyBackup)) {
            try { backupNote = ` Резервная копия также повреждена и сохранена как ${preserveBrokenFile(historyBackup)}.` } catch { backupNote = ' Резервная копия тоже не читается.' }
          }
          historyWarning = `Файл истории повреждён и сохранён как ${preserved}.${backupNote} Старые данные не удалены; новая история будет записываться отдельно.`
          return null
        }
      }
    }
    if (fs.existsSync(historyBackup)) {
      try {
        const recovered = readHistory(historyBackup)
        atomicWrite(historyFile, JSON.stringify(recovered))
        lastSavedHistory = JSON.stringify(recovered)
        lastBackupAt = Date.now()
        historyWarning = 'Основной файл истории отсутствовал. История восстановлена из резервной копии.'
        return recovered
      } catch {
        try { historyWarning = `Основной файл истории отсутствует, а резервная копия повреждена и сохранена как ${preserveBrokenFile(historyBackup)}.` } catch { historyWarning = 'Основной файл истории и резервная копия не читаются.' }
      }
    }
    return null
  }
  const saveState = value => {
    const serialized = serializeHistory(value)
    if (serialized === lastSavedHistory) return { ok: true, unchanged: true }
    fs.mkdirSync(directory, { recursive: true })
    if (fs.existsSync(historyFile)) {
      let previous
      try {
        previous = readHistory(historyFile)
      } catch {
        const preserved = preserveBrokenFile(historyFile)
        historyWarning = `Перед сохранением повреждённый файл истории сохранён как ${preserved}.`
      }
      if (previous && (!fs.existsSync(historyBackup) || Date.now() - lastBackupAt >= HISTORY_BACKUP_INTERVAL_MS)) {
        atomicWrite(historyBackup, JSON.stringify(previous))
        lastBackupAt = Date.now()
      }
    }
    atomicWrite(historyFile, serialized)
    lastSavedHistory = serialized
    return { ok: true }
  }
  return {
    publicConfig, saveSettings, getSettings: () => ({ ...settings }),
    getCandidateProfiles: () => ({ ...candidateProfiles }),
    candidateProfilesStatus: () => profilesLocked ? 'locked' : Object.values(candidateProfiles).some(Boolean) ? 'ready' : 'empty',
    getPracticeLibraries: () => JSON.parse(JSON.stringify(practiceLibraries)),
    practiceLibrariesStatus: () => practiceLibrariesLocked ? 'locked' : practiceLibraries.length ? 'ready' : 'empty',
    practiceLibrariesWarning: () => practiceLibrariesWarning,
    savePracticeLibraries,
    loadState, historyWarning: () => historyWarning, saveState,
  }
}
module.exports = { createStore, readJson, writeJson, normalizeCandidateProfiles, normalizePracticeLibraries }
