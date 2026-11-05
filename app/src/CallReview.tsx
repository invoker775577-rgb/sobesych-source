import { memo } from 'react'
import type { Call } from './types'
import { parseAnswerSections } from './copilot.mjs'
import { feedbackLabels } from './types'
export const CallReview = memo(function CallReview({ call }: { call: Call }) {
  const questions = call.messages.filter(item => item.speaker === 'interviewer')
  const marked = call.messages.filter(item => item.speaker === 'assistant' && call.feedback?.[item.id])
  return <details className="call-review"><summary>Разбор звонка</summary><p>Локальный просмотр сохранённых реплик и твоих отметок. Дополнительных запросов к модели нет.</p><p>Реплик собеседника {questions.length} · ответов {call.messages.filter(item => item.speaker === 'assistant').length} · замечаний {marked.length}</p>
    <details><summary>Сохранённые реплики собеседника</summary>{questions.map(item => <p key={item.id}>{item.text}</p>)}</details>
    {marked.map(item => <div key={item.id}><strong>{feedbackLabels[call.feedback![item.id]]}</strong><p>{parseAnswerSections(item.text).answer}</p></div>)}
    {!marked.length && <p>Чтобы сохранить замечание, отметь ответ кнопкой под ним.</p>}
  </details>
}, (before, after) => before.call.messages === after.call.messages && before.call.feedback === after.call.feedback)
