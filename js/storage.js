// Persistence layer. Everything lives in localStorage under three keys:
//   tti.profiles.v1    – all profiles, their fact weights and quiz stats
//   tti.leaderboard.v1 – one shared top-10 high-score list
//   tti.settings.v1    – device-level sound settings
// If localStorage is unavailable (private mode, blocked storage) we fall back
// to an in-memory copy so the game still works for the session.

const KEYS = {
  profiles: 'tti.profiles.v1',
  leaderboard: 'tti.leaderboard.v1',
  settings: 'tti.settings.v1',
};

export const DEFAULT_MAX_FACTOR = 12;
export const MIN_MAX_FACTOR = 2;
export const MAX_MAX_FACTOR = 20;
export const NAME_MAX_LENGTH = 16;
export const LEADERBOARD_SIZE = 10;

const memory = new Map();
let persistent = true;

function rawGet(key) {
  if (memory.has(key)) return memory.get(key);
  try {
    return localStorage.getItem(key);
  } catch {
    persistent = false;
    return null;
  }
}

function rawSet(key, value) {
  try {
    localStorage.setItem(key, value);
    memory.delete(key);
  } catch {
    persistent = false;
    memory.set(key, value);
  }
}

function readJSON(key, fallback) {
  const raw = rawGet(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  rawSet(key, JSON.stringify(value));
}

export function storageIsPersistent() {
  return persistent;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const factKey = (a, b) => `${a}x${b}`;

/* ------------------------------------------------------------------ */
/* Seed facts                                                          */
/* ------------------------------------------------------------------ */

let seed = null;

// Accepts the parsed contents of data/facts.json. A missing or malformed
// file falls back to an all-ones 12x12 table so the game can still run.
export function setSeed(json) {
  const base = {
    maxFactor: 12,
    defaultWeight: 1,
    minWeight: 1,
    maxWeight: 10,
    correctDelta: -1,
    wrongDelta: 2,
    facts: [],
  };
  const s = { ...base, ...(json && typeof json === 'object' ? json : {}) };
  s.minWeight = Math.max(1, Number(s.minWeight) || 1);
  s.maxWeight = Math.max(s.minWeight, Number(s.maxWeight) || 10);
  s.defaultWeight = clamp(Number(s.defaultWeight) || 1, s.minWeight, s.maxWeight);
  s.byKey = new Map();
  for (const f of Array.isArray(s.facts) ? s.facts : []) {
    const a = Number(f.a);
    const b = Number(f.b);
    if (!Number.isInteger(a) || !Number.isInteger(b)) continue;
    const w = clamp(Number(f.weight) || s.defaultWeight, s.minWeight, s.maxWeight);
    s.byKey.set(factKey(a, b), w);
  }
  seed = s;
}

export function seedConfig() {
  if (!seed) setSeed(null);
  return seed;
}

function seedWeight(a, b) {
  const s = seedConfig();
  return s.byKey.get(factKey(a, b)) ?? s.defaultWeight;
}

// Builds the fact map for 1..maxFactor. Facts already in `existing` keep their
// weight and stats; new facts start at their seed (default) weight; facts
// outside the range are dropped simply by not being copied.
export function buildFacts(maxFactor, existing = {}) {
  const out = {};
  for (let a = 1; a <= maxFactor; a++) {
    for (let b = 1; b <= maxFactor; b++) {
      const k = factKey(a, b);
      const old = existing && existing[k];
      out[k] = old
        ? { a, b, weight: old.weight, asked: old.asked || 0, correct: old.correct || 0 }
        : { a, b, weight: seedWeight(a, b), asked: 0, correct: 0 };
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Drill timing defaults (from data/config.json)                       */
/* ------------------------------------------------------------------ */

let drill = null;

// Accepts the drillTiming object from data/config.json. Missing or bad
// values fall back to random timing around 20 seconds.
export function setDrillDefaults(json) {
  const j = json && typeof json === 'object' ? json : {};
  const min = Math.max(1, Math.round(Number(j.minIntervalSeconds) || 10));
  const max = Math.max(min, Math.round(Number(j.maxIntervalSeconds) || 300));
  const spread = Number(j.randomSpread);
  drill = {
    mode: j.mode === 'fixed' ? 'fixed' : 'random',
    interval: clamp(Math.round(Number(j.intervalSeconds) || 20), min, max),
    min,
    max,
    spread: Number.isFinite(spread) ? clamp(spread, 0, 0.95) : 0.5,
  };
}

export function drillConfig() {
  if (!drill) setDrillDefaults(null);
  return drill;
}

function cleanDrill(d) {
  const cfg = drillConfig();
  const src = d && typeof d === 'object' ? d : {};
  return {
    mode: src.mode === 'fixed' || src.mode === 'random' ? src.mode : cfg.mode,
    interval: clamp(Math.round(Number(src.interval) || cfg.interval), cfg.min, cfg.max),
  };
}

/* ------------------------------------------------------------------ */
/* Profiles                                                            */
/* ------------------------------------------------------------------ */

function emptyStore() {
  return { version: 1, lastActiveId: null, profiles: {} };
}

function loadStore() {
  const s = readJSON(KEYS.profiles, null);
  if (!s || typeof s !== 'object' || !s.profiles || typeof s.profiles !== 'object') {
    return emptyStore();
  }
  return s;
}

let store = loadStore();

function save() {
  writeJSON(KEYS.profiles, store);
}

function newId() {
  return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function freshStats() {
  return { asked: 0, correct: 0, wrong: 0, timeouts: 0 };
}

// "First use" of a profile: copy the seed facts into it. Also fills in
// fields added in later versions (drill timing) for older profiles.
function ensureFacts(p) {
  if (!p.facts || typeof p.facts !== 'object' || !Object.keys(p.facts).length) {
    p.facts = buildFacts(p.maxFactor);
  }
  if (!p.stats) p.stats = freshStats();
  if (!p.drill) p.drill = cleanDrill(null);
}

export const Profiles = {
  list() {
    return Object.values(store.profiles).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );
  },

  get(id) {
    return store.profiles[id] || null;
  },

  // The last-logged-in profile, repairing the pointer if it went stale.
  active() {
    let p = store.profiles[store.lastActiveId];
    if (!p) {
      const all = Object.values(store.profiles).sort(
        (a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0)
      );
      p = all[0] || null;
      store.lastActiveId = p ? p.id : null;
      if (p) save();
    }
    if (p) ensureFacts(p);
    return p;
  },

  nameError(name) {
    const n = (name || '').trim();
    if (!n) return 'Please enter a name.';
    if (n.length > NAME_MAX_LENGTH) return `Names can be at most ${NAME_MAX_LENGTH} characters.`;
    const clash = Object.values(store.profiles).some(
      (p) => p.name.toLowerCase() === n.toLowerCase()
    );
    if (clash) return `A profile called "${n}" already exists.`;
    return null;
  },

  create(name) {
    const err = this.nameError(name);
    if (err) throw new Error(err);
    const now = Date.now();
    const p = {
      id: newId(),
      name: name.trim(),
      createdAt: now,
      lastUsedAt: now,
      maxFactor: DEFAULT_MAX_FACTOR,
      facts: null,
      stats: freshStats(),
      drill: cleanDrill(null),
    };
    ensureFacts(p);
    store.profiles[p.id] = p;
    store.lastActiveId = p.id;
    save();
    return p;
  },

  switchTo(id) {
    const p = store.profiles[id];
    if (!p) return null;
    p.lastUsedAt = Date.now();
    ensureFacts(p);
    store.lastActiveId = id;
    save();
    return p;
  },

  // Removes a profile permanently. Returns the profile that is active
  // afterwards (possibly a different one), or null if none remain.
  remove(id) {
    delete store.profiles[id];
    if (store.lastActiveId === id) store.lastActiveId = null;
    save();
    return this.active();
  },

  setMaxFactor(id, n) {
    const p = store.profiles[id];
    if (!p) return;
    const max = clamp(Math.round(n), MIN_MAX_FACTOR, MAX_MAX_FACTOR);
    ensureFacts(p);
    p.maxFactor = max;
    p.facts = buildFacts(max, p.facts);
    save();
  },

  setDrillTiming(id, patch) {
    const p = store.profiles[id];
    if (!p) return null;
    p.drill = cleanDrill({ ...cleanDrill(p.drill), ...patch });
    save();
    return p.drill;
  },

  resetProgress(id) {
    const p = store.profiles[id];
    if (!p) return;
    p.facts = buildFacts(p.maxFactor);
    p.stats = freshStats();
    save();
  },

  // Weighted-random pick: each fact's chance is weight / sum(weights).
  // Avoids asking the exact same fact twice in a row when possible.
  pickFact(id, avoidKey = null) {
    const p = store.profiles[id];
    if (!p) return null;
    ensureFacts(p);
    const facts = Object.values(p.facts);
    const draw = () => {
      const total = facts.reduce((sum, f) => sum + f.weight, 0);
      let r = Math.random() * total;
      for (const f of facts) {
        r -= f.weight;
        if (r < 0) return f;
      }
      return facts[facts.length - 1];
    };
    let f = draw();
    if (facts.length > 1 && factKey(f.a, f.b) === avoidKey) f = draw();
    if (facts.length > 1 && factKey(f.a, f.b) === avoidKey) f = draw();
    return { a: f.a, b: f.b, key: factKey(f.a, f.b) };
  },

  // outcome: 'correct' | 'wrong' | 'timeout'. Returns the fact's new weight.
  recordAnswer(id, a, b, outcome) {
    const p = store.profiles[id];
    if (!p) return null;
    ensureFacts(p);
    const s = seedConfig();
    const k = factKey(a, b);
    const f = p.facts[k] || (p.facts[k] = { a, b, weight: s.defaultWeight, asked: 0, correct: 0 });
    const ok = outcome === 'correct';
    f.asked += 1;
    if (ok) f.correct += 1;
    f.weight = clamp(f.weight + (ok ? s.correctDelta : s.wrongDelta), s.minWeight, s.maxWeight);
    p.stats.asked += 1;
    if (ok) p.stats.correct += 1;
    else if (outcome === 'timeout') p.stats.timeouts += 1;
    else p.stats.wrong += 1;
    save();
    return f.weight;
  },
};

/* ------------------------------------------------------------------ */
/* Shared leaderboard                                                  */
/* ------------------------------------------------------------------ */

function sortBoard(list) {
  return list.sort((a, b) => b.score - a.score || a.date - b.date);
}

export const Leaderboard = {
  list() {
    const raw = readJSON(KEYS.leaderboard, []);
    const clean = (Array.isArray(raw) ? raw : []).filter(
      (e) => e && typeof e.name === 'string' && Number.isFinite(e.score)
    );
    return sortBoard(clean).slice(0, LEADERBOARD_SIZE);
  },

  top() {
    const l = this.list();
    return l.length ? l[0].score : 0;
  },

  qualifies(score) {
    if (!(score > 0)) return false;
    const l = this.list();
    return l.length < LEADERBOARD_SIZE || score > l[l.length - 1].score;
  },

  // Returns the 0-based rank of the new entry, or -1 if it did not place.
  add({ name, score, wave }) {
    if (!this.qualifies(score)) return -1;
    const entry = { id: newId(), name, score, wave, date: Date.now() };
    const l = sortBoard([...this.list(), entry]).slice(0, LEADERBOARD_SIZE);
    writeJSON(KEYS.leaderboard, l);
    return l.findIndex((e) => e.id === entry.id);
  },

  clear() {
    writeJSON(KEYS.leaderboard, []);
  },
};

/* ------------------------------------------------------------------ */
/* Device settings                                                     */
/* ------------------------------------------------------------------ */

const DEFAULT_SETTINGS = { muted: false, volume: 0.7, speech: true };

export const Settings = {
  get() {
    const s = readJSON(KEYS.settings, {});
    return { ...DEFAULT_SETTINGS, ...(s && typeof s === 'object' ? s : {}) };
  },
  set(patch) {
    const next = { ...this.get(), ...patch };
    writeJSON(KEYS.settings, next);
    return next;
  },
};
