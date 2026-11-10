// Times-tables drill: "a × b = ?" with a typed answer. Each fact has a
// weight (see facts.json); misses raise it so tricky facts come back more.
//
// Profile data for this game (ctx.data()):
//   { maxFactor, facts: { "7x8": { a, b, weight, asked, correct } }, stats }

const DEFAULT_MAX_FACTOR = 12;
const MIN_MAX_FACTOR = 2;
const MAX_MAX_FACTOR = 20;

const factKey = (a, b) => `${a}x${b}`;

export default function createGame(ctx) {
  const W = ctx.weights;
  const { escapeHtml, toast, confirm } = ctx.ui;
  let rules = W.rules(null);
  let seedWeights = new Map();
  let lastKey = null;

  // Builds the fact map for 1..maxFactor. Facts already in `existing` keep
  // their weight and stats; new facts start at their seed (default) weight;
  // facts outside the range are dropped simply by not being copied.
  function buildFacts(maxFactor, existing = {}) {
    const out = {};
    for (let a = 1; a <= maxFactor; a++) {
      for (let b = 1; b <= maxFactor; b++) {
        const k = factKey(a, b);
        const old = existing && existing[k];
        out[k] = old
          ? { a, b, weight: old.weight, asked: old.asked || 0, correct: old.correct || 0 }
          : { a, b, weight: seedWeights.get(k) ?? rules.defaultWeight, asked: 0, correct: 0 };
      }
    }
    return out;
  }

  // "First use" for a profile: copy the seed facts into its bucket.
  function data() {
    const d = ctx.data();
    let changed = false;
    if (!Number.isInteger(d.maxFactor)) {
      d.maxFactor = DEFAULT_MAX_FACTOR;
      changed = true;
    }
    if (!d.facts || typeof d.facts !== 'object' || !Object.keys(d.facts).length) {
      d.facts = buildFacts(d.maxFactor);
      changed = true;
    }
    if (!d.stats) {
      d.stats = W.freshStats();
      changed = true;
    }
    if (changed) ctx.save();
    return d;
  }

  return {
    async load() {
      const seed = await ctx.loadJSON('facts.json');
      rules = W.rules(seed);
      seedWeights = new Map();
      for (const f of Array.isArray(seed?.facts) ? seed.facts : []) {
        const a = Number(f.a);
        const b = Number(f.b);
        if (!Number.isInteger(a) || !Number.isInteger(b)) continue;
        seedWeights.set(factKey(a, b), W.clamp(Number(f.weight) || rules.defaultWeight, rules.minWeight, rules.maxWeight));
      }
    },

    async newQuestion() {
      const f = W.pick(Object.values(data().facts), (x) => factKey(x.a, x.b), lastKey);
      lastKey = factKey(f.a, f.b);
      return { a: f.a, b: f.b };
    },

    renderQuestion(el, q, answer) {
      el.innerHTML = `
        <form class="tt-form" autocomplete="off">
          <div class="quiz-q">
            <span>${q.a}</span><span class="op">×</span><span>${q.b}</span><span class="op">=</span>
            <input class="tt-input" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" aria-label="Your answer">
          </div>
          <button class="btn btn-primary" type="submit">Submit</button>
        </form>`;
      const form = el.querySelector('form');
      const input = el.querySelector('input');
      let locked = false;
      // Only digits in the answer box.
      input.addEventListener('input', () => {
        const clean = input.value.replace(/\D+/g, '').slice(0, 4);
        if (clean !== input.value) input.value = clean;
      });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (locked) return;
        const v = input.value.trim();
        if (!/^\d+$/.test(v)) {
          input.classList.remove('shake');
          void input.offsetWidth;
          input.classList.add('shake');
          return;
        }
        const n = Number(v);
        answer(n === q.a * q.b ? 'correct' : 'wrong', n);
      });
      setTimeout(() => input.focus({ preventScroll: true }), 30);
      return {
        lock() {
          locked = true;
          input.disabled = true;
        },
      };
    },

    answerText: (q) => `${q.a} × ${q.b} = ${q.a * q.b}`,
    givenText: (q, given) => `You answered ${given}.`,

    record(q, outcome) {
      const d = data();
      const k = factKey(q.a, q.b);
      const f = d.facts[k] || (d.facts[k] = { a: q.a, b: q.b, weight: rules.defaultWeight, asked: 0, correct: 0 });
      W.record(f, outcome, rules);
      W.recordStats(d.stats, outcome);
      ctx.save();
    },

    renderSettings(el) {
      const d = data();
      const p = ctx.profile();
      const n = d.maxFactor;
      let options = '';
      for (let i = MIN_MAX_FACTOR; i <= MAX_MAX_FACTOR; i++) {
        options += `<option value="${i}"${i === n ? ' selected' : ''}>${i} × ${i}${i === DEFAULT_MAX_FACTOR ? ' (default)' : ''}</option>`;
      }

      const st = d.stats;
      const acc = st.asked ? Math.round((st.correct / st.asked) * 100) + '%' : '–';
      const stats = [
        [st.asked, 'Drills answered'],
        [st.correct, 'Correct'],
        [acc, 'Accuracy'],
        [st.timeouts, 'Timed out'],
      ]
        .map(([v, l]) => `<div class="stat"><span class="stat-value">${v}</span><span class="stat-label">${l}</span></div>`)
        .join('');

      const tough = Object.values(d.facts)
        .filter((f) => f.weight > rules.minWeight)
        .sort((a, b) => b.weight - a.weight || a.a - b.a || a.b - b.b)
        .slice(0, 8);
      const toughHtml = tough.length
        ? tough.map((f) => `<li>${f.a} × ${f.b}<small>weight ${f.weight} · ${f.correct}/${f.asked} right</small></li>`).join('')
        : '<li class="empty">No trouble spots yet. Missed facts will show up here.</li>';

      let grid = '<div class="cell corner">×</div>';
      for (let b = 1; b <= n; b++) grid += `<div class="cell head">${b}</div>`;
      for (let a = 1; a <= n; a++) {
        grid += `<div class="cell head">${a}</div>`;
        for (let b = 1; b <= n; b++) {
          const f = d.facts[factKey(a, b)];
          const tip = `${a} × ${b} = ${a * b}\nWeight ${f.weight}\nAnswered ${f.correct}/${f.asked} correctly`;
          grid += `<div class="cell fact" title="${tip}" style="${W.style(f.weight, rules.minWeight, rules.maxWeight)}">${f.weight}</div>`;
        }
      }

      el.innerHTML = `
        <div class="game-settings-row">
          <label class="field">
            <span class="field-label">Times tables up to</span>
            <select data-tt="max-factor">${options}</select>
          </label>
          <p class="hint">Only this profile changes. Facts still in range keep their weights, new facts start fresh and facts out of range are dropped. Each drill gives ${ctx.meta.timeLimitSeconds} seconds to answer.</p>
        </div>
        <div class="stats">${stats}</div>
        <div class="card-section">
          <h3 class="sub-title">Needs the most training</h3>
          <ol class="toughest">${toughHtml}</ol>
        </div>
        <div class="card-section">
          <h3 class="sub-title">Weight of every fact</h3>
          <p class="hint">A higher weight means the fact comes up more often. A miss adds ${rules.wrongDelta}, a correct answer changes it by ${rules.correctDelta}, and weights stay between ${rules.minWeight} and ${rules.maxWeight}. Hover or tap a cell for details.</p>
          <div class="grid-scroll"><div class="weight-grid" style="grid-template-columns:repeat(${n + 1}, minmax(22px, 36px))">${grid}</div></div>
        </div>
        <div class="danger-row">
          <button class="btn btn-danger-outline" type="button" data-tt="reset">Reset times-tables progress</button>
          <p class="hint">Puts ${escapeHtml(p.name)}'s times-tables weights and accuracy back to the start. High scores are kept.</p>
        </div>`;

      el.querySelector('[data-tt="max-factor"]').addEventListener('change', (e) => {
        const max = W.clamp(Math.round(Number(e.target.value)), MIN_MAX_FACTOR, MAX_MAX_FACTOR);
        const cur = data();
        cur.maxFactor = max;
        cur.facts = buildFacts(max, cur.facts);
        ctx.save();
        this.renderSettings(el);
        toast(`${p.name} now trains up to ${max} × ${max}.`);
      });

      el.querySelector('[data-tt="reset"]').addEventListener('click', async () => {
        const ok = await confirm({
          title: 'Reset progress?',
          message: `Reset ${p.name}'s times-tables weights and accuracy back to the start? High scores are kept.`,
          okLabel: 'Reset progress',
        });
        if (!ok) return;
        const max = data().maxFactor;
        ctx.resetData();
        const fresh = ctx.data();
        fresh.maxFactor = max;
        ctx.save();
        this.renderSettings(el);
        toast('Progress reset.');
      });
    },
  };
}
