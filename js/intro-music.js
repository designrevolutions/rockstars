// An original, slow, epic space theme synthesised with the Web Audio API:
// brass-like chords (detuned saws through an opening low-pass filter), a
// timpani-style drum pulse and, from the second time round, a trumpet-like
// melody. Everything runs through a generated reverb. No audio files.

const BPM = 66;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;

// One chord per bar: [bass, ...voicing] as MIDI note numbers (D minor).
const CHORDS = [
  [38, 50, 57, 62, 65], // Dm
  [34, 50, 58, 62, 65], // Bb
  [41, 53, 57, 60, 65], // F
  [36, 52, 55, 60, 64], // C
  [31, 50, 55, 58, 62], // Gm
  [34, 50, 58, 62, 65], // Bb
  [33, 50, 57, 62, 64], // Asus4
  [33, 49, 57, 61, 64], // A
];

// Melody per bar: [startBeat, midi, lengthInBeats].
const MELODY = [
  [[0, 74, 2], [2, 69, 1], [3, 74, 1]],
  [[0, 77, 3], [3, 74, 1]],
  [[0, 72, 2], [2, 69, 1], [3, 65, 1]],
  [[0, 67, 3], [3, 72, 1]],
  [[0, 74, 2], [2, 70, 1], [3, 67, 1]],
  [[0, 77, 2], [2, 74, 1], [3, 77, 1]],
  [[0, 74, 2], [2, 76, 2]],
  [[0, 73, 4]],
];

const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

function makeImpulse(ctx, seconds = 3) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
  }
  return buf;
}

function makeNoise(ctx) {
  const len = ctx.sampleRate;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export class IntroMusic {
  constructor(volume = 0.5) {
    this.volume = Math.min(1, Math.max(0, volume));
    this.ctx = null;
    this.timer = null;
    this.stopped = false;
  }

  // Must be called from inside a user gesture (click or key press).
  start() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || this.volume <= 0) return;
    try {
      const ctx = (this.ctx = new AC());
      if (ctx.state === 'suspended') ctx.resume();

      this.master = ctx.createGain();
      this.master.gain.setValueAtTime(0, ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(this.volume * 0.55, ctx.currentTime + 1.5);
      const comp = ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(ctx.destination);

      this.dry = ctx.createGain();
      this.dry.gain.value = 0.75;
      this.dry.connect(this.master);
      const verb = ctx.createConvolver();
      verb.buffer = makeImpulse(ctx);
      this.wet = ctx.createGain();
      this.wet.gain.value = 0.5;
      this.wet.connect(verb).connect(this.master);

      this.noise = makeNoise(ctx);
      this.bar = 0;
      this.nextBarTime = ctx.currentTime + 0.15;
      this.timer = setInterval(() => this.schedule(), 200);
      this.schedule();
    } catch (err) {
      console.warn('Intro music failed to start:', err);
    }
  }

  // Bars are scheduled about a second ahead so timing stays tight.
  schedule() {
    if (this.stopped || !this.ctx) return;
    while (this.nextBarTime < this.ctx.currentTime + 1.2) {
      this.playBar(this.bar, this.nextBarTime);
      this.bar++;
      this.nextBarTime += BAR;
    }
  }

  out(node) {
    node.connect(this.dry);
    node.connect(this.wet);
  }

  playBar(n, t) {
    const i = n % CHORDS.length;
    const loop = Math.floor(n / CHORDS.length);
    const [bass, ...voices] = CHORDS[i];

    voices.forEach((m) => this.brass(hz(m), t, BAR + 0.25, 0.05));
    this.brass(hz(bass), t, BAR + 0.25, 0.07, 500);
    if (loop >= 1) MELODY[i].forEach(([b, m, len]) => this.trumpet(hz(m), t + b * BEAT, len * BEAT));

    // Drum pulse: strong on 1, softer on 3, a pickup roll into every 4th bar.
    const drumHz = hz(bass < 36 ? bass + 12 : bass);
    this.timpani(drumHz, t, 1);
    this.timpani(drumHz, t + 2 * BEAT, 0.55);
    if (i % 4 === 3) {
      this.timpani(drumHz, t + 3 * BEAT, 0.5);
      this.timpani(drumHz, t + 3.5 * BEAT, 0.6);
      this.timpani(drumHz, t + 3.75 * BEAT, 0.75);
    }
    if (i === 7) this.swell(t + 2 * BEAT, 2 * BEAT);
  }

  // Brass pad: three detuned saws, filter opens on the swell.
  brass(f, t, dur, gain, cutoff = 1800) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(cutoff * 0.25, t);
    lp.frequency.linearRampToValueAtTime(cutoff, t + 0.6);
    lp.frequency.linearRampToValueAtTime(cutoff * 0.6, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.45);
    g.gain.setValueAtTime(gain, t + dur - 0.4);
    g.gain.linearRampToValueAtTime(0, t + dur);
    lp.connect(g);
    this.out(g);
    for (const det of [-7, 0, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  trumpet(f, t, dur) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.linearRampToValueAtTime(3200, t + 0.08);
    lp.frequency.linearRampToValueAtTime(2200, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09, t + 0.06);
    g.gain.linearRampToValueAtTime(0.07, t + 0.3);
    g.gain.setValueAtTime(0.07, Math.max(t + 0.3, t + dur - 0.12));
    g.gain.linearRampToValueAtTime(0, t + dur);
    lp.connect(g);
    this.out(g);

    const vib = ctx.createOscillator();
    const vibAmt = ctx.createGain();
    vib.frequency.value = 5.2;
    vibAmt.gain.setValueAtTime(0, t);
    vibAmt.gain.linearRampToValueAtTime(f * 0.006, t + Math.min(0.6, dur));
    vib.connect(vibAmt);

    for (const [type, det] of [['sawtooth', -4], ['square', 4]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = det;
      vibAmt.connect(o.frequency);
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    vib.start(t);
    vib.stop(t + dur + 0.05);
  }

  timpani(f, t, vel) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(f * 1.5, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.45 * vel, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    o.connect(g);
    this.out(g);
    o.start(t);
    o.stop(t + 1.5);

    const n = ctx.createBufferSource();
    const bp = ctx.createBiquadFilter();
    const ng = ctx.createGain();
    n.buffer = this.noise;
    bp.type = 'bandpass';
    bp.frequency.value = 180;
    bp.Q.value = 0.8;
    ng.gain.setValueAtTime(0.35 * vel, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    n.connect(bp).connect(ng);
    this.out(ng);
    n.start(t);
    n.stop(t + 0.3);
  }

  // A soft cymbal-like rise leading back to the top of the progression.
  swell(t, dur) {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    const hp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    n.buffer = this.noise;
    n.loop = true;
    hp.type = 'highpass';
    hp.frequency.value = 5000;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 1.2);
    n.connect(hp).connect(g);
    this.out(g);
    n.start(t);
    n.stop(t + dur + 1.3);
  }

  fadeOut(seconds = 1.5) {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.timer);
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(this.master.gain.value, now);
      this.master.gain.linearRampToValueAtTime(0, now + seconds);
    } catch (e) {}
    setTimeout(() => ctx.close().catch(() => {}), seconds * 1000 + 300);
  }
}
