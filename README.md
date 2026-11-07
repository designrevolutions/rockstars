# Times Table Invaders

A Space Invaders-style arcade game that stops every minute or so for a quick times-tables drill. It is plain HTML, CSS and JavaScript using the Canvas 2D API. There is no framework, no build step and no backend. Everything a player does is saved in the browser's `localStorage`.

## Running it

The game uses ES modules and loads two JSON files, so it must be served over HTTP. Opening `index.html` straight from disk will not work.

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

### Deploying to Cloudflare Pages

Connect the repository in Cloudflare Pages and use these settings:

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Build command | *(leave empty)* |
| Build output directory | `/` |

### Handy URL options

| Option | Effect |
| --- | --- |
| `?quiz=10` | Fires a drill roughly every 10 seconds instead of every 40–80 seconds. |
| `?debug=1` | Exposes the app's internals on `window.__tti` for poking at in the console. |

## Controls

| Action | Keys |
| --- | --- |
| Move | ← → or A D |
| Fire | Space, ↑ or W |
| Pause | P or Esc |
| Mute | M |

On touch screens, on-screen ◀ FIRE ▶ buttons appear under the game.

## Project layout

```
index.html          all views: welcome, game, settings, plus overlays and the modal
css/style.css       styling and the starfield backdrop
js/app.js           view switching, profiles UI, settings, and the quiz freeze/thaw glue
js/game.js          the game engine: simulation clock, entities, collisions, rendering
js/quiz.js          the drill scheduler and the drill overlay
js/storage.js       localStorage: profiles, fact weights, leaderboard, device settings
js/audio.js         every sound effect, synthesised with the Web Audio API
js/sprites.js       pixel-art sprites drawn from text bitmaps
data/facts.json     seed list of multiplication facts and the weight rules
data/phrases.json   the lines shown and spoken after each drill
assets/             the planet backdrop image
```

All sprites are drawn in code and every sound is synthesised, so there are no image or audio files to manage.

## Design rationale

### Why the game is frozen and thawed instead of paused and restarted

A drill can appear at any moment: mid-volley, with the mystery ship halfway across, a step before the invaders march down. The player is in the middle of something and has to stop to do maths. If the game drifted on, or jumped forward when the drill closed, a drill would cost the player a life they could not defend. That would turn learning into a punishment.

So the engine never reads the wall clock for game logic. It keeps its own simulation clock, `game.time`, which only advances inside `update()`. That function only runs from the `requestAnimationFrame` loop. Every timer in the game counts in simulation seconds: the march step, enemy fire, the mystery-ship spawn, respawn delays, banners, particle lifetimes and even star twinkle.

Freezing calls `game.hold('quiz')`, which cancels the animation frame. Nothing is scheduled, so nothing runs: no hidden updates, no off-screen firing. Thawing calls `game.release('quiz')`. That restarts the loop with the last timestamp cleared, so the first frame after a thaw has a time step of zero. The game carries on from exactly the state it was frozen in. It never catches up on the time that passed and never re-syncs to the current time.

Holds are a set of named reasons: `quiz`, `pause` and so on. The loop only runs when the set is empty. That lets independent reasons overlap safely. For example, if the tab is hidden during a drill, the game stays paused after the drill ends instead of springing back to life.

The drill timer itself runs on real seconds, not simulation seconds. It is fed only by frames that actually ran, so it does not count time spent on menus, in the pause screen or inside a drill. After every drill, whatever the result, it draws a fresh random interval between 40 and 80 seconds so drills never feel metronomic.

### Why facts use weights from a JSON file instead of plain random selection

Plain random selection treats `2 × 2` and `7 × 8` the same forever. A player who keeps missing `7 × 8` would see it no more often than facts they already know.

Each fact has a weight, and a fact's chance of being asked is its weight divided by the sum of all weights. A miss raises the weight and a correct answer lowers it. Facts the player struggles with come back more often, and mastered facts fade into the background without disappearing. This is a light form of spaced repetition.

Weights are clamped between a minimum and a maximum, 1 to 10 by default. The minimum keeps every fact in rotation, because a weight of zero would retire it for good. The maximum stops one stubborn fact from crowding out everything else.

The starting weights and the rules live in `data/facts.json` rather than in code:

```json
{
  "maxFactor": 12, "defaultWeight": 1, "minWeight": 1, "maxWeight": 10,
  "correctDelta": -1, "wrongDelta": 2,
  "facts": [{ "a": 1, "b": 1, "weight": 1 }, ...]
}
```

That makes the system tunable without touching code. A teacher could start the 7, 8 and 12 tables heavier, or make misses count for more. The seed is copied into a profile the first time that profile is used. From then on the profile's own copy is the source of truth, so each player's history is theirs alone.

Changing a profile's table range rebuilds its fact set. Facts still in range keep their weight and history. New facts start at the seed weight, or the default weight past the seed's range. Facts now out of range are dropped.

### Why profiles are separate from the shared leaderboard

Profiles and the leaderboard answer different questions.

A **profile** is about learning. It holds one person's fact weights, accuracy and table range. Mixing two learners' data would make the weights useless, so each profile is fully isolated.

The **leaderboard** is about the game. It is a single family or classroom high-score table where everyone competes on the same board. That is more fun than each person only ever beating themselves.

Keeping them apart has practical benefits too. Deleting a profile removes that learner's private training data but leaves their past scores on the board, since those are a record of games that were played. Clearing the leaderboard never touches anyone's learning progress. Leaderboard entries store a copy of the player's name rather than a profile ID, so they never point at a profile that no longer exists.

### Why the spoken lines live in a phrases JSON

The lines shown after a drill live in `data/phrases.json` rather than in the code. Each line can be a single string or an array of strings, and an array picks one line at random each time.

- **Swapping the wording is a content change, not a code change.** Anyone can change the tone, translate it or add variety without reading JavaScript.
- **The voice is configurable in the same place.** Lines are read aloud with the browser's built-in speech synthesis. The `voice` block sets the language, rate, pitch and preferred voices. Players can turn speech off in Settings.
- **The defaults are original.** They use a drill-sergeant "soldier" theme rather than quoting dialogue from any film.

If the file is missing or broken, the game falls back to a short built-in set of lines and keeps running.

## localStorage data shape

Three keys are used, each versioned so the format can change later without misreading old data.

### `tti.profiles.v1`: profiles and their training data

```jsonc
{
  "version": 1,
  "lastActiveId": "p_mw6b1q2xk3f9a",      // the profile auto-selected on load
  "profiles": {
    "p_mw6b1q2xk3f9a": {
      "id": "p_mw6b1q2xk3f9a",
      "name": "Ava",
      "createdAt": 1794050000000,
      "lastUsedAt": 1794050785786,
      "maxFactor": 12,                     // per-profile table range, 2–20
      "facts": {                           // one entry per fact, a×b for a,b in 1..maxFactor
        "7x8": { "a": 7, "b": 8, "weight": 5, "asked": 4, "correct": 1 },
        "2x2": { "a": 2, "b": 2, "weight": 1, "asked": 3, "correct": 3 }
      },
      "stats": { "asked": 7, "correct": 4, "wrong": 2, "timeouts": 1 }
    }
  }
}
```

### `tti.leaderboard.v1`: the shared top 10

```jsonc
[
  { "id": "p_mw6c...", "name": "Ava", "score": 4210, "wave": 4, "date": 1794050785786 }
]
```

The list is sorted by score, highest first. On a tie the earlier score ranks higher.

### `tti.settings.v1`: device-level preferences

```json
{ "muted": false, "volume": 0.7, "speech": true }
```

Sound settings belong to the device, not to a profile, because they follow the room the game is played in rather than the person.

If `localStorage` is unavailable, for example when site data is blocked, the game keeps working from memory for the session and shows a warning that nothing will be saved.

## Gameplay summary

- Five rows of eleven invaders march side to side and step down at each edge. Squids score 30, crabs 20 and octopuses 10. The mystery ship scores 50 to 300.
- The march speeds up as invaders die, with an extra boost for every row wiped out. Each new wave starts lower and faster, and fires faster and more often.
- Clearing a wave earns a bonus of 250 points times the wave number. An extra life is awarded at 1,500 points.
- Four destructible bunkers erode under fire from both sides and are rebuilt each wave.
- The game ends when the last life is lost or the invaders reach the ground.
