// App controller: views, profiles, settings, and the glue between the game
// loop and the times-tables drill (freeze on trigger, thaw on resolve).

import {
  Profiles,
  Leaderboard,
  Settings,
  setSeed,
  seedConfig,
  storageIsPersistent,
  MIN_MAX_FACTOR,
  MAX_MAX_FACTOR,
  factKey,
} from './storage.js';
import { Sfx } from './audio.js';
import { Game } from './game.js';
import { buildSprites } from './sprites.js';
import { QuizScheduler, QuizUI, pickLine } from './quiz.js';

const $ = (sel) => document.querySelector(sel);

// Used only if data/phrases.json cannot be loaded or is malformed.
const FALLBACK_PHRASES = {
  title: 'Training drill, soldier!',
  success: 'Well done, soldier!',
  fail: 'Train harder, soldier.',
  correctLabel: 'Correct!',
  wrongLabel: 'Wrong!',
  timeoutLabel: "Time's up!",
  voice: { enabled: false },
};

const state = {
  view: 'welcome',
  phrases: FALLBACK_PHRASES,
  game: null,
  scheduler: null,
  quiz: null,
  quizActive: false,
  lastFactKey: null,
  justCreated: false,
};

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function loadJSON(url) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } catch (err) {
    console.warn(`Could not load ${url}:`, err);
    return null;
  }
}

// ?quiz=10 shortens the drill interval to ~10 s, handy for testing.
function quizWindow() {
  const q = Number(new URLSearchParams(location.search).get('quiz'));
  if (Number.isFinite(q) && q > 0) return [q * 0.75, q * 1.25];
  return [40, 80];
}

async function boot() {
  const [phrases, seed] = await Promise.all([loadJSON('data/phrases.json'), loadJSON('data/facts.json')]);
  state.phrases = { ...FALLBACK_PHRASES, ...(phrases || {}) };
  setSeed(seed);

  // Make sure the pixel font is ready before the canvas draws text.
  if (document.fonts && document.fonts.load) {
    await Promise.race([
      document.fonts.load('16px "Press Start 2P"').catch(() => {}),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  }

  Sfx.configure(Settings.get());
  state.scheduler = new QuizScheduler(...quizWindow());
  state.quiz = new QuizUI($('#quiz-overlay'));
  state.game = new Game($('#game'), {
    onRealTick: onRealTick,
    onGameOver: onGameOver,
  });

  drawLegend();
  bindWelcome();
  bindGame();
  bindSettings();
  bindModal();
  showView('welcome');
  if (!storageIsPersistent()) $('#storage-warning').hidden = false;
  // ?debug=1 exposes internals on window for testing from the console.
  if (new URLSearchParams(location.search).has('debug')) {
    window.__tti = { state, Profiles, Leaderboard, Settings };
  }
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

function showView(name) {
  state.view = name;
  for (const v of ['welcome', 'game', 'settings']) $(`#view-${v}`).hidden = v !== name;
  document.body.classList.toggle('in-game', name === 'game');
  if (name === 'welcome') renderWelcome();
  if (name === 'settings') renderSettings();
  window.scrollTo(0, 0);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function renderLeaderboard(el, highlightRank = -1) {
  const list = Leaderboard.list();
  if (!list.length) {
    el.innerHTML = '<li class="empty">No scores yet. Be the first!</li>';
    return;
  }
  el.innerHTML = list
    .map(
      (e, i) =>
        `<li class="${i === highlightRank ? 'is-new' : ''}"><span class="lb-name">${escapeHtml(e.name)}</span>` +
        `<span class="lb-score">${e.score}</span></li>`
    )
    .join('');
}

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function drawLegend() {
  const sprites = buildSprites();
  const pick = { ufo: sprites.ufo, squid: sprites.invader.squid[0][0], crab: sprites.invader.crab[1][0], octopus: sprites.invader.octopus[3][0] };
  document.querySelectorAll('.legend-sprite').forEach((c) => {
    const s = pick[c.dataset.sprite];
    c.width = s.canvas.width;
    c.height = s.canvas.height;
    c.getContext('2d').drawImage(s.canvas, 0, 0);
  });
}

/* ------------------------------------------------------------------ */
/* Welcome / profile switching                                         */
/* ------------------------------------------------------------------ */

const NEW_PROFILE = '__new__';

function renderWelcome() {
  const p = Profiles.active();
  $('#welcome-returning').hidden = !p;
  $('#welcome-create').hidden = !!p;
  if (p) {
    $('#welcome-greeting').textContent = state.justCreated ? 'Welcome,' : 'Welcome back,';
    $('#welcome-name').textContent = p.name;
    const sel = $('#profile-select');
    sel.innerHTML = '';
    for (const prof of Profiles.list()) {
      const o = new Option(prof.name, prof.id, false, prof.id === p.id);
      sel.add(o);
    }
    sel.add(new Option('+ Create new profile', NEW_PROFILE));
    sel.value = p.id;
  } else {
    $('#create-name').value = '';
    $('#create-error').textContent = '';
    setTimeout(() => $('#create-name').focus(), 50);
  }
  renderLeaderboard($('#leaderboard-welcome'));
}

async function createProfileFlow() {
  const name = await promptDialog({
    title: 'Create new profile',
    message: 'Enter a name for the new soldier.',
    okLabel: 'Create',
    validate: (v) => Profiles.nameError(v),
  });
  if (name == null) return null;
  const p = Profiles.create(name);
  state.justCreated = true;
  return p;
}

function bindWelcome() {
  $('#btn-play').addEventListener('click', startGame);
  $('#btn-settings').addEventListener('click', () => showView('settings'));

  $('#profile-select').addEventListener('change', async (e) => {
    const value = e.target.value;
    const current = Profiles.active();
    if (value === NEW_PROFILE) {
      e.target.value = current ? current.id : '';
      const p = await createProfileFlow();
      if (p) toast(`Profile "${p.name}" created.`);
    } else if (!current || value !== current.id) {
      Profiles.switchTo(value);
      state.justCreated = false;
    }
    renderWelcome();
  });

  $('#welcome-create').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#create-name').value;
    const err = Profiles.nameError(name);
    if (err) {
      $('#create-error').textContent = err;
      return;
    }
    Profiles.create(name);
    state.justCreated = true;
    renderWelcome();
  });
}

/* ------------------------------------------------------------------ */
/* Game + quiz freeze/thaw                                             */
/* ------------------------------------------------------------------ */

const KEYMAP = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  Space: 'fire',
  ArrowUp: 'fire',
  KeyW: 'fire',
};

function startGame() {
  const p = Profiles.active();
  if (!p) return showView('welcome');
  Sfx.unlock();
  showView('game');
  $('#pause-overlay').hidden = true;
  $('#gameover-overlay').hidden = true;
  state.quiz.hide();
  state.quizActive = false;
  state.scheduler.reset();
  state.game.start({ hiScore: Leaderboard.top(), playerName: p.name });
}

function isPaused() {
  return state.game.isHeld('pause');
}

function pause() {
  const g = state.game;
  if (!g.active || isPaused()) return;
  g.hold('pause');
  $('#pause-overlay').hidden = false;
  if (!state.quizActive) setTimeout(() => $('#btn-resume').focus(), 0);
}

function resume() {
  if (!isPaused()) return;
  $('#pause-overlay').hidden = true;
  state.game.release('pause');
}

function quitToMenu() {
  state.game.stop();
  state.quiz.hide();
  state.quizActive = false;
  speechCancel();
  showView('welcome');
}

// Called by the game loop every frame with real elapsed seconds while the
// game is running (never while frozen or paused).
function onRealTick(dt) {
  if (state.quizActive) return;
  const phase = state.game.phase;
  if (phase === 'gameover' || phase === 'finished') return;
  if (state.scheduler.tick(dt)) runQuiz();
}

async function runQuiz() {
  const p = Profiles.active();
  if (!p) return;
  state.quizActive = true;
  state.game.hold('quiz'); // freeze: the loop stops right here

  const fact = Profiles.pickFact(p.id, state.lastFactKey);
  state.lastFactKey = fact.key;
  const ph = state.phrases;
  const { outcome, given } = await state.quiz.ask(fact, pickLine(ph.title, FALLBACK_PHRASES.title));

  Profiles.recordAnswer(p.id, fact.a, fact.b, outcome);
  const ok = outcome === 'correct';
  const line = ok ? pickLine(ph.success, FALLBACK_PHRASES.success) : pickLine(ph.fail, FALLBACK_PHRASES.fail);
  const label = ok
    ? pickLine(ph.correctLabel, 'Correct!')
    : outcome === 'timeout'
      ? pickLine(ph.timeoutLabel, "Time's up!")
      : pickLine(ph.wrongLabel, 'Wrong!');
  if (ok) Sfx.success();
  else Sfx.fail();
  speak(line, ok ? 300 : 1600);

  await state.quiz.feedback({ outcome, fact, given, label, line });

  // The player may have quit to the menu meanwhile.
  if (!state.quizActive) return;
  state.quiz.hide();
  state.quizActive = false;
  state.scheduler.reset(); // draw a fresh random interval
  state.game.release('quiz'); // thaw: resume from the exact frozen state
}

function onGameOver({ score, wave }) {
  const p = Profiles.active();
  const rank = p ? Leaderboard.add({ name: p.name, score, wave }) : -1;
  $('#go-score').textContent = score;
  $('#go-wave').textContent = wave;
  $('#go-rank').textContent =
    rank === 0 ? 'New top score!' : rank > 0 ? `You placed #${rank + 1} on the leaderboard!` : '';
  renderLeaderboard($('#leaderboard-gameover'), rank);
  $('#gameover-overlay').hidden = false;
  setTimeout(() => $('#btn-again').focus(), 0);
}

function toggleMute() {
  const s = Settings.set({ muted: !Settings.get().muted });
  Sfx.configure(s);
  if (s.muted) speechCancel();
  toast(s.muted ? 'Sound muted' : 'Sound on');
}

function bindGame() {
  window.addEventListener('keydown', (e) => {
    if (state.view !== 'game' || !$('#modal').hidden) return;
    if (state.quizActive) return; // let the answer box have the keyboard
    const g = state.game;
    const k = KEYMAP[e.code];
    if (k) {
      e.preventDefault();
      if (g.active && !isPaused()) g.input[k] = true;
      return;
    }
    if (e.code === 'KeyP' || e.code === 'Escape') {
      e.preventDefault();
      if (isPaused()) resume();
      else pause();
    } else if (e.code === 'KeyM') {
      toggleMute();
    }
  });
  window.addEventListener('keyup', (e) => {
    const k = KEYMAP[e.code];
    if (k && state.game) state.game.input[k] = false;
  });

  // Pause automatically when the tab is hidden or the window loses focus.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.view === 'game') pause();
  });
  window.addEventListener('blur', () => {
    if (state.view === 'game' && !state.quizActive) pause();
  });

  // Touch controls.
  document.querySelectorAll('.touch-btn').forEach((btn) => {
    const key = btn.dataset.key;
    const set = (down) => (e) => {
      e.preventDefault();
      btn.classList.toggle('is-down', down);
      const g = state.game;
      if (g.active && !g.isHeld()) g.input[key] = down;
    };
    btn.addEventListener('pointerdown', set(true));
    btn.addEventListener('pointerup', set(false));
    btn.addEventListener('pointercancel', set(false));
    btn.addEventListener('pointerleave', set(false));
  });

  $('#btn-resume').addEventListener('click', resume);
  $('#btn-quit').addEventListener('click', quitToMenu);
  $('#btn-again').addEventListener('click', startGame);
  $('#btn-menu').addEventListener('click', () => showView('welcome'));
  $('#btn-go-settings').addEventListener('click', () => showView('settings'));
  window.addEventListener('resize', () => state.game.resize());
}

/* ------------------------------------------------------------------ */
/* Speech (optional, voice settings come from phrases.json)            */
/* ------------------------------------------------------------------ */

let voices = [];
if ('speechSynthesis' in window) {
  const load = () => (voices = speechSynthesis.getVoices());
  load();
  speechSynthesis.addEventListener?.('voiceschanged', load);
}

function speechCancel() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

function speak(text, delayMs = 0) {
  const v = state.phrases.voice || {};
  const s = Settings.get();
  if (!('speechSynthesis' in window) || v.enabled === false || !s.speech || s.muted) return;
  speechCancel();
  const u = new SpeechSynthesisUtterance(text);
  if (v.lang) u.lang = v.lang;
  if (Number.isFinite(v.rate)) u.rate = v.rate;
  if (Number.isFinite(v.pitch)) u.pitch = v.pitch;
  u.volume = Math.min(1, Math.max(0, s.volume));
  const preferred = Array.isArray(v.preferredVoices) ? v.preferredVoices : [];
  const voice =
    preferred.map((name) => voices.find((x) => x.name === name)).find(Boolean) ||
    (v.lang && voices.find((x) => x.lang === v.lang)) ||
    null;
  if (voice) u.voice = voice;
  setTimeout(() => speechSynthesis.speak(u), delayMs);
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

// Weight 1 (the floor) is a calm teal; anything above it jumps to warm
// amber and heats up to hot pink at the maximum, so trouble spots stand out.
function weightStyle(w, min, max) {
  if (w <= min) return 'background:rgba(77,255,192,.16);color:#7dffd0';
  const t = max > min + 1 ? (w - min - 1) / (max - min - 1) : 1;
  const hue = (45 - t * 75 + 360) % 360;
  return `background:hsl(${hue} 95% ${62 - t * 6}%);color:#14081f`;
}

function renderSettings() {
  const p = Profiles.active();
  if (!p) return showView('welcome');
  const cfg = seedConfig();

  $('#set-name').textContent = p.name;
  const sel = $('#set-max-factor');
  sel.innerHTML = '';
  for (let n = MIN_MAX_FACTOR; n <= MAX_MAX_FACTOR; n++) {
    sel.add(new Option(`${n} × ${n}${n === 12 ? ' (default)' : ''}`, String(n), false, n === p.maxFactor));
  }
  sel.value = String(p.maxFactor);

  const s = Settings.get();
  $('#set-mute').checked = s.muted;
  $('#set-volume').value = Math.round(s.volume * 100);
  $('#set-speech').checked = s.speech;

  const st = p.stats;
  const acc = st.asked ? Math.round((st.correct / st.asked) * 100) + '%' : '–';
  $('#set-stats').innerHTML = [
    [st.asked, 'Drills answered'],
    [st.correct, 'Correct'],
    [acc, 'Accuracy'],
    [st.timeouts, 'Timed out'],
  ]
    .map(([v, l]) => `<div class="stat"><span class="stat-value">${v}</span><span class="stat-label">${l}</span></div>`)
    .join('');

  const facts = Object.values(p.facts);
  const tough = facts
    .filter((f) => f.weight > cfg.minWeight)
    .sort((a, b) => b.weight - a.weight || a.a - b.a || a.b - b.b)
    .slice(0, 8);
  $('#set-toughest').innerHTML = tough.length
    ? tough
        .map((f) => `<li>${f.a} × ${f.b}<small>weight ${f.weight} · ${f.correct}/${f.asked} right</small></li>`)
        .join('')
    : '<li class="empty">No trouble spots yet. Missed facts will show up here.</li>';

  $('#weight-hint').textContent =
    `A higher weight means the fact comes up more often. A miss adds ${cfg.wrongDelta}, ` +
    `a correct answer changes it by ${cfg.correctDelta}, and weights stay between ${cfg.minWeight} and ${cfg.maxWeight}. ` +
    `Hover or tap a cell for details.`;

  const n = p.maxFactor;
  const grid = $('#weight-grid');
  grid.style.gridTemplateColumns = `repeat(${n + 1}, 32px)`;
  let html = '<div class="cell corner">×</div>';
  for (let b = 1; b <= n; b++) html += `<div class="cell head">${b}</div>`;
  for (let a = 1; a <= n; a++) {
    html += `<div class="cell head">${a}</div>`;
    for (let b = 1; b <= n; b++) {
      const f = p.facts[factKey(a, b)];
      const tip = `${a} × ${b} = ${a * b}\nWeight ${f.weight}\nAnswered ${f.correct}/${f.asked} correctly`;
      html += `<div class="cell fact" title="${tip}" style="${weightStyle(f.weight, cfg.minWeight, cfg.maxWeight)}">${f.weight}</div>`;
    }
  }
  grid.innerHTML = html;

  renderLeaderboard($('#leaderboard-settings'));

  $('#profile-list').innerHTML = Profiles.list()
    .map(
      (prof) =>
        `<li><span>${escapeHtml(prof.name)}${prof.id === p.id ? '<span class="tag">(current)</span>' : ''}</span>` +
        `<button class="btn btn-danger-outline" type="button" data-delete="${prof.id}">Delete</button></li>`
    )
    .join('');
}

function bindSettings() {
  $('#btn-settings-back').addEventListener('click', () => showView('welcome'));

  $('#set-max-factor').addEventListener('change', (e) => {
    const p = Profiles.active();
    Profiles.setMaxFactor(p.id, Number(e.target.value));
    renderSettings();
    toast(`${p.name} now trains up to ${e.target.value} × ${e.target.value}.`);
  });

  $('#set-mute').addEventListener('change', (e) => {
    Sfx.configure(Settings.set({ muted: e.target.checked }));
    if (e.target.checked) speechCancel();
  });
  $('#set-volume').addEventListener('input', (e) => {
    Sfx.configure(Settings.set({ volume: Number(e.target.value) / 100 }));
  });
  $('#set-volume').addEventListener('change', () => {
    Sfx.unlock();
    Sfx.shoot();
  });
  $('#set-speech').addEventListener('change', (e) => {
    Settings.set({ speech: e.target.checked });
    if (!e.target.checked) speechCancel();
  });

  $('#btn-clear-leaderboard').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Clear leaderboard?',
      message: 'This removes every high score for all profiles. It cannot be undone.',
      okLabel: 'Clear scores',
    });
    if (!ok) return;
    Leaderboard.clear();
    renderSettings();
    toast('Leaderboard cleared.');
  });

  $('#btn-reset-progress').addEventListener('click', async () => {
    const p = Profiles.active();
    const ok = await confirmDialog({
      title: 'Reset progress?',
      message: `Reset ${p.name}'s times-tables weights and accuracy back to the start? High scores are kept.`,
      okLabel: 'Reset progress',
    });
    if (!ok) return;
    Profiles.resetProgress(p.id);
    renderSettings();
    toast('Progress reset.');
  });

  $('#profile-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-delete]');
    if (!btn) return;
    const target = Profiles.get(btn.dataset.delete);
    if (!target) return;
    const wasActive = Profiles.active()?.id === target.id;
    const ok = await confirmDialog({
      title: `Delete "${target.name}"?`,
      message:
        `This permanently deletes ${target.name}'s profile, including all times-tables weights and accuracy. ` +
        'Their scores stay on the shared leaderboard. This cannot be undone.',
      okLabel: 'Delete profile',
    });
    if (!ok) return;
    const next = Profiles.remove(target.id);
    if (!wasActive) {
      renderSettings();
      toast(`Deleted "${target.name}".`);
      return;
    }
    state.justCreated = false;
    if (next) toast(`Deleted "${target.name}". Switched to ${next.name}.`);
    else toast(`Deleted "${target.name}". Create a new profile to play.`);
    showView('welcome');
  });
}

/* ------------------------------------------------------------------ */
/* Modal dialogs                                                       */
/* ------------------------------------------------------------------ */

let modalResolve = null;
let modalValidate = null;
let modalReturnFocus = null;

function openModal({ title, message, okLabel = 'OK', danger = false, input = false, validate = null }) {
  return new Promise((resolve) => {
    modalReturnFocus = document.activeElement;
    $('#modal-title').textContent = title;
    $('#modal-message').textContent = message || '';
    $('#modal-error').textContent = '';
    $('#modal-field').hidden = !input;
    $('#modal-input').value = '';
    const ok = $('#modal-ok');
    ok.textContent = okLabel;
    ok.classList.toggle('btn-danger', danger);
    ok.classList.toggle('btn-primary', !danger);
    modalValidate = validate;
    modalResolve = resolve;
    $('#modal').hidden = false;
    setTimeout(() => (input ? $('#modal-input') : $('#modal-cancel')).focus(), 20);
  });
}

function closeModal(result) {
  $('#modal').hidden = true;
  const r = modalResolve;
  modalResolve = null;
  if (modalReturnFocus && modalReturnFocus.focus) modalReturnFocus.focus();
  if (r) r(result);
}

function confirmDialog(opts) {
  return openModal({ ...opts, danger: true });
}

function promptDialog(opts) {
  return openModal({ ...opts, input: true });
}

function bindModal() {
  $('#modal-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!$('#modal-field').hidden) {
      const v = $('#modal-input').value;
      const err = modalValidate ? modalValidate(v) : null;
      if (err) {
        $('#modal-error').textContent = err;
        return;
      }
      closeModal(v.trim());
    } else {
      closeModal(true);
    }
  });
  $('#modal-cancel').addEventListener('click', () => closeModal($('#modal-field').hidden ? false : null));
  $('#modal').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal($('#modal-field').hidden ? false : null);
    }
  });
  $('#modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal') closeModal($('#modal-field').hidden ? false : null);
  });
}

boot();
