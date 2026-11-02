export type AnswerSections = { answer: string; details: string; questions: string; assumptions: string; diagram: string; kind: 'general' | 'code' | 'design'; layered: boolean }
export function parseAnswerSections(text?: string): AnswerSections
