export function detectPracticeSpeechLocale(text = '') {
  const value = String(text)
  const cyrillic = value.match(/\p{Script=Cyrillic}/gu)?.length || 0
  const latin = value.match(/\p{Script=Latin}/gu)?.length || 0
  return latin > cyrillic ? 'en-US' : 'ru-RU'
}

const technicalTerms = /\b(?:grpc|kubernetes|k8s|docker|terraform|ansible|gcp|gcs|aws|azure|cloud run|cloud sql|sql|api|ci\s*\/\s*cd|gitlab|nginx|ingress|haproxy|wireguard|vault|approle|jwt|consul|prometheus|grafana|alertmanager|greenplum|postgresql|redis|rabbitmq|kafka|minio|ceph|rustfs|apache nifi|argo cd|linux|http|https|iam|cpu|ram)\b/giu

export function resolvePracticeTranscriptionLanguage(question = '', preference = 'auto', knownLanguage = '') {
  if (preference === 'ru' || preference === 'en') return preference
  if (knownLanguage === 'ru' || knownLanguage === 'en') return knownLanguage
  const words = String(question).replace(technicalTerms, ' ').match(/[a-zа-яё]{2,}/giu) || []
  const cyrillic = words.filter(word => /\p{Script=Cyrillic}/u.test(word)).length
  const latin = words.length - cyrillic
  if (words.length < 2 || cyrillic === latin) return 'auto'
  return cyrillic > latin ? 'ru' : 'en'
}

export function createPracticeUtterance(text, UtteranceCtor, voices = []) {
  const utterance = new UtteranceCtor(String(text).trim())
  utterance.lang = detectPracticeSpeechLocale(utterance.text)
  utterance.rate = 0.95
  utterance.voice = voices.find(voice => voice.lang?.toLowerCase() === utterance.lang.toLowerCase())
    || voices.find(voice => voice.lang?.toLowerCase().startsWith(utterance.lang.slice(0, 2).toLowerCase()))
    || null
  return utterance
}
