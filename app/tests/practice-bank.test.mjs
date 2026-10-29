import test from 'node:test'
import assert from 'node:assert/strict'
import { getPracticeQuestion, getPracticeQuestions, getPracticeTrack, getPracticeTracks } from '../src/practice-bank.mjs'

test('practice bank is localized and separated by candidate profile', () => {
  const devops = getPracticeQuestions('devops')
  const support = getPracticeQuestions('support')
  for (const profile of [devops, support]) {
    const ids = profile.map(question => question.id)
    assert.equal(new Set(ids).size, ids.length)
    assert.ok(profile.some(question => question.id === 'sql-sum:ru'))
    for (const language of ['ru', 'en']) assert.ok(profile.some(question => question.language === language))
  }
  assert.ok(devops.some(question => question.id === 'rabbitmq-kafka:ru'))
  for (const id of ['docker-networking', 'sync-async-messaging', 'grpc-vs-message-queue', 'k3s-fit', 'ingress-service-mesh', 'early-warning-signals', 'production-readiness', 'registry-retention']) {
    assert.ok(devops.some(question => question.id === `${id}:ru`), `Missing Russian practice question: ${id}`)
    assert.ok(devops.some(question => question.id === `${id}:en`), `Missing English practice question: ${id}`)
  }
  assert.ok(devops.some(question => question.id === 'argo-application:en'))
  assert.ok(devops.some(question => question.id === 'conntrack-story:ru'))
  assert.ok(!devops.some(question => question.id === 'payment-mismatch:ru'))
  assert.ok(support.some(question => question.id === 'payment-mismatch:ru'))
  assert.ok(!support.some(question => question.id === 'vault-secrets:en'))
})

test('practice questions contain no prewritten answer or raw interview transcript', () => {
  const questions = [...getPracticeQuestions('devops'), ...getPracticeQuestions('support')]
  for (const item of questions) {
    assert.match(item.question, /[?.]$/)
    assert.doesNotMatch(item.question, /ExamplePay|Steam|Situation:|Task:|Action:|Result:/i)
    assert.ok(item.label.length < 60)
  }
})

test('screen and technical ambiguity examples are represented in both languages', () => {
  const questions = getPracticeQuestions('devops')
  const sumRu = questions.find(question => question.id === 'sql-sum:ru')
  const sumEn = questions.find(question => question.id === 'sql-sum:en')
  assert.match(sumRu.question, /без строк таблицы/)
  assert.match(sumEn.question, /no table rows/i)
  assert.match(questions.find(question => question.id === 'docker-expose:ru').question, /сам по себе/)
  assert.match(questions.find(question => question.id === 'rabbitmq-kafka:en').question, /push and pull/i)
})

test('interview tracks are localized, profile-specific, and reference valid questions', () => {
  for (const profile of ['devops', 'support']) {
    const questions = getPracticeQuestions(profile)
    const tracks = getPracticeTracks(profile)
    assert.ok(tracks.length > 0)
    assert.equal(new Set(tracks.map(track => track.id)).size, tracks.length)
    for (const track of tracks) {
      assert.ok(track.questionIds.length >= 5)
      assert.ok(track.title.length < 60)
      assert.ok(track.questionIds.every(id => questions.some(question => question.id === id)), `Track ${track.id} contains a question outside the ${profile} bank`)
      assert.ok(track.questionIds.every(id => getPracticeQuestion(id)?.language === track.language), `Track ${track.id} mixes question languages`)
      assert.equal(getPracticeTrack(track.id)?.id, track.id)
    }
  }
  assert.ok(!getPracticeTracks('support').some(track => track.id.startsWith('devops-')))
  assert.ok(!getPracticeTracks('devops').some(track => track.id.startsWith('support-')))
})

test('a transcript-derived DevOps round covers the real technical interview gaps', () => {
  const round = getPracticeTrack('devops-transcript-round:ru')
  const englishRound = getPracticeTrack('devops-transcript-round:en')
  assert.ok(round); assert.ok(englishRound)
  for (const id of ['postgres-vacuum', 'greenplum-mpp', 'early-warning-signals', 'production-readiness', 'postmortem', 'object-storage', 'ansible-role', 'ansible-notify', 'ansible-precedence', 'vault-jwt-flow', 'vault-runner-auth-boundary', 'nifi-dataflow', 'grpc-vs-message-queue', 'rust-experience']) {
    assert.ok(round.questionIds.includes(`${id}:ru`), `Transcript round is missing ${id}`)
    assert.ok(englishRound.questionIds.includes(`${id}:en`), `English transcript round is missing ${id}`)
    assert.ok(getPracticeQuestion(`${id}:ru`))
    assert.ok(getPracticeQuestion(`${id}:en`))
  }
  assert.match(getPracticeQuestion('postgres-vacuum:ru').question, /VACUUM FULL/)
  assert.match(getPracticeQuestion('greenplum-mpp:en').question, /coordinator and segments/)
  assert.match(getPracticeQuestion('postmortem:en').question, /good postmortem/i)
  assert.match(getPracticeQuestion('object-storage:ru').question, /MinIO.*файловой системы/)
  assert.match(getPracticeQuestion('rust-experience:ru').question, /опыт работы с Rust/)
  assert.match(getPracticeQuestion('ingress-service-mesh:ru').question, /Ingress.*service mesh.*контроллер.*встроен ли mesh/)
  assert.match(getPracticeQuestion('ansible-notify:en').question, /handler/)
  assert.match(getPracticeQuestion('vault-jwt-flow:ru').question, /GitLab CI job входит в Vault по JWT\? Что Vault проверяет/)
  assert.match(getPracticeQuestion('vault-runner-auth-boundary:ru').question, /лично можешь подтвердить/)
  assert.match(getPracticeQuestion('vault-runner-auth-boundary:en').question, /personally confirm/)
})

test('a transcript-derived behavioral round covers experience without embedding answers or biography', () => {
  const russian = getPracticeTrack('devops-behavioral:ru')
  const english = getPracticeTrack('devops-behavioral:en')
  assert.ok(russian); assert.ok(english)
  for (const id of ['background', 'job-change', 'conntrack-story', 'unclear-task-story', 'work-planning', 'team-responsibility', 'on-call', 'technical-disagreement', 'career-growth']) {
    assert.ok(russian.questionIds.includes(`${id}:ru`), `Behavior round is missing ${id}`)
    assert.ok(english.questionIds.includes(`${id}:en`), `English behavior round is missing ${id}`)
  }
  assert.match(getPracticeQuestion('unclear-task-story:ru').question, /плохо описана|не хватало документации/)
  assert.match(getPracticeQuestion('technical-disagreement:en').question, /real example if you can/i)
  assert.match(getPracticeQuestion('team-responsibility:en').question, /personally responsible/i)
  assert.match(getPracticeQuestion('on-call:ru').question, /регулярный график таких смен/i)
  assert.doesNotMatch(JSON.stringify([russian, english]), /ExamplePay|conntrack table full|переезд за границу|move abroad/i)
})

test('the Support behavioral round is bilingual, profile-specific, and grounded in work stories', () => {
  const russian = getPracticeTrack('support-behavioral:ru')
  const english = getPracticeTrack('support-behavioral:en')
  assert.ok(russian); assert.ok(english)
  for (const id of ['support-day-to-day', 'support-payment-case', 'support-prioritization', 'support-difficult-customer', 'support-developer-case', 'support-process-improvement', 'support-career-growth']) {
    assert.ok(russian.questionIds.includes(`${id}:ru`), `Support round is missing ${id}`)
    assert.ok(english.questionIds.includes(`${id}:en`), `English Support round is missing ${id}`)
    assert.ok(getPracticeQuestion(`${id}:ru`))
    assert.ok(getPracticeQuestion(`${id}:en`))
    assert.ok(getPracticeQuestions('support').some(question => question.id === `${id}:ru`))
    assert.ok(!getPracticeQuestions('devops').some(question => question.id === `${id}:ru`))
  }
  assert.match(getPracticeQuestion('support-payment-case:ru').question, /нашёл причину.*проверил результат/)
  assert.match(getPracticeQuestion('support-difficult-customer:en').question, /upset customer/i)
  assert.match(getPracticeQuestion('support-process-improvement:en').question, /What changed afterward/i)
})
