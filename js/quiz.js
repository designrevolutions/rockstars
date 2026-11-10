// Drill interruption: a real-time scheduler that decides *when* a drill
// fires, and the overlay UI that frames it. The overlay owns the title,
// countdown and feedback; the current game draws the question itself into
// the overlay's body (see js/games.js for that contract). The app wires
// these to the arcade's hold/release (freeze/thaw) calls.

import { Sfx } from './audio.js';

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
    this.body = this.$('#quiz-body');
    this.count = this.$('#quiz-count');
    this.bar = this.$('#quiz-bar');
    this.timerBox = this.$('.quiz-timer');
    this.feedbackBox = this.$('#quiz-feedback');
    this.continueBtn = this.$('#quiz-continue');
    this.handle = null;
    this.cancel = null; // ends whatever ask() or feedback() is running
  }

  get visible() {
    return !this.root.hidden;
  }

  // Lets the game draw the question, then runs the countdown. Resolves with
  // { outcome: 'correct' | 'wrong' | 'timeout', given }.
  ask({ game, question, title, seconds }) {
    this.$('#quiz-title').textContent = title;
    this.root.dataset.game = game.id;
    this.body.innerHTML = '';
    this.body.hidden = false;
    this.body.classList.remove('is-revealed');
    this.timerBox.hidden = false;
    this.feedbackBox.hidden = true;
    this.root.classList.remove('is-success', 'is-fail');
    this.root.hidden = false;
    Sfx.quizAlert();

    return new Promise((resolve) => {
      let finished = false;
      const total = seconds * 1000;
      const deadline = performance.now() + total;
      let shown = seconds;
      this.count.textContent = shown;
      this.bar.style.transform = 'scaleX(1)';
      this.timerBox.classList.remove('urgent');

      let handle = null;
      const finish = (outcome, given) => {
        if (finished) return;
        finished = true;
        clearInterval(timer);
        handle?.lock?.();
        if (this.cancel === cancel) this.cancel = null;
        resolve({ outcome, given });
      };
      const cancel = () => finish('timeout', null);
      this.cancel = cancel;

      handle = game.game.renderQuestion(this.body, question, (outcome, given) =>
        finish(outcome === 'correct' ? 'correct' : 'wrong', given)
      ) || null;
      this.handle = handle;

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
    });
  }

  // Shows the result. Resolves when the player continues or the panel
  // times out on its own. Games whose handle has reveal() keep their
  // question on screen (e.g. to mark the right option); others are hidden.
  feedback({ outcome, given, label, line, answer, givenText }) {
    const ok = outcome === 'correct';
    const reveal = this.handle?.reveal;
    if (reveal) {
      this.body.classList.add('is-revealed');
      reveal.call(this.handle, { outcome, given });
    } else {
      this.body.hidden = true;
    }
    this.timerBox.hidden = true;
    this.feedbackBox.hidden = false;
    this.root.classList.toggle('is-success', ok);
    this.root.classList.toggle('is-fail', !ok);
    this.$('#quiz-result').textContent = label;
    this.$('#quiz-line').textContent = line;
    this.$('#quiz-answer').textContent = answer;
    this.$('#quiz-given').textContent =
      outcome === 'wrong' ? givenText || '' : outcome === 'timeout' ? 'No answer in time.' : '';

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
        if (this.cancel === done) this.cancel = null;
        resolve();
      };
      this.cancel = done;
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
    this.cancel?.();
    this.handle?.lock?.();
    this.handle = null;
    this.root.hidden = true;
    this.root.classList.remove('is-success', 'is-fail');
  }
}
