const gcsProjectMigrationPatterns = [
  /\b(?:migrat\p{L}*|mov\p{L}*|transfer\p{L}*)\b.{0,70}\b(?:project\p{L}*|service\p{L}*|application\p{L}*|system\p{L}*)\b/iu,
  /\b(?:project\p{L}*|service\p{L}*|application\p{L}*|system\p{L}*)\b.{0,70}\b(?:migrat\p{L}*|mov\p{L}*|transfer\p{L}*)\b/iu,
  /(?:перенос\p{L}*|миграц\p{L}*).{0,70}(?:проект\p{L}*|сервис\p{L}*|приложен\p{L}*|систем\p{L}*)/iu,
  /(?:проект\p{L}*|сервис\p{L}*|приложен\p{L}*|систем\p{L}*).{0,70}(?:перенос\p{L}*|миграц\p{L}*)/iu,
]

export function normalizeTranscriptText(value = '') {
  // Literal code is not speech and must not receive vocabulary or whitespace repairs.
  if (String(value).includes('`')) return String(value)
  let text = String(value)
    .normalize('NFKC')
    .replace(/[ \t\r\n]+/g, ' ')
    .replace(/([!?.,])\1{2,}/g, '$1')
    .replace(/\b(?:type[- ]?hungry|five[- ]?hundred[- ]?and[- ]?two|fifty[- ]?two)\s+errors?\b/gi, '502 errors')
    .replace(/\bengine(?:'s)?\s+ingress\b/gi, 'Nginx Ingress')
    .replace(/\bG\s*R\s*P\s*C\b/gi, 'gRPC')
    .replace(/\b[ck]ubernets?\b/gi, 'Kubernetes')
    .replace(/(^|[^\p{L}\p{N}_])минио(?=$|[^\p{L}\p{N}_])/giu, '$1MinIO')
    .replace(/(^|[^\p{L}\p{N}])(?:ансибл|анзибл)(?:[аеуыом]*)?(?=$|[^\p{L}\p{N}])/giu, '$1Ansible')
    .replace(/(^|[^\p{L}\p{N}_])дак[ао]р[- ]контейнер(?=$|[^\p{L}\p{N}_])/giu, '$1Docker контейнер')
    .replace(/\brebin(?:\.|\s*)mq\b/gi, 'RabbitMQ')
    .replace(/\bwireglass\b/gi, 'WireGuard')
    .replace(/\bsysktl\b/gi, 'sysctl')
    .replace(/\bhyperproxy\b/gi, 'HAProxy')
    .replace(/\babro\b/gi, 'AppRole')
    .replace(/\blearnmanager\b/gi, 'Alertmanager')
    .replace(/\bunigink\b/gi, 'Nginx')
    .replace(/\bibtable\b/gi, 'iptables')
    .replace(/(^|[^\p{L}\p{N}_])green\s+plum(?=$|[^\p{L}\p{N}_])/giu, '$1Greenplum')
    .replace(/(^|[^\p{L}\p{N}_])гринпл(?:ам|ум)(?=$|[^\p{L}\p{N}_])/giu, '$1Greenplum')
    .replace(/\bhashcorp\s+falcon\b/gi, 'HashiCorp Vault')
    .replace(/\bcontrol[- ]track(?:ing)?\b/gi, 'conntrack')
    .replace(/\bJ\s*CP\b/gi, 'GCP')
    .replace(/был\s+лобот[а-яё]*\s*,?\s*связан/giu, 'был опыт, связан')
    .replace(/переносн(?:ым|ой)\s+проектом/giu, 'переносом проекта')
    .replace(/что\s+бы\s+ты\s+проявил/giu, 'что бы ты проверил')
    .replace(/\bin\s+the[.,]?\s+og\s+hvað\s+company\b/giu, 'in your previous company')
    .trim()
  const hasGoogleCloudContext = /\b(?:GCP|Cloud Run|Cloud SQL|Google Cloud Platform)\b/i.test(text)
  const hasStorageContext = /\b(?:Cloud Storage|storage|bucket|buckets|object storage|file storage)\b|(?:бакет|хранилищ|объект|файл)\p{L}*/iu.test(text)
  const hasLinuxOpsContext = /\b(?:Linux|Ubuntu|sysctl|kernel|hardening|tuning)\b|линукс|убунту|ядр\p{L}*|хардинг\p{L}*|тюнинг\p{L}*/iu.test(text)
  const hasNetworkContext = /\b(?:VPN|WireGuard|WireGlass|network)\b|сет\p{L}*|туннел\p{L}*|маршрут\p{L}*/iu.test(text)
  const hasDatabaseContext = /\b(?:Kafka|ClickHouse|PostgreSQL|SQL|database)\b|баз\p{L}*|колончат\p{L}*/iu.test(text)
  if (!/["'«»]|\b(?:SELECT|INSERT|UPDATE|CREATE|ALTER)\b/iu.test(text) && /реализационн\p{L}*\s+баз\p{L}*\s+дан\s*ных/iu.test(text)) {
    text = text.replace(/(^|[^\p{L}\p{N}_])(не)?реализационн(ая|ой|ую|ые|ых|ым|ыми)(?=$|[^\p{L}\p{N}_])/giu, '$1$2реляционн$3')
  }
  if (/\bnginx\b.{0,60}\bingress\b|\bingress\b.{0,60}\bnginx\b/i.test(text)) {
    text = text.replace(/\bin\s+cuba\s+or\s+nets?\b/gi, 'in Kubernetes')
  }
  if (hasLinuxOpsContext) {
    text = text.replace(/(^|[^\p{L}\p{N}_])линдекс(?:а|у|е|ом)?(?=$|[^\p{L}\p{N}_])/giu, '$1Linux')
    text = text.replace(/(^|[^\p{L}\p{N}_])сс?ктл(?:а|у|е|ом|ы)?(?=$|[^\p{L}\p{N}_])/giu, '$1sysctl')
  }
  if (hasNetworkContext) text = text.replace(/\bAir[ -]?Guard\b/gi, 'WireGuard')
  if (hasDatabaseContext) {
    text = text.replace(/(^|[^\p{L}\p{N}_])(?:крик|клик)\s*хаус(?:е|а|у|ом|ы)?(?=$|[^\p{L}\p{N}_])/giu, '$1ClickHouse')
  }
  if (/\bSQL\b/i.test(text) && /(?:отлич|разниц|сравн)/iu.test(text) && /\b(?:LEFT|RIGHT|FULL|CROSS)\s+JOIN\b/i.test(text) && !/`|\b(?:SELECT|FROM)\b|['"«»]/iu.test(text)) {
    text = text.replace(/\b(?:INR|NR)\s+JOIN\b/gi, 'INNER JOIN')
    text = text.replace(/(отличаются\s+|разница\s+между\s+|сравни\s+)(?:NRJN|ERJN)(?=\s+и\s+(?:LEFT|RIGHT|FULL|CROSS)\s+JOIN\b)/giu, '$1INNER JOIN')
    text = text.replace(/(отличаются\s+|разница\s+между\s+|сравни\s+)ENER\s+JOIN(?=\s+и\s+(?:LEFT|RIGHT|FULL|CROSS)\s+JOIN\b)/giu, '$1INNER JOIN')
  }
  const gcsIsProjectDestination = /\b(?:to|into|onto)\s+GCS\b|(?:в|на)\s+GCS\b/i.test(text)
  const mentionsProjectMigration = gcsProjectMigrationPatterns.some(pattern => pattern.test(text))
  const asksToMoveProjectToGcs = gcsIsProjectDestination && mentionsProjectMigration
  if (/\bGCS\b/i.test(text) && !hasStorageContext && (hasGoogleCloudContext || asksToMoveProjectToGcs)) {
    text = text.replace(/\bGCS\b/gi, 'GCP')
  }
  if (/\bGreenplum\b/i.test(text) && /segment|сегмент/i.test(text)) {
    text = text.replace(/\bcoordernit(?:ra|ry)\b/gi, 'coordinator')
  }
  if (/\b(?:Argo\s*CD|GitOps)\b/i.test(text)) text = text.replace(/\bpool[- ]based\b/gi, 'pull-based')
  return /(?:docker|докер|container|контейнер)/i.test(text)
    ? text.replace(/\b(?:ICD|CISD|NCICD|CICD|CI\s+slash\s+CD)\b/gi, 'CI/CD')
    : text
}

export function normalizeMessageText(message) {
  return message.origin === 'manual' || message.speaker === 'assistant'
    ? String(message.text)
    : normalizeTranscriptText(message.text)
}

export function insertTranscriptMessage(messages = [], next) {
  return [...messages, next]
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const timeDifference = Date.parse(a.item.createdAt) - Date.parse(b.item.createdAt)
      return Number.isFinite(timeDifference) && timeDifference !== 0 ? timeDifference : a.index - b.index
    })
    .map(entry => entry.item)
}

export function localSocialReply(value = '') {
  const greeting = value.toLowerCase().replace(/[,.!?;:]+/g, ' ').replace(/\s+/g, ' ').trim()
  const phrase = '(?:привет|здравствуй|здравствуйте|добрый день|добрый вечер|доброе утро|hello|hi)'
  if (new RegExp(`^${phrase}(?: ${phrase})*$`, 'i').test(greeting)) return /[а-яё]/i.test(greeting) ? 'Здравствуйте.' : 'Hello.'
  if (/^(?:how are you|how is it going|how are things)$/i.test(greeting)) return "I'm doing well, thank you. How about you?"
  if (/^(?:как дела|как вы|как поживаете)$/i.test(greeting)) return 'Спасибо, всё хорошо. А у вас как?'
  return ''
}

export function isTranscriptNoise(value = '') {
  const text = normalizeTranscriptText(value)
  if (!text) return true
  const lower = text.toLocaleLowerCase('ru-RU')
  const compact = lower.replace(/[!?.,:;'"«»()[\]{}-]+/g, ' ').replace(/\s+/g, ' ').trim()
  const noiseLead = /^(?:субтитры|subtitles?|редактор\s+субтитров|корректор\s+субтитров|subtitle editor|спасибо за просмотр|thanks for watching|thank you|с вами был|подписывайтесь|приятного просмотра)(?=\s|$)/u
  const lead = compact.match(noiseLead)
  if (lead && !interviewWords.test(compact.slice(lead[0].length))) return true
  if (/^(продолжение следует|to be continued)$/u.test(compact)) return true
  if (/^(так|ну|ээ|эм|мм|ага|угу|окей|ладно|конец|до свидания|um|uh|mm hmm|you)$/u.test(compact)) return true
  const letters = lower.replace(/[^a-zа-яё]/giu, '')
  if (letters.length >= 6 && new Set([...letters]).size <= 2) return true
  if (/([a-zа-яё])\1{5,}/iu.test(letters)) return true
  return false
}

const interviewWords = /(?:^|[^\p{L}\p{N}_])(?:(?:почему|как|что|чем|зачем|где|когда|сколько|какой|какая|какие)(?![-‐‑‒–—](?:то|нибудь|либо))|опыт|случай|объясни\p{L}*|расскаж\p{L}*|опиши\p{L}*|назови\p{L}*|напиши\p{L}*|реши\p{L}*|выведи\p{L}*|составь\p{L}*|покажи\p{L}*|диагност\p{L}*|отлича\p{L}*|разница|может|можно|нужно|надо|будешь|сделаешь|работает|причин\p{L}*|ошибк\p{L}*|load average|cpu|linux|docker|kubernetes|devops|support|how|what|why|when|where|which|could|would|can|have you|explain|describe|tell|walk|compare|debug|diagnose|troubleshoot)(?=$|[^\p{L}\p{N}_])/iu
const fillerQuestionWord = /(?:^|[^\p{L}\p{N}_])(?:что|как|почему|зачем|где|когда|сколько|какой|какая|какие|кто|куда|откуда)[-‐‑‒–—](?:то|нибудь|либо)(?=$|[^\p{L}\p{N}_])/iu

function isLowInformationSpeech(value = '') {
  const text = normalizeTranscriptText(value)
  if (/^[\p{Lu}\d]{2,8}[.!?]?$/u.test(text)) return false
  const hasFillerQuestionWord = fillerQuestionWord.test(text)
  const reduced = text
    .replace(new RegExp(fillerQuestionWord.source, 'giu'), ' ')
    .replace(/(?:^|[^\p{L}\p{N}_])(?:ну|так|там|вот|значит|типа|короче|просто|это|да)(?=$|[^\p{L}\p{N}_])/giu, ' ')
    .replace(/[\p{P}\p{S}\p{N}\s]/gu, '')
  return [...reduced].length < 4 && (!/[?？]/u.test(text) || hasFillerQuestionWord)
}

function isStandaloneInterviewerTurn(value = '') {
  const text = normalizeTranscriptText(value)
  if (isTranscriptNoise(text) || isLowInformationSpeech(text)) return false
  // A manually requested answer can concern a statement, not just a question.
  if (text.includes('`') || /^(?:и|and|за|behind)(?=$|[\s,.!?])/iu.test(text)) return false
  const acknowledgement = text.toLowerCase().replace(/[\p{P}\p{S}]/gu, ' ').trim()
  if (/^(?:(?:понял\p{L}*|хорошо|отлично|ясно|понятно|спасибо|окей|okay|ok|thanks|understood|great|fine)\s*)+$/iu.test(acknowledgement)) return false
  return text.split(/\s+/u).some(word => /\p{L}/u.test(word))
}

export function latestInterviewerMessage(messages = [], onMerge) {
  const interviewerMessages = messages.filter(m => m?.speaker === 'interviewer' && typeof m.text === 'string')
  const lastRaw = interviewerMessages.at(-1)
  const relevant = interviewerMessages.filter(m => !isTranscriptNoise(m.text))
  const last = relevant.at(-1)
  if (!last) return last
  const correction = /^(нет|да|а если|без|только|no|yes|but|without|only)(?=$|\s|[,.!?])/i.test(last.text.trim()) || /^\d+(?:\s*(?:гб|gb|мб|mb|%))?$/i.test(last.text.trim())
  if (!correction && lastRaw !== last && isTranscriptNoise(lastRaw?.text) && (last.origin === 'manual' || isLikelyInterviewQuestion(last.text) || isStandaloneInterviewerTurn(last.text))) {
    const questionIndex = messages.indexOf(last)
    if (Number.isInteger(questionIndex) && messages.slice(questionIndex + 1).some(m => m?.speaker === 'me' || m?.speaker === 'assistant')) return undefined
  }
  if (last.origin === 'manual') return last
  const startsNewQuestion = /^(?:(?:что|как|почему|зачем|где|когда|сколько|какой|расскаж\p{L}*|объясни\p{L}*|опиши\p{L}*)(?![-‐‑‒–—](?:то|нибудь|либо))|what|how|why|where|when|which|have you|tell|describe|explain|could|would|can)(?=$|[^\p{L}])/iu.test(last.text.trim())
  if (!correction && isLowInformationSpeech(last.text)) return undefined
  if (!correction && !startsNewQuestion) {
    const index = messages.lastIndexOf(last)
    let text = normalizeMessageText(last)
    const literalFragment = text.trimStart().startsWith('`')
    let first = index
    for (let i = index - 1; i >= Math.max(0, index - 3); i--) {
      const previous = messages[i]
      if (previous?.speaker !== 'interviewer' || previous.origin === 'manual' || isTranscriptNoise(previous.text)) break
      if (/\.$/.test(previous.text.trim()) && isStandaloneInterviewerTurn(last.text) && /^[\p{Lu}\d]/u.test(last.text.trim())) break
      if (/[?!]$/.test(previous.text.trim()) && !/^[a-z]/.test(last.text.trim()) && !literalFragment) break
      const gap = Date.parse(messages[first]?.createdAt) - Date.parse(previous.createdAt)
      if ((Number.isFinite(gap) && gap > 12_000) || (literalFragment && (!Number.isFinite(gap) || gap < 0))) break
      const previousText = normalizeMessageText(previous)
      text = text.includes('`') || previousText.includes('`')
        ? `${previousText}\n${text}`
        : `${previousText.replace(/[?!]$/, '')} ${text}`
      first = i
      if (isLikelyInterviewQuestion(text)) break
    }
    if (first !== index && isLikelyInterviewQuestion(text)) {
      onMerge?.(first, index)
      return { ...last, text: normalizeTranscriptText(text) }
    }
  }
  if (isLikelyInterviewQuestion(last.text) || isStandaloneInterviewerTurn(last.text)) return last
  if (correction || /^(?:привет|здравствуй|здравствуйте|добрый день|добрый вечер|доброе утро|hello|hi)(?=$|[\s,.!?])/iu.test(last.text.trim())) return last
  return undefined
}

function isExplicitExperienceQuestion(text = '') {
  return /(?:^|[^\p{L}\p{N}])(?:опыт\p{L}*|сам\p{L}*\s+сложн\p{L}*\s+(?:задач\p{L}*|проект\p{L}*|инцидент\p{L}*|проблем\p{L}*)|пример из практики|встреча\p{L}*|(?:вам|тебе)\s+(?:приходил\p{L}*|доводил\p{L}*)|(?:вы|ты)\s+(?:использова\p{L}*|строи\p{L}*|создава\p{L}*|писа\p{L}*|настраива\p{L}*|поддержива\p{L}*|встреча\p{L}*|эксплуатирова\p{L}*|администрирова\p{L}*|работали|сталкивались|делали|внедряли|переносили)|как\s+(?:вы|ты)\s+(?:решали|разбирали|делали|внедряли|мигрировали|планировали)|расскаж\p{L}*.{0,32}(?:опыт|проект|случа|инцидент|работ)|have you|did you ever|did you\s+(?:use|build|write|configure|run|deploy|support|operate|manage|implement|create|maintain)\b|how did you|how have you|worked with|experience(?:\s+(?:with|in|at|on|as))?|tell me about a time|tell me about your (?:work|project|incident|experience|(?:hardest|biggest|most difficult|most challenging)\s+(?:production\s+)?(?:task|project|incident|problem|challenge))|describe (?:a|an|your) (?:time|project|incident|experience)|walk me through (?:a|an|your) (?:time|project|incident)|what\s+(?:was|is)\s+(?:your\s+)?(?:most\s+(?:difficult|challenging|complex)|hardest|biggest)\s+(?:technical\s+)?(?:task|project|challenge|problem|incident|achievement)|tell me about (?:a|your) (?:most\s+)?(?:difficult|challenging|complex)\s+(?:task|project|problem)|what did you do (?:when|to|about)|(?:how|what|where|which)\s+(?:does|did|is|was)\s+your\s+.{0,50}\b(?:runner|playbook|pipeline|vault|cluster|infrastructure|setup|role|system|process)\b|project you worked on)(?=$|[^\p{L}\p{N}])/iu.test(text)
}

export function isExperienceQuestion(text = '') {
  const question = normalizeTranscriptText(text)
  if (/(?:в\s+работе|на\s+работе|at\s+work|in\s+your\s+(?:job|project)|in\s+production)/iu.test(question)
    && /(?:как\s+(?:вы|ты).{0,35}(?:используете|используешь|применяете|применяешь)|how\s+do\s+you\s+(?:use|apply|work\s+with))(?=$|[^\p{L}])/iu.test(question)) return true
  const explicit = isExplicitExperienceQuestion(question) || isPersonalStoryQuestion(question)
  if (explicit) return true
  if (/(?:за\s+что\s+(?:вы\s+)?отвеча\p{L}*\s+лично|personally\s+responsible\s+for|how\s+did\s+your\s+(?:devops\s+)?team.{0,40}(?:split|divide).{0,20}ownership|on[ -]?call.{0,60}(?:experience|schedule|rotation|rota)|дежурств\p{L}*.{0,60}(?:опыт|график|смен))/iu.test(question)) return true
  if (/(?:^|[^\p{L}\p{N}])(?:будешь|будете|можешь|хотел\p{L}*\s+бы)(?=$|[^\p{L}\p{N}])|(?:^|[^\p{L}\p{N}])(?:would|will|can)\s+you(?=$|[^\p{L}\p{N}])/iu.test(question)) return false
  const direct = /(?:^|[^\p{L}\p{N}])(?:ты|вы)(?=$|[^\p{L}\p{N}])[^?!]{0,80}(?:использова\p{L}*|строи\p{L}*|создава\p{L}*|писа\p{L}*|настраива\p{L}*|поддержива\p{L}*|встреча\p{L}*|эксплуатирова\p{L}*|администрирова\p{L}*|работа\p{L}*|сталкива\p{L}*|занима\p{L}*|дела\p{L}*|внедря\p{L}*|реша\p{L}*|разбира\p{L}*|управля\p{L}*|планирова\p{L}*|слыш\p{L}*|знако\p{L}*)(?=$|[^\p{L}\p{N}])/iu.test(question)
  const inverted = /(?:^|[^\p{L}\p{N}])(?:дела\p{L}*|писа\p{L}*|использова\p{L}*|настраива\p{L}*|внедря\p{L}*|управля\p{L}*|занима\p{L}*)[^?!]{0,32}(?:ли\s+)?(?:ты|вы)(?=$|[^\p{L}\p{N}])/iu.test(question)
  const technology = /(?:ansible|argo\s*cd|gcp|aws|azure|kubernetes|k8s|docker|terraform|vault|kafka|rabbitmq|grpc)[^?!]{0,60}(?:дела\p{L}*|писа\p{L}*|использова\p{L}*|настраива\p{L}*|внедря\p{L}*|управля\p{L}*|занима\p{L}*)/iu.test(question)
  return direct || inverted || technology
}

const personalStoryPatterns = [
  /(?:describe|tell|share|give).{0,80}(?:conflict|disagreement|example of (?:using|working)|situation (?:where|when))/iu,
  /(?:tell\s+me\s+about|describe)\s+your\s+(?:(?:last|latest|recent)\s+)?(?:task|case|project|incident|work)\b/iu,
  /^(?:(?:ну|а|и|давай)[,\s]+)?кейсы?[,\s]+как\s+(?:ты|вы)(?=$|[^\p{L}\p{N}_])/iu,
  /(?:расскаж\p{L}*|опиши\p{L}*).{0,48}кейс\p{L}*/iu,
  /(?:tell\s+me\s+about|describe)\s+(?:a|an)\s+(?:work|production|technical)\s+case\b/iu,
  /(?:привед\p{L}*.{0,30}реальн\p{L}*\s+пример|give me a real example|tell me about a real example)/iu,
  /(?:расскаж\p{L}*|опиши\p{L}*).{0,56}(?:случа\p{L}*|истори\p{L}*|инцидент\p{L}*|ситуац\p{L}*|проект\p{L}*|релиз\p{L}*|сложн\p{L}*|проблем\p{L}*|задач\p{L}*)/iu,
  /расскаж\p{L}*.{0,24}как\s+(?:вы|ты)\s+(?:дела\p{L}*|строи\p{L}*|настраива\p{L}*|внедря\p{L}*|разбира\p{L}*|реша\p{L}*|откатыва\p{L}*)/iu,
  /(?:какая|какую|какой|самая|самый|что было).{0,24}(?:сам\p{L}*\s+)?(?:сложн\p{L}*|интересн\p{L}*|важн\p{L}*|крупн\p{L}*).{0,32}(?:задач\p{L}*|проект\p{L}*|ситуац\p{L}*|инцидент\p{L}*|проблем\p{L}*|опыт\p{L}*)/iu,
  /что\s+было\s+сам(?:ым|ой|ое)\s+(?:сложн\p{L}*|интересн\p{L}*|важн\p{L}*)/iu,
  /как\s+(?:вы|ты)\s+(?:разбирали|решали|устранили|расследовали|восстановили|откатывали|справлялись|действовали)(?=$|[^\p{L}\p{N}_]).{0,70}(?:ошиб\p{L}*|инцидент\p{L}*|сбо\p{L}*|проблем\p{L}*|отказ\p{L}*|авари\p{L}*|нагрузк\p{L}*|502|504)/iu,
  /(?:tell\s+me\s+about\s+(?:a\s+time|an?\s+(?:incident|project|challenge|problem|case))|describe\s+(?:a\s+time|an?\s+(?:incident|project|challenge|problem|case))|walk\s+me\s+through\s+(?:the\s+|a\s+)?(?:incident|project|time)|give\s+me\s+an\s+example\s+of\s+(?:a\s+time|an?\s+(?:incident|project|challenge)))/iu,
  /what\s+(?:was|is)\s+(?:your\s+)?(?:hardest|most\s+difficult|most\s+challenging|biggest).{0,32}(?:task|project|challenge|problem|incident|achievement)/iu,
  /what\s+was\s+(?:the|your)\s+(?:hardest|most\s+difficult|most\s+challenging|biggest)\s+(?:part|thing|challenge|task|project|incident|problem)\b/iu,
  /how\s+did\s+you\s+(?:handle|resolve|investigate|debug|fix|respond\s+to|deal\s+with).{0,80}(?:incident|problem|failure|error|outage)/iu,
]

export function isPersonalStoryQuestion(value = '') {
  const question = normalizeTranscriptText(value)
  if (/^(?:explain|describe)\s+what\s+(?:an?|the)\s+.{0,50}\s+is(?:\s|[.!?]|$)/iu.test(question)) return false
  if (/^(?:(?:расскажи(?:те)?|объясни(?:те)?|explain|describe)\s+)?(?:что\s+такое|как\s+работает|what\s+(?:is|are)|how\s+.+?\s+works)(?:\s|[?!,.]|$)/iu.test(question)) return false
  return /(?:расскаж\p{L}*|опиш\p{L}*|привед\p{L}*).{0,100}(?:инцидент\p{L}*|кейс\p{L}*|случа[йяею]\p{L}*)|(?:tell|describe|share|give).{0,80}(?:incident|work example|production issue)/iu.test(question) || personalStoryPatterns.some(pattern => pattern.test(question))
}

export function isDiagnosticQuestion(text = '') {
  return /(?:^|[^\p{L}\p{N}_])(почему|диагност\p{L}*|ошибк\p{L}*|не работает|не запуска\p{L}*|падает|упал\p{L}*|высок\p{L}*|низк\p{L}*|медлен\p{L}*|тормоз\p{L}*|недоступ\p{L}*|timeout|latency|load average|crashloop\p{L}*|oom|disk|memory|cpu|debug|diagnose|troubleshoot|fails|failing|failed|crashes|intermittent|unavailable)(?=$|[^\p{L}\p{N}_])/iu.test(text)
}

export function isCodeRequest(value = '') {
  const text = value.replace(/```[\s\S]*?(?:```|$)|`[^`\r\n]*(?:`|$)/gu, ' ')
  if (/^\s*(?:why|почему|зачем|что такое|what is|what are)(?=$|[^\p{L}])/iu.test(text) || isExperienceQuestion(text) || isProseChangeRequest(text)) return false
  const action = /(?:^|[.!?]\s+|\n)\s*(?:(?:please|then|now|and|so|а|и|теперь|пожалуйста|как|можешь|можете|can you|could you|would you|how to|how can I|how do I),?\s+)*(?:write|implement|create|build|show|give|fix|correct|rewrite|update|change|(?:I|we) need|дай(?:те)?|напиши(?:те)?|написать|составь(?:те)?|создай(?:те)?|покажи(?:те)?|исправь(?:те)?|исправить|поправь(?:те)?|поправить|перепиши(?:те)?|переписать|измени(?:те)?|изменить|нужен|нужна)(?=$|[^\p{L}\p{N}_])/iu
  const subject = /(?:^|[^\p{L}\p{N}_])(?:SQL|Python|Bash|PowerShell|JavaScript|TypeScript|query|queries|script|function|code|запрос\p{L}*|скрипт\p{L}*|функци\p{L}*|код)(?=$|[^\p{L}\p{N}_])/iu
  if (action.test(text) && subject.test(text)) return true
  const tableAction = /(?:^|[.!?]\s+|\n)\s*(?:(?:please|can you|could you|would you|смотри|так|ну|давай|пожалуйста|можешь|можете|как),?\s+)*(?:(?:нужно|надо)\s+)?(?:выведи(?:те)?|вывести|покажи(?:те)?|показать|show|list|return|get)\s+(?!(?:результат\p{L}*|итог\p{L}*|(?:the\s+)?(?:result|output|meaning|difference)|how|why)(?=$|[^\p{L}]))/iu
  const tableObject = /(?:строк\p{L}*|столбц\p{L}*|колонк\p{L}*|уникальн\p{L}*\s+(?:значен\p{L}*|ошибк\p{L}*)|\b(?:rows?|columns?|records?|each)\b)/iu
  const tableSource = /(?:табли[цч]\p{L}*|\b(?:table|schema|SQL|WHERE|GROUP\s+BY)\b|\b[a-z][a-z\d]*_[a-z\d_]+\b|(?:из|from)\s+[a-z][a-z\d_]*(?=$|[^\p{L}\p{N}_]))/iu
  return tableAction.test(text) && tableObject.test(text) && tableSource.test(text)
}

export function isCodeChangeRequest(value = '') {
  if (/^(?:уточняю|уточнение|исправление|correction|to clarify)[\s,:]+(?:id|[a-z_][a-z\d_]*id)\s*(?:=|(?:это(?:\s+число)?|is)\s+)\s*[+-]?\d+(?:\.\d+)?(?!\d|\.\d)/iu.test(value.trim())) return true
  return !isProseChangeRequest(value) && /^(?:(?:а|и|теперь|потом|пожалуйста|можешь|можете|then|now|and|but|so|please|can you|could you|would you),?\s+)*(?:добавь(?:те)?|добавить|убери(?:те)?|убрать|исправь(?:те)?|исправить|поправь(?:те)?|поправить|измени(?:те)?|изменить|перепиши(?:те)?|переписать|add|remove|fix|correct|update|rewrite|change)(?=$|[^\p{L}\p{N}_])/iu.test(value.trim())
}

export function isProseChangeRequest(value = '') {
  return /^(?:(?:а|и|теперь|потом|пожалуйста|можешь|можете|then|now|and|but|so|please|can you|could you|would you),?\s+)*(?:rewrite|rephrase|simplify|shorten|change|перепиши(?:те)?|переписать|переформулируй(?:те)?|переформулировать|упрости(?:те)?|упростить|сократи(?:те)?|сократить|измени(?:те)?|изменить)\s+(?:(?:the|this|that|your|это|это\s+самое|этот|тво[её])\s+)?(?:explanation|wording|description|объяснени\p{L}*|пояснени\p{L}*|описани\p{L}*)(?=$|[^\p{L}\p{N}_])/iu.test(value.trim())
}

export function isLikelyInterviewQuestion(value = '') {
  const text = normalizeTranscriptText(value)
  if (isTranscriptNoise(text) || isLowInformationSpeech(text)) return false
  if (interviewWords.test(text) || isCodeRequest(text) || isCodeChangeRequest(text) || isProseChangeRequest(text)) return true
  return text.includes('?')
}

export function usableQuestionDraft(value = '') {
  const text = normalizeTranscriptText(value)
  const wordCount = text.split(/\s+/u).filter(Boolean).length
  return wordCount >= 6 && (isLikelyInterviewQuestion(text) || isStandaloneInterviewerTurn(text)) ? text : ''
}

export const QUESTION_DRAFT_MAX_AGE_MS = 15_000

export function isFreshQuestionDraft(createdAt, now = Date.now(), maxAgeMs = QUESTION_DRAFT_MAX_AGE_MS) {
  const timestamp = Date.parse(createdAt || '')
  const age = now - timestamp
  return Number.isFinite(timestamp) && age >= -2_000 && age <= maxAgeMs
}

export function selectLiveQuestionDraft({ latestQuestion, partialText = '', partialCreatedAt = '', now = Date.now() } = {}) {
  const partialTime = Date.parse(partialCreatedAt || '')
  if (!isFreshQuestionDraft(partialCreatedAt, now)) return ''
  const latestTime = Date.parse(latestQuestion?.createdAt || '')
  if (Number.isFinite(latestTime) && partialTime <= latestTime) return ''
  return usableQuestionDraft(partialText)
}

export function selectQuestionFallback({ initialQuestion, currentQuestion, partialText = '', partialCreatedAt = '', now = Date.now(), allowVisibleFallback = false } = {}) {
  if (currentQuestion && currentQuestion.id !== initialQuestion?.id) return { source: 'final', text: currentQuestion.text }
  const draft = isFreshQuestionDraft(partialCreatedAt, now) ? usableQuestionDraft(partialText) : ''
  if (draft) return { source: 'draft', text: draft }
  if (allowVisibleFallback && initialQuestion) return { source: 'visible', text: initialQuestion.text }
  return null
}

export function interviewerPreview(messages = [], partialText = '') {
  const partial = normalizeTranscriptText(partialText)
  if (partial) return { text: partial, state: 'partial' }

  const current = latestInterviewerMessage(messages)
  if (current) {
    return {
      text: normalizeMessageText(current),
      state: isLikelyInterviewQuestion(current.text) ? 'recognized' : 'correction',
      messageId: current.id,
    }
  }

  const raw = messages.findLast(item => item?.speaker === 'interviewer' && typeof item.text === 'string')
  return raw
    ? { text: normalizeMessageText(raw), state: 'review', messageId: raw.id }
    : { text: '', state: 'waiting' }
}
