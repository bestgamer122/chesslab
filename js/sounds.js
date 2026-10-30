export class SoundPlayer {
  constructor() {
    this.enabled = true;
    this.ctx = null;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  toggle(state) {
    this.enabled = state;
    if (state) this.init();
  }

  playMove() {
    if (!this.enabled) return;
    this.init();
    this._playTone(300, 'sine', 0.1, 0.05);
  }

  playCapture() {
    if (!this.enabled) return;
    this.init();
    this._playTone(200, 'triangle', 0.15, 0.06);
  }

  playCheck() {
    if (!this.enabled) return;
    this.init();
    this._playTone(600, 'sine', 0.15, 0.08);
  }

  _playTone(freq, type, duration, volume) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    // Мягкое затухание
    gain.gain.setValueAtTime(volume, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }
}
