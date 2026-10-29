import { isTranscriptNoise } from './transcript.mjs'

const MAX_TRANSCRIPT_CHARS = 2_000_000
const MAX_QUESTIONS = 100
const MAX_TRANSCRIPT_FILES = 50
const speakerWordStart = '(?<![\\p{L}\\p{N}_])'
const speakerWordEnd = '(?![\\p{L}\\p{N}_])'
const directAddress = new RegExp(`${speakerWordStart}(?:ты|тебе|тебя|твой|твоя|твое|твоё|твои|твою|твоей|твоём|твоем|твоими|вы|вам|вас|ваш|ваша|ваше|ваши|вашу|вашей|вашем|вашими|you|your)${speakerWordEnd}`, 'iu')
const interviewerImperative = /(?<![\p{L}\p{N}_])(?:расскажи(?:те)?|опиши(?:те)?|объясни(?:те)?|поясни(?:те)?|приведи(?:те)?|покажи(?:те)?|подскажи(?:те)?|назови(?:те)?|tell me|walk me through)(?![\p{L}\p{N}_])/iu

const invitation = /^(?:(?:давайте|please)(?=$|[^\p{L}\p{N}_])[\s,:-]*)?(?:(?:если не против|if you do not mind)(?=$|[^\p{L}\p{N}_])[\s,:-]*)?(?:расскажи(?:те)?(?=$|[^\p{L}\p{N}_])|опиши(?:те)?(?=$|[^\p{L}\p{N}_])|приведи(?:те)?\s+(?:пример|ситуац)\p{L}*|поясни(?:те)?(?=$|[^\p{L}\p{N}_])|tell me about\b|walk me through\b|describe\b|give me an example\b|can you (?:describe|tell me about)\b)/iu
const speakerLabel = '(?:собеседник|интервьюер|кандидат|вы|interviewer|candidate|you|speaker\\s+\\d+)'
const speakerLine = new RegExp(`^\\s*(?<label>${speakerLabel})(?:\\s+(?<time>\\d{1,2}:\\d{2}(?::\\d{2})?))?\\s*(?::\\s*(?<inline>.*))?\\s*$`, 'iu')
const inlineAfterTime = new RegExp(`^\\s*(?<label>${speakerLabel})\\s+\\d{1,2}:\\d{2}(?::\\d{2})?\\s+(?<inline>.+?)\\s*$`, 'iu')
const timeOnly = /^\s*\d{1,2}:\d{2}(?::\d{2})?\s*$/u
const panelHandoff = /^\p{Lu}[\p{L}'’-]{1,30},\s*(?:у\s+тебя\s+есть\s+вопрос(?:ы|ов)|do\s+you\s+have\s+(?:any\s+)?questions?)\s*[?!.]*$/iu
const lowSignalQuestion = /^(?:(?:ну|а|и)\s+)?(?:что\s+(?:ещ[её](?:\s+рассказать)?|дальше|рассказать|делать)|дальше\s+что|есть\s+ли\s+что-?то\s+такое|есть\s+вопрос(?:ы|ов)?|what\s+(?:else|next|to\s+do)|anything\s+else|any\s+questions)\s*[?!.]*$/iu
const meetingLogisticsQuestion = /^(?:(?:привет|алло)[,\s]+)?(?:(?:меня\s+)?слышно(?:\s+меня)?|как\s+слышно(?:\s+меня)?|микрофон\s+(?:пропал|не\s+работает|работает)|(?:у\s+вас\s+)?(?:пропал|не\s+работает)\s+микрофон|can\s+you\s+hear\s+me|is\s+my\s+mic\s+(?:working|on)|audio\s+check)(?![\p{L}\p{N}_])/iu

function sentenceSegments(text) {
  if (typeof Intl.Segmenter === 'function') {
    return [...new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text)].map(item => item.segment)
  }
  return text.match(/[^?!.\n]+[?!.]?/gu) || []
}

export function extractPracticeTranscript(input) {
  const source = String(input ?? '').replace(/^\uFEFF/u, '')
  if (source.length > MAX_TRANSCRIPT_CHARS) throw new RangeError('Текст больше 2 МБ. Выбери файл покороче.')

  const blocks = [{ speaker: 'unknown', lines: [] }]
  let block = blocks[0]
  let hasRoleLabels = false
  const resolveSpeaker = label => /^(?:собеседник|интервьюер|interviewer)$/iu.test(label)
    ? 'interviewer'
    : /^(?:вы|кандидат|candidate|you)$/iu.test(label) ? 'candidate' : 'unknown'

  for (const line of source.replace(/^\s*\(?transcribed by turboscribe[^\n]*\)?\s*$/gimu, '').split(/\r?\n/u)) {
    const parsed = speakerLine.exec(line) || inlineAfterTime.exec(line)
    if (parsed) {
      block = { speaker: resolveSpeaker(parsed.groups.label), lines: [] }
      blocks.push(block)
      if (block.speaker !== 'unknown') hasRoleLabels = true
      if (parsed.groups.inline?.trim()) block.lines.push(parsed.groups.inline.trim())
    } else if (!timeOnly.test(line)) {
      block.lines.push(line)
    }
  }

  const questions = []
  const seen = new Set()
  const questionBlocks = hasRoleLabels ? blocks.filter(item => item.speaker === 'interviewer') : blocks
  for (const item of questionBlocks) {
    for (const part of sentenceSegments(item.lines.join('\n'))) {
      const question = part.replace(/[\s\r\n]+/gu, ' ').trim().replace(/^[\s•*-]+/u, '')
      const isQuestion = /[?？]["'»”)]*$/u.test(question) || invitation.test(question)
      if (!isQuestion || question.length < 10 || question.length > 500 || isTranscriptNoise(question) || panelHandoff.test(question) || lowSignalQuestion.test(question) || meetingLogisticsQuestion.test(question)) continue
      const key = question.toLocaleLowerCase('ru-RU').replace(/\s+/gu, ' ')
      if (seen.has(key)) continue
      seen.add(key)
      questions.push(question)
      if (questions.length >= MAX_QUESTIONS) return { questions, hasSpeakerLabels: hasRoleLabels }
    }
  }
  return { questions, hasSpeakerLabels: hasRoleLabels }
}

export function extractPracticeQuestions(input) {
  return extractPracticeTranscript(input).questions
}

export function classifyPracticeQuestionAudience(question) {
  const text = String(question ?? '')
  return directAddress.test(text) || interviewerImperative.test(text) ? 'addressed' : 'review'
}

export function mergePracticeTranscripts(transcripts) {
  if (!Array.isArray(transcripts) || transcripts.length === 0) {
    return { questions: [], questionSources: [], sourceNames: [], sourceQuestionCounts: [], hasSpeakerLabels: false, sourceCount: 0, unlabelledFileCount: 0, emptyFileCount: 0 }
  }
  if (transcripts.length > MAX_TRANSCRIPT_FILES) throw new RangeError(`Можно загрузить не больше ${MAX_TRANSCRIPT_FILES} TXT за раз.`)

  const questions = []
  const questionSources = []
  const seen = new Map()
  const sourceNames = transcripts.map((transcript, index) => transcript?.fileName?.slice(0, 120) || `Запись ${index + 1}`)
  let unlabelledFileCount = 0
  let emptyFileCount = 0
  for (const [sourceIndex, transcript] of transcripts.entries()) {
    const parsed = extractPracticeTranscript(transcript?.text)
    if (!parsed.hasSpeakerLabels) unlabelledFileCount += 1
    if (!parsed.questions.length) emptyFileCount += 1
    for (const question of parsed.questions) {
      const key = question.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
      const existingIndex = seen.get(key)
      if (existingIndex !== undefined) {
        questionSources[existingIndex].add(sourceIndex)
        continue
      }
      seen.set(key, questions.length)
      questions.push(question)
      questionSources.push(new Set([sourceIndex]))
    }
  }
  const sourceQuestionCounts = Array.from({ length: transcripts.length }, () => 0)
  const indexedQuestionSources = questionSources.map(sources => {
    const indexes = [...sources]
    for (const sourceIndex of indexes) sourceQuestionCounts[sourceIndex] += 1
    return indexes
  })
  return {
    questions,
    questionSources: indexedQuestionSources,
    sourceNames,
    sourceQuestionCounts,
    hasSpeakerLabels: unlabelledFileCount === 0,
    sourceCount: transcripts.length,
    unlabelledFileCount,
    emptyFileCount,
  }
}
