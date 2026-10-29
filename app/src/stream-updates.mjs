// Keep the first words immediate; intermediate deltas need at most one render per frame.
export function createStreamUpdates(publish, schedule = requestAnimationFrame, cancel = cancelAnimationFrame) {
  let latest = null
  let frame = null
  const clear = () => {
    if (frame !== null) cancel(frame)
    frame = null
  }
  return {
    push(value) {
      const immediate = !value || value.status !== 'streaming' || !latest || latest.status !== 'streaming' || latest.callId !== value.callId || latest.mode !== value.mode
      latest = value
      if (immediate) {
        clear()
        publish(value)
      } else if (frame === null) {
        frame = schedule(() => { frame = null; publish(latest) })
      }
    },
    cancel() { clear(); latest = null },
  }
}
