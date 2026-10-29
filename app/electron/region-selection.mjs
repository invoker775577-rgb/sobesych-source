export function selectionBounds(start, end, viewport) {
  if (!start || !end || !viewport ||
    ![start.x, start.y, end.x, end.y, viewport.width, viewport.height].every(Number.isFinite) ||
    viewport.width <= 0 || viewport.height <= 0) return null
  const clamp = (value, maximum) => Math.min(maximum, Math.max(0, value))
  const startX = clamp(start.x, viewport.width)
  const startY = clamp(start.y, viewport.height)
  const endX = clamp(end.x, viewport.width)
  const endY = clamp(end.y, viewport.height)
  return { x: Math.min(startX, endX), y: Math.min(startY, endY), width: Math.abs(endX - startX), height: Math.abs(endY - startY) }
}
