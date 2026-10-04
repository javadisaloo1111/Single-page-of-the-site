class VocaTypePcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 16000;
    this.phase = 0;
    this.filtered = 0;
    this.alpha = 1 - Math.exp((-2 * Math.PI * 7200) / sampleRate);
    this.frame = [];
  }

  process(inputs, outputs) {
    const channels = inputs[0];
    const output = outputs[0];
    if (output) for (const channel of output) channel.fill(0);
    if (!channels || channels.length === 0 || channels[0].length === 0) return true;

    const length = channels[0].length;
    for (let i = 0; i < length; i++) {
      let mono = 0;
      for (const channel of channels) mono += channel[i] || 0;
      mono /= channels.length;
      this.filtered += this.alpha * (mono - this.filtered);
      this.phase += this.targetRate;
      while (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        this.frame.push(this.filtered);
      }
      if (this.frame.length >= 800) {
        const samples = new Float32Array(this.frame);
        this.frame.length = 0;
        this.port.postMessage({ samples }, [samples.buffer]);
      }
    }
    return true;
  }
}

registerProcessor("vocatyp-pcm16", VocaTypePcmProcessor);
