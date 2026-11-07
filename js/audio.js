// Every sound in the game is synthesised with the Web Audio API: oscillators
// for tones and a shared white-noise buffer for explosions. No audio files.
// Sounds are short one-shots, so freezing the game loop naturally silences
// game audio; nothing has to be stopped or resumed.

let ctx = null;
let master = null;
let noiseBuf = null;
let muted = false;
let volume = 0.7;

function applyVolume() {
  if (master) master.gain.value = muted ? 0 : volume * 0.6;
}

function ready() {
  return ctx && master && !muted && volume > 0;
}

function makeNoise() {
  const len = ctx.sampleRate * 1.5;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

// A single enveloped oscillator, optionally gliding, filtered and with vibrato.
function tone({
  type = 'square',
  freq,
  to = null,
  dur = 0.1,
  gain = 0.15,
  delay = 0,
  attack = 0.005,
  vib = 0,
  vibRate = 6,
  lowpass = null,
}) {
  if (!ready()) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.setValueAtTime(gain, t0 + Math.max(attack, dur * 0.6));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  let node = osc;
  if (lowpass) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lowpass;
    node.connect(f);
    node = f;
  }
  node.connect(g).connect(master);

  if (vib) {
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.frequency.value = vibRate;
    lg.gain.value = vib;
    lfo.connect(lg).connect(osc.frequency);
    lfo.start(t0);
    lfo.stop(t0 + dur + 0.05);
  }
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

// Filtered noise burst with a sweeping cutoff.
function noise({ dur = 0.3, gain = 0.3, from = 3000, to = 200, delay = 0, type = 'lowpass' }) {
  if (!ready()) return;
  const t0 = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(from, t0);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

const MARCH = [98, 87.3, 77.8, 73.4];

export const Sfx = {
  // Must be called from a user gesture (e.g. the Play button) so browsers
  // allow audio to start.
  unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.connect(ctx.destination);
      noiseBuf = makeNoise();
      applyVolume();
    }
    if (ctx.state === 'suspended') ctx.resume();
  },

  configure(s) {
    if (typeof s.muted === 'boolean') muted = s.muted;
    if (Number.isFinite(s.volume)) volume = Math.min(1, Math.max(0, s.volume));
    applyVolume();
  },

  shoot() {
    tone({ type: 'square', freq: 1200, to: 240, dur: 0.12, gain: 0.08 });
  },

  enemyShoot() {
    tone({ type: 'triangle', freq: 420, to: 160, dur: 0.1, gain: 0.05 });
  },

  step(i) {
    tone({ type: 'square', freq: MARCH[i % 4], dur: 0.09, gain: 0.22, lowpass: 500, attack: 0.002 });
  },

  invaderBoom() {
    noise({ dur: 0.28, gain: 0.35, from: 4000, to: 300 });
    tone({ type: 'square', freq: 360, to: 60, dur: 0.18, gain: 0.06 });
  },

  playerBoom() {
    noise({ dur: 1.0, gain: 0.5, from: 1800, to: 80 });
    tone({ type: 'sawtooth', freq: 220, to: 35, dur: 0.9, gain: 0.12, lowpass: 900 });
  },

  ufoBlip(phase) {
    tone({ type: 'sawtooth', freq: phase ? 760 : 560, to: phase ? 560 : 760, dur: 0.12, gain: 0.035, lowpass: 2400 });
  },

  ufoBoom() {
    noise({ dur: 0.5, gain: 0.35, from: 6000, to: 400 });
    [1320, 990, 1180, 880, 1046].forEach((f, i) =>
      tone({ type: 'square', freq: f, dur: 0.07, gain: 0.06, delay: 0.05 + i * 0.06 })
    );
  },

  waveClear() {
    [523, 659, 784, 1046, 1318].forEach((f, i) =>
      tone({ type: 'square', freq: f, dur: 0.14, gain: 0.07, delay: i * 0.09, lowpass: 3000 })
    );
  },

  extraLife() {
    for (let i = 0; i < 8; i++) {
      tone({ type: 'square', freq: i % 2 ? 1568 : 1318, dur: 0.06, gain: 0.05, delay: i * 0.06 });
    }
  },

  gameOver() {
    [392, 330, 262, 196].forEach((f, i) =>
      tone({ type: 'square', freq: f, dur: i === 3 ? 0.9 : 0.28, gain: 0.1, delay: i * 0.3, lowpass: 1600, vib: i === 3 ? 6 : 0 })
    );
  },

  quizAlert() {
    [880, 660, 880].forEach((f, i) => tone({ type: 'square', freq: f, dur: 0.1, gain: 0.07, delay: i * 0.12 }));
  },

  tick(urgent) {
    tone({ type: 'sine', freq: urgent ? 1500 : 1000, dur: 0.05, gain: urgent ? 0.18 : 0.12, attack: 0.002 });
  },

  success() {
    [523, 659, 784, 1046].forEach((f, i) =>
      tone({ type: 'triangle', freq: f, dur: i === 3 ? 0.5 : 0.16, gain: 0.18, delay: i * 0.09 })
    );
    tone({ type: 'sine', freq: 2093, dur: 0.6, gain: 0.05, delay: 0.3 });
  },

  // The comedic "sad trombone": wah, wah, wah, waaaah.
  fail() {
    const notes = [196, 185, 174.6, 164.8];
    notes.forEach((f, i) =>
      tone({
        type: 'sawtooth',
        freq: f,
        to: i === 3 ? f * 0.94 : null,
        dur: i === 3 ? 1.1 : 0.32,
        gain: 0.16,
        delay: i * 0.36,
        attack: 0.04,
        lowpass: 900,
        vib: i === 3 ? 5 : 0,
        vibRate: 5,
      })
    );
  },
};
