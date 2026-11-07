// Pixel-art sprites defined as text bitmaps and pre-rendered once to
// offscreen canvases with a gradient fill and a soft neon glow. Drawing a
// pre-rendered canvas each frame is far cheaper than per-frame shadowBlur.

const BITMAPS = {
  squid: [
    [
      '...##...',
      '..####..',
      '.######.',
      '##.##.##',
      '########',
      '..#..#..',
      '.#.##.#.',
      '#.#..#.#',
    ],
    [
      '...##...',
      '..####..',
      '.######.',
      '##.##.##',
      '########',
      '.#.##.#.',
      '#......#',
      '.#....#.',
    ],
  ],
  crab: [
    [
      '..#.....#..',
      '...#...#...',
      '..#######..',
      '.##.###.##.',
      '###########',
      '#.#######.#',
      '#.#.....#.#',
      '...##.##...',
    ],
    [
      '..#.....#..',
      '#..#...#..#',
      '#.#######.#',
      '###.###.###',
      '###########',
      '.#########.',
      '..#.....#..',
      '.#.......#.',
    ],
  ],
  octopus: [
    [
      '....####....',
      '.##########.',
      '############',
      '###..##..###',
      '############',
      '...##..##...',
      '..##.##.##..',
      '##........##',
    ],
    [
      '....####....',
      '.##########.',
      '############',
      '###..##..###',
      '############',
      '..###..###..',
      '.##..##..##.',
      '..##....##..',
    ],
  ],
  player: [
    [
      '......#......',
      '.....###.....',
      '.....###.....',
      '.###########.',
      '#############',
      '#############',
      '#############',
      '#############',
    ],
  ],
  ufo: [
    [
      '.....######.....',
      '...##########...',
      '..############..',
      '.##.##.##.##.##.',
      '################',
      '..###..##..###..',
      '...#........#...',
    ],
  ],
  boom: [
    [
      '....#...#....',
      '.#...#.#...#.',
      '..#.......#..',
      '...#.....#...',
      '##.........##',
      '...#.....#...',
      '..#..#.#..#..',
      '.#..#...#..#.',
    ],
  ],
};

// Row palettes: [top colour, bottom colour, glow colour].
export const PALETTES = [
  ['#ff8af9', '#b04bff', '#ff5ef7'], // row 0 – squids
  ['#7ff6ff', '#2f9bff', '#4fe6ff'], // row 1 – crabs
  ['#a79bff', '#5a5bff', '#8f7bff'], // row 2 – crabs
  ['#c6ff6a', '#3fd96b', '#9dff5e'], // row 3 – octopuses
  ['#ffe46a', '#ff9a3d', '#ffc23f'], // row 4 – octopuses
];

const PLAYER_PAL = ['#9dffcf', '#16c7ff', '#4dffc0'];
const UFO_PAL = ['#ff6d8a', '#ff9f3d', '#ff4d6d'];
const BOOM_PAL = ['#ffffff', '#ffb347', '#ffcf70'];

const SCALE = 3;
const PAD = 8;

function render(bitmap, [top, bottom, glow]) {
  const w = bitmap[0].length * SCALE;
  const h = bitmap.length * SCALE;
  const c = document.createElement('canvas');
  c.width = w + PAD * 2;
  c.height = h + PAD * 2;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, PAD, 0, PAD + h);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);

  const paint = () => {
    bitmap.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] === '#') g.fillRect(PAD + x * SCALE, PAD + y * SCALE, SCALE, SCALE);
      }
    });
  };
  // Glow pass, then a crisp pass on top.
  g.shadowColor = glow;
  g.shadowBlur = 7;
  g.fillStyle = grad;
  paint();
  g.shadowBlur = 0;
  paint();
  // A one-pixel highlight on the top edge of each lit pixel for a bit of depth.
  g.fillStyle = 'rgba(255,255,255,0.25)';
  bitmap.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === '#' && (y === 0 || bitmap[y - 1][x] !== '#')) {
        g.fillRect(PAD + x * SCALE, PAD + y * SCALE, SCALE, 1);
      }
    }
  });
  return { canvas: c, w, h, pad: PAD };
}

let cache = null;

export function buildSprites() {
  if (cache) return cache;
  const kinds = {};
  for (const kind of ['squid', 'crab', 'octopus']) {
    kinds[kind] = PALETTES.map((pal) => BITMAPS[kind].map((bm) => render(bm, pal)));
  }
  cache = {
    invader: kinds, // invader[kind][paletteIndex][frame]
    player: render(BITMAPS.player[0], PLAYER_PAL),
    lifeIcon: render(BITMAPS.player[0], PLAYER_PAL),
    ufo: render(BITMAPS.ufo[0], UFO_PAL),
    boom: render(BITMAPS.boom[0], BOOM_PAL),
    size: (kind) => ({ w: BITMAPS[kind][0][0].length * SCALE, h: BITMAPS[kind][0].length * SCALE }),
  };
  return cache;
}

export function drawSprite(ctx, s, x, y, alpha = 1) {
  if (alpha !== 1) ctx.globalAlpha = alpha;
  ctx.drawImage(s.canvas, Math.round(x - s.pad), Math.round(y - s.pad));
  if (alpha !== 1) ctx.globalAlpha = 1;
}
