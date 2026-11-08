// The opening crawl: a tilted, receding text scroll over a starfield with a
// synthesised theme. Settings come from data/name_intro.json. It auto-plays
// (behind an "Enter" click that unlocks audio) until this device has seen it
// maxAutoPlays times, and can always be replayed from the welcome screen.

import { IntroMusic } from './intro-music.js';

const COUNT_KEY = 'tti_introAutoPlays';
const TITLE_SECONDS = 7; // how long the title takes to recede
const CRAWL_DELAY_SECONDS = 3; // crawl starts this long after the title

const $ = (sel, root = document) => root.querySelector(sel);

function num(v, fallback, min, max) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

// Returns a clean config, or null if the file is missing or unusable.
export function parseIntroConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const lines = Array.isArray(raw.lines)
    ? raw.lines.filter((l) => typeof l === 'string' && l.trim()).map((l) => l.trim())
    : [];
  if (!lines.length) return null;
  return {
    enabled: raw.enabled === true,
    maxAutoPlays: Math.floor(num(raw.maxAutoPlays, 2, 0, 1000)),
    title: typeof raw.title === 'string' ? raw.title.trim() : '',
    scrollDurationSeconds: num(raw.scrollDurationSeconds, 60, 5, 600),
    endDelaySeconds: num(raw.endDelaySeconds, 2, 0, 60),
    musicEnabled: raw.musicEnabled !== false,
    musicVolume: num(raw.musicVolume, 0.5, 0, 1),
    lines,
  };
}

function readCount() {
  try {
    return Math.max(0, parseInt(localStorage.getItem(COUNT_KEY), 10) || 0);
  } catch (e) {
    return 0;
  }
}

function bumpCount() {
  try {
    localStorage.setItem(COUNT_KEY, String(readCount() + 1));
  } catch (e) {}
}

export function resetIntroCount() {
  try {
    localStorage.removeItem(COUNT_KEY);
  } catch (e) {}
}

export function shouldAutoPlay(cfg) {
  return !!cfg && cfg.enabled && readCount() < cfg.maxAutoPlays;
}

const reducedMotion = () =>
  !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

export class Intro {
  constructor(root, { isMuted = () => false, onClose = () => {} } = {}) {
    this.root = root;
    this.isMuted = isMuted;
    this.onClose = onClose;
    this.phase = 'idle'; // idle | enter | playing | closing
    this.anims = [];
    this.timers = [];
    this.music = null;
    this.onKey = this.onKey.bind(this);

    $('#intro-enter-btn', root).addEventListener('click', () => this.begin(true));
    $('#intro-skip', root).addEventListener('click', () => this.close(400));
    $('#intro-continue', root).addEventListener('click', () => this.close(400));
  }

  // Auto-play: the Enter screen first, so the click can unlock audio.
  autoPlay(cfg) {
    if (this.phase !== 'idle') return;
    this.cfg = cfg;
    this.open();
    this.phase = 'enter';
    $('#intro-enter', this.root).hidden = false;
    $('#intro-enter-btn', this.root).focus({ preventScroll: true });
  }

  // From the "Play intro" link: that click already unlocked audio.
  play(cfg) {
    if (this.phase !== 'idle') return;
    this.cfg = cfg;
    this.open();
    this.begin(false);
  }

  open() {
    this.root.hidden = false;
    this.root.classList.remove('is-leaving');
    this.root.style.removeProperty('--intro-fade');
    document.documentElement.classList.add('intro-open');
    $('#app').inert = true;
    this.openedAt = performance.now();
    window.addEventListener('keydown', this.onKey);
  }

  begin(counted) {
    if (this.phase === 'playing' || this.phase === 'closing') return;
    if (counted) bumpCount();
    this.phase = 'playing';
    $('#intro-enter', this.root).hidden = true;

    const cfg = this.cfg;
    if (cfg.musicEnabled && !this.isMuted()) {
      this.music = new IntroMusic(cfg.musicVolume);
      this.music.start(); // still inside the user gesture
    }

    if (reducedMotion() || typeof Element.prototype.animate !== 'function') this.showStatic();
    else this.runCrawl();
  }

  fillText(container) {
    container.replaceChildren(
      ...this.cfg.lines.map((line) => {
        const p = document.createElement('p');
        p.textContent = line;
        return p;
      }),
    );
  }

  showStatic() {
    const box = $('#intro-static', this.root);
    const title = $('#intro-static-title', this.root);
    title.textContent = this.cfg.title;
    title.hidden = !this.cfg.title;
    this.fillText($('#intro-static-text', this.root));
    box.hidden = false;
    box.scrollTop = 0;
    $('#intro-continue', this.root).focus({ preventScroll: true });
  }

  runCrawl() {
    const cfg = this.cfg;
    const stage = $('#intro-stage', this.root);
    const title = $('#intro-title', this.root);
    const crawl = $('#intro-crawl', this.root);
    title.textContent = cfg.title;
    title.hidden = !cfg.title;
    this.fillText(crawl);
    stage.hidden = false;
    $('#intro-skip', this.root).hidden = false;

    if (cfg.title) {
      this.anims.push(
        title.animate(
          [
            { transform: 'translate(-50%, -50%) scale(1)', opacity: 0 },
            { transform: 'translate(-50%, -50%) scale(0.92)', opacity: 1, offset: 0.08 },
            { transform: 'translate(-50%, -50%) scale(0.25)', opacity: 1, offset: 0.7 },
            { transform: 'translate(-50%, -50%) scale(0.02)', opacity: 0 },
          ],
          { duration: TITLE_SECONDS * 1000, easing: 'ease-in', fill: 'forwards' },
        ),
      );
    }

    // The text sits just below the bottom edge of a plane tilted away from
    // the viewer, then slides far enough up it to shrink into the distance.
    const h = this.root.clientHeight || window.innerHeight;
    const distance = crawl.offsetHeight + h * 3;
    const crawlAnim = crawl.animate(
      [{ transform: 'translateY(0)' }, { transform: `translateY(${-distance}px)` }],
      {
        duration: cfg.scrollDurationSeconds * 1000,
        delay: cfg.title ? CRAWL_DELAY_SECONDS * 1000 : 0,
        easing: 'linear',
        fill: 'forwards',
      },
    );
    this.anims.push(crawlAnim);
    crawlAnim.finished
      .then(() => {
        if (this.phase !== 'playing') return;
        this.timers.push(setTimeout(() => this.close(1200), cfg.endDelaySeconds * 1000));
      })
      .catch(() => {}); // cancelled by Skip
  }

  onKey(e) {
    if (!['Escape', ' ', 'Spacebar', 'Enter'].includes(e.key)) return;
    e.preventDefault();
    // Ignore held keys and the key press that opened the intro.
    if (e.repeat || performance.now() - this.openedAt < 300) return;
    if (this.phase === 'enter') {
      if (e.key === 'Escape') {
        bumpCount();
        this.close(400);
      } else {
        this.begin(true);
      }
    } else if (this.phase === 'playing') {
      this.close(400);
    }
  }

  close(fadeMs) {
    if (this.phase === 'closing' || this.phase === 'idle') return;
    this.phase = 'closing';
    window.removeEventListener('keydown', this.onKey);
    if (this.music) this.music.fadeOut(Math.max(0.6, fadeMs / 1000 + 0.6));
    this.music = null;
    this.timers.forEach(clearTimeout);
    this.timers = [];

    $('#app').inert = false;
    document.documentElement.classList.remove('intro-open');
    window.scrollTo(0, 0);
    this.onClose();

    const ms = reducedMotion() ? 0 : fadeMs;
    this.root.style.setProperty('--intro-fade', `${ms}ms`);
    this.root.classList.add('is-leaving');
    setTimeout(() => {
      this.anims.forEach((a) => a.cancel());
      this.anims = [];
      for (const id of ['#intro-enter', '#intro-stage', '#intro-static', '#intro-skip']) {
        $(id, this.root).hidden = true;
      }
      this.root.hidden = true;
      this.root.classList.remove('is-leaving');
      this.phase = 'idle';
    }, ms);
  }
}
