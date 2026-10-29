const scenarios = [
  {
    id: 'background', profile: 'both',
    titleRu: 'Опыт и сильные стороны', titleEn: 'Background and strengths',
    questionRu: 'Коротко расскажи о своём опыте и о том, чем занимался на последних проектах.',
    questionEn: 'Tell me about your background and the work you did on your recent projects.',
  },
  {
    id: 'job-change', profile: 'both',
    titleRu: 'Причина смены работы', titleEn: 'Reason for changing jobs',
    questionRu: 'Почему ты сейчас ищешь новую работу?',
    questionEn: 'Why are you looking for a new job now?',
  },
  {
    id: 'work-planning', profile: 'devops',
    titleRu: 'Работа с командой и планирование', titleEn: 'Teamwork and planning',
    questionRu: 'Как вы планировали работу с разработчиками и DBA, когда задача затрагивала сразу несколько частей системы?',
    questionEn: 'How did you plan work with developers and DBAs when a task affected several parts of the system?',
  },
  {
    id: 'team-responsibility', profile: 'devops',
    titleRu: 'Зоны ответственности в команде', titleEn: 'Team areas of ownership',
    questionRu: 'Как были распределены зоны ответственности в вашей DevOps-команде и за что отвечали лично вы?',
    questionEn: 'How did your DevOps team split ownership, and what were you personally responsible for?',
  },
  {
    id: 'on-call', profile: 'devops',
    titleRu: 'Дежурства и аварии', titleEn: 'On-call and incidents',
    questionRu: 'Как ты относишься к дежурствам и был ли у тебя регулярный график таких смен?',
    questionEn: 'How do you feel about on-call work, and did you have a regular on-call schedule?',
  },
  {
    id: 'unclear-task-story', profile: 'devops',
    titleRu: 'STAR: задача без ясного описания', titleEn: 'STAR: an unclear task',
    questionRu: 'Расскажи о случае, когда задача была плохо описана или не хватало документации. Как ты разобрался и что изменил после?',
    questionEn: 'Tell me about a time a task was unclear or lacked documentation. How did you work it out, and what did you improve afterward?',
  },
  {
    id: 'technical-disagreement', profile: 'devops',
    titleRu: 'Техническое разногласие', titleEn: 'A technical disagreement',
    questionRu: 'Как ты решаешь технические разногласия в команде? Приведи реальный пример, если можешь.',
    questionEn: 'How do you handle technical disagreements on a team? Give a real example if you can.',
  },
  {
    id: 'career-growth', profile: 'devops',
    titleRu: 'Дальше в карьере', titleEn: 'Career growth',
    questionRu: 'В каком направлении ты хочешь развиваться в ближайшие пару лет и почему?',
    questionEn: 'How would you like to grow over the next couple of years, and why?',
  },
  {
    id: 'rust-experience', profile: 'devops',
    titleRu: 'Rust: опыт без преувеличений', titleEn: 'Rust: honest experience',
    questionRu: 'У тебя был опыт работы с Rust? Что именно ты с ним делал?',
    questionEn: 'Have you worked with Rust? What have you done with it?',
  },
  {
    id: 'postmortem', profile: 'devops',
    titleRu: 'Инцидент: хороший postmortem', titleEn: 'Incident: a good postmortem',
    questionRu: 'Что должно быть в хорошем postmortem после серьёзного сбоя и зачем он нужен?',
    questionEn: 'What should a good postmortem include after a serious incident, and why?',
  },
  {
    id: 'object-storage', profile: 'devops',
    titleRu: 'Объектное хранилище', titleEn: 'Object storage',
    questionRu: 'Что такое объектное хранилище? Чем MinIO отличается от обычной файловой системы и что важно для его эксплуатации?',
    questionEn: 'What is object storage? How is MinIO different from a normal file system, and what matters in production?',
  },
  {
    id: 'sql-sum', profile: 'both',
    titleRu: 'SQL: результат SUM', titleEn: 'SQL: SUM result',
    questionRu: 'На экране только запрос SELECT SUM(QTY) FROM INVOICES, без строк таблицы. Что можно точно сказать о результате?',
    questionEn: 'The screen shows SELECT SUM(QTY) FROM INVOICES, but no table rows. What can you say for sure about the result?',
  },
  {
    id: 'docker-multistage', profile: 'devops',
    titleRu: 'Docker: multi-stage сборка', titleEn: 'Docker: multi-stage build',
    questionRu: 'Зачем используют multi-stage build и что обычно оставляют в финальном образе?',
    questionEn: 'Why use a multi-stage Docker build, and what should stay in the final image?',
  },
  {
    id: 'docker-networking', profile: 'devops',
    titleRu: 'Docker: связь контейнеров', titleEn: 'Docker: container networking',
    questionRu: 'Два контейнера запущены на одном хосте. Как дать одному обратиться к другому и что проверить, если соединения нет?',
    questionEn: 'Two containers run on one host. How can one reach the other, and what would you check if it cannot connect?',
  },
  {
    id: 'sync-async-messaging', profile: 'devops',
    titleRu: 'Сервисы: sync и async', titleEn: 'Services: sync and async',
    questionRu: 'Чем синхронный вызов сервиса отличается от асинхронного сообщения? Когда выберешь каждый вариант?',
    questionEn: 'How is a synchronous service call different from an asynchronous message, and when would you use each one?',
  },
  {
    id: 'grpc-vs-message-queue', profile: 'devops',
    titleRu: 'gRPC или очередь сообщений', titleEn: 'gRPC or a message queue',
    questionRu: 'Когда для связи двух сервисов выберешь gRPC, а когда очередь сообщений? В каком случае вызывающий сервис ждёт ответ?',
    questionEn: 'When would you use gRPC between two services and when a message queue? When does the caller wait for a reply?',
  },
  {
    id: 'rabbitmq-kafka', profile: 'devops',
    titleRu: 'RabbitMQ и Kafka', titleEn: 'RabbitMQ and Kafka',
    questionRu: 'В чём практическая разница RabbitMQ и Kafka? Не ограничивайся словами «push» и «pull».',
    questionEn: 'What is the practical difference between RabbitMQ and Kafka? Do not reduce it to push and pull.',
  },
  {
    id: 'k3s-fit', profile: 'devops',
    titleRu: 'K3s и Kubernetes', titleEn: 'K3s and Kubernetes',
    questionRu: 'Чем K3s отличается от обычной сборки Kubernetes и для какого стенда или проекта ты бы его выбрал?',
    questionEn: 'How does K3s differ from a standard Kubernetes setup, and what kind of project would you use it for?',
  },
  {
    id: 'ingress-service-mesh', profile: 'devops',
    titleRu: 'Kubernetes: Ingress и service mesh', titleEn: 'Kubernetes: Ingress and service mesh',
    questionRu: 'Чем Kubernetes Ingress отличается от service mesh? Нужен ли для Ingress отдельный контроллер и встроен ли mesh в Kubernetes?',
    questionEn: 'How is Kubernetes Ingress different from a service mesh? Does Ingress need a controller, and is a mesh built in?',
  },
  {
    id: 'kafka-offset', profile: 'devops',
    titleRu: 'Kafka: consumer и offset', titleEn: 'Kafka: consumer and offset',
    questionRu: 'Как consumer group читает сообщения в Kafka и что происходит с offset после обработки?',
    questionEn: 'How does a Kafka consumer group read messages, and what happens to the offset after processing?',
  },
  {
    id: 'kafka-transactions', profile: 'devops',
    titleRu: 'Kafka: транзакции', titleEn: 'Kafka: transactions',
    questionRu: 'Поддерживает ли Kafka транзакции? Где они полезны и чем отличаются от транзакций в SQL-базе?',
    questionEn: 'Does Kafka support transactions? When are they useful, and how are they different from SQL database transactions?',
  },
  {
    id: 'argo-application', profile: 'devops',
    titleRu: 'Argo CD: Application', titleEn: 'Argo CD: Application',
    questionRu: 'Что такое Application в Argo CD и чем Argo CD отличается от CI-пайплайна?',
    questionEn: 'What is an Application in Argo CD, and how is Argo CD different from a CI pipeline?',
  },
  {
    id: 'canary-rollout', profile: 'devops',
    titleRu: 'Canary-релиз', titleEn: 'Canary release',
    questionRu: 'Как провести canary-релиз и по каким сигналам решить, увеличивать трафик или откатывать версию?',
    questionEn: 'How would you run a canary release, and what signals would make you increase traffic or roll back?',
  },
  {
    id: 'conntrack-diagnostic', profile: 'devops',
    titleRu: 'Диагностика 502/504', titleEn: 'Diagnosing 502/504 errors',
    questionRu: 'На edge-нодах периодически появляются 502 и 504, но CPU и память в норме. С чего начнёшь диагностику?',
    questionEn: 'Edge nodes return 502 and 504 from time to time, but CPU and memory look normal. How would you investigate?',
  },
  {
    id: 'conntrack-story', profile: 'devops',
    titleRu: 'STAR: production-инцидент', titleEn: 'STAR: production incident',
    questionRu: 'Расскажи о production-инциденте, когда edge-ноды перестали принимать новые соединения. Как нашёл причину и проверил исправление?',
    questionEn: 'Tell me about a production incident where edge nodes stopped accepting new connections. How did you find the cause and check the fix?',
  },
  {
    id: 'early-warning-signals', profile: 'devops',
    titleRu: 'Наблюдаемость: ранние сигналы', titleEn: 'Observability: early warning signals',
    questionRu: 'Какие метрики и сигналы помогут заметить, что сервис деградирует, до полного отказа?',
    questionEn: 'What metrics and signals can show that a service is degrading before it fails?',
  },
  {
    id: 'production-readiness', profile: 'devops',
    titleRu: 'Эксплуатация: готовность сервиса', titleEn: 'Operations: service readiness',
    questionRu: 'Что проверишь перед передачей нового микросервиса в эксплуатацию?',
    questionEn: 'What should be checked before production handover of a new microservice?',
  },
  {
    id: 'docker-expose', profile: 'devops',
    titleRu: 'Docker: EXPOSE', titleEn: 'Docker: EXPOSE',
    questionRu: 'Что делает EXPOSE в Dockerfile? Откроет ли он порт сам по себе, и сломает ли сборку неверный номер порта?',
    questionEn: 'What does EXPOSE do in a Dockerfile? Does it open a port by itself, and will a wrong port break the build?',
  },
  {
    id: 'docker-cache', profile: 'devops',
    titleRu: 'Docker: слои и кэш', titleEn: 'Docker: layers and cache',
    questionRu: 'Что произойдёт со сборкой и кэшем, если Dockerfile разбит на много RUN и COPY?',
    questionEn: 'What happens to build time and cache if a Dockerfile has many RUN and COPY steps?',
  },
  {
    id: 'registry-retention', profile: 'devops',
    titleRu: 'Registry: теги и очистка', titleEn: 'Registry: tags and cleanup',
    questionRu: 'Как хранить образы из feature-веток и чистить старые образы, не удалив нужный release?',
    questionEn: 'How would you keep images from feature branches and clean up old ones without deleting a needed release?',
  },
  {
    id: 'ansible-rollout', profile: 'devops',
    titleRu: 'Ansible: безопасный rollout', titleEn: 'Ansible: safe rollout',
    questionRu: 'Как безопасно раскатить изменение Ansible на группу серверов и убедиться, что оно применилось?',
    questionEn: 'How would you safely roll out an Ansible change to a group of servers and check that it worked?',
  },
  {
    id: 'vault-secrets', profile: 'devops',
    titleRu: 'Vault: секреты приложений', titleEn: 'Vault: application secrets',
    questionRu: 'Как приложения и CI получали секреты из Vault и как ты ограничивал доступ?',
    questionEn: 'How did apps and CI get secrets from Vault, and how did you limit access?',
  },
  {
    id: 'vault-jwt-flow', profile: 'devops',
    titleRu: 'Vault: вход GitLab CI по JWT', titleEn: 'Vault: GitLab CI JWT login',
    questionRu: 'Как GitLab CI job входит в Vault по JWT? Что Vault проверяет и какой доступ получает job?',
    questionEn: 'How does a GitLab CI job log in to Vault with JWT? What does Vault validate, and what access does the job get?',
  },
  {
    id: 'vault-runner-auth-boundary', profile: 'devops',
    titleRu: 'Vault: личный опыт с Ansible runner', titleEn: 'Vault: personal experience with the Ansible runner',
    questionRu: 'Что ты лично можешь подтвердить про вход Ansible runner в Vault? Какой способ аутентификации вы использовали?',
    questionEn: 'What can you personally confirm about how the Ansible runner logged in to Vault? Which authentication method did your team use?',
  },
  {
    id: 'postgres-vacuum', profile: 'devops',
    titleRu: 'PostgreSQL: VACUUM', titleEn: 'PostgreSQL: VACUUM',
    questionRu: 'Зачем PostgreSQL нужен VACUUM? Что он делает с удалёнными и старыми версиями строк, и чем отличается VACUUM FULL?',
    questionEn: 'Why does PostgreSQL need VACUUM? What does it do with dead row versions, and how is VACUUM FULL different?',
  },
  {
    id: 'greenplum-mpp', profile: 'devops',
    titleRu: 'Greenplum: параллельная база', titleEn: 'Greenplum: distributed database',
    questionRu: 'Чем Greenplum отличается от обычного PostgreSQL? Как coordinator и сегменты вместе выполняют запрос?',
    questionEn: 'How is Greenplum different from regular PostgreSQL, and how do the coordinator and segments run a query together?',
  },
  {
    id: 'ansible-role', profile: 'devops',
    titleRu: 'Ansible: роли', titleEn: 'Ansible: roles',
    questionRu: 'Зачем выносить задачи в Ansible-роль, если их можно написать прямо в playbook?',
    questionEn: 'Why put Ansible tasks in a role instead of writing them directly in a playbook?',
  },
  {
    id: 'ansible-notify', profile: 'devops',
    titleRu: 'Ansible: notify и handlers', titleEn: 'Ansible: notify and handlers',
    questionRu: 'Что делает notify в Ansible и когда запускается handler?',
    questionEn: 'What does notify do in Ansible, and when does a handler run?',
  },
  {
    id: 'ansible-precedence', profile: 'devops',
    titleRu: 'Ansible: defaults и vars', titleEn: 'Ansible: defaults and vars',
    questionRu: 'Чем defaults роли отличаются от vars и почему defaults проще переопределить?',
    questionEn: 'How are role defaults different from role vars, and why are defaults easier to override?',
  },
  {
    id: 'nifi-dataflow', profile: 'devops',
    titleRu: 'Apache NiFi: поток данных', titleEn: 'Apache NiFi: data flow',
    questionRu: 'Что такое Apache NiFi и как в нём связаны processor, FlowFile и connection?',
    questionEn: 'What is Apache NiFi, and how do processors, FlowFiles, and connections work together?',
  },
  {
    id: 'gcp-experience', profile: 'devops',
    titleRu: 'Опыт с GCP без выдумок', titleEn: 'GCP experience, honestly',
    questionRu: 'Ты лично переносил production-проект на GCP? Если нет, как честно ответишь и какой близкий опыт приведёшь?',
    questionEn: 'Have you personally moved a production project to GCP? If not, how would you answer honestly and give related experience?',
  },
  {
    id: 'payment-mismatch', profile: 'support',
    titleRu: 'Платёж: статусы разошлись', titleEn: 'Payment: status mismatch',
    questionRu: 'Провайдер считает платёж завершённым, а у нас он всё ещё pending. Как будешь разбираться?',
    questionEn: 'The provider says a payment is complete, but our system still shows pending. How would you investigate?',
  },
  {
    id: 'safe-retry', profile: 'support',
    titleRu: 'Платёж: безопасный retry', titleEn: 'Payment: safe retry',
    questionRu: 'Какие факты проверишь перед повторной обработкой платежа, чтобы не создать двойную выплату?',
    questionEn: 'What would you check before retrying a payment to avoid sending it twice?',
  },
  {
    id: 'webhook-failure', profile: 'support',
    titleRu: 'API и webhook', titleEn: 'API and webhook issue',
    questionRu: 'Клиент говорит, что webhook не пришёл. Как соберёшь факты и проверишь, где потерялся запрос?',
    questionEn: 'A customer says a webhook did not arrive. How would you gather facts and find where the request failed?',
  },
  {
    id: 'developer-escalation', profile: 'support',
    titleRu: 'Эскалация разработчикам', titleEn: 'Escalating to developers',
    questionRu: 'Что приложишь к эскалации разработчикам, чтобы им не пришлось заново искать проблему?',
    questionEn: 'What would you include in an escalation so developers do not have to repeat your investigation?',
  },
  {
    id: 'unclear-requirements', profile: 'support',
    titleRu: 'Неясные требования', titleEn: 'Unclear requirements',
    questionRu: 'Что будешь делать, если описание проблемы неполное и пока непонятно, где именно сбой?',
    questionEn: 'What would you do if a problem report is incomplete and the failing part is not clear yet?',
  },
  {
    id: 'support-day-to-day', profile: 'support',
    titleRu: 'Опыт: обычная смена', titleEn: 'Experience: a normal shift',
    questionRu: 'Расскажи, чем ты обычно занимался на смене и как обращение проходило от первого сообщения до решения.',
    questionEn: 'Tell me what you usually did during a shift and how a ticket went from the first report to a fix.',
  },
  {
    id: 'support-payment-case', profile: 'support',
    titleRu: 'STAR: сбой платежа', titleEn: 'STAR: a payment issue',
    questionRu: 'Расскажи про сложный случай с платежом: как ты нашёл причину, что сделал и как проверил результат?',
    questionEn: 'Tell me about a difficult payment issue. How did you find the cause, what did you do, and how did you check the result?',
  },
  {
    id: 'support-prioritization', profile: 'support',
    titleRu: 'Приоритет обращений', titleEn: 'Ticket priorities',
    questionRu: 'Как ты решал, за какое обращение браться первым, если одновременно приходило несколько срочных?',
    questionEn: 'How did you choose what to handle first when several urgent tickets came in at once?',
  },
  {
    id: 'support-difficult-customer', profile: 'support',
    titleRu: 'STAR: недовольный клиент', titleEn: 'STAR: an upset customer',
    questionRu: 'Расскажи, как ты общался с недовольным клиентом, пока проблема ещё не была решена.',
    questionEn: 'Tell me about a time you helped an upset customer while the issue was still open.',
  },
  {
    id: 'support-developer-case', profile: 'support',
    titleRu: 'STAR: работа с разработчиками', titleEn: 'STAR: working with developers',
    questionRu: 'Расскажи про проблему, которую ты передал разработчикам. Какие факты собрал и чем всё закончилось?',
    questionEn: 'Tell me about an issue you escalated to developers. What facts did you collect, and how did it end?',
  },
  {
    id: 'support-process-improvement', profile: 'support',
    titleRu: 'STAR: улучшение процесса', titleEn: 'STAR: improving a process',
    questionRu: 'Расскажи про инструкцию или процесс поддержки, который ты улучшил. Что изменилось после этого?',
    questionEn: 'Tell me about a support guide or process you improved. What changed afterward?',
  },
  {
    id: 'support-career-growth', profile: 'support',
    titleRu: 'Дальнейший рост', titleEn: 'Career growth',
    questionRu: 'В какой части технической поддержки ты хочешь развиваться дальше и почему?',
    questionEn: 'Which part of technical support would you like to grow in, and why?',
  },
]

const interviewTracks = [
  {
    id: 'devops-platform', profile: 'devops',
    titleRu: 'DevOps: технический раунд', titleEn: 'DevOps: technical round',
    questionIds: ['docker-multistage', 'docker-networking', 'k3s-fit', 'sync-async-messaging', 'rabbitmq-kafka', 'kafka-offset', 'kafka-transactions', 'argo-application', 'canary-rollout', 'docker-cache', 'docker-expose', 'registry-retention'],
  },
  {
    id: 'devops-operations', profile: 'devops',
    titleRu: 'DevOps: эксплуатация и инциденты', titleEn: 'DevOps: operations and incidents',
    questionIds: ['conntrack-diagnostic', 'conntrack-story', 'early-warning-signals', 'production-readiness', 'ansible-rollout', 'vault-secrets', 'gcp-experience'],
  },
  {
    id: 'devops-transcript-round', profile: 'devops',
    titleRu: 'DevOps: вопросы с технических раундов', titleEn: 'DevOps: questions from technical rounds',
    questionIds: ['docker-multistage', 'docker-networking', 'k3s-fit', 'ingress-service-mesh', 'sync-async-messaging', 'grpc-vs-message-queue', 'rabbitmq-kafka', 'kafka-offset', 'kafka-transactions', 'argo-application', 'canary-rollout', 'early-warning-signals', 'production-readiness', 'postmortem', 'object-storage', 'greenplum-mpp', 'postgres-vacuum', 'ansible-role', 'ansible-notify', 'ansible-precedence', 'vault-jwt-flow', 'vault-runner-auth-boundary', 'nifi-dataflow', 'rust-experience'],
  },
  {
    id: 'devops-behavioral', profile: 'devops',
    titleRu: 'DevOps: опыт и рабочие ситуации', titleEn: 'DevOps: experience and teamwork',
    questionIds: ['background', 'job-change', 'conntrack-story', 'unclear-task-story', 'work-planning', 'team-responsibility', 'on-call', 'technical-disagreement', 'career-growth'],
  },
  {
    id: 'support-operations', profile: 'support',
    titleRu: 'Support: разбор инцидентов', titleEn: 'Support: incident handling',
    questionIds: ['background', 'payment-mismatch', 'safe-retry', 'webhook-failure', 'developer-escalation', 'unclear-requirements'],
  },
  {
    id: 'support-behavioral', profile: 'support',
    titleRu: 'Support: опыт и рабочие ситуации', titleEn: 'Support: experience and work stories',
    questionIds: ['support-day-to-day', 'support-payment-case', 'support-prioritization', 'support-difficult-customer', 'support-developer-case', 'support-process-improvement', 'support-career-growth'],
  },
]

function localizeQuestion(scenario, language) {
  return {
    id: `${scenario.id}:${language}`,
    language,
    label: language === 'ru' ? scenario.titleRu : scenario.titleEn,
    question: language === 'ru' ? scenario.questionRu : scenario.questionEn,
  }
}

export function getPracticeQuestion(id) {
  const [scenarioId, language] = String(id || '').split(':')
  const scenario = scenarios.find(item => item.id === scenarioId)
  if (!scenario || !['ru', 'en'].includes(language)) return undefined
  return localizeQuestion(scenario, language)
}

export function getPracticeTracks(profile) {
  return interviewTracks
    .filter(track => track.profile === profile)
    .flatMap(track => ['ru', 'en'].map(language => ({
      id: `${track.id}:${language}`,
      language,
      title: language === 'ru' ? track.titleRu : track.titleEn,
      questionIds: track.questionIds.map(id => `${id}:${language}`),
    })))
}

export function getPracticeTrack(id) {
  for (const profile of ['devops', 'support']) {
    const track = getPracticeTracks(profile).find(item => item.id === id)
    if (track) return track
  }
  return undefined
}

export function getPracticeQuestions(profile) {
  return scenarios
    .filter(scenario => scenario.profile === 'both' || scenario.profile === profile)
    .flatMap(scenario => ['ru', 'en'].map(language => localizeQuestion(scenario, language)))
}
