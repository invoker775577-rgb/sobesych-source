export function createStreamUpdates<T extends { callId: string; mode: string; status: string }>(
  publish: (value: T | null) => void,
  schedule?: (callback: FrameRequestCallback) => number,
  cancel?: (frame: number) => void,
): { push(value: T | null): void; cancel(): void }
