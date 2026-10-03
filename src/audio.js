export class SkateAudio {
  constructor() { this.enabled = true; }
  async start() {
    if (!this.context) {
      const Context = window.AudioContext || window.webkitAudioContext; if (!Context) return;
      this.context = new Context(); this.master = this.context.createGain(); this.master.gain.value = .3; this.master.connect(this.context.destination);
      const buffer = this.context.createBuffer(1, this.context.sampleRate * 2, this.context.sampleRate);
      const data = buffer.getChannelData(0); for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buffer; this.rolling = this.context.createBufferSource(); this.rolling.buffer = buffer; this.rolling.loop = true;
      this.filter = this.context.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 300;
      this.rollGain = this.context.createGain(); this.rollGain.gain.value = 0;
      this.rolling.connect(this.filter).connect(this.rollGain).connect(this.master); this.rolling.start();
    }
    if (this.context.state === 'suspended') await this.context.resume();
  }
  update(p, playing) {
    if (!this.context) return;
    const t = this.context.currentTime; this.master.gain.setTargetAtTime(this.enabled ? .3 : 0, t, .05);
    this.rollGain.gain.setTargetAtTime(playing && (p.grounded || p.rail) ? Math.min(.25, p.speed * .022) : 0, t, .08);
    this.filter.frequency.setTargetAtTime(p.rail ? 1800 : 170 + p.speed * 70, t, .1);
  }
  hit(kind) {
    if (!this.context || !this.enabled) return;
    const c = this.context, t = c.currentTime, source = c.createBufferSource(), filter = c.createBiquadFilter(), gain = c.createGain();
    source.buffer = this.noiseBuffer; filter.type = 'bandpass'; filter.frequency.value = kind === 'pop' ? 1100 : 260;
    gain.gain.setValueAtTime(kind === 'bail' ? .8 : .5, t); gain.gain.exponentialRampToValueAtTime(.001, t + .18);
    source.connect(filter).connect(gain).connect(this.master); source.start(); source.stop(t + .2);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
  }
}
