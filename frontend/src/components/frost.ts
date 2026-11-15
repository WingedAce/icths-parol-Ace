// Procedural frost "ferns": a main stem with symmetric side branches that get
// shorter towards the tip, like real window frost. Deterministic per seed, so
// the title looks the same on every visit. Returns a single SVG path.

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function frostPath(seed: number): string {
  const r = rng(seed);
  const parts: string[] = [];

  const branch = (x: number, y: number, angle: number, len: number, depth: number) => {
    const x2 = x + Math.sin(angle) * len;
    const y2 = y - Math.cos(angle) * len;
    parts.push(`M${x.toFixed(1)} ${y.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}`);
    if (depth <= 0 || len < 4) return;
    const count = depth === 2 ? 5 : 3;
    for (let i = 1; i <= count; i++) {
      const t = i / (count + 1) + (r() - 0.5) * 0.06;
      const bx = x + (x2 - x) * t;
      const by = y + (y2 - y) * t;
      const bl = len * (0.46 - t * 0.28) * (0.85 + r() * 0.3);
      const spread = 0.85 + r() * 0.25;
      branch(bx, by, angle - spread, bl, depth - 1);
      branch(bx, by, angle + spread, bl, depth - 1);
    }
  };

  branch(0, 0, (r() - 0.5) * 0.12, 34, 2);
  return parts.join("");
}
