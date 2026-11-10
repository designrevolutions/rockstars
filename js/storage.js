// Persistence layer. Everything lives in localStorage under three keys:
//   tti.profiles.v1    – all profiles, their drill timing and each game's data
//   tti.leaderboard.v1 – one shared top-10 high-score list
//   tti.settings.v1    – device-level sound settings
// If localStorage is unavailable (private mode, blocked storage) we fall back
// to an in-memory copy so the game still works for the session.

import { clamp } from './weights.js';

const KEYS = {
  profiles: 'tti.profiles.v1',
  leaderboard: 'tti.leaderboard.v1',
  settings: 'tti.settings.v1',
};

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

/* ------------------------------------------------------------------ */
/* Drill timing defaults (from data/settings.json)                     */
/* ------------------------------------------------------------------ */

let drill = null;

// Accepts the drillTiming object from data/settings.json. Missing or bad
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
  return { version: 2, lastActiveId: null, profiles: {} };
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
  store.version = 2;
  writeJSON(KEYS.profiles, store);
}

function newId() {
  return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Brings older profiles up to date. Version 1 kept the times-tables data
// (maxFactor, facts, stats) on the profile itself; it now lives in that
// game's bucket under p.games, like every other game's data.
function ensureProfile(p) {
  let changed = false;
  if (!p.games || typeof p.games !== 'object') {
    p.games = {};
    changed = true;
  }
  if ('facts' in p || 'maxFactor' in p || 'stats' in p) {
    const tt = p.games['times-tables'] || (p.games['times-tables'] = {});
    if (p.maxFactor && !tt.maxFactor) tt.maxFactor = p.maxFactor;
    if (p.facts && !tt.facts) tt.facts = p.facts;
    if (p.stats && !tt.stats) tt.stats = p.stats;
    delete p.maxFactor;
    delete p.facts;
    delete p.stats;
    changed = true;
  }
  if (!p.drill) {
    p.drill = cleanDrill(null);
    changed = true;
  }
  if (changed) save();
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
    if (p) ensureProfile(p);
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
      game: null,
      games: {},
      drill: cleanDrill(null),
    };
    store.profiles[p.id] = p;
    store.lastActiveId = p.id;
    save();
    return p;
  },

  switchTo(id) {
    const p = store.profiles[id];
    if (!p) return null;
    p.lastUsedAt = Date.now();
    ensureProfile(p);
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

  setDrillTiming(id, patch) {
    const p = store.profiles[id];
    if (!p) return null;
    p.drill = cleanDrill({ ...cleanDrill(p.drill), ...patch });
    save();
    return p.drill;
  },

  // Which quiz this profile plays: a folder name under games/, or null for
  // the default from data/settings.json.
  setGame(id, gameId) {
    const p = store.profiles[id];
    if (!p) return;
    p.game = gameId;
    save();
  },

  // The profile's private data for one game. Each game owns the shape of
  // its own bucket, changes it in place and calls Profiles.save().
  gameData(id, gameId) {
    const p = store.profiles[id];
    if (!p) return null;
    ensureProfile(p);
    return p.games[gameId] || (p.games[gameId] = {});
  },

  resetGameData(id, gameId) {
    const p = store.profiles[id];
    if (!p) return;
    ensureProfile(p);
    p.games[gameId] = {};
    save();
  },

  save() {
    save();
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
