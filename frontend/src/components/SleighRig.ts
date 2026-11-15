import { createElement as h, type CSSProperties, type ReactElement } from "react";
import { DEER, FLAG, SLEIGH, type Rig } from "./pixelArt";

// Santa's sleigh, assembled from separately animated pixel layers (see
// buildRig in pixelArt.ts). All motion is CSS: transform-only keyframes in
// index.css (.wb-deer, .wb-leg, .wb-neck, .wb-flag ...). Every layer is a
// full-size box on one shared coordinate space, so each transform-origin below
// sits exactly on a joint: hip, knee, neck base, antler root, tail root.

type Vars = Record<string, string | number>;
const css = (v: Vars) => v as CSSProperties;

// grid row of a point in the deer's own drawing coordinates
const row = (y: number) => y - 1 + SLEIGH.offY;
// a point on the grid, in art pixels (--u is the CSS pixel size of one cell)
const at = (x: number, y: number) => `calc(${x} * var(--u)) calc(${y} * var(--u))`;
const px = (src: string) =>
  h("img", { className: "wb-px", src, alt: "", draggable: false });
const box = (className: string, style: Vars | undefined, ...kids: ReactElement[]) =>
  h("span", { className: `wb-l ${className}`, style: style ? css(style) : undefined }, ...kids);

type LegUrls = { thigh: string; shin: string };

// hip pivot is the top edge of the thigh, knee pivot the top edge of the shin
function leg(kind: "fore" | "hind", side: "near" | "far", x: number, u: LegUrls, lp: number) {
  return box(
    `wb-leg wb-${kind} wb-${side}`,
    { "--lp": lp, transformOrigin: at(x + 1, row(9)) },
    px(u.thigh),
    box("wb-shin", { transformOrigin: at(x + 1, row(11)) }, px(u.shin)),
  );
}

// Each reindeer gets its own gallop period and phase so the team never moves in
// lockstep: dur = seconds per stride, ph = phase offset in seconds, lead = Rudolph.
const TEAM = [
  { ox: 30, lead: false, dur: 0.64, ph: 0.0, tail: 1.45 },
  { ox: 49, lead: false, dur: 0.58, ph: 0.23, tail: 1.2 },
  { ox: 68, lead: true, dur: 0.61, ph: 0.41, tail: 1.65 },
];

function deer(rig: Rig, t: (typeof TEAM)[number], i: number) {
  const L = rig.legs;
  return h(
    "span",
    {
      key: i,
      className: "wb-deer",
      style: css({
        left: `calc(${t.ox} * var(--u))`,
        width: `calc(${DEER.cols} * var(--u))`,
        "--dur": `${t.dur}s`,
        "--ph": `${-t.ph}s`,
        "--tail": `${t.tail}`,
      }),
    },
    box(
      "wb-bob",
      undefined,
      box(
        "wb-pitch",
        { transformOrigin: at(7, row(6)) },
        box("wb-tail", { transformOrigin: at(2, row(5.5)) }, px(rig.tail)),
        leg("hind", "far", 4, L.hindFar, 0.57),
        leg("fore", "far", 8, L.foreFar, 0.1),
        box("wb-torso", undefined, px(rig.body)),
        leg("hind", "near", 2, L.hindNear, 0.47),
        leg("fore", "near", 10, L.foreNear, 0),
        box(
          "wb-neck",
          { transformOrigin: at(12, row(6)) },
          px(t.lead ? rig.headLead : rig.head),
          box("wb-antlers", { transformOrigin: at(14, row(2)) }, px(rig.antlers)),
          box("wb-scarf", { transformOrigin: at(10.5, row(5)) }, px(rig.scarfTail)),
          ...(t.lead
            ? [
                h("span", {
                  key: "nose",
                  className: "wb-nose",
                  style: css({ left: `calc(17.5 * var(--u))`, top: `calc(${row(3) + 0.5} * var(--u))` }),
                }),
              ]
            : []),
        ),
      ),
    ),
  );
}

// Philippine flag on the sleigh's flagpole. The cloth is cut into vertical
// slices; each slice bobs and shears on its own phase, with more travel the
// farther it is from the pole, so a wave runs down the fabric.
function flag(rig: Rig) {
  const n = FLAG.cols / 2;
  const slices: ReactElement[] = [];
  for (let j = 0; j < n; j++) {
    const k = n - 1 - j; // distance from the pole, in slices
    slices.push(
      h("span", {
        key: j,
        className: "wb-fs",
        style: css({ "--j": j, "--k": k, "--a": ((k + 0.6) / n).toFixed(3) }),
      }),
    );
  }
  return h(
    "span",
    {
      className: "wb-flag",
      style: css({
        "--flag": rig.flag,
        left: `calc(${1 - FLAG.cols} * var(--u))`,
        top: `calc(${-10 + SLEIGH.offY} * var(--u))`,
        width: `calc(${FLAG.cols} * var(--u))`,
        height: `calc(${FLAG.rows} * var(--u))`,
      }),
    },
    ...slices,
  );
}

export default function SleighRig({ rig }: { rig: Rig }) {
  return h(
    "span",
    { className: "wb-rig" },
    box(
      "wb-hull",
      { transformOrigin: at(24, row(9)) },
      px(rig.hull),
      box("wb-santa-scarf", { transformOrigin: at(16, row(0) + 0.5) }, px(rig.santaScarf)),
      flag(rig),
    ),
    ...TEAM.map((t, i) => deer(rig, t, i)),
  );
}
