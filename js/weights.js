// Shared weighted-repetition helpers. Any quiz whose items should come up
// more often after a miss can use these (games get them as ctx.weights).
// An item is any object with { weight, asked, correct }.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Normalises the weight rules from a game's seed file. Missing or bad
// values fall back to weights 1..10, -1 for a correct answer, +2 for a miss.
export function rules(json) {
  const j = json && typeof json === 'object' ? json : {};
  const minWeight = Math.max(1, Number(j.minWeight) || 1);
  const maxWeight = Math.max(minWeight, Number(j.maxWeight) || 10);
  const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
  return {
    minWeight,
    maxWeight,
    defaultWeight: clamp(Number(j.defaultWeight) || 1, minWeight, maxWeight),
    correctDelta: num(j.correctDelta, -1),
    wrongDelta: num(j.wrongDelta, 2),
  };
}

// Weighted-random pick: each item's chance is weight / sum(weights).
// Redraws up to twice to avoid repeating avoidKey when possible.
export function pick(items, keyOf, avoidKey = null) {
  if (!items.length) return null;
  const draw = () => {
    const total = items.reduce((sum, it) => sum + it.weight, 0);
    let r = Math.random() * total;
    for (const it of items) {
      r -= it.weight;
      if (r < 0) return it;
    }
    return items[items.length - 1];
  };
  let it = draw();
  if (items.length > 1 && keyOf(it) === avoidKey) it = draw();
  if (items.length > 1 && keyOf(it) === avoidKey) it = draw();
  return it;
}

// outcome: 'correct' | 'wrong' | 'timeout'. Updates the item in place.
export function record(item, outcome, r) {
  const ok = outcome === 'correct';
  item.asked = (item.asked || 0) + 1;
  if (ok) item.correct = (item.correct || 0) + 1;
  item.weight = clamp(item.weight + (ok ? r.correctDelta : r.wrongDelta), r.minWeight, r.maxWeight);
  return item.weight;
}

export function freshStats() {
  return { asked: 0, correct: 0, wrong: 0, timeouts: 0 };
}

export function recordStats(stats, outcome) {
  stats.asked += 1;
  if (outcome === 'correct') stats.correct += 1;
  else if (outcome === 'timeout') stats.timeouts += 1;
  else stats.wrong += 1;
}

// Inline style for a weight badge. The floor weight is a calm teal; anything
// above it jumps to warm amber and heats up to hot pink at the maximum.
export function style(w, min, max) {
  if (w <= min) return 'background:rgba(77,255,192,.16);color:#7dffd0';
  const t = max > min + 1 ? (w - min - 1) / (max - min - 1) : 1;
  const hue = (45 - t * 75 + 360) % 360;
  return `background:hsl(${hue} 95% ${62 - t * 6}%);color:#14081f`;
}
