// Flags of the World drill: shows a flag and four country names to choose
// from. Each country has a weight (see flags.json); misses raise it so
// tricky flags come back more often, exactly like the times-tables facts.
//
// Profile data for this game (ctx.data()):
//   { regions: ["Europe", ...] | null (all),
//     items: { "fr": { weight, asked, correct } }, stats }

const OPTION_COUNT = 4;

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// Waits for an image to be ready (or gives up after a moment) so the
// countdown never starts on a blank frame.
function preload(src) {
  const img = new Image();
  img.src = src;
  const ready = img.decode ? img.decode().catch(() => {}) : new Promise((r) => (img.onload = img.onerror = r));
  return Promise.race([ready, new Promise((r) => setTimeout(r, 1500))]);
}

export default function createGame(ctx) {
  const W = ctx.weights;
  const { escapeHtml, toast, confirm } = ctx.ui;
  let rules = W.rules(null);
  let countries = [];
  let byCode = new Map();
  let regions = [];
  let lastCode = null;

  const flagUrl = (code) => ctx.url(`images/${code}.svg`);
  const theName = (c) => (c.the ? `the ${c.name}` : c.name);

  function data() {
    const d = ctx.data();
    let changed = false;
    if (!d.items || typeof d.items !== 'object') {
      d.items = {};
      changed = true;
    }
    // New countries (including ones added to flags.json later) start at
    // their seed weight.
    for (const c of countries) {
      if (!d.items[c.code]) {
        d.items[c.code] = { weight: c.weight, asked: 0, correct: 0 };
        changed = true;
      }
    }
    if (!d.stats) {
      d.stats = W.freshStats();
      changed = true;
    }
    if (d.regions !== null && !Array.isArray(d.regions)) {
      d.regions = null;
      changed = true;
    }
    if (changed) ctx.save();
    return d;
  }

  function enabledRegions(d) {
    const list = Array.isArray(d.regions) ? d.regions.filter((r) => regions.includes(r)) : [];
    return list.length ? list : regions;
  }

  function pool(d) {
    const on = new Set(enabledRegions(d));
    return countries.filter((c) => on.has(c.region));
  }

  // Three wrong options: two from the same region where possible (they
  // tend to look alike, which makes the question worth thinking about),
  // then the rest from anywhere.
  function distractors(answer) {
    const others = countries.filter((c) => c.code !== answer.code);
    const near = shuffle(others.filter((c) => c.region === answer.region)).slice(0, 2);
    const taken = new Set(near.map((c) => c.code));
    const far = shuffle(others.filter((c) => !taken.has(c.code))).slice(0, OPTION_COUNT - 1 - near.length);
    return [...near, ...far];
  }

  return {
    async load() {
      const seed = await ctx.loadJSON('flags.json');
      if (!seed || !Array.isArray(seed.countries)) throw new Error('flags.json is missing or invalid');
      rules = W.rules(seed);
      countries = seed.countries
        .filter((c) => c && /^[a-z0-9-]+$/i.test(c.code) && typeof c.name === 'string')
        .map((c) => ({
          code: c.code,
          name: c.name,
          region: typeof c.region === 'string' ? c.region : 'Other',
          the: !!c.the,
          weight: W.clamp(Number(c.weight) || rules.defaultWeight, rules.minWeight, rules.maxWeight),
        }));
      if (countries.length < OPTION_COUNT) throw new Error('flags.json needs at least four countries');
      byCode = new Map(countries.map((c) => [c.code, c]));
      const listed = Array.isArray(seed.regions) ? seed.regions : [];
      const used = [...new Set(countries.map((c) => c.region))];
      regions = [...listed.filter((r) => used.includes(r)), ...used.filter((r) => !listed.includes(r))];
    },

    async newQuestion() {
      const d = data();
      const items = pool(d).map((c) => ({ c, weight: d.items[c.code].weight }));
      const answer = W.pick(items, (x) => x.c.code, lastCode).c;
      lastCode = answer.code;
      const options = shuffle([answer, ...distractors(answer)]);
      await preload(flagUrl(answer.code));
      return { code: answer.code, options: options.map((c) => c.code) };
    },

    renderQuestion(el, q, answer) {
      el.innerHTML = `
        <div class="flag-q">
          <p class="flag-prompt">What country flag is this?</p>
          <div class="flag-frame"><img class="flag-img" src="${flagUrl(q.code)}" alt="The flag to identify" width="640" height="480"></div>
          <div class="flag-options" role="group" aria-label="Choose a country">
            ${q.options
              .map(
                (code, i) =>
                  `<button class="flag-option" type="button" data-code="${code}">` +
                  `<span class="flag-key" aria-hidden="true">${i + 1}</span>` +
                  `<span class="flag-name">${escapeHtml(byCode.get(code).name)}</span></button>`
              )
              .join('')}
          </div>
        </div>`;
      const buttons = [...el.querySelectorAll('.flag-option')];
      let locked = false;
      const choose = (code) => {
        if (locked) return;
        answer(code === q.code ? 'correct' : 'wrong', code);
      };
      buttons.forEach((b) => b.addEventListener('click', () => choose(b.dataset.code)));
      // Number keys 1-4 pick an option. Nothing is focused on purpose, so a
      // Space still held down from firing cannot click an answer.
      const onKey = (e) => {
        const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
        if (!m) return;
        const b = buttons[Number(m[1]) - 1];
        if (!b) return;
        e.preventDefault();
        choose(b.dataset.code);
      };
      window.addEventListener('keydown', onKey);
      return {
        lock() {
          if (locked) return;
          locked = true;
          window.removeEventListener('keydown', onKey);
          buttons.forEach((b) => (b.disabled = true));
        },
        reveal({ given }) {
          for (const b of buttons) {
            const code = b.dataset.code;
            b.classList.toggle('is-correct', code === q.code);
            b.classList.toggle('is-wrong', code === given && code !== q.code);
            b.classList.toggle('is-dim', code !== q.code && code !== given);
          }
        },
      };
    },

    answerText: (q) => { const n = theName(byCode.get(q.code)); return `It's ${n[0].toUpperCase()}${n.slice(1)}.`; },
    givenText: (q, given) => `You chose ${theName(byCode.get(given))}.`,
    spokenAnswer: (q, outcome) => (outcome === 'correct' ? '' : `That was the flag of ${theName(byCode.get(q.code))}.`),

    record(q, outcome) {
      const d = data();
      W.record(d.items[q.code], outcome, rules);
      W.recordStats(d.stats, outcome);
      ctx.save();
    },

    renderSettings(el) {
      const d = data();
      const p = ctx.profile();
      const on = new Set(enabledRegions(d));
      const count = (r) => countries.filter((c) => c.region === r).length;
      const asked = pool(d).length;

      const regionHtml = regions
        .map(
          (r) =>
            `<label class="flag-region"><input type="checkbox" value="${escapeHtml(r)}"${on.has(r) ? ' checked' : ''}>` +
            `<span>${escapeHtml(r)} <small>${count(r)}</small></span></label>`
        )
        .join('');

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

      const mini = (c) => `<img src="${flagUrl(c.code)}" alt="" width="32" height="24" loading="lazy">`;
      const tough = countries
        .map((c) => ({ c, it: d.items[c.code] }))
        .filter((x) => x.it.weight > rules.minWeight)
        .sort((a, b) => b.it.weight - a.it.weight || a.c.name.localeCompare(b.c.name))
        .slice(0, 8);
      const toughHtml = tough.length
        ? tough
            .map(
              ({ c, it }) =>
                `<li class="flag-tough">${mini(c)}<span>${escapeHtml(c.name)}<small>weight ${it.weight} · ${it.correct}/${it.asked} right</small></span></li>`
            )
            .join('')
        : '<li class="empty">No trouble spots yet. Missed flags will show up here.</li>';

      const groups = regions
        .filter((r) => on.has(r))
        .map((r) => {
          const tiles = countries
            .filter((c) => c.region === r)
            .map((c) => {
              const it = d.items[c.code];
              const tip = `${c.name}\nWeight ${it.weight}\nAnswered ${it.correct}/${it.asked} correctly`;
              return (
                `<div class="flag-tile" title="${escapeHtml(tip)}">${mini(c)}` +
                `<span class="flag-weight" style="${W.style(it.weight, rules.minWeight, rules.maxWeight)}">${it.weight}</span></div>`
              );
            })
            .join('');
          return `<h4 class="flag-group">${escapeHtml(r)}</h4><div class="flag-tiles">${tiles}</div>`;
        })
        .join('');

      el.innerHTML = `
        <fieldset class="flag-regions">
          <legend class="field-label">Regions to ask about</legend>
          <div class="flag-region-list">${regionHtml}</div>
        </fieldset>
        <p class="hint">${asked} flags are in play. Wrong answers can come from any region. Each drill gives ${ctx.meta.timeLimitSeconds} seconds to answer.</p>
        <div class="stats">${stats}</div>
        <div class="card-section">
          <h3 class="sub-title">Needs the most training</h3>
          <ol class="toughest">${toughHtml}</ol>
        </div>
        <div class="card-section">
          <h3 class="sub-title">Weight of every flag</h3>
          <p class="hint">A higher weight means the flag comes up more often. A miss adds ${rules.wrongDelta}, a correct answer changes it by ${rules.correctDelta}, and weights stay between ${rules.minWeight} and ${rules.maxWeight}. Hover or tap a flag for details.</p>
          ${groups}
        </div>
        <div class="danger-row">
          <button class="btn btn-danger-outline" type="button" data-flags="reset">Reset flags progress</button>
          <p class="hint">Puts ${escapeHtml(p.name)}'s flag weights and accuracy back to the start. Region choices and high scores are kept.</p>
        </div>`;

      el.querySelectorAll('.flag-region input').forEach((box) =>
        box.addEventListener('change', () => {
          const picked = [...el.querySelectorAll('.flag-region input:checked')].map((b) => b.value);
          if (!picked.length) {
            box.checked = true;
            toast('Keep at least one region switched on.');
            return;
          }
          const cur = data();
          cur.regions = picked.length === regions.length ? null : picked;
          ctx.save();
          this.renderSettings(el);
        })
      );

      el.querySelector('[data-flags="reset"]').addEventListener('click', async () => {
        const ok = await confirm({
          title: 'Reset progress?',
          message: `Reset ${p.name}'s flag weights and accuracy back to the start? High scores are kept.`,
          okLabel: 'Reset progress',
        });
        if (!ok) return;
        const keep = data().regions;
        ctx.resetData();
        ctx.data().regions = keep;
        ctx.save();
        this.renderSettings(el);
        toast('Progress reset.');
      });
    },
  };
}
