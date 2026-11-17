// Tiny pixel-art toolkit: sprites are described as rows of palette letters and
// turned into 1px-per-cell PNG data URLs. They are then scaled up in CSS by a
// whole-number factor with `image-rendering: pixelated`, so every pixel in the
// artwork stays the same size and perfectly crisp.

export type Sprite = { url: string; cols: number; rows: number };
type Palette = Record<string, string>;

const BASE: Palette = {
  W: "#ffffff",
  w: "#e3f3ff",
  I: "#9fd3f5",
  i: "#5f9fd0",
  D: "#3a6a96",
  S: "#d5d9dd",
  s: "#7b8088",
  G: "#f0cf75",
  g: "#b08a32",
  R: "#c4474e",
  r: "#7a2227",
};

function makeSprite(rows: string[], extra: Palette = {}): Sprite {
  const pal = { ...BASE, ...extra };
  const cols = Math.max(...rows.map((r) => r.length));
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows.length;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { url: "", cols, rows: rows.length };
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = pal[row.charAt(x)];
      if (color) {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  });
  return { url: canvas.toDataURL(), cols, rows: rows.length };
}

type BallPattern = "plain" | "band" | "zig" | "dots";

// Round baubles are drawn procedurally so any size shades consistently:
// light from the top-left, a dark rim, one specular glint, optional decoration.
// `d` must be odd so the hanging cap sits exactly on the centre column.
function ballRows(d: number, pattern: BallPattern): string[] {
  const c = (d - 1) / 2;
  const r = d / 2;
  const grid: string[][] = [];
  for (let y = 0; y < d; y++) {
    const row: string[] = [];
    for (let x = 0; x < d; x++) {
      const dx = x - c;
      const dy = y - c;
      const dist = Math.hypot(dx, dy);
      if (dist > r - 0.15) {
        row.push(".");
        continue;
      }
      const light = -(dx * 0.55 + dy * 0.75) / r;
      let ch = light > 0.42 ? "a" : light > -0.4 ? "b" : "d";
      if (dist > r - 1.2 && light < -0.15) ch = "d";
      row.push(ch);
    }
    grid.push(row);
  }

  const put = (x: number, y: number, ch: string, onlyInside = true) => {
    const row = grid[y];
    if (!row || x < 0 || x >= d) return;
    if (onlyInside && row[x] === ".") return;
    row[x] = ch;
  };

  const mid = Math.floor(d / 2);
  if (pattern === "band") {
    for (let x = 0; x < d; x++) {
      put(x, mid - 1, "p");
      put(x, mid, "p");
    }
  } else if (pattern === "zig") {
    for (let x = 0; x < d; x++) put(x, mid + (x % 2 === 0 ? 0 : 1), "p");
  } else if (pattern === "dots") {
    for (let y = mid - 2; y <= mid + 2; y += 2) {
      for (let x = (y / 2) % 2 === 0 ? 1 : 2; x < d; x += 2) put(x, y, "p");
    }
  }

  const hx = Math.round(c - r * 0.42);
  const hy = Math.round(c - r * 0.5);
  put(hx, hy, "h");
  put(hx + 1, hy, "h");
  put(hx, hy + 1, "h");

  const pad = (d - 3) / 2;
  const side = ".".repeat(pad);
  return [
    `${side}.s.${side}`,
    `${side}SSS${side}`,
    ...grid.map((row) => row.join("")),
  ];
}

const BALL_TONES = {
  red: { a: "#ff8a90", b: "#c4474e", d: "#69191f", h: "#ffffff", p: "#f0cf75" },
  ice: { a: "#d8efff", b: "#6aa9d8", d: "#244767", h: "#ffffff", p: "#ffffff" },
  silver: { a: "#ffffff", b: "#bfc4ca", d: "#5a6068", h: "#ffffff", p: "#9fd3f5" },
  gold: { a: "#fff3b8", b: "#e8c66a", d: "#86651f", h: "#ffffff", p: "#c4474e" },
} satisfies Record<string, Palette>;

const STAR = [
  ".....G.....",
  "....GwG....",
  "....GwG....",
  "GGGGGwGGGGG",
  ".GGwwwwwGG.",
  "..GGwwwGG..",
  "...GwwwG...",
  "...GwGwG...",
  "..GGG.GGG..",
  "..Gg...gG..",
  ".gg.....gg.",
];

const BELL = [
  ".RRR...RRR.",
  ".RRrRRRrRR.",
  "....rRr....",
  "....GGG....",
  "...GwGGG...",
  "..GwGGGGG..",
  "..GwGGGGg..",
  ".GwGGGGGgg.",
  ".GwGGGGGgg.",
  "GGGGGGGGGgg",
  "ggggggggggg",
  "....sSs....",
];

const SNOWFLAKE = [
  ".....I.....",
  "..I..w..I..",
  "...I.w.I...",
  "....IwI....",
  ".II.IwI.II.",
  "IwwwwWwwwwI",
  ".II.IwI.II.",
  "....IwI....",
  "...I.w.I...",
  "..I..w..I..",
  ".....I.....",
];

const CRYSTAL = ["..w..", ".wIw.", "wIiIw", ".wIw.", "..w.."];
const ICICLE = ["wIw", "wIi", ".Ii", ".I.", ".i."];

// ---- Green knitwear: emerald / pine / forest with white and icy-blue trim.
// E emerald, F deep emerald (knit shading), P pine, K forest.
const KNIT: Palette = { E: "#1f9d6b", F: "#14724b", P: "#2f5d46", K: "#1d3f2f" };

// A knitted Christmas sweater: ribbed white collar, cuffs and hem, a faint
// knit checker, and a snowflake motif with stitched dots on the chest.
function sweaterRows(): string[] {
  const cols = 15;
  const rows = 13;
  const g: string[][] = Array.from({ length: rows }, () => Array<string>(cols).fill("."));
  const set = (x: number, y: number, c: string) => {
    const r = g[y];
    if (r && x >= 0 && x < cols) r[x] = c;
  };
  for (let y = 2; y < 12; y++) for (let x = 3; x <= 11; x++) set(x, y, (x + y) % 2 ? "E" : "F");
  for (let x = 1; x <= 13; x++) set(x, 2, (x + 2) % 2 ? "E" : "F");
  // sleeves hang beside the body, joined at the shoulder, with a gap under the arm
  for (let y = 3; y <= 10; y++) {
    const xs = y <= 6 ? [0, 1, 2, 12, 13, 14] : [0, 1, 13, 14];
    for (const x of xs) set(x, y, (x + y) % 2 ? "E" : "F");
  }
  for (let x = 3; x <= 11; x++) set(x, 12, x % 2 ? "W" : "w"); // ribbed hem
  for (const x of [0, 1, 13, 14]) {
    set(x, 11, x % 2 ? "W" : "w"); // ribbed cuffs
    set(x, 12, x % 2 ? "w" : "W");
  }
  for (const y of [7, 8, 9, 10]) { set(3, y, "K"); set(11, y, "K"); } // seam shadow
  for (let x = 5; x <= 9; x++) set(x, 1, x % 2 ? "W" : "w"); // collar
  set(7, 2, "K"); set(6, 2, "K"); set(8, 2, "K");
  const flake = ["..W..", ".WIW.", "WIWIW", ".WIW.", "..W.."];
  flake.forEach((row, dy) => [...row].forEach((c, dx) => c !== "." && set(5 + dx, 4 + dy, c)));
  for (const [x, y] of [[4, 4], [10, 4], [4, 10], [10, 10], [7, 10]] as const) set(x, y, "I");
  const out = g.map((r) => r.join(""));
  out[0] = "......sSs......";
  return out;
}

// One knitted mitten on a cord: white ribbed cuff, emerald body with a snowflake.
const MITTEN = [
  "...sSs...",
  "..WwWwW..",
  "..WwWwW..",
  ".EEEEEEF.",
  ".EEEWEEF.",
  "EEEWIWEF.",
  "EEEEWEEF.",
  ".EFEEEEF.",
  ".EEFEEFF.",
  ".FFEFFFF.",
];

export type SpriteName =
  | "ballRed"
  | "ballIce"
  | "ballSilver"
  | "ballGold"
  | "star"
  | "bell"
  | "snowflake"
  | "crystal"
  | "icicle"
  | "sweater"
  | "mitten";

export function buildSprites(): Record<SpriteName, Sprite> {
  return {
    ballRed: makeSprite(ballRows(13, "band"), BALL_TONES.red),
    ballIce: makeSprite(ballRows(11, "zig"), BALL_TONES.ice),
    ballSilver: makeSprite(ballRows(9, "dots"), BALL_TONES.silver),
    ballGold: makeSprite(ballRows(11, "plain"), BALL_TONES.gold),
    star: makeSprite(STAR),
    bell: makeSprite(BELL),
    snowflake: makeSprite(SNOWFLAKE),
    crystal: makeSprite(CRYSTAL),
    icicle: makeSprite(ICICLE),
    sweater: makeSprite(sweaterRows(), KNIT),
    mitten: makeSprite(MITTEN, KNIT),
  };
}

// ---- The little elf that peeks out of a clicked ornament. One 9x11 head-and-
// shoulders sprite in four poses (looking ahead, looking one way, looking the
// other way, blinking); CSS swaps between them. E/F are the hat greens, k/o
// skin and ear shadow, b the eyes, q closed eyelids, n the cheeks, m the mouth.
const ELF_PALETTE: Palette = {
  E: "#1f9d6b",
  F: "#14724b",
  k: "#f6cba3",
  o: "#e0a074",
  b: "#2b1b16",
  q: "#8a4b35",
  n: "#f08a86",
  m: "#a64b3a",
};

type ElfLook = "ahead" | "left" | "right" | "blink";

const ELF_EYES: Record<ElfLook, string> = {
  ahead: "ookbkbkoo",
  left: "oobkbkkoo",
  right: "ookkbkboo",
  blink: "ookqkqkoo",
};

function elfRows(look: ElfLook): string[] {
  return [
    "....W....",
    "...EEE...",
    "..EEEEF..",
    ".EEEEEFF.",
    ".WWWWWWW.",
    ".okkkkko.",
    ELF_EYES[look],
    "oonkkknoo",
    "..kkmkk..",
    "...kkk...",
    "..RRGRR..",
  ];
}

export type ElfArt = {
  cols: number;
  rows: number;
  ahead: string;
  left: string;
  right: string;
  blink: string;
};

export function buildElf(): ElfArt {
  const make = (look: ElfLook) => makeSprite(elfRows(look), ELF_PALETTE);
  const ahead = make("ahead");
  return {
    cols: ahead.cols,
    rows: ahead.rows,
    ahead: ahead.url,
    left: make("left").url,
    right: make("right").url,
    blink: make("blink").url,
  };
}

// ---- Light garland: a repeating scallop of wire with five bulbs. Two
// "lit" layers alternate in CSS so the lights twinkle in a pleasant rhythm.
export const GARLAND = { cols: 44, rows: 18 };

export function buildGarland(): { base: string; litA: string; litB: string } {
  const { cols, rows } = GARLAND;
  const bulbX = [5, 13, 21, 29, 37];
  const colors = ["#c4474e", "#9fd3f5", "#f0cf75", "#f5fbff", "#9fd3f5"];
  const wireY = (x: number) =>
    Math.round(1 + 8 * (1 - ((x - (cols - 1) / 2) / (cols / 2)) ** 2));

  const layer = () => {
    const canvas = document.createElement("canvas");
    canvas.width = cols;
    canvas.height = rows;
    return { canvas, ctx: canvas.getContext("2d") };
  };

  const drawBulb = (
    ctx: CanvasRenderingContext2D,
    x: number,
    index: number,
    alpha: number,
    halo: boolean,
  ) => {
    const yw = wireY(x);
    const color = colors[index] ?? "#ffffff";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#59636e";
    ctx.fillRect(x, yw + 1, 1, 1);
    if (halo) {
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = color;
      ctx.fillRect(x - 2, yw + 2, 5, 3);
      ctx.fillRect(x - 1, yw + 1, 3, 5);
    }
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x - 1, yw + 2, 3, 2);
    ctx.fillRect(x, yw + 4, 1, 1);
    ctx.globalAlpha = Math.min(1, alpha + 0.2);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x - 1, yw + 2, 1, 1);
    ctx.globalAlpha = 1;
  };

  const base = layer();
  const a = layer();
  const b = layer();
  if (!base.ctx || !a.ctx || !b.ctx) return { base: "", litA: "", litB: "" };

  base.ctx.fillStyle = "#55606b";
  let prev = wireY(0);
  for (let x = 0; x < cols; x++) {
    const y = wireY(x);
    for (let yy = Math.min(y, prev); yy <= Math.max(y, prev); yy++) {
      base.ctx.fillRect(x, yy, 1, 1);
    }
    prev = y;
  }
  bulbX.forEach((x, i) => drawBulb(base.ctx!, x, i, 0.45, false));
  bulbX.forEach((x, i) => {
    if (i % 2 === 0) drawBulb(a.ctx!, x, i, 1, true);
    else drawBulb(b.ctx!, x, i, 1, true);
  });

  return {
    base: base.canvas.toDataURL(),
    litA: a.canvas.toDataURL(),
    litB: b.canvas.toDataURL(),
  };
}

// ---- Snow bank: a seamless pixel drift that sits along the bottom edge.
export const SNOWBANK = { cols: 48, rows: 16 };

export function buildSnowBank(): string {
  const { cols, rows } = SNOWBANK;
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const tau = Math.PI * 2;
  for (let x = 0; x < cols; x++) {
    const raw =
      7 +
      2.2 * Math.sin((tau * 3 * x) / cols) +
      1.6 * Math.sin((tau * 7 * x) / cols + 0.8);
    const height = Math.max(3, Math.min(12, Math.round(raw)));
    for (let depth = 0; depth < height; depth++) {
      const y = rows - height + depth;
      ctx.fillStyle =
        depth === 0
          ? "#ffffff"
          : depth < 3
            ? "#e3f3ff"
            : depth < 6
              ? "#bcd9ee"
              : "#8fb6d4";
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas.toDataURL();
}

// ---- Santa, sleigh and three reindeer ------------------------------------
// The sleigh is drawn as separate transparent layers on the same pixel grid so
// CSS can move the parts independently: a static hull (sleigh, Santa, harness,
// flagpole) and, for every reindeer, a rig of articulated parts (tail, body,
// neck + head, antlers, scarf tail and four two-segment legs). Every deer layer
// is a full-size 19 x 23 canvas, so every part shares one coordinate space and
// a CSS transform-origin can sit exactly on a joint.
export const SLEIGH = {
  cols: 88,
  rows: 23,
  offY: 11, // grid rows above the sleigh floor, for Santa, the hat and antlers
  tailX: 0, // where the sparkle trail starts (cells)
  tailY: 15,
};

export const DEER = { cols: 19, rows: 23 };

// Philippine flag footprint on the sleigh grid (cells): 2:1, hoisted on the pole
export const FLAG = { cols: 14, rows: 7 };

const SC = {
  B: "#8b5a3c", b: "#4e3222", L: "#c08d5e", A: "#e0c08f", K: "#ff5a5f", E: "#1a1410",
  W: "#f4fbff", R: "#c4474e", r: "#74212a", G: "#f0cf75", g: "#a87f2c", S: "#d5d9dd",
  s: "#7b8088", F: "#f1c9a8", P: "#2f5d46", p: "#3f7a5c", I: "#9fd3f5", N: "#1d1d1d",
  // far-side legs sit in shadow
  fB: "#6a4429", fb: "#3b2616",
  // knitwear
  e: "#1f9d6b", f: "#14724b",
};

type Pen = {
  px: (x: number, y: number, c: string) => void;
  rect: (x: number, y: number, w: number, h: number, c: string) => void;
  line: (x0: number, y0: number, x1: number, y1: number, c: string) => void;
};

// Paints one transparent layer. `y` is in sleigh rows relative to the floor
// (negative = above), exactly like the original single-image drawing.
function layer(cols: number, rows: number, draw: (pen: Pen) => void): string {
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const px = (x: number, y: number, c: string) => {
    if (x < 0 || x >= cols) return;
    ctx.fillStyle = c;
    ctx.fillRect(x, y + SLEIGH.offY, 1, 1);
  };
  const rect = (x: number, y: number, w: number, h: number, c: string) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(x + i, y + j, c);
  };
  const line = (x0: number, y0: number, x1: number, y1: number, c: string) => {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let x = x0;
    let y = y0;
    for (;;) {
      px(x, y, c);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  };
  draw({ px, rect, line });
  return canvas.toDataURL();
}

// Static sleigh hull: harness, sleigh, gifts, Santa (with emerald scarf and
// mittens) and the flagpole.
function hullUrl(): string {
  return layer(SLEIGH.cols, SLEIGH.rows, ({ px, rect, line }) => {
    // harness between the team and the sleigh
    line(26, 5, 32, 5, SC.g);
    line(42, 5, 51, 5, SC.g);
    line(61, 5, 70, 5, SC.g);
    line(25, -1, 33, 4, SC.g);

    // flagpole: silver staff with a gold finial, planted at the sleigh's tail
    rect(1, -10, 1, 10, SC.S);
    px(1, -11, SC.G);
    px(1, -9, SC.s); px(1, -5, SC.s); px(1, -1, SC.s);

    // sleigh
    rect(0, 9, 26, 1, SC.S);
    rect(0, 10, 26, 1, SC.s);
    px(26, 8, SC.S); px(27, 7, SC.S); px(27, 6, SC.S);
    rect(5, 7, 1, 2, SC.G);
    rect(18, 7, 1, 2, SC.G);
    // sack of gifts and a present
    rect(4, -2, 5, 1, SC.P);
    rect(3, -1, 8, 4, SC.P);
    px(4, 0, SC.p); px(5, 0, SC.p); px(4, 1, SC.p);
    rect(6, -1, 2, 1, SC.G);
    rect(12, 0, 3, 3, SC.I);
    rect(13, 0, 1, 3, SC.W);
    // body
    rect(2, 3, 22, 4, SC.R);
    rect(2, 6, 22, 1, SC.r);
    rect(2, 2, 22, 1, SC.G);
    rect(4, 4, 18, 1, SC.g);
    rect(24, 2, 2, 4, SC.R);
    px(26, 2, SC.G); px(25, 1, SC.R);
    rect(0, 1, 3, 2, SC.R);
    px(0, 0, SC.G); px(1, 0, SC.G);

    // Santa
    rect(16, -1, 7, 3, SC.R);
    rect(16, 1, 7, 1, SC.N);
    px(19, 1, SC.G);
    rect(17, -3, 5, 2, SC.W);
    rect(17, -5, 5, 2, SC.F);
    px(18, -4, SC.E); px(20, -4, SC.E);
    px(19, -4, "#e39b86");
    rect(17, -6, 5, 1, SC.W);
    rect(17, -8, 5, 2, SC.R);
    px(16, -7, SC.R); px(15, -7, SC.R); px(14, -6, SC.R);
    px(13, -6, SC.W); px(13, -5, SC.W);
    // emerald knitted scarf around the neck (its tail flutters as its own layer)
    rect(16, -1, 7, 1, SC.e);
    px(17, -1, SC.f); px(19, -1, SC.f); px(21, -1, SC.f);
    px(22, 0, SC.f); px(21, 0, SC.e);
    // sleeve, white cuff and emerald mitten
    px(23, -1, SC.R);
    px(24, -1, SC.W);
    px(25, -1, SC.e); px(25, 0, SC.f);
  });
}

// The loose end of Santa's scarf; flutters in the slipstream behind him.
function santaScarfTailUrl(): string {
  return layer(SLEIGH.cols, SLEIGH.rows, ({ px }) => {
    px(15, -1, SC.e); px(14, -1, SC.f);
    px(14, -2, SC.e); px(13, -2, SC.W); px(12, -2, SC.f);
    px(12, -3, SC.e); px(11, -3, SC.f);
  });
}

export type Rig = {
  hull: string;
  santaScarf: string;
  tail: string;
  body: string;
  head: string;
  headLead: string;
  antlers: string;
  scarfTail: string;
  legs: {
    foreNear: { thigh: string; shin: string };
    foreFar: { thigh: string; shin: string };
    hindNear: { thigh: string; shin: string };
    hindFar: { thigh: string; shin: string };
  };
  flag: string;
};

// Leg columns (x of the 2-wide leg) and where each leg hangs from the body
const LEG_X = { foreNear: 10, foreFar: 8, hindNear: 2, hindFar: 4 } as const;

function legUrl(x: number, near: boolean, part: "thigh" | "shin"): string {
  const light = near ? SC.B : SC.fB;
  const dark = near ? SC.b : SC.fb;
  return layer(DEER.cols, DEER.rows, ({ px }) => {
    // deer coordinates: row y is drawn at y - 1 (the original deer origin)
    const d = (dx: number, dy: number, c: string) => px(dx, dy - 1, c);
    if (part === "thigh") {
      d(x, 9, light); d(x + 1, 9, dark);
      d(x, 10, light); d(x + 1, 10, dark);
    } else {
      d(x, 11, light); d(x + 1, 11, dark);
      d(x, 12, dark); d(x + 1, 12, dark); // hoof
    }
  });
}

// Philippine flag, drawn mirrored (white triangle at the pole) because the
// flag trails behind a sleigh that is flying to the right.
function flagUrl(): string {
  const sun = { x: 8.7, y: 15 };
  const star = (cx: number, cy: number, r: number, tip: number) => {
    const pts: string[] = [];
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? r : r * 0.4;
      const a = tip + (i * Math.PI) / 5;
      pts.push(`${(cx + Math.sin(a) * rad).toFixed(2)},${(cy - Math.cos(a) * rad).toFixed(2)}`);
    }
    return `<polygon points="${pts.join(" ")}"/>`;
  };
  const rays: string[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    const tipX = sun.x + Math.sin(a) * 7.4;
    const tipY = sun.y - Math.cos(a) * 7.4;
    const bx = sun.x + Math.sin(a) * 3.4;
    const by = sun.y - Math.cos(a) * 3.4;
    const nx = Math.cos(a) * 1.15;
    const ny = Math.sin(a) * 1.15;
    rays.push(
      `<polygon points="${(bx - nx).toFixed(2)},${(by - ny).toFixed(2)} ${(bx + nx).toFixed(2)},${(by + ny).toFixed(2)} ${tipX.toFixed(2)},${tipY.toFixed(2)}"/>`,
    );
  }
  const toward = (x: number, y: number) => Math.atan2(x - sun.x, -(y - sun.y));
  const stars = [
    star(3.4, 4.9, 3.1, toward(0, 0)),
    star(3.4, 25.1, 3.1, toward(0, 30)),
    star(21.2, 15, 3.1, toward(26, 15)),
  ].join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 30" width="120" height="60">` +
    `<g transform="translate(60 0) scale(-1 1)">` +
    `<rect width="60" height="15" fill="#0038a8"/><rect y="15" width="60" height="15" fill="#ce1126"/>` +
    `<path d="M0 0L26 15L0 30Z" fill="#ffffff"/>` +
    `<g fill="#fcd116"><circle cx="${sun.x}" cy="${sun.y}" r="2.7"/>${rays.join("")}${stars}</g>` +
    `</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export function buildRig(): Rig {
  const leg = (key: keyof typeof LEG_X, near: boolean) => ({
    thigh: legUrl(LEG_X[key], near, "thigh"),
    shin: legUrl(LEG_X[key], near, "shin"),
  });
  const headPaint = (lead: boolean) =>
    layer(DEER.cols, DEER.rows, ({ px, rect }) => {
      const d = (x: number, y: number, c: string) => px(x, y - 1, c);
      const dr = (x: number, y: number, w: number, h: number, c: string) => rect(x, y - 1, w, h, c);
      dr(11, 3, 3, 4, SC.B); // neck
      dr(13, 2, 4, 3, SC.B); // head
      dr(16, 3, 2, 2, SC.L); // muzzle
      d(17, 3, lead ? SC.K : SC.b);
      d(15, 3, SC.E);
      d(13, 1, SC.B); d(12, 1, SC.b); // ear
      // emerald knitted scarf wrapped round the neck, with a white stripe
      d(11, 5, SC.e); d(12, 5, SC.f); d(13, 5, SC.e);
      d(11, 6, SC.f); d(12, 6, SC.W); d(13, 6, SC.f);
      d(12, 7, SC.G); // bell
    });
  return {
    hull: hullUrl(),
    santaScarf: santaScarfTailUrl(),
    tail: layer(DEER.cols, DEER.rows, ({ px }) => {
      px(1, 4, SC.W); px(1, 5, SC.W); px(0, 5, SC.W);
    }),
    body: layer(DEER.cols, DEER.rows, ({ px, rect }) => {
      const d = (x: number, y: number, c: string) => px(x, y - 1, c);
      const dr = (x: number, y: number, w: number, h: number, c: string) => rect(x, y - 1, w, h, c);
      dr(2, 5, 10, 4, SC.B);
      dr(2, 8, 10, 1, SC.b);
      dr(3, 5, 8, 1, SC.L);
      // forest-green knitted saddle blanket: snowflake diamond, white trim
      const blanket = ["eefWfee", "efWIWfe", "WSWSWSW"];
      const col: Record<string, string> = { e: SC.e, f: SC.f, W: SC.W, I: SC.I, S: SC.S };
      blanket.forEach((row, dy) =>
        [...row].forEach((c, dx) => {
          const color = col[c];
          if (color) d(4 + dx, 5 + dy, color);
        }),
      );
    }),
    head: headPaint(false),
    headLead: headPaint(true),
    antlers: layer(DEER.cols, DEER.rows, ({ px }) => {
      for (const [x, y] of [[14, 1], [14, 0], [14, -1], [15, 0], [16, -1], [13, 0], [12, -1]] as const) {
        px(x, y - 1, SC.A);
      }
    }),
    scarfTail: layer(DEER.cols, DEER.rows, ({ px }) => {
      const cells: [number, number, string][] = [
        [10, 5, SC.e], [9, 5, SC.f], [9, 4, SC.e], [8, 4, SC.W], [7, 4, SC.f], [7, 3, SC.e], [6, 3, SC.f], [5, 3, SC.e],
      ];
      for (const [x, y, c] of cells) px(x, y - 1, c);
    }),
    legs: {
      foreNear: leg("foreNear", true),
      foreFar: leg("foreFar", false),
      hindNear: leg("hindNear", true),
      hindFar: leg("hindFar", false),
    },
    flag: flagUrl(),
  };
}
