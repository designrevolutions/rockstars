# Times Table Invaders

A Space Invaders-style arcade game that stops every so often for a quick training drill. The player picks which quiz the drills come from: **Times tables** or **Flags of the World**, with room for more. It is plain HTML, CSS and JavaScript using the Canvas 2D API. There is no framework, no build step and no backend. Everything a player does is saved in the browser's `localStorage`.

## Running it

The game uses ES modules and loads its data and quizzes with `fetch`, so it must be served over HTTP. Opening `index.html` straight from disk will not work.

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
| `?quiz=5` | Overrides the drill interval with 5 seconds for this visit, keeping the profile's random or fixed mode. Settings shows a note while it is active. |
| `?intro=reset` | Resets this device's intro auto-play count, so the intro auto-plays again. |
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
index.html            all views: welcome, game, settings, plus overlays and the modal
css/style.css         shared styling and the starfield backdrop
data/settings.json    app-wide settings: default quiz, default drill timing, speaking voice
data/name_intro.json  the opening crawl's story lines and settings
js/app.js             the shell: views, profiles UI, quiz picker, settings, drill freeze/thaw glue
js/games.js           loads the quizzes listed in games/games.json and defines the game contract
js/quiz.js            the drill scheduler and the drill overlay (title, countdown, feedback)
js/weights.js         shared weighted-repetition helpers any quiz can use
js/storage.js         localStorage: profiles, per-quiz data buckets, leaderboard, device settings
js/game.js            the arcade engine: simulation clock, entities, collisions, rendering
js/audio.js           every sound effect, synthesised with the Web Audio API
js/sprites.js         pixel-art sprites drawn from text bitmaps
js/intro.js           the opening crawl: Enter screen, scroll, skip, auto-play count
js/intro-music.js     the intro theme, synthesised with the Web Audio API
games/games.json      the manifest: which quizzes exist, in menu order
games/times-tables/   game.json, game.js, style.css, facts.json, phrases.json
games/flags/          game.json, game.js, style.css, flags.json, phrases.json, images/*.svg
```

The arcade's sprites are drawn in code and every sound is synthesised. The only image files are the flag SVGs, which come from the MIT-licensed [flag-icons](https://github.com/lipis/flag-icons) project (see `games/flags/images/LICENSE`).

## Quizzes

The arcade is shared and the quizzes plug into it. Each quiz lives in its own folder under `games/` and holds everything specific to it: its settings, logic, styling, questions and phrases. The shared shell handles everything else: choosing a quiz, profiles, when drills fire, freezing the arcade, the countdown, feedback, phrases, speech, sound and the leaderboard.

### Why there is a manifest

A static site cannot list the contents of a folder, because the browser can only fetch files whose names it already knows. So `games/games.json` lists the quiz folders:

```json
{ "games": ["times-tables", "flags"] }
```

The manifest only names the folders. Everything else about a quiz is in that quiz's own `game.json`. A quiz that fails to load is logged to the console and left out of the menus, and the other quizzes keep working.

### Choosing a quiz

The player picks a quiz from the **Quiz** menu on the welcome screen, and the choice is saved per profile. New profiles start on `defaultGame` from `data/settings.json`. If that quiz is missing, they start on the first quiz in the manifest.

### Each quiz's folder

| File | Purpose |
| --- | --- |
| `game.json` | `name` for the menus, `timeLimitSeconds` to answer each drill, and which `phrases` and `stylesheet` files to load. |
| `game.js` | The quiz's logic and question UI. It default-exports `createGame(ctx)`. |
| `style.css` | Styles for this quiz's question and settings panel only. |
| `phrases.json` | The drill title and the success and fail lines, in the same format as before. It may include a `voice` block to override the shared voice. |
| anything else | The quiz's own data, such as `facts.json`, `flags.json` or `images/`. The quiz loads these itself with `ctx.loadJSON` and `ctx.url`. |

### The contract between the shell and a quiz

The full contract is documented at the top of `js/games.js`. In short, the shell gives `createGame` a `ctx` object containing:

- the quiz's folder (`url`, `loadJSON`) and its `meta` (the parsed `game.json`)
- the active profile's private data bucket for this quiz (`data()`, `save()`, `resetData()`)
- the shared weighting helpers (`weights`) and a few UI helpers (`ui.toast`, `ui.confirm`, `ui.escapeHtml`)

The quiz returns an object with these methods:

| Method | Job |
| --- | --- |
| `load()` | Load data files. Throwing hides the quiz. |
| `newQuestion()` | Pick the next question. It can be async, for example to preload an image. |
| `renderQuestion(el, q, answer)` | Draw the question into the drill overlay and call `answer('correct' \| 'wrong', given)` once. Returns `{ lock(), reveal?() }`. `reveal` keeps the question visible during feedback, which the flags quiz uses to mark the right answer. |
| `answerText(q)`, `givenText(q, given)` | The feedback lines, for example `7 × 8 = 56` and `You answered 54.` |
| `spokenAnswer(q, outcome)` | Optional. Spoken before the fail line. |
| `record(q, outcome)` | Update weights and stats. `outcome` is `'correct'`, `'wrong'` or `'timeout'`. |
| `renderSettings(el)` | Draw this quiz's options and progress into its panel in Settings. |

A quiz decides how it is answered, such as typing a number or clicking one of four options, how its questions are picked, and what it stores. The shell never looks inside a question.

### Adding a new quiz

1. Copy an existing folder, for example `games/flags/` to `games/capitals/`. The folder name is the quiz's ID: letters, digits, `-` and `_`.
2. Edit `game.json` to set the name and the time limit.
3. Replace the data files and `phrases.json`, and change `game.js` for the new questions and answers.
4. Add `"capitals"` to `games/games.json`.

No shared code changes. To make it the default for new profiles, set `"defaultGame": "capitals"` in `data/settings.json`.

### Times tables

This quiz shows `a × b = ?` with a typed answer and 5 seconds to reply. It plays exactly as before the quiz system existed. Its range (up to 2×2 to 20×20), progress, weight grid and reset button are in its Settings panel.

### Flags of the World

This quiz shows a flag and asks *What country flag is this?*, with four countries to choose from. Players can click an option or press 1 to 4. It gives 8 seconds to answer. Two of the wrong options come from the same region as the right answer where possible, because neighbouring flags tend to look alike. After a wrong answer, the right option is highlighted, the correct country is shown and spoken, and then a fail line is read out.

It covers 195 countries: the 193 UN members plus Vatican City and Palestine. Each country has a weight, using the same rules as the times-tables facts. In Settings, a player can limit the regions it asks about, see which flags need the most training, and see the weight of every flag.

## Design rationale

### Why the game is frozen and thawed instead of paused and restarted

A drill can appear at any moment: mid-volley, with the mystery ship halfway across, a step before the invaders march down. The player is in the middle of something and has to stop to do maths. If the game drifted on, or jumped forward when the drill closed, a drill would cost the player a life they could not defend. That would turn learning into a punishment.

So the engine never reads the wall clock for game logic. It keeps its own simulation clock, `game.time`, which only advances inside `update()`. That function only runs from the `requestAnimationFrame` loop. Every timer in the game counts in simulation seconds: the march step, enemy fire, the mystery-ship spawn, respawn delays, banners, particle lifetimes and even star twinkle.

Freezing calls `game.hold('quiz')`, which cancels the animation frame. Nothing is scheduled, so nothing runs: no hidden updates, no off-screen firing. Thawing calls `game.release('quiz')`. That restarts the loop with the last timestamp cleared, so the first frame after a thaw has a time step of zero. The game carries on from exactly the state it was frozen in. It never catches up on the time that passed and never re-syncs to the current time.

Holds are a set of named reasons: `quiz`, `pause` and so on. The loop only runs when the set is empty. That lets independent reasons overlap safely. For example, if the tab is hidden during a drill, the game stays paused after the drill ends instead of springing back to life.

The drill timer itself runs on real seconds, not simulation seconds. It is fed only by frames that actually ran, so it does not count time spent on menus, in the pause screen or inside a drill. After every drill, whatever the result, it starts a fresh gap. How long that gap is depends on the profile's drill timing, described next.

### Drill timing

Each profile chooses how drills are spaced, in Settings under **Drill timing**. The timing applies to every quiz.

- **Random** spaces drills at a random moment around the chosen interval. With the default spread, a 20-second interval gives gaps anywhere from 10 to 30 seconds, averaging 20. This keeps drills from feeling predictable.
- **Fixed** spaces drills exactly one interval apart, which suits a player who likes to know when the next one is coming.

The interval can be set from 10 to 300 seconds. New profiles start from the `drillTiming` defaults in `data/settings.json`:

```json
{
  "defaultGame": "times-tables",
  "drillTiming": {
    "mode": "random",
    "intervalSeconds": 20,
    "minIntervalSeconds": 10,
    "maxIntervalSeconds": 300,
    "randomSpread": 0.5
  },
  "voice": { "enabled": true, "lang": "en-GB", "rate": 0.95, "pitch": 0.75, "preferredVoices": ["..."] }
}
```

`randomSpread` sets how far a random gap may stray from the interval. A value of 0.5 allows gaps from half to one and a half times the interval. Editing the file changes the starting point for new profiles. It never overrides a choice a player has already saved.

How long a player has to *answer* is a per-quiz setting, `timeLimitSeconds` in that quiz's `game.json`, because a typed sum and a four-way choice need different amounts of time.

Timing is stored per profile because the right pace depends on the learner. A confident player might want a drill every 15 seconds, while a younger sibling on the same device might prefer one a minute.

### Why questions use weights from a JSON file instead of plain random selection

Plain random selection treats `2 × 2` and `7 × 8` the same forever. A player who keeps missing `7 × 8` would see it no more often than facts they already know.

Each fact has a weight, and a fact's chance of being asked is its weight divided by the sum of all weights. A miss raises the weight and a correct answer lowers it. Facts the player struggles with come back more often, and mastered facts fade into the background without disappearing. This is a light form of spaced repetition.

Weights are clamped between a minimum and a maximum, 1 to 10 by default. The minimum keeps every fact in rotation, because a weight of zero would retire it for good. The maximum stops one stubborn fact from crowding out everything else.

The starting weights and the rules live in each quiz's data file, `games/times-tables/facts.json` or `games/flags/flags.json`, rather than in code. Both quizzes use the shared helpers in `js/weights.js`, and the flags quiz weights each country the same way:

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

The lines shown after a drill live in each quiz's `phrases.json` rather than in the code. Each line can be a single string or an array of strings. An array is drawn from a shuffled bag, so every line is used once before any repeats.

- **Swapping the wording is a content change, not a code change.** Anyone can change the tone, translate it or add variety without reading JavaScript.
- **Each quiz has its own lines.** The flags quiz reuses the drill sergeant's general lines but swaps the maths jokes for geography ones.
- **The voice is configurable.** Lines are read aloud with the browser's built-in speech synthesis. The shared `voice` block in `data/settings.json` sets the language, rate, pitch and preferred voices, and a quiz's `phrases.json` can override any of it. Players can turn speech off in Settings.
- **The defaults are original.** They use a drill-sergeant "soldier" theme rather than quoting dialogue from any film.

If a quiz's phrases file is missing or broken, that quiz falls back to a short built-in set of lines and keeps running.

## localStorage data shape

Three keys are used, each versioned so the format can change later without misreading old data.

### `tti.profiles.v1`: profiles and their training data

```jsonc
{
  "version": 2,
  "lastActiveId": "p_mw6b1q2xk3f9a",      // the profile auto-selected on load
  "profiles": {
    "p_mw6b1q2xk3f9a": {
      "id": "p_mw6b1q2xk3f9a",
      "name": "Ava",
      "createdAt": 1794050000000,
      "lastUsedAt": 1794050785786,
      "game": "flags",                     // chosen quiz; null means data/settings.json's defaultGame
      "drill": { "mode": "random", "interval": 20 },  // seconds; shared by every quiz
      "games": {                           // one private bucket per quiz, shaped by that quiz
        "times-tables": {
          "maxFactor": 12,                 // table range, 2–20
          "facts": { "7x8": { "a": 7, "b": 8, "weight": 5, "asked": 4, "correct": 1 } },
          "stats": { "asked": 7, "correct": 4, "wrong": 2, "timeouts": 1 }
        },
        "flags": {
          "regions": null,                 // null means every region, or e.g. ["Europe", "Africa"]
          "items": { "fr": { "weight": 3, "asked": 2, "correct": 1 } },
          "stats": { "asked": 2, "correct": 1, "wrong": 1, "timeouts": 0 }
        }
      }
    }
  }
}
```

Version 1 profiles kept the times-tables `maxFactor`, `facts` and `stats` on the profile itself. They are moved into `games["times-tables"]` the first time the profile is used, so no progress is lost.

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
