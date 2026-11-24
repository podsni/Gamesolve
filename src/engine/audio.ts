const PENTATONIC_HZ = [
  261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0,
  1046.5, 1174.66, 1318.51,
];

class KalimbaAudioEngine {
  private audioCtx: AudioContext | null = null;
  public muted = false;

  public ensureAudio(): AudioContext | null {
    if (this.muted) return null;
    if (typeof window === 'undefined') return null;
    if (!this.audioCtx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (AudioCtx) {
        this.audioCtx = new AudioCtx();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  public playTargetNote(comboIndex: number): void {
    const ac = this.ensureAudio();
    if (!ac) return;
    const now = ac.currentTime;
    const freq = PENTATONIC_HZ[comboIndex % PENTATONIC_HZ.length];

    const osc = ac.createOscillator();
    const over = ac.createOscillator();
    const gain = ac.createGain();
    const overGain = ac.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    over.type = 'triangle';
    over.frequency.setValueAtTime(freq * 2, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.2, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.5);

    overGain.gain.setValueAtTime(0.001, now);
    overGain.gain.exponentialRampToValueAtTime(0.04, now + 0.01);
    overGain.gain.exponentialRampToValueAtTime(0.0005, now + 0.2);

    osc.connect(gain);
    over.connect(overGain);
    gain.connect(ac.destination);
    overGain.connect(ac.destination);

    osc.start(now);
    over.start(now);
    osc.stop(now + 0.55);
    over.stop(now + 0.22);
  }

  public playWallThud(): void {
    const ac = this.ensureAudio();
    if (!ac) return;
    const now = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(58, now + 0.08);
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  public playWinChord(): void {
    const ac = this.ensureAudio();
    if (!ac) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      const now = ac.currentTime + i * 0.055;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.12, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.65);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(now);
      osc.stop(now + 0.68);
    });
  }
}

export const audioEngine = new KalimbaAudioEngine();
