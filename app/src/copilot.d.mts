export type AnswerSections = { answer: string; details: string; questions: string; assumptions: string; diagram: string; kind: 'general' | 'code' | 'design'; layered: boolean; illustrative?: boolean }
export function parseAnswerSections(text?: string): AnswerSections
export function activeTask(messages: import('./types').Message[]): { kind: string; question: string; turns: import('./types').Message[]; draft: string }
export function selectContextPassages(documents: { id: string; title: string; text: string }[], ids: string[], question: string, maxChars?: number): { id: string; title: string; text: string }[]
