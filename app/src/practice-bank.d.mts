export type PracticeQuestion = { id: string; language: 'ru' | 'en'; label: string; question: string }
export type PracticeTrack = { id: string; language: 'ru' | 'en'; title: string; questionIds: string[] }
export function getPracticeQuestions(profile: 'devops' | 'support'): PracticeQuestion[]
export function getPracticeQuestion(id: string): PracticeQuestion | undefined
export function getPracticeTracks(profile: 'devops' | 'support'): PracticeTrack[]
export function getPracticeTrack(id: string): PracticeTrack | undefined
