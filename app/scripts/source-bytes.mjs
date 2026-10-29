export function sameTextSource(left, right) {
  if (left.equals(right)) return true
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
    return decoder.decode(left).replaceAll('\r\n', '\n') === decoder.decode(right).replaceAll('\r\n', '\n')
  } catch { return false }
}
