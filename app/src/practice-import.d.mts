export function extractPracticeQuestions(input: string): string[]
export function extractPracticeTranscript(input: string): { questions: string[]; hasSpeakerLabels: boolean }
export function classifyPracticeQuestionAudience(question: string): 'addressed' | 'review'
export function mergePracticeTranscripts(transcripts: Array<{ fileName?: string; text: string }>): {
  questions: string[]
  questionSources: number[][]
  sourceNames: string[]
  sourceQuestionCounts: number[]
  hasSpeakerLabels: boolean
  sourceCount: number
  unlabelledFileCount: number
  emptyFileCount: number
}
