import { useLayoutEffect, useMemo, useRef, type CSSProperties } from "react";
import { frostPath } from "./frost";

// The brand name freezes in a natural way: a soft frost front travels across
// the letters turning them into translucent, slightly clouded ice with a
// bevelled edge and a gloss highlight; frost ferns grow along the edges as the
// front passes, shards and icicles form, and once frozen a droplet occasionally
// forms and falls from an icicle. The real text stays underneath the whole time,
// so it is always readable and accessible; the ice is a decorative overlay.
//
// WHY THE ICE USED TO FLOAT
// Every decoration was placed in "% of the title box". But the box is the line
// box, not the letters: capitals only fill the middle of it, the gaps between
// letters are empty, and the title uses the system font stack, so glyph widths
// and cap heights differ on every OS (SF Pro, Segoe UI, Roboto ...). A fixed
// percentage can therefore never land on a letter edge everywhere.
//
// HOW IT IS ATTACHED NOW
// Each decoration is tied to a specific letter. After layout (and again when
// the fonts finish loading or the title is resized) the real geometry is read
// from the browser: each letter's ink edges, the cap line and the baseline.
// Ferns and shards then grow from the cap line of their letter, icicles and
// drops hang from its baseline, glints sit on its face. Sizes are in `em`, so
// everything scales with the title instead of staying a fixed number of pixels.

type Edge = "top" | "base" | "mid";

// i = character index in the title, f = 0..1 across that letter's ink,
// dy = shift in em (positive = down) so the root sinks into the letter.
type Spot = { i: number; f: number };

const TOP_FERNS: (Spot & { rot: number; size: number; seed: number })[] = [
  { i: 0, f: 0.5, rot: -16, size: 0.73, seed: 11 }, // I
  { i: 3, f: 0.5, rot: 10, size: 0.63, seed: 23 }, // A (apex)
  { i: 9, f: 0.1, rot: -8, size: 0.8, seed: 37 }, // Y (left arm)
  { i: 12, f: 0.14, rot: 16, size: 0.67, seed: 41 }, // P (stem)
];

const BOTTOM_FERNS: (Spot & { rot: number; size: number; seed: number })[] = [
  { i: 4, f: 0.88, rot: 168, size: 0.57, seed: 67 }, // R (right leg)
  { i: 9, f: 0.5, rot: 192, size: 0.63, seed: 71 }, // Y (stem)
];

const SHARDS: (Spot & { h: number })[] = [
  { i: 2, f: 0.4, h: 0.43 }, // P
  { i: 6, f: 0.12, h: 0.33 }, // L
  { i: 10, f: 0.12, h: 0.4 }, // N
  { i: 14, f: 0.5, h: 0.3 }, // E
];

// len in em; drips = a droplet occasionally forms on the tip
const ICICLES: (Spot & { len: number; drips: boolean })[] = [
  { i: 0, f: 0.5, len: 0.47, drips: false }, // I
  { i: 2, f: 0.12, len: 0.63, drips: true }, // P (stem)
  { i: 5, f: 0.5, len: 0.4, drips: false }, // O
  { i: 8, f: 0.45, len: 0.57, drips: true }, // S
  { i: 10, f: 0.9, len: 0.43, drips: false }, // N (right stem)
  { i: 12, f: 0.12, len: 0.67, drips: true }, // P (stem)
];

// t = how far down the cap height (0 = cap line, 1 = baseline)
const GLINTS: (Spot & { t: number; d: number })[] = [
  { i: 0, f: 0.5, t: 0.2, d: 5.6 },
  { i: 5, f: 0.3, t: 0.2, d: 6.8 },
  { i: 9, f: 0.15, t: 0.15, d: 6.2 },
  { i: 13, f: 0.7, t: 0.25, d: 7.4 },
];

// The front reaches x% of the title at about this time (seconds)
const reach = (pct: number) => 0.9 + Math.max(0, pct) * 0.033;

type Ink = { left: number; right: number } | null;

type Geometry = {
  ink: Ink[]; // per character, px from the left edge of the title
  capTop: number; // px from the top edge of the title
  baseline: number;
  capHeight: number;
  fontSize: number;
};

// Reads where the letters really are. Works in any font and at any size.
function measure(root: HTMLElement, base: HTMLElement, probe: HTMLElement): Geometry | null {
  const node = base.firstChild;
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const text = node.nodeValue ?? "";
  const rootRect = root.getBoundingClientRect();
  if (rootRect.width === 0 || rootRect.height === 0) return null;

  const cs = getComputedStyle(base);
  const fontSize = parseFloat(cs.fontSize) || 16;
  const ctx = document.createElement("canvas").getContext("2d");
  if (ctx) ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;

  // Cap height of the font actually in use ("H" has a flat top and bottom).
  const capHeight = ctx?.measureText("H").actualBoundingBoxAscent || fontSize * 0.72;
  // The empty inline probe sits exactly on the text baseline.
  const baseline = probe.getBoundingClientRect().bottom - rootRect.top;

  const range = document.createRange();
  const ink: Ink[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    const rect = ch.trim() ? (range.setStart(node, i), range.setEnd(node, i + 1), range.getClientRects().item(0)) : null;
    if (!rect) {
      ink.push(null);
      continue;
    }
    const origin = rect.left - rootRect.left;
    const m = ctx?.measureText(ch);
    let left = m ? origin - m.actualBoundingBoxLeft : origin;
    let right = m ? origin + m.actualBoundingBoxRight : origin + rect.width;
    if (!(right - left > fontSize * 0.05)) {
      left = origin + rect.width * 0.08;
      right = origin + rect.width * 0.92;
    }
    ink.push({ left, right });
  }

  return { ink, capTop: baseline - capHeight, baseline, capHeight, fontSize };
}

type Placed = HTMLElement | SVGSVGElement;

function place(root: HTMLElement, g: Geometry) {
  root.querySelectorAll<Placed>("[data-i]").forEach((el) => {
    const ink = g.ink[Number(el.dataset.i)];
    if (!ink) {
      el.style.display = "none";
      return;
    }
    el.style.display = "";
    const f = Number(el.dataset.f ?? 0.5);
    const edge = (el.dataset.edge ?? "top") as Edge;
    const t = Number(el.dataset.t ?? 0.5);
    const dx = Number(el.dataset.dx ?? 0);
    const dy = Number(el.dataset.dy ?? 0);
    const x = ink.left + f * (ink.right - ink.left) + dx * g.fontSize;
    const y =
      (edge === "top" ? g.capTop : edge === "base" ? g.baseline : g.capTop + g.capHeight * t) +
      dy * g.fontSize;
    el.style.left = `${x.toFixed(2)}px`;
    el.style.top = `${y.toFixed(2)}px`;
  });
}

function sameGeometry(a: Geometry | null, b: Geometry | null) {
  if (!a || !b) return false;
  const near = (x: number, y: number) => Math.abs(x - y) < 0.25;
  return (
    near(a.capTop, b.capTop) &&
    near(a.baseline, b.baseline) &&
    near(a.fontSize, b.fontSize) &&
    a.ink.length === b.ink.length &&
    a.ink.every((v, i) => {
      const w = b.ink[i];
      return v && w ? near(v.left, w.left) && near(v.right, w.right) : v === w;
    })
  );
}

export default function FrozenTitle({ text }: { text: string }) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const baseRef = useRef<HTMLSpanElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);

  const first = Math.max(0, text.search(/\S/));
  const last = Math.max(first, text.trimEnd().length - 1);
  const pct = (i: number, f: number) => ((i + f) / Math.max(1, text.length)) * 100;

  const paths = useMemo(() => {
    const seeds = [...TOP_FERNS, ...BOTTOM_FERNS].map((s) => s.seed).concat(97, 101);
    return Object.fromEntries(seeds.map((s) => [s, frostPath(s)])) as Record<number, string>;
  }, []);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const base = baseRef.current;
    const probe = probeRef.current;
    if (!root || !base || !probe) return;

    let raf = 0;
    let current: Geometry | null = null;
    const update = () => {
      const next = measure(root, base, probe);
      if (!next || sameGeometry(current, next)) return;
      current = next;
      place(root, next);
      root.dataset.ready = "1";
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };

    update(); // before the first paint, so the ice never appears in the wrong spot
    // re-measure when the title is resized (the font size follows the viewport)
    const ro = new ResizeObserver(schedule);
    ro.observe(root);
    // ... and when the real font replaces the fallback font
    const fonts = document.fonts;
    void fonts?.ready.then(schedule);
    fonts?.addEventListener?.("loadingdone", schedule);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      fonts?.removeEventListener?.("loadingdone", schedule);
    };
  }, [text]);

  const fernProps = (
    s: Spot & { rot: number; size: number; seed: number },
    edge: Edge,
    dy: number,
    key: string,
  ) => (
    <svg
      key={key}
      className="fz-fern"
      viewBox="-30 -40 60 44"
      aria-hidden="true"
      data-i={s.i}
      data-f={s.f}
      data-edge={edge}
      data-dy={dy}
      style={
        {
          width: `${s.size}em`,
          height: `${(s.size * 44) / 60}em`,
          "--rot": `${s.rot}deg`,
          "--d": `${reach(pct(s.i, s.f)) + 0.35}s`,
        } as CSSProperties
      }
    >
      <path d={paths[s.seed]} pathLength={1} />
    </svg>
  );

  return (
    <span className="frozen" ref={rootRef}>
      <span className="frozen-base" ref={baseRef}>
        {text}
        <span className="fz-probe" ref={probeRef} aria-hidden="true" />
      </span>

      <span className="fz-stack" aria-hidden="true">
        <span className="fz-depth">{text}</span>
        <span className="fz-body">{text}</span>
        <span className="fz-edge">{text}</span>
        <span className="fz-gloss">{text}</span>
      </span>

      {TOP_FERNS.map((s, k) => fernProps(s, "top", 0.035, `ft${k}`))}
      {BOTTOM_FERNS.map((s, k) => fernProps(s, "base", -0.035, `fb${k}`))}

      {/* the two ends of the title: ferns creep out sideways from the first and
          last letter */}
      {[
        { i: first, f: 0, dx: 0.03, rot: -82, seed: 97 },
        { i: last, f: 1, dx: -0.03, rot: 82, seed: 101 },
      ].map((s, k) => (
        <svg
          key={`fe${k}`}
          className="fz-fern"
          viewBox="-30 -40 60 44"
          aria-hidden="true"
          data-i={s.i}
          data-f={s.f}
          data-dx={s.dx}
          data-edge="mid"
          data-t={0.5}
          style={
            {
              width: "0.53em",
              height: `${(0.53 * 44) / 60}em`,
              "--rot": `${s.rot}deg`,
              "--d": `${reach(pct(s.i, s.f)) + 0.35}s`,
            } as CSSProperties
          }
        >
          <path d={paths[s.seed]} pathLength={1} />
        </svg>
      ))}

      {SHARDS.map((s, k) => (
        <svg
          key={`s${k}`}
          className="fz-shard"
          viewBox="-8 -30 16 30"
          aria-hidden="true"
          data-i={s.i}
          data-f={s.f}
          data-edge="top"
          data-dy={0.03}
          style={
            {
              width: `${s.h / 2}em`,
              height: `${s.h}em`,
              "--rot": `${(k % 2 === 0 ? -1 : 1) * (6 + k * 3)}deg`,
              "--d": `${reach(pct(s.i, s.f)) + 0.5}s`,
            } as CSSProperties
          }
        >
          <path className="fz-shard-body" d="M0 0L6 -4L6 -22L0 -28L-6 -22L-6 -4Z" />
          <path className="fz-shard-light" d="M0 0L-6 -4L-6 -22L0 -28Z" />
          <path className="fz-shard-facet" d="M0 -28V0M-6 -22L0 -17L6 -22" />
        </svg>
      ))}

      {ICICLES.map((s, k) => (
        <span key={`i${k}`}>
          <svg
            className="fz-icicle"
            viewBox="0 0 10 40"
            aria-hidden="true"
            data-i={s.i}
            data-f={s.f}
            data-edge="base"
            data-dy={-0.06}
            style={
              {
                width: `${Math.max(0.1, s.len * 0.22)}em`,
                height: `${s.len}em`,
                "--d": `${reach(pct(s.i, s.f)) + 0.9}s`,
              } as CSSProperties
            }
          >
            <path className="fz-icicle-body" d="M0 0H10L6.2 24L5 40L3.8 24Z" />
            <path className="fz-icicle-light" d="M1.2 0H3.8L4.4 22L3.9 25Z" />
          </svg>
          {s.drips && (
            <span
              className="fz-drop"
              aria-hidden="true"
              data-i={s.i}
              data-f={s.f}
              data-edge="base"
              data-dy={s.len - 0.06}
              style={{ "--d": `${6 + k * 1.9}s` } as CSSProperties}
            />
          )}
        </span>
      ))}

      {GLINTS.map((s, k) => (
        <span
          key={`g${k}`}
          className="fz-glint"
          aria-hidden="true"
          data-i={s.i}
          data-f={s.f}
          data-edge="mid"
          data-t={s.t}
          style={{ "--d": `${s.d}s` } as CSSProperties}
        />
      ))}
    </span>
  );
}
