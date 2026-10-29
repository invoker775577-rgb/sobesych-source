export function isScreenTaskFollowup(text?: string): boolean
export function screenTaskFollowupMessages<T extends { id: string; speaker: string; text: string; createdAt?: string }>(messages?: T[], answerId?: string, capturedAt?: string): T[] | null
