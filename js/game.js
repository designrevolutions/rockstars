// The game engine. All game time is *simulation time*: it only advances
// inside update(), which only runs from the animation-frame loop. Holding
// the game (quiz, pause, hidden tab) cancels the loop outright, so every
// timer, position and animation phase stays exactly where it was. Releasing
// the hold restarts the loop with a zero-length first frame, so the game
// thaws from the identical state with no catch-up jump.

import { Sfx } from './audio.js';
import { buildSprites, drawSprite, PALETTES } from './sprites.js';

export const W = 800;
export const H = 600;

const STEP = 1 / 120; // fixed simulation step (seconds)
const MAX_FRAME = 0.1; // never simulate more than this per frame

const COLS = 11;
const ROWS = 5;
const COL_W = 48;
const ROW_H = 40;
const ROW_TYPES = [
  { kind: 'squid', pal: 0, points: 30 },
  { kind: 'crab', pal: 1, points: 20 },
  { kind: 'crab', pal: 2, points: 20 },
  { kind: 'octopus', pal: 3, points: 10 },
  { kind: 'octopus', pal: 4, points: 10 },
];

const PLAYER_Y = 520;
const GROUND_Y = 560;
const PLAYER_SPEED = 300;
const PLAYER_COOLDOWN = 0.32;
const MAX_PLAYER_BULLETS = 2;
const PLAYER_BULLET_SPEED = 600;
const START_LIVES = 3;
const EXTRA_LIFE_AT = 1500;

const BUNKER_COLS = 22;
const BUNKER_ROWS = 16;
const CELL = 3;
const BUNKER_Y = 430;

const UFO_POINTS = [50, 100, 150, 300];

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function bunkerShape(x, y) {
  // Rounded top corners.
  if (y < 4 && (x < 4 - y || x >= BUNKER_COLS - (4 - y))) return false;
  // Arch cut-out underneath.
  if (y >= 11 && Math.abs(x - (BUNKER_COLS - 1) / 2) < 3 + (y - 11) * 0.8) return false;
  return true;
}

// The planet photo has a dark square background; crop it to a soft-edged
// circle once so it blends into the starfield.
function maskPlanet(img) {
  const size = 260;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const crop = Math.min(img.naturalWidth, img.naturalHeight) / 1.42;
  g.drawImage(img, (img.naturalWidth - crop) / 2, (img.naturalHeight - crop) / 2, crop, crop, 0, 0, size, size);
  g.globalCompositeOperation = 'destination-in';
  const m = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  m.addColorStop(0, '#000');
  m.addColorStop(0.62, '#000');
  m.addColorStop(0.8, 'rgba(0,0,0,0.6)');
  m.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = m;
  g.fillRect(0, 0, size, size);
  return c;
}

export class Game {
  constructor(canvas, hooks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hooks = hooks;
    this.input = { left: false, right: false, fire: false };
    this.holds = new Set();
    this.raf = null;
    this.lastTs = null;
    this.active = false;
    this.sprites = buildSprites();
    this.planet = null;
    const img = new Image();
    img.onload = () => (this.planet = maskPlanet(img));
    img.src = 'assets/broken-planet.webp';
    this.stars = Array.from({ length: 110 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      z: rand(0.2, 1),
      p: rand(0, Math.PI * 2),
    }));
    this._frame = this._frame.bind(this);
    this.resize();
  }

  /* ---------------- lifecycle ---------------- */

  resize() {
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    if (this.score !== undefined) this.render();
  }

  start({ hiScore = 0, playerName = '' } = {}) {
    this.stop();
    this.hiScore = hiScore;
    this.playerName = playerName;
    this.score = 0;
    this.lives = START_LIVES;
    this.wave = 0;
    this.time = 0; // simulation clock
    this.acc = 0;
    this.extraLifeAwarded = false;
    this.particles = [];
    this.explosions = [];
    this.popups = [];
    const size = this.sprites.size('player');
    this.player = { x: W / 2 - size.w / 2, w: size.w, h: size.h, alive: true, cooldown: 0, invuln: 0, respawn: 0 };
    this.nextWave();
    this.active = true;
    this._schedule();
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.active = false;
    this.holds.clear();
    this.clearInput();
  }

  clearInput() {
    this.input.left = this.input.right = this.input.fire = false;
  }

  // Freeze: stop the loop itself. Nothing advances while any hold exists.
  hold(reason) {
    this.holds.add(reason);
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.clearInput();
  }

  // Thaw: restart the loop from the frozen state once every hold is gone.
  release(reason) {
    this.holds.delete(reason);
    this.clearInput();
    this._schedule();
  }

  isHeld(reason) {
    return reason ? this.holds.has(reason) : this.holds.size > 0;
  }

  _schedule() {
    if (!this.active || this.holds.size || this.raf) return;
    this.lastTs = null; // first frame after a (re)start has dt = 0
    this.raf = requestAnimationFrame(this._frame);
  }

  _frame(ts) {
    this.raf = null;
    if (!this.active || this.holds.size) return;
    if (this.lastTs === null) this.lastTs = ts;
    const realDt = Math.min((ts - this.lastTs) / 1000, 0.25);
    this.lastTs = ts;

    // Real-time hook (drives the quiz timer). It may freeze the game.
    if (this.hooks.onRealTick) this.hooks.onRealTick(realDt);
    if (!this.active) return;
    if (this.holds.size) {
      this.render();
      return;
    }

    this.acc += Math.min(realDt, MAX_FRAME);
    while (this.acc >= STEP && this.active) {
      this.update(STEP);
      this.acc -= STEP;
    }
    this.render();
    if (this.phase === 'finished') {
      this.active = false;
      if (this.hooks.onGameOver) this.hooks.onGameOver({ score: this.score, wave: this.wave });
      return;
    }
    if (this.active && !this.holds.size) this.raf = requestAnimationFrame(this._frame);
  }

  /* ---------------- waves ---------------- */

  nextWave() {
    this.wave += 1;
    const n = this.wave;
    this.cfg = {
      stepBase: Math.max(0.26, 0.7 * Math.pow(0.9, n - 1)),
      fireBase: Math.max(0.4, 1.2 * Math.pow(0.9, n - 1)),
      bulletSpeed: Math.min(420, 220 + 18 * (n - 1)),
      maxEnemyBullets: Math.min(2 + n, 7),
      aimChance: Math.min(0.6, 0.25 + 0.05 * n),
    };
    this.invaders = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = ROW_TYPES[r];
        const s = this.sprites.size(t.kind);
        this.invaders.push({ r, c, alive: true, kind: t.kind, pal: t.pal, points: t.points, w: s.w, h: s.h });
      }
    }
    this.aliveCount = ROWS * COLS;
    this.rowAlive = Array(ROWS).fill(COLS);
    this.rowsCleared = 0;
    this.formation = {
      x: (W - COLS * COL_W) / 2,
      y: 96 + Math.min(n - 1, 6) * 14,
      dir: 1,
      timer: 0,
      frame: 0,
      note: 0,
    };
    this.pBullets = [];
    this.eBullets = [];
    this.ufo = null;
    this.ufoTimer = rand(14, 24);
    this.fireTimer = 1.2;
    this.buildBunkers();
    this.phase = 'intro';
    this.phaseT = 1.6;
    this.banner = { text: `WAVE ${n}`, sub: n === 1 ? 'DEFEND THE BASE!' : 'GET READY', t: 1.6 };
    this.player.alive = true;
    this.player.invuln = 0;
  }

  buildBunkers() {
    const bw = BUNKER_COLS * CELL;
    this.bunkers = [0, 1, 2, 3].map((i) => {
      const cells = new Uint8Array(BUNKER_COLS * BUNKER_ROWS);
      for (let y = 0; y < BUNKER_ROWS; y++)
        for (let x = 0; x < BUNKER_COLS; x++) cells[y * BUNKER_COLS + x] = bunkerShape(x, y) ? 1 : 0;
      return { x: Math.round((W * (i + 1)) / 5 - bw / 2), y: BUNKER_Y, w: bw, h: BUNKER_ROWS * CELL, cells };
    });
  }

  invaderRect(inv) {
    const f = this.formation;
    return { x: f.x + inv.c * COL_W + (COL_W - inv.w) / 2, y: f.y + inv.r * ROW_H, w: inv.w, h: inv.h };
  }

  stepInterval() {
    const total = ROWS * COLS;
    const frac = (this.aliveCount - 1) / (total - 1);
    const min = 0.035;
    const base = min + (this.cfg.stepBase - min) * Math.pow(frac, 1.15);
    return base * Math.pow(0.94, this.rowsCleared);
  }

  stepFormation() {
    const f = this.formation;
    const dx = 8 * f.dir;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const inv of this.invaders) {
      if (!inv.alive) continue;
      const r = this.invaderRect(inv);
      minX = Math.min(minX, r.x);
      maxX = Math.max(maxX, r.x + r.w);
    }
    if (maxX + dx > W - 14 || minX + dx < 14) {
      f.y += 16;
      f.dir *= -1;
    } else {
      f.x += dx;
    }
    f.frame ^= 1;
    Sfx.step(f.note);
    f.note = (f.note + 1) % 4;

    for (const inv of this.invaders) {
      if (!inv.alive) continue;
      const r = this.invaderRect(inv);
      for (const b of this.bunkers) if (overlap(r, b)) this.carveBunker(b, r);
      if (r.y + r.h >= PLAYER_Y) {
        this.invaded();
        return;
      }
    }
  }

  /* ---------------- update ---------------- */

  update(dt) {
    this.time += dt;
    for (const s of this.stars) {
      s.y += s.z * 14 * dt;
      if (s.y > H) {
        s.y -= H;
        s.x = Math.random() * W;
      }
    }
    if (this.banner) {
      this.banner.t -= dt;
      if (this.banner.t <= 0 && this.phase !== 'gameover') this.banner = null;
    }

    switch (this.phase) {
      case 'intro':
        this.updatePlayer(dt, false);
        this.phaseT -= dt;
        if (this.phaseT <= 0) this.phase = 'play';
        break;
      case 'play':
        this.updatePlayer(dt, true);
        this.updateFormation(dt);
        this.updateUfo(dt);
        this.updateBullets(dt);
        break;
      case 'dying':
        this.player.respawn -= dt;
        this.updateBullets(dt);
        if (this.player.respawn <= 0) {
          this.player.alive = true;
          this.player.x = W / 2 - this.player.w / 2;
          this.player.invuln = 1.5;
          this.player.cooldown = 0.3;
          this.phase = 'play';
        }
        break;
      case 'waveclear':
        this.updatePlayer(dt, false);
        this.updateBullets(dt);
        this.phaseT -= dt;
        if (this.phaseT <= 0) this.nextWave();
        break;
      case 'gameover':
        this.phaseT -= dt;
        if (this.phaseT <= 0) this.phase = 'finished';
        break;
    }
    this.updateEffects(dt);
  }

  updatePlayer(dt, canFire) {
    const p = this.player;
    if (!p.alive) return;
    const mv = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0);
    p.x = clamp(p.x + mv * PLAYER_SPEED * dt, 16, W - 16 - p.w);
    p.cooldown -= dt;
    p.invuln = Math.max(0, p.invuln - dt);
    if (canFire && this.input.fire && p.cooldown <= 0 && this.pBullets.length < MAX_PLAYER_BULLETS) {
      this.pBullets.push({ x: p.x + p.w / 2 - 1.5, y: PLAYER_Y - 14, w: 3, h: 14 });
      p.cooldown = PLAYER_COOLDOWN;
      Sfx.shoot();
    }
  }

  updateFormation(dt) {
    const f = this.formation;
    f.timer += dt;
    if (f.timer >= this.stepInterval()) {
      f.timer = 0;
      this.stepFormation();
      if (this.phase !== 'play') return;
    }
    this.fireTimer -= dt;
    if (this.fireTimer <= 0) {
      this.fireTimer = this.cfg.fireBase * rand(0.6, 1.4);
      if (this.eBullets.length < this.cfg.maxEnemyBullets) this.enemyShoot();
    }
  }

  enemyShoot() {
    const bottoms = new Map();
    for (const inv of this.invaders) {
      if (!inv.alive) continue;
      const cur = bottoms.get(inv.c);
      if (!cur || inv.r > cur.r) bottoms.set(inv.c, inv);
    }
    const shooters = [...bottoms.values()];
    if (!shooters.length) return;
    let shooter;
    if (this.player.alive && Math.random() < this.cfg.aimChance) {
      const px = this.player.x + this.player.w / 2;
      shooter = shooters.reduce((best, inv) => {
        const r = this.invaderRect(inv);
        const d = Math.abs(r.x + r.w / 2 - px);
        return !best || d < best.d ? { inv, d } : best;
      }, null).inv;
    } else {
      shooter = shooters[Math.floor(Math.random() * shooters.length)];
    }
    const r = this.invaderRect(shooter);
    this.eBullets.push({
      x: r.x + r.w / 2 - 2,
      y: r.y + r.h,
      w: 5,
      h: 14,
      vy: this.cfg.bulletSpeed * rand(0.85, 1.1),
      kind: Math.random() < 0.5 ? 0 : 1,
      t: 0,
    });
    Sfx.enemyShoot();
  }

  updateUfo(dt) {
    if (!this.ufo) {
      this.ufoTimer -= dt;
      if (this.ufoTimer <= 0) {
        this.ufoTimer = rand(18, 30);
        if (this.aliveCount >= 8) {
          const dir = Math.random() < 0.5 ? 1 : -1;
          const s = this.sprites.ufo;
          this.ufo = {
            x: dir > 0 ? -s.w : W,
            y: 58,
            w: s.w,
            h: s.h,
            dir,
            points: UFO_POINTS[Math.floor(Math.random() * UFO_POINTS.length)],
            blipT: 0,
            blip: 0,
          };
        }
      }
      return;
    }
    const u = this.ufo;
    u.x += u.dir * 120 * dt;
    u.blipT -= dt;
    if (u.blipT <= 0) {
      u.blipT = 0.14;
      u.blip ^= 1;
      Sfx.ufoBlip(u.blip);
    }
    if (u.x > W + 10 || u.x < -u.w - 10) this.ufo = null;
  }

  updateBullets(dt) {
    // Player bullets.
    for (let i = this.pBullets.length - 1; i >= 0; i--) {
      const b = this.pBullets[i];
      b.y -= PLAYER_BULLET_SPEED * dt;
      if (b.y + b.h < 30 || this.playerBulletHits(b)) this.pBullets.splice(i, 1);
    }
    // Enemy bullets.
    for (let i = this.eBullets.length - 1; i >= 0; i--) {
      const b = this.eBullets[i];
      b.y += b.vy * dt;
      b.t += dt;
      let gone = false;
      if (b.y + b.h >= GROUND_Y) {
        this.spark(b.x + b.w / 2, GROUND_Y, '#ff9a6b', 6);
        gone = true;
      } else if (this.hitBunkers(b, 1)) {
        gone = true;
      } else if (this.player.alive && this.phase === 'play' && this.player.invuln <= 0) {
        const p = this.player;
        const pr = { x: p.x + 3, y: PLAYER_Y + 6, w: p.w - 6, h: p.h - 6 };
        if (overlap(b, pr)) {
          gone = true;
          this.hitPlayer();
        }
      }
      if (gone) this.eBullets.splice(i, 1);
    }
  }

  playerBulletHits(b) {
    if (this.ufo && overlap(b, this.ufo)) {
      const u = this.ufo;
      this.addScore(u.points);
      this.popups.push({ x: u.x + u.w / 2, y: u.y, text: String(u.points), t: 1.2, color: '#ffb05e' });
      this.burst(u.x + u.w / 2, u.y + u.h / 2, '#ff6d8a', 26, 220);
      this.ufo = null;
      Sfx.ufoBoom();
      return true;
    }
    for (const inv of this.invaders) {
      if (!inv.alive) continue;
      const r = this.invaderRect(inv);
      if (overlap(b, r)) {
        this.killInvader(inv, r);
        return true;
      }
    }
    if (this.hitBunkers(b, -1)) return true;
    for (let j = this.eBullets.length - 1; j >= 0; j--) {
      const e = this.eBullets[j];
      if (overlap(b, e)) {
        this.eBullets.splice(j, 1);
        this.spark(e.x + 2, e.y + e.h / 2, '#ffffff', 8);
        return true;
      }
    }
    return false;
  }

  killInvader(inv, r) {
    inv.alive = false;
    this.aliveCount -= 1;
    this.rowAlive[inv.r] -= 1;
    if (this.rowAlive[inv.r] === 0) this.rowsCleared += 1;
    this.addScore(inv.points);
    this.explosions.push({ x: r.x + r.w / 2, y: r.y + r.h / 2, t: 0.22 });
    this.burst(r.x + r.w / 2, r.y + r.h / 2, PALETTES[inv.pal][2], 14, 170);
    Sfx.invaderBoom();
    if (this.aliveCount === 0) this.waveCleared();
  }

  waveCleared() {
    const bonus = 250 * this.wave;
    this.addScore(bonus);
    this.phase = 'waveclear';
    this.phaseT = 2.6;
    this.eBullets = [];
    this.ufo = null;
    this.banner = { text: `WAVE ${this.wave} CLEARED`, sub: `BONUS +${bonus}`, t: 2.6 };
    Sfx.waveClear();
  }

  addScore(points) {
    this.score += points;
    if (this.score > this.hiScore) this.hiScore = this.score;
    if (!this.extraLifeAwarded && this.score >= EXTRA_LIFE_AT) {
      this.extraLifeAwarded = true;
      this.lives += 1;
      this.popups.push({ x: W / 2, y: GROUND_Y - 40, text: 'EXTRA LIFE!', t: 1.8, color: '#7dffb0' });
      Sfx.extraLife();
    }
  }

  hitPlayer() {
    const p = this.player;
    p.alive = false;
    this.lives -= 1;
    this.burst(p.x + p.w / 2, PLAYER_Y + p.h / 2, '#4dffc0', 40, 260);
    this.burst(p.x + p.w / 2, PLAYER_Y + p.h / 2, '#ffffff', 16, 140);
    this.explosions.push({ x: p.x + p.w / 2, y: PLAYER_Y + p.h / 2, t: 0.6 });
    this.eBullets = [];
    this.pBullets = [];
    Sfx.playerBoom();
    if (this.lives <= 0) {
      this.gameOver();
    } else {
      p.respawn = 1.6;
      this.phase = 'dying';
    }
  }

  invaded() {
    this.lives = 0;
    if (this.player.alive) {
      const p = this.player;
      p.alive = false;
      this.burst(p.x + p.w / 2, PLAYER_Y + p.h / 2, '#4dffc0', 40, 260);
      Sfx.playerBoom();
    }
    this.gameOver('THE INVADERS LANDED');
  }

  gameOver(sub = 'FINAL SCORE ' + this.score) {
    this.phase = 'gameover';
    this.phaseT = 2.6;
    this.ufo = null;
    this.eBullets = [];
    this.pBullets = [];
    this.banner = { text: 'GAME OVER', sub, t: 99 };
    Sfx.gameOver();
  }

  /* ---------------- bunkers ---------------- */

  // dir: -1 for upward bullets, +1 for downward bullets.
  hitBunkers(b, dir) {
    for (const bk of this.bunkers) {
      if (!overlap(b, bk)) continue;
      const x0 = clamp(Math.floor((b.x - bk.x) / CELL), 0, BUNKER_COLS - 1);
      const x1 = clamp(Math.floor((b.x + b.w - 1 - bk.x) / CELL), 0, BUNKER_COLS - 1);
      const y0 = clamp(Math.floor((b.y - bk.y) / CELL), 0, BUNKER_ROWS - 1);
      const y1 = clamp(Math.floor((b.y + b.h - 1 - bk.y) / CELL), 0, BUNKER_ROWS - 1);
      // Scan in the direction of travel so the first cell met is the impact.
      for (let k = 0; k <= y1 - y0; k++) {
        const y = dir > 0 ? y0 + k : y1 - k;
        for (let x = x0; x <= x1; x++) {
          if (bk.cells[y * BUNKER_COLS + x]) {
            this.erode(bk, x, y, dir);
            return true;
          }
        }
      }
    }
    return false;
  }

  erode(bk, cx, cy, dir) {
    const radius = 2.6;
    for (let y = cy - 3; y <= cy + 3; y++) {
      for (let x = cx - 3; x <= cx + 3; x++) {
        if (x < 0 || y < 0 || x >= BUNKER_COLS || y >= BUNKER_ROWS) continue;
        const d = Math.hypot(x - cx, (y - cy) * 0.8 + dir * 0.6);
        if (d < radius - 1 || (d < radius + 0.6 && Math.random() < 0.5)) bk.cells[y * BUNKER_COLS + x] = 0;
      }
    }
    this.spark(bk.x + cx * CELL, bk.y + cy * CELL, '#7dff7a', 5);
  }

  carveBunker(bk, r) {
    const x0 = clamp(Math.floor((r.x - bk.x) / CELL), 0, BUNKER_COLS - 1);
    const x1 = clamp(Math.floor((r.x + r.w - bk.x) / CELL), 0, BUNKER_COLS - 1);
    const y0 = clamp(Math.floor((r.y - bk.y) / CELL), 0, BUNKER_ROWS - 1);
    const y1 = clamp(Math.floor((r.y + r.h - bk.y) / CELL), 0, BUNKER_ROWS - 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) bk.cells[y * BUNKER_COLS + x] = 0;
  }

  /* ---------------- effects ---------------- */

  burst(x, y, color, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = rand(0.3, 1) * speed;
      const life = rand(0.35, 0.8);
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, color, size: rand(2, 4) });
    }
  }

  spark(x, y, color, n) {
    this.burst(x, y, color, n, 90);
  }

  updateEffects(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - 2.2 * dt;
      p.vy = p.vy * (1 - 2.2 * dt) + 60 * dt;
      p.life -= dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      this.explosions[i].t -= dt;
      if (this.explosions[i].t <= 0) this.explosions.splice(i, 1);
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.t -= dt;
      p.y -= 30 * dt;
      if (p.t <= 0) this.popups.splice(i, 1);
    }
  }

  /* ---------------- render ---------------- */

  render() {
    const g = this.ctx;
    const t = this.time;

    // Background.
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#060818');
    bg.addColorStop(0.6, '#0b0b2a');
    bg.addColorStop(1, '#170a2e');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);

    if (this.planet) {
      g.save();
      g.globalAlpha = 0.35;
      g.globalCompositeOperation = 'screen';
      g.drawImage(this.planet, W - 300, 30);
      g.restore();
    }

    for (const s of this.stars) {
      const a = 0.25 + 0.55 * s.z * (0.6 + 0.4 * Math.sin(t * 2 + s.p));
      g.fillStyle = `rgba(220,230,255,${a.toFixed(3)})`;
      const size = s.z > 0.8 ? 2 : 1;
      g.fillRect(Math.round(s.x), Math.round(s.y), size, size);
    }

    this.renderHud(g);

    // UFO.
    if (this.ufo) drawSprite(g, this.sprites.ufo, this.ufo.x, this.ufo.y);

    // Invaders.
    const frame = this.formation.frame;
    for (const inv of this.invaders) {
      if (!inv.alive) continue;
      const r = this.invaderRect(inv);
      drawSprite(g, this.sprites.invader[inv.kind][inv.pal][frame], r.x, r.y);
    }

    // Bunkers, drawn as horizontal runs of live cells.
    const bunkerGrad = g.createLinearGradient(0, BUNKER_Y, 0, BUNKER_Y + BUNKER_ROWS * CELL);
    bunkerGrad.addColorStop(0, '#8dff6a');
    bunkerGrad.addColorStop(1, '#1fae5a');
    g.fillStyle = bunkerGrad;
    for (const bk of this.bunkers) {
      for (let y = 0; y < BUNKER_ROWS; y++) {
        let start = -1;
        for (let x = 0; x <= BUNKER_COLS; x++) {
          const on = x < BUNKER_COLS && bk.cells[y * BUNKER_COLS + x];
          if (on && start < 0) start = x;
          if (!on && start >= 0) {
            g.fillRect(bk.x + start * CELL, bk.y + y * CELL, (x - start) * CELL, CELL);
            start = -1;
          }
        }
      }
    }

    // Player.
    const p = this.player;
    if (p.alive && !(p.invuln > 0 && Math.floor(t * 12) % 2)) {
      drawSprite(g, this.sprites.player, p.x, PLAYER_Y);
    }

    // Player bullets.
    g.save();
    g.shadowColor = '#7ff6ff';
    g.shadowBlur = 10;
    g.fillStyle = '#e6feff';
    for (const b of this.pBullets) g.fillRect(b.x, b.y, b.w, b.h);
    g.restore();

    // Enemy bullets: zig-zags and plungers.
    g.save();
    g.lineWidth = 2;
    g.shadowBlur = 8;
    for (const b of this.eBullets) {
      const cx = b.x + b.w / 2;
      if (b.kind === 0) {
        g.strokeStyle = g.shadowColor = '#ff6b8b';
        g.beginPath();
        const phase = Math.floor(b.t * 18) % 2 ? 1 : -1;
        for (let k = 0; k <= 4; k++) {
          const xx = cx + (k % 2 ? phase : -phase) * 2.5;
          const yy = b.y + (k * b.h) / 4;
          k ? g.lineTo(xx, yy) : g.moveTo(xx, yy);
        }
        g.stroke();
      } else {
        g.fillStyle = g.shadowColor = '#ffd23f';
        g.fillRect(cx - 1, b.y, 2, b.h);
        const barY = b.y + ((Math.floor(b.t * 14) % 3) * b.h) / 3;
        g.fillRect(cx - 3, barY, 6, 2);
      }
    }
    g.restore();

    // Particles.
    for (const q of this.particles) {
      g.globalAlpha = Math.max(0, q.life / q.max);
      g.fillStyle = q.color;
      g.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
    }
    g.globalAlpha = 1;

    for (const e of this.explosions) {
      const s = this.sprites.boom;
      drawSprite(g, s, e.x - s.w / 2, e.y - s.h / 2, Math.min(1, e.t * 6));
    }

    g.font = '12px "Press Start 2P", monospace';
    g.textAlign = 'center';
    for (const pp of this.popups) {
      g.globalAlpha = Math.min(1, pp.t * 2);
      g.fillStyle = pp.color;
      g.fillText(pp.text, pp.x, pp.y);
    }
    g.globalAlpha = 1;

    // Ground line and lives.
    g.fillStyle = '#3dff8b';
    g.fillRect(0, GROUND_Y, W, 2);
    g.textAlign = 'left';
    g.fillStyle = '#c9f9ff';
    g.font = '14px "Press Start 2P", monospace';
    g.fillText(String(Math.max(0, this.lives)), 18, GROUND_Y + 28);
    const icon = this.sprites.lifeIcon;
    for (let i = 0; i < Math.min(Math.max(0, this.lives - 1), 6); i++) {
      drawSprite(g, icon, 50 + i * (icon.w + 10), GROUND_Y + 10);
    }
    g.textAlign = 'right';
    g.fillStyle = '#9aa6d6';
    g.font = '10px "Press Start 2P", monospace';
    g.fillText(this.playerName.toUpperCase(), W - 18, GROUND_Y + 26);

    if (this.banner) this.renderBanner(g, this.banner);
  }

  renderHud(g) {
    g.font = '12px "Press Start 2P", monospace';
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#9aa6d6';
    g.textAlign = 'left';
    g.fillText('SCORE', 18, 22);
    g.textAlign = 'center';
    g.fillText('HI-SCORE', W / 2, 22);
    g.textAlign = 'right';
    g.fillText('WAVE', W - 18, 22);

    g.font = '16px "Press Start 2P", monospace';
    g.fillStyle = '#ffffff';
    g.textAlign = 'left';
    g.fillText(String(this.score).padStart(5, '0'), 18, 44);
    g.textAlign = 'center';
    g.fillStyle = '#ffd23f';
    g.fillText(String(this.hiScore).padStart(5, '0'), W / 2, 44);
    g.textAlign = 'right';
    g.fillStyle = '#ffffff';
    g.fillText(String(this.wave), W - 18, 44);
  }

  renderBanner(g, b) {
    g.save();
    g.textAlign = 'center';
    g.fillStyle = 'rgba(5,6,20,0.55)';
    g.fillRect(0, H / 2 - 60, W, 104);
    g.font = '28px "Press Start 2P", monospace';
    g.shadowColor = '#ff5ef7';
    g.shadowBlur = 16;
    g.fillStyle = '#ffffff';
    g.fillText(b.text, W / 2, H / 2 - 8);
    g.shadowBlur = 0;
    if (b.sub) {
      g.font = '14px "Press Start 2P", monospace';
      g.fillStyle = '#7ff6ff';
      g.fillText(b.sub, W / 2, H / 2 + 26);
    }
    g.restore();
  }
}
