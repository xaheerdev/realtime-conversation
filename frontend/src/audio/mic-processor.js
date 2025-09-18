// src/audio/mic-processor.js
class MicCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const sr = sampleRate;
    this.chunkSize = options?.processorOptions?.chunkSize ?? Math.round(sr * 0.04);
    this.buf = new Float32Array(0);
  }
  process(inputs) {
    const i = inputs[0];
    if (!i || !i[0]) return true;
    const ch = i[0];
    const next = new Float32Array(this.buf.length + ch.length);
    next.set(this.buf, 0); next.set(ch, this.buf.length);
    this.buf = next;
    while (this.buf.length >= this.chunkSize) {
      const frame = this.buf.slice(0, this.chunkSize);
      this.buf = this.buf.slice(this.chunkSize);
      this.port.postMessage(frame, [frame.buffer]);
    }
    return true;
  }
}
registerProcessor('mic-capture', MicCaptureProcessor);
