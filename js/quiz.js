// Times-tables interruption: a real-time scheduler that decides *when* a
// drill fires, and the overlay UI that asks the question and shows feedback.
// The app wires these to the game's hold/release (freeze/thaw) calls.

import { Sfx } from './audio.js';

export const QUIZ_SECONDS = 5;

// Accumulates real seconds of active play and fires after a random interval
// drawn from [min, max]. reset() draws a fresh interval.
export class QuizScheduler {
  constructor(minSeconds = 40, maxSeconds = 80) {
    this.min = minSeconds;
    this.max = maxSeconds;
    this.reset();
  }
  reset() {
    this.elapsed = 0;
    this.next = this.min + Math.random() * (this.max - this.min);
  }
  tick(dt) {
    this.elapsed += dt;
    return this.elapsed >= this.next;
  }
}

export function pickLine(value, fallback = '') {
  if (Array.isArray(value)) {
    const opts = value.filter((v) => typeof v === 'string' && v.trim());
    return opts.length ? opts[Math.floor(Math.random() * opts.length)] : fallback;
  }
  return typeof value === 'string' && value.trim() ? value : fallback;
}

export class QuizUI {
  constructor(root) {
    this.root = root;
    this.$ = (sel) => root.querySelector(sel);
    this.form = this.$('#quiz-form');
    this.input = this.$('#quiz-input');
    this.count = this.$('#quiz-count');
    this.bar = this.$('#quiz-bar');
    this.timerBox = this.$('.quiz-timer');
    this.feedbackBox = this.$('#quiz-feedback');
    this.continueBtn = this.$('#quiz-continue');
    // Only digits in the answer box.
    this.input.addEventListener('input', () => {
      const clean = this.input.value.replace(/\D+/g, '').slice(0, 4);
      if (clean !== this.input.value) this.input.value = clean;
    });
  }

  get visible() {
    return !this.root.hidden;
  }

  // Shows "a × b = ?" with a countdown. Resolves with
  // { outcome: 'correct' | 'wrong' | 'timeout', given: number|null }.
  ask(fact, title) {
    this.$('#quiz-title').textContent = title;
    this.$('#quiz-a').textContent = fact.a;
    this.$('#quiz-b').textContent = fact.b;
    this.input.value = '';
    this.input.disabled = false;
    this.form.hidden = false;
    this.timerBox.hidden = false;
    this.feedbackBox.hidden = true;
    this.root.classList.remove('is-success', 'is-fail');
    this.root.hidden = false;
    Sfx.quizAlert();
    setTimeout(() => this.input.focus({ preventScroll: true }), 30);

    return new Promise((resolve) => {
      const total = QUIZ_SECONDS * 1000;
      const deadline = performance.now() + total;
      let shown = QUIZ_SECONDS;
      this.count.textContent = shown;
      this.bar.style.transform = 'scaleX(1)';
      this.timerBox.classList.remove('urgent');

      const finish = (outcome, given) => {
        clearInterval(timer);
        this.form.onsubmit = null;
        this.input.disabled = true;
        resolve({ outcome, given });
      };

      const timer = setInterval(() => {
        const rem = Math.max(0, deadline - performance.now());
        this.bar.style.transform = `scaleX(${(rem / total).toFixed(4)})`;
        const whole = Math.ceil(rem / 1000);
        if (whole !== shown) {
          shown = whole;
          this.count.textContent = whole;
          if (whole > 0) Sfx.tick(whole <= 2);
          this.timerBox.classList.toggle('urgent', whole <= 2);
        }
        if (rem <= 0) finish('timeout', null);
      }, 50);

      this.form.onsubmit = (e) => {
        e.preventDefault();
        const v = this.input.value.trim();
        if (!/^\d+$/.test(v)) {
          this.input.classList.remove('shake');
          void this.input.offsetWidth;
          this.input.classList.add('shake');
          return;
        }
        const n = Number(v);
        finish(n === fact.a * fact.b ? 'correct' : 'wrong', n);
      };
    });
  }

  // Shows the result. Resolves when the player continues or the panel
  // times out on its own.
  feedback({ outcome, fact, given, label, line }) {
    const ok = outcome === 'correct';
    this.form.hidden = true;
    this.timerBox.hidden = true;
    this.feedbackBox.hidden = false;
    this.root.classList.toggle('is-success', ok);
    this.root.classList.toggle('is-fail', !ok);
    this.$('#quiz-result').textContent = label;
    this.$('#quiz-line').textContent = line;
    this.$('#quiz-answer').textContent = `${fact.a} × ${fact.b} = ${fact.a * fact.b}`;
    this.$('#quiz-given').textContent =
      outcome === 'wrong' ? `You answered ${given}.` : outcome === 'timeout' ? 'No answer in time.' : '';

    const autoMs = ok ? 3000 : 5000;
    const auto = this.$('#quiz-auto');
    auto.style.transition = 'none';
    auto.style.transform = 'scaleX(1)';
    void auto.offsetWidth;
    auto.style.transition = `transform ${autoMs}ms linear`;
    auto.style.transform = 'scaleX(0)';

    return new Promise((resolve) => {
      const shownAt = performance.now();
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        clearTimeout(t);
        window.removeEventListener('keydown', onKey, true);
        this.continueBtn.onclick = null;
        resolve();
      };
      const onKey = (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && performance.now() - shownAt > 400) {
          e.preventDefault();
          done();
        }
      };
      const t = setTimeout(done, autoMs);
      window.addEventListener('keydown', onKey, true);
      this.continueBtn.onclick = done;
      setTimeout(() => this.continueBtn.focus({ preventScroll: true }), 420);
    });
  }

  hide() {
    this.root.hidden = true;
    this.root.classList.remove('is-success', 'is-fail');
  }
}
