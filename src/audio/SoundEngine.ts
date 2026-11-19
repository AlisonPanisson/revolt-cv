/**
 * Procedural Web Audio synthesizer capturing Re-Volt's signature
 * high-pitched brushless DC RC motor whine, pickup roulette chimes,
 * turbo surges, and firework rocket blasts.
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private motorOsc1: OscillatorNode | null = null;
  private motorOsc2: OscillatorNode | null = null;
  private motorGain: GainNode | null = null;
  private motorFilter: BiquadFilterNode | null = null;
  private muted: boolean = false;
  private initialized: boolean = false;

  public unlock(): void {
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    this.motorGain = this.ctx.createGain();
    this.motorGain.gain.value = 0.0;

    this.motorFilter = this.ctx.createBiquadFilter();
    this.motorFilter.type = 'bandpass';
    this.motorFilter.frequency.value = 650;
    this.motorFilter.Q.value = 2.2;

    // Dual detuned oscillators mimic RC spur gear + DC motor whine
    this.motorOsc1 = this.ctx.createOscillator();
    this.motorOsc1.type = 'sawtooth';
    this.motorOsc1.frequency.value = 140;

    this.motorOsc2 = this.ctx.createOscillator();
    this.motorOsc2.type = 'triangle';
    this.motorOsc2.frequency.value = 282;

    this.motorOsc1.connect(this.motorFilter);
    this.motorOsc2.connect(this.motorFilter);
    this.motorFilter.connect(this.motorGain);
    this.motorGain.connect(this.ctx.destination);

    this.motorOsc1.start();
    this.motorOsc2.start();
    this.initialized = true;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.motorGain && this.ctx) {
      this.motorGain.gain.setTargetAtTime(muted ? 0 : 0.03, this.ctx.currentTime, 0.05);
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public updateMotor(speedMps: number, throttle: number, turboActive: boolean, activeRace: boolean): void {
    if (!this.initialized || !this.ctx || !this.motorOsc1 || !this.motorOsc2 || !this.motorGain || !this.motorFilter) {
      return;
    }
    if (this.muted || !activeRace) {
      this.motorGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
      return;
    }

    const normSpeed = Math.min(1.25, Math.abs(speedMps) / 32);
    const turboBoost = turboActive ? 1.28 : 1.0;
    const baseFreq = (125 + normSpeed * 420 + throttle * 65) * turboBoost;

    const now = this.ctx.currentTime;
    this.motorOsc1.frequency.setTargetAtTime(baseFreq, now, 0.04);
    this.motorOsc2.frequency.setTargetAtTime(baseFreq * 2.01, now, 0.04);
    this.motorFilter.frequency.setTargetAtTime(420 + normSpeed * 1400, now, 0.05);

    const targetGain = 0.018 + Math.min(0.055, normSpeed * 0.035 + throttle * 0.02);
    this.motorGain.gain.setTargetAtTime(targetGain, now, 0.05);
  }

  public playTone(freq: number, durationSec: number, type: OscillatorType = 'sine', volume = 0.08): void {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + durationSec);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + durationSec);
  }

  public playCountdownBeep(go: boolean): void {
    this.playTone(go ? 880 : 440, go ? 0.35 : 0.16, 'square', 0.06);
  }

  public playPickupCollect(): void {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, idx) => {
      window.setTimeout(() => this.playTone(n, 0.1, 'triangle', 0.07), idx * 55);
    });
  }

  public playTurbo(): void {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(240, now);
    osc.frequency.exponentialRampToValueAtTime(980, now + 0.45);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.5);
  }

  public playExplosion(): void {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx) return;

    const bufferSize = Math.floor(this.ctx.sampleRate * 0.38);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.25));
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 520;

    const gain = this.ctx.createGain();
    gain.gain.value = 0.16;

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    noise.start();
  }
}
