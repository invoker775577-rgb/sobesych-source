import { localSocialReply } from './transcript.mjs'

export function isScreenTaskFollowup(text = '') {
  const question = text.trim()
  // Relative "that" describes a named object, not necessarily the selected task.
  const references = question.replace(/(\b(?:a|an|the)\s+(?:(?!(?:this|that|it|and|or|but|if|when|then)\b)[\p{L}\p{N}._/-]+\s+){1,6})that\b/giu, '$1')
  if (localSocialReply(question)) return false
  if (/(?:нов(?:ый|ая|ое)\s+(?:вопрос|задача|тема)|друг(?:ой|ая|ую)\s+(?:вопрос|задач|тема)|сменим\s+тему|(?:new|different|another)\s+(?:question|task|topic)|change the subject)/iu.test(question)) return false
  return /^(?:а\s+(?:если|что|как|почему|зачем|где|теперь)|и\s+(?:если|что|как|почему)|теперь|тогда|пусть|добав(?:ь|им)|убер(?:и|ём)|замени|перепиши|измени|покажи|объясни|поясни)(?:\s|[,.!?]|$)/iu.test(question)
    || /(?:эт(?:от|ого|ому|им|ом|у|ой|а|о)|здесь|тут|вместо|в\s+нашем\s+(?:запросе|коде|решении))/iu.test(question) && /^(?:почему|как|что|зачем|мож(?:но|ешь|ете)|чем|где)/iu.test(question)
    || /^(?:and\s+(?:if|what|how|why)|what\s+if|what\s+about|how\s+about|in\s+that\s+case|then|now|add|remove|replace|rewrite|change|update|explain|show)(?:\s|[,.!?]|$)/iu.test(question)
    || /^(?:why|how|what|can|could|would|does|do|is)\b/iu.test(question) && /\b(?:this|that|it|here|instead|our (?:query|code|solution)|the (?:query|code|solution))\b/iu.test(references)
}

const isAcknowledgement = text => /^(?:да|нет|ага|угу|ок(?:ей)?|хорошо|понятно|спасибо|yes|no|ok(?:ay)?|right|thanks|thank you)[.!?,\s]*$/iu.test(text.trim())

export function screenTaskFollowupMessages(messages = [], answerId = '', capturedAt = '') {
  const anchor = messages.findIndex(message => message.id === answerId && message.speaker === 'assistant')
  if (anchor < 0) return null
  const capturedTime = Date.parse(capturedAt)
  const continuation = Number.isFinite(capturedTime)
    ? [messages[anchor], ...messages.filter(message => message.id !== answerId && Date.parse(message.createdAt) >= capturedTime)]
    : messages.slice(anchor)
  let socialExchange = false
  // Ignore greetings and their replies without discarding the selected task.
  const discussion = continuation.filter(message => {
    if (message.speaker === 'interviewer') socialExchange = Boolean(localSocialReply(message.text))
    return !socialExchange
  })
  if (socialExchange) return null
  const questions = discussion.filter(message => message.speaker === 'interviewer')
  if (!questions.length || !isScreenTaskFollowup(questions.at(-1).text) || !questions.every(message => isScreenTaskFollowup(message.text) || isAcknowledgement(message.text))) return null
  // Preserve the original solution and every spoken condition. Old generated drafts can be omitted.
  const previousAnswers = discussion.filter(message => message.speaker === 'assistant').slice(-2)
  return discussion.filter((message, index) => index === 0 || message.speaker === 'interviewer' || previousAnswers.includes(message))
}
