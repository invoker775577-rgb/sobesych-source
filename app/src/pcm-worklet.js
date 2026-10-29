class PcmCollector extends AudioWorkletProcessor {
  constructor() {
    super(); this.buffer = new Float32Array(2048); this.offset = 0
    this.port.onmessage = ({ data }) => {
      if (data?.type !== 'flush') return
      if (this.offset) {
        const tail = this.buffer.slice(0, this.offset)
        this.port.postMessage(tail, [tail.buffer]); this.offset = 0
      }
      this.port.postMessage({ type: 'flushed', id: data.id })
    }
  }
  process(inputs) {
    const channels = inputs[0]
    if (!channels?.length) return true
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0
      for (const channel of channels) value += channel[i]
      this.buffer[this.offset++] = value / channels.length
      if (this.offset === this.buffer.length) {
        this.port.postMessage(this.buffer, [this.buffer.buffer])
        this.buffer = new Float32Array(2048); this.offset = 0
      }
    }
    return true
  }
}
registerProcessor('pcm-collector', PcmCollector)
