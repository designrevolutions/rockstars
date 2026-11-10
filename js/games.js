// Game registry. Reads games/games.json, then loads each listed game from
// its own folder (games/<id>/): game.json for its settings, game.js for its
// logic, and optionally phrases.json and a stylesheet.
//
// The contract between the shell and a game
// -----------------------------------------
// games/<id>/game.js default-exports a factory: createGame(ctx) => game.
//
// ctx, what the shell gives the game:
//   id, meta             folder name and the parsed, normalised game.json
//   url(rel)             path of a file in the game's folder
//   loadJSON(rel)        fetches a JSON file from the game's folder (null on failure)
//   profile()            the active profile ({ id, name, ... }) or null
//   data()               the active profile's private bucket for this game;
//                        change it in place, then call save()
//   save()               persists the bucket
//   resetData()          empties the bucket for the active profile
//   weights              shared weighted-repetition helpers (js/weights.js)
//   ui                   { escapeHtml, toast, confirm } from the shell
//
// game, what the game gives the shell:
//   async load()                        load data files; throw to disable the game
//   async newQuestion()                 pick the next question (any shape)
//   renderQuestion(el, q, answer)       draw the question into el and call
//                                       answer(outcome, given) once, where outcome
//                                       is 'correct' or 'wrong'. Returns a handle:
//                                         lock()          stop taking input (required)
//                                         reveal(result)  optional; keeps the question
//                                                         on screen during feedback
//   answerText(q)                       the right answer, e.g. "7 × 8 = 56"
//   givenText(q, given)                 what the player chose, e.g. "You answered 54."
//   spokenAnswer(q, outcome)            optional; spoken before the fail line
//   record(q, outcome)                  update weights and stats ('correct' | 'wrong' | 'timeout')
//   renderSettings(el)                  draw this game's settings and progress into el
//
// The shell owns everything else: when a drill fires, freezing the arcade,
// the countdown (meta.timeLimitSeconds), feedback, phrases, speech and sound.

import * as Weights from './weights.js';
import { Profiles } from './storage.js';

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;

function normaliseMeta(id, raw) {
  const m = raw && typeof raw === 'object' ? raw : {};
  const t = Number(m.timeLimitSeconds);
  return {
    ...m,
    name: typeof m.name === 'string' && m.name.trim() ? m.name.trim() : id,
    timeLimitSeconds: Number.isFinite(t) ? Math.min(120, Math.max(2, Math.round(t))) : 5,
    phrases: typeof m.phrases === 'string' ? m.phrases : null,
    stylesheet: typeof m.stylesheet === 'string' ? m.stylesheet : null,
  };
}

function addStylesheet(href) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

// Loads one game. Resolves to null (and logs why) if anything fails, so one
// broken game never stops the others from loading.
async function loadGame(id, { loadJSON, ui }) {
  try {
    if (!ID_PATTERN.test(id)) throw new Error('invalid folder name');
    const base = `games/${id}/`;
    const rawMeta = await loadJSON(base + 'game.json');
    if (!rawMeta) throw new Error('game.json is missing or invalid');
    const meta = normaliseMeta(id, rawMeta);
    const mod = await import(new URL(`../${base}game.js`, import.meta.url).href);
    if (typeof mod.default !== 'function') throw new Error('game.js has no default export');

    const ctx = Object.freeze({
      id,
      meta,
      url: (rel) => base + rel,
      loadJSON: (rel) => loadJSON(base + rel),
      profile: () => Profiles.active(),
      data: () => {
        const p = Profiles.active();
        return p ? Profiles.gameData(p.id, id) : {};
      },
      save: () => Profiles.save(),
      resetData: () => {
        const p = Profiles.active();
        if (p) Profiles.resetGameData(p.id, id);
      },
      weights: Weights,
      ui,
    });

    const game = mod.default(ctx);
    const [phrases] = await Promise.all([meta.phrases ? loadJSON(base + meta.phrases) : null, game.load()]);
    if (meta.stylesheet) addStylesheet(base + meta.stylesheet);
    return { id, meta, phrases: phrases || {}, game };
  } catch (err) {
    console.warn(`Game "${id}" could not be loaded and is hidden:`, err);
    return null;
  }
}

// Returns the loaded games in manifest order.
export async function loadGames(services) {
  const manifest = await services.loadJSON('games/games.json');
  const ids = Array.isArray(manifest?.games) ? [...new Set(manifest.games.filter((g) => typeof g === 'string'))] : [];
  if (!ids.length) console.warn('games/games.json lists no games.');
  const loaded = await Promise.all(ids.map((id) => loadGame(id, services)));
  return loaded.filter(Boolean);
}
