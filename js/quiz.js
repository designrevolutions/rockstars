// Times-tables interruption: a real-time scheduler that decides *when* a
// drill fires, and the overlay UI that asks the question and shows feedback.
// The app wires these to the game's hold/release (freeze/thaw) calls.

import { Sfx } from './audio.js';

export const QUIZ_SECONDS = 5;

// Accumulates real seconds of active play and fires when the current gap
// has passed. In "fixed" mode every gap equals the interval. In "random"
// mode each gap is drawn from interval × [1 - spread, 1 + spread], so the
// average stays at the interval. reset() starts a fresh gap.
export class QuizScheduler {
  constructor() {
    this.configure({ mode: 'random', interval: 20, spread: 0.5 });
  }
  configure({ mode, interval, spread = 0.5 }) {
    this.mode = mode === 'fixed' ? 'fixed' : 'random';
    this.interval = Math.max(1, Number(interval) || 20);
    this.spread = Math.min(0.95, Math.max(0, spread));
    this.reset();
  }
  reset() {
    this.elapsed = 0;
    const jitter = this.mode === 'fixed' ? 0 : (Math.random() * 2 - 1) * this.spread;
    this.next = this.interval * (1 + jitter);
  }
  tick(dt) {
    this.elapsed += dt;
    return this.elapsed >= this.next;
  }
}

// Each phrase array (e.g. success, fail) gets its own shuffled "bag", keyed
// on the array itself. Lines are drawn from the bag until it is empty, then
// it is refilled and reshuffled, so every line is used once before any
// repeat, and the last line shown is never the first pick of the next round.
const bags = new WeakMap();

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

export function pickLine(value, fallback = '') {
  if (Array.isArray(value)) {
    const opts = value.filter((v) => typeof v === 'string' && v.trim());
    if (!opts.length) return fallback;
    let bag = bags.get(value);
    if (!bag) {
      bag = { remaining: [], last: null };
      bags.set(value, bag);
    }
    if (!bag.remaining.length) {
      bag.remaining = shuffle([...opts]);
      // Picks pop from the end; move the just-shown line out of that slot.
      const n = bag.remaining.length;
      if (n > 1 && bag.remaining[n - 1] === bag.last) {
        const j = Math.floor(Math.random() * (n - 1));
        [bag.remaining[n - 1], bag.remaining[j]] = [bag.remaining[j], bag.remaining[n - 1]];
      }
    }
    bag.last = bag.remaining.pop();
    return bag.last;
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
    // The form never navigates; ask() swaps in the real handler.
    this.form.addEventListener('submit', (e) => e.preventDefault());
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
