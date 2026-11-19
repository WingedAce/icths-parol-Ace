import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  GARLAND,
  SLEIGH,
  SNOWBANK,
  buildGarland,
  buildSnowBank,
  buildRig,
  buildSprites,
  buildElf,
  type SpriteName,
} from "./pixelArt";
import SleighRig from "./SleighRig";
import { useLowQuality } from "../utils/lowQuality";

// Immersive but quiet winter backdrop for I-PAROL SYNAPSE:
//   aurora (CSS) -> light garland + snow bank (pixel tiles) -> hanging pixel
//   ornaments -> Santa's sleigh, which crosses the sky every so often -> a single
//   <canvas> with three snow depth layers, drifting ice crystals, the sleigh's
//   sparkle trail and click/hover sparkles.
// Everything sits behind the page content (the backdrop never takes clicks,
// only the ornaments themselves can be touched) and stops moving when the
// system asks for reduced motion.
//
// One component, three intensities, so the whole app shares one identity:
//   full  - the landing page: everything above.
//   calm  - the color-lock / sign-in screens: aurora, a light dusting of snow,
//           the garland, the snow bank and two small ornaments at the edges.
//   quiet - the workspace: a faint aurora, sparse slow snow and a low snow
//           bank. No sleigh, no ornaments, no big flakes, capped frame rate.
// calm and quiet are pinned to the viewport (position: fixed), so a long,
// scrolling page does not get a huge canvas.

type Ornament = {
  sprite: SpriteName;
  side: "left" | "right";
  offset: string;
  lenMobile: number; // hanging length (px) on phones
  lenDesktop: number; // hanging length (px) on larger screens
  unit: number; // pixel size on desktop; phones use one less
  sway: number; // seconds per sway cycle
  delay: number;
  far?: boolean; // distant ornaments are smaller and dimmer
  mobile?: boolean; // shown on phones
};

const ORNAMENTS: Ornament[] = [
  { sprite: "ballRed", side: "left", offset: "4%", lenMobile: 30, lenDesktop: 150, unit: 4, sway: 7, delay: -1, mobile: true },
  { sprite: "star", side: "left", offset: "15%", lenMobile: 20, lenDesktop: 70, unit: 3, sway: 8, delay: -4, far: true },
  { sprite: "ballSilver", side: "left", offset: "26%", lenMobile: 20, lenDesktop: 34, unit: 2, sway: 9, delay: -2, far: true },
  { sprite: "bell", side: "right", offset: "5%", lenMobile: 26, lenDesktop: 120, unit: 4, sway: 8, delay: -3, mobile: true },
  { sprite: "ballIce", side: "right", offset: "17%", lenMobile: 20, lenDesktop: 190, unit: 3, sway: 7.5, delay: -5, far: true },
  { sprite: "snowflake", side: "right", offset: "28%", lenMobile: 20, lenDesktop: 56, unit: 3, sway: 9, delay: -6, far: true },
  { sprite: "ballGold", side: "left", offset: "34%", lenMobile: 20, lenDesktop: 24, unit: 2, sway: 8.5, delay: -7, far: true },
  // emerald knitwear, hung with the baubles
  { sprite: "sweater", side: "left", offset: "20.5%", lenMobile: 20, lenDesktop: 104, unit: 3, sway: 8.8, delay: -2.5, far: true },
  { sprite: "mitten", side: "right", offset: "10.5%", lenMobile: 20, lenDesktop: 72, unit: 3, sway: 7.8, delay: -4.5, far: true },
];

export type BackdropVariant = "full" | "calm" | "quiet";

type Profile = {
  far: number; // snow density multipliers per depth layer
  mid: number;
  near: number;
  maxFps: number; // 0 = every frame
  dprCap: number;
  sleigh: boolean;
  crystals: boolean;
  garland: boolean;
  bank: boolean;
  ornaments: number[] | "all"; // indices into ORNAMENTS
  lenScale: number; // ornament string length multiplier
};

const PROFILES: Record<BackdropVariant, Profile> = {
  full: { far: 1, mid: 1, near: 1, maxFps: 0, dprCap: 1.5, sleigh: true, crystals: true, garland: true, bank: true, ornaments: "all", lenScale: 1 },
  calm: { far: 0.45, mid: 0.3, near: 0, maxFps: 30, dprCap: 1.25, sleigh: false, crystals: false, garland: true, bank: true, ornaments: [0, 3], lenScale: 0.5 },
  quiet: { far: 0.3, mid: 0.12, near: 0, maxFps: 24, dprCap: 1, sleigh: false, crystals: false, garland: false, bank: true, ornaments: [], lenScale: 1 },
};

type Flake = {
  x: number;
  y: number;
  vy: number;
  sway: number;
  freq: number;
  phase: number;
  layer: 0 | 1 | 2;
  tw: number;
};

type Spark = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
};

type Trail = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  star: boolean;
  seed: number;
};

type Crystal = { x: number; y: number; vx: number; vy: number; age: number; ttl: number };

// Pixel footprints, in art-pixels, for the flake layers.
const MID_CELLS: [number, number][] = [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]];
const FG_CELLS: [number, number][] = [
  [2, 0], [0, 1], [2, 1], [4, 1], [1, 2], [2, 2], [3, 2], [0, 3], [2, 3], [4, 3], [2, 4],
];
const CRYSTAL_ROWS = ["..w..", ".wIw.", "wIiIw", ".wIw.", "..w.."];
const CRYSTAL_COLORS: Record<string, string> = { w: "#e8f6ff", I: "#9fd3f5", i: "#5f9fd0" };
const SPARK_COLORS = ["#ffffff", "#f0cf75", "#9fd3f5", "#ffffff"];
const TRAIL_COLORS = ["#ffffff", "#f0cf75", "#f0cf75", "#9fd3f5", "#ffffff"];

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export default function WinterBackdrop({
  variant = "full",
  paused = false,
}: {
  variant?: BackdropVariant;
  // true while something opaque covers this backdrop: stops the animation
  paused?: boolean;
}) {
  // Low Quality Mode drops Santa, the ornaments and the ice crystals (and the
  // falling snow, see noSnow). Aurora, garland and snow bank stay as they are.
  const lowQuality = useLowQuality();
  const profile = useMemo<Profile>(
    () =>
      lowQuality
        ? { ...PROFILES[variant], sleigh: false, crystals: false, ornaments: [] }
        : PROFILES[variant],
    [variant, lowQuality],
  );
  // Low Quality Mode also stops the falling snow, except on the "quiet"
  // backdrop (workspace and Developer Window), which is left as it is.
  const noSnow = lowQuality && variant !== "quiet";
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const burstRef = useRef<(x: number, y: number, count: number) => void>(() => {});

  const sleighRef = useRef<HTMLDivElement>(null);
  const santaBtnRef = useRef<HTMLButtonElement>(null);
  // true while Santa is held still for his greeting; read by the flight loop
  const santaHoldRef = useRef(false);
  const greetTimers = useRef<number[]>([]);
  const [greet, setGreet] = useState<{ left: number; top: number; below: boolean; leaving: boolean } | null>(null);
  const sprites = useMemo(() => buildSprites(), []);
  const elf = useMemo(() => buildElf(), []);
  // The elf that peeks out of a clicked ornament. Only one at a time: clicks
  // while he is out are ignored, so he can never overlap or restart halfway.
  const [elfAt, setElfAt] = useState<number | null>(null);
  const elfBusyRef = useRef(false);
  const elfTimerRef = useRef<number | null>(null);
  const rig = useMemo(() => buildRig(), []);
  const garland = useMemo(() => buildGarland(), []);
  const snowBank = useMemo(() => buildSnowBank(), []);

  // ---------------------------------------------------------------- snow
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = rootRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !host || !ctx) return;
    if (noSnow) return;

    const minFrame = profile.maxFps ? 1000 / profile.maxFps - 2 : 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let raf = 0;
    let last = 0;
    let t = 0;
    let nextCrystal = rand(5, 9);
    let flakes: Flake[] = [];
    const sparks: Spark[] = [];
    const crystals: Crystal[] = [];
    const trail: Trail[] = [];
    const sleigh = sleighRef.current;
    // Santa: waits, then flies across the sky; alternates direction each pass
    let sFlying = false;
    let sWait = 3.5;
    let sDir: 1 | -1 = -1;
    let sP = 0;
    let sDur = 34;
    let sBaseY = 0;
    let sAmp = 0;
    let sPhase = 0;
    let sUnit = 3;
    let trailAcc = 0;
    let sT = 0; // Santa's own clock: does not advance while he is held for a greeting
    // art-pixel size in canvas pixels, per layer: far dust, mid, close-up
    let unit: [number, number, number] = [1, 2, 3];
    const wind = [0.45, 1, 1.7];
    const alpha = [0.4, 0.75, 0.55];

    const makeFlake = (layer: 0 | 1 | 2, anywhere: boolean): Flake => ({
      x: rand(0, w),
      y: anywhere ? rand(0, h) : rand(-30, -4),
      vy: layer === 0 ? rand(10, 20) : layer === 1 ? rand(28, 46) : rand(72, 110),
      sway: layer === 0 ? rand(1, 3) : layer === 1 ? rand(3, 9) : rand(6, 16),
      freq: rand(0.4, 1.3),
      phase: rand(0, Math.PI * 2),
      layer,
      tw: 0,
    });

    const build = () => {
      const area = w * h;
      const far = Math.round(Math.min(110, Math.max(30, area / 9000)) * profile.far);
      const mid = Math.round(Math.min(60, Math.max(14, area / 20000)) * profile.mid);
      const near = Math.round(Math.min(14, Math.max(4, area / 90000)) * profile.near);
      flakes = [
        ...Array.from({ length: far }, () => makeFlake(0, true)),
        ...Array.from({ length: mid }, () => makeFlake(1, true)),
        ...Array.from({ length: near }, () => makeFlake(2, true)),
      ];
    };

    const resize = () => {
      const rect = host.getBoundingClientRect();
      w = Math.max(1, rect.width);
      h = Math.max(1, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, profile.dprCap);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      unit = [
        Math.max(1, Math.round(dpr)),
        Math.max(2, Math.round(1.5 * dpr)),
        Math.max(3, Math.round(3 * dpr)),
      ];
      build();
      sUnit = window.innerWidth >= 640 ? 3 : 2;
      if (reduce) {
        draw();
        if (sleigh) {
          sleigh.style.visibility = "visible";
          sleigh.style.transform = `translate3d(${Math.round(w * 0.6)}px, ${Math.round(h * 0.12)}px, 0)`;
        }
      }
    };

    const cell = (x: number, y: number, u: number) => {
      ctx.fillRect(Math.round((x * dpr) / u) * u, Math.round((y * dpr) / u) * u, u, u);
    };

    const drawFlake = (f: Flake) => {
      const u = unit[f.layer];
      const px = Math.round((f.x * dpr) / u) * u;
      const py = Math.round((f.y * dpr) / u) * u;
      ctx.globalAlpha = alpha[f.layer] ?? 0.5;
      ctx.fillStyle = f.layer === 2 ? "#eaf6ff" : "#ffffff";
      if (f.layer === 0) {
        ctx.fillRect(px, py, u, u);
      } else {
        const cells = f.layer === 1 ? MID_CELLS : FG_CELLS;
        for (const [cx, cy] of cells) ctx.fillRect(px + cx * u, py + cy * u, u, u);
      }
      if (f.tw > 0) {
        // a brief four-point glint
        ctx.globalAlpha = Math.min(1, f.tw);
        ctx.fillStyle = "#ffffff";
        const o = f.layer === 0 ? 2 : 3;
        const s = f.layer === 2 ? 2 : 1;
        ctx.fillRect(px - o * u, py, s * u, u);
        ctx.fillRect(px + o * u, py, s * u, u);
        ctx.fillRect(px, py - o * u, u, s * u);
        ctx.fillRect(px, py + o * u, u, s * u);
      }
    };

    const drawCrystal = (c: Crystal) => {
      const u = Math.max(2, Math.round(2.5 * dpr));
      const px = Math.round((c.x * dpr) / u) * u;
      const py = Math.round((c.y * dpr) / u) * u;
      ctx.globalAlpha = Math.sin((c.age / c.ttl) * Math.PI) * 0.85;
      CRYSTAL_ROWS.forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx++) {
          const color = CRYSTAL_COLORS[row.charAt(rx)];
          if (!color) continue;
          ctx.fillStyle = color;
          ctx.fillRect(px + rx * u, py + ry * u, u, u);
        }
      });
    };

    function draw() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      for (const f of flakes) drawFlake(f);
      ctx!.globalAlpha = 1;
    }

    const burst = (x: number, y: number, count: number) => {
      if (reduce) return;
      for (let i = 0; i < count && sparks.length < 90; i++) {
        const a = rand(0, Math.PI * 2);
        const s = rand(40, 120);
        sparks.push({
          x,
          y,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s - 30,
          life: 0,
          max: rand(0.5, 0.95),
          color: SPARK_COLORS[i % SPARK_COLORS.length] ?? "#ffffff",
        });
      }
    };
    burstRef.current = burst;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      // nothing to draw while the tab is hidden or an opaque screen covers us
      if (document.hidden || pausedRef.current) {
        last = now;
        return;
      }
      // lighter variants redraw at a capped rate: same motion, less work
      if (minFrame && last && now - last < minFrame) return;
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
      last = now;
      t += dt;

      const gust = Math.sin(t * 0.13) * 7 + Math.sin(t * 0.37 + 1.3) * 3.5;
      for (const f of flakes) {
        f.y += f.vy * dt;
        f.x += (gust * (wind[f.layer] ?? 1) + Math.sin(t * f.freq + f.phase) * f.sway) * dt;
        if (f.y > h + 24) {
          f.y = -rand(6, 30);
          f.x = rand(0, w);
        }
        if (f.x > w + 24) f.x = -24;
        else if (f.x < -24) f.x = w + 24;
        if (f.tw > 0) f.tw -= dt * 1.5;
        else if (f.layer < 2 && Math.random() < dt * 0.012) f.tw = 1;
      }

      nextCrystal -= dt;
      if (profile.crystals && nextCrystal <= 0 && crystals.length < 3) {
        nextCrystal = rand(7, 14);
        const fromLeft = Math.random() < 0.5;
        crystals.push({
          x: fromLeft ? -20 : w + 20,
          y: rand(h * 0.1, h * 0.6),
          vx: (fromLeft ? 1 : -1) * rand(18, 30),
          vy: rand(8, 18),
          age: 0,
          ttl: rand(14, 22),
        });
      }

      // ---- Santa's flight
      if (sleigh) {
        if (!sFlying) {
          sWait -= dt;
          if (sWait <= 0) {
            sFlying = true;
            sDir = sDir === 1 ? -1 : 1;
            sP = 0;
            sDur = rand(30, 38);
            sBaseY = rand(h * 0.09, h * 0.24);
            sAmp = rand(h * 0.02, h * 0.045);
            sPhase = rand(0, Math.PI * 2);
            sleigh.style.visibility = "visible";
            // the flag flaps faster the faster the sleigh crosses (set once per
            // pass; the waving itself is pure CSS)
            const speed = (w + SLEIGH.cols * sUnit) / sDur;
            sleigh.style.setProperty("--wave", `${Math.max(0.6, 1.5 - speed / 110).toFixed(2)}s`);
          }
        } else if (!santaHoldRef.current) {
          sT += dt;
          sP += dt / sDur;
          const sw = SLEIGH.cols * sUnit;
          if (sP >= 1) {
            sFlying = false;
            sWait = rand(26, 48);
            sleigh.style.visibility = "hidden";
          } else {
            const left = sDir > 0 ? -sw + (w + sw) * sP : w - (w + sw) * sP;
            const top =
              sBaseY + Math.sin(sP * Math.PI * 2.5 + sPhase) * sAmp + Math.sin(sT * 2.2) * 2.5;
            const tx = Math.round(sDir > 0 ? left : left + sw);
            sleigh.style.transform = `translate3d(${tx}px, ${Math.round(top)}px, 0) scaleX(${sDir})`;

            // sparkle trail streaming from the back of the sleigh
            trailAcc += dt * 55;
            const backX = sDir > 0 ? left : left + sw;
            const backY = top + SLEIGH.tailY * sUnit;
            while (trailAcc >= 1) {
              trailAcc -= 1;
              if (trail.length >= 170) break;
              trail.push({
                x: backX + rand(-3, 3),
                y: backY + rand(-9, 9),
                vx: -sDir * rand(6, 30),
                vy: rand(-8, 14),
                life: 0,
                max: rand(1.1, 2.2),
                color: TRAIL_COLORS[Math.floor(Math.random() * TRAIL_COLORS.length)] ?? "#ffffff",
                star: Math.random() < 0.08,
                seed: rand(0, 6.28),
              });
            }
          }
        }
      }

      draw();

      for (let i = crystals.length - 1; i >= 0; i--) {
        const c = crystals[i];
        if (!c) continue;
        c.age += dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        if (c.age >= c.ttl) crystals.splice(i, 1);
        else drawCrystal(c);
      }

      const su = Math.max(2, Math.round(2 * dpr));
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        if (!s) continue;
        s.life += dt;
        s.vy += 140 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        if (s.life >= s.max) {
          sparks.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = 1 - s.life / s.max;
        ctx.fillStyle = s.color;
        cell(s.x, s.y, su);
      }
      const tu = Math.max(2, Math.round(1.5 * dpr));
      for (let i = trail.length - 1; i >= 0; i--) {
        const s = trail[i];
        if (!s) continue;
        s.life += dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += 6 * dt;
        if (s.life >= s.max) {
          trail.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = (1 - s.life / s.max) * (0.55 + 0.45 * Math.sin(s.life * 16 + s.seed)) * 0.9;
        ctx.fillStyle = s.color;
        cell(s.x, s.y, tu);
        if (s.star) {
          cell(s.x - tu / dpr, s.y, tu);
          cell(s.x + tu / dpr, s.y, tu);
          cell(s.x, s.y - tu / dpr, tu);
          cell(s.x, s.y + tu / dpr, tu);
        }
      }
      ctx.globalAlpha = 1;
    };

    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();
    if (!reduce) raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      burstRef.current = () => {};
    };
  }, [variant, profile, noSnow]);

  // ------------------------------------------- cursor-proximity glow
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !window.matchMedia("(pointer: fine)").matches) return;
    if (profile.ornaments !== "all" && profile.ornaments.length === 0) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>("[data-orn]"));
    let raf = 0;
    let px = -999;
    let py = -999;

    const check = () => {
      raf = 0;
      for (const el of items) {
        const sprite = el.querySelector<HTMLElement>(".wb-sprite");
        if (!sprite) continue;
        const r = sprite.getBoundingClientRect();
        if (r.width === 0) continue;
        const near =
          Math.hypot(px - (r.left + r.width / 2), py - (r.top + r.height / 2)) <
          r.width / 2 + 110;
        el.toggleAttribute("data-near", near);
      }
    };
    const onMove = (e: PointerEvent) => {
      px = e.clientX;
      py = e.clientY;
      if (!raf) raf = requestAnimationFrame(check);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [profile]);

  // Turning Low Quality Mode on while Santa's greeting or the elf is showing:
  // drop them and their timers right away.
  useEffect(() => {
    if (!lowQuality) return;
    greetTimers.current.forEach((id) => window.clearTimeout(id));
    greetTimers.current = [];
    santaHoldRef.current = false;
    setGreet(null);
    if (elfTimerRef.current !== null) {
      window.clearTimeout(elfTimerRef.current);
      elfTimerRef.current = null;
    }
    elfBusyRef.current = false;
    setElfAt(null);
  }, [lowQuality]);

  const sparkle = (el: HTMLElement, count: number) => {
    const host = rootRef.current;
    if (!host) return;
    const r = el.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    burstRef.current(r.left - h.left + r.width / 2, r.top - h.top + r.height / 2, count);
  };

  const clearGreetTimers = () => {
    greetTimers.current.forEach((id) => window.clearTimeout(id));
    greetTimers.current = [];
  };

  // Santa greeting: hold the sleigh (JS flight + every CSS gallop animation
  // pauses in place), pop up the message, then let go so he carries on exactly
  // where he stopped. Clicks while a greeting is showing are ignored.
  const greetSanta = useCallback(() => {
    const host = rootRef.current;
    const btn = santaBtnRef.current;
    const sleigh = sleighRef.current;
    if (!host || !btn || !sleigh || santaHoldRef.current) return;
    santaHoldRef.current = true;
    sleigh.classList.add("wb-sleigh-paused");

    const r = btn.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    const cx = r.left - h.left + r.width / 2;
    const cy = r.top - h.top;
    // keep the bubble on screen and away from the page edges
    const left = Math.min(Math.max(cx, 110), Math.max(110, h.width - 110));
    const below = cy < 70;
    setGreet({ left, top: below ? r.bottom - h.top + 8 : cy - 8, below, leaving: false });
    burstRef.current(cx, cy + r.height * 0.35, 22);

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    greetTimers.current.push(
      window.setTimeout(() => setGreet((g) => (g ? { ...g, leaving: true } : g)), reduce ? 2200 : 2500),
      window.setTimeout(() => {
        setGreet(null);
        santaHoldRef.current = false;
        sleigh.classList.remove("wb-sleigh-paused");
      }, reduce ? 2300 : 2750),
    );
  }, []);

  useEffect(
    () => () => {
      clearGreetTimers();
      santaHoldRef.current = false;
    },
    [],
  );

  const peekElf = useCallback((index: number) => {
    if (elfBusyRef.current) return;
    elfBusyRef.current = true;
    setElfAt(index);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    elfTimerRef.current = window.setTimeout(
      () => {
        elfTimerRef.current = null;
        elfBusyRef.current = false;
        setElfAt(null);
      },
      reduce ? 1900 : 2700,
    );
  }, []);

  useEffect(
    () => () => {
      if (elfTimerRef.current !== null) window.clearTimeout(elfTimerRef.current);
      elfBusyRef.current = false;
    },
    [],
  );

  // Page content sits on top of the sky (on a phone the centred column covers
  // all of it), so a tap on Santa often lands on the content and never reaches
  // his button. Hit-test the tap against his box ourselves. Taps on buttons,
  // links and form fields are left alone, and a drag or scroll is not a tap.
  useEffect(() => {
    if (!profile.sleigh) return;
    let down: { x: number; y: number; t: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
    };
    const onUp = (e: PointerEvent) => {
      const d = down;
      down = null;
      if (!d || performance.now() - d.t > 700) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12) return;
      const sleigh = sleighRef.current;
      const btn = santaBtnRef.current;
      if (!sleigh || !btn || sleigh.style.visibility !== "visible" || santaHoldRef.current) return;
      const target = e.target as Element | null;
      if (target?.closest("button, a, input, select, textarea, label, [role='button']")) return;
      const slop = e.pointerType === "touch" ? 14 : 0;
      const r = btn.getBoundingClientRect();
      if (
        e.clientX < r.left - slop ||
        e.clientX > r.right + slop ||
        e.clientY < r.top - slop ||
        e.clientY > r.bottom + slop
      ) {
        return;
      }
      greetSanta();
    };
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
    };
  }, [profile.sleigh, greetSanta]);

  const garlandStyle = (url: string): CSSProperties => ({
    backgroundImage: `url(${url})`,
  });

  return (
    <div ref={rootRef} aria-hidden="true" className={`wb-root wb-${variant}`}>
      <div className="wb-aurora-wrap">
        <div className="wb-aurora wb-aurora-a" />
        <div className="wb-aurora wb-aurora-b" />
        <div className="wb-aurora wb-aurora-c" />
      </div>

      {profile.garland && (
        <div
          className="wb-garland"
          style={{ "--cols": GARLAND.cols, "--rows": GARLAND.rows } as CSSProperties}
        >
          <div className="wb-garland-layer" style={garlandStyle(garland.base)} />
          <div className="wb-garland-layer wb-twinkle-a" style={garlandStyle(garland.litA)} />
          <div className="wb-garland-layer wb-twinkle-b" style={garlandStyle(garland.litB)} />
        </div>
      )}

      {profile.bank && !noSnow && (
        <div
          className="wb-bank"
          style={
            {
              "--cols": SNOWBANK.cols,
              "--rows": SNOWBANK.rows,
              backgroundImage: `url(${snowBank})`,
            } as CSSProperties
          }
        />
      )}

      {ORNAMENTS.map((o, i) => {
        if (profile.ornaments !== "all" && !profile.ornaments.includes(i)) return null;
        const s = sprites[o.sprite];
        return (
          <div
            key={i}
            data-orn=""
            className={`wb-orn ${o.mobile ? "" : "wb-hide-mobile"} ${o.far ? "wb-far" : ""}`}
            style={
              {
                [o.side]: o.offset,
                "--ud": `${o.unit}px`,
                "--um": `${Math.max(2, o.unit - 1)}px`,
                "--len-m": `${Math.round(o.lenMobile * Math.min(1, profile.lenScale + 0.3))}px`,
                "--len-d": `${Math.round(o.lenDesktop * profile.lenScale)}px`,
                "--sway": `${o.sway}s`,
                "--delay": `${o.delay}s`,
                "--cols": s.cols,
                "--rows": s.rows,
              } as CSSProperties
            }
          >
            <span className="wb-string" />
            <img
              className="wb-sprite"
              src={s.url}
              alt=""
              draggable={false}
              onPointerEnter={(e) => sparkle(e.currentTarget, 4)}
              onClick={(e) => {
                sparkle(e.currentTarget, 14);
                peekElf(i);
              }}
            />
            {elfAt === i && (
              <span
                className="wb-elf"
                style={
                  {
                    // he peeks out towards the middle of the screen, where there is room
                    "--dir": o.side === "left" ? 1 : -1,
                    "--ecols": elf.cols,
                    "--erows": elf.rows,
                  } as CSSProperties
                }
              >
                <img className="wb-elf-f wb-elf-ahead" src={elf.ahead} alt="" draggable={false} />
                <img className="wb-elf-f wb-elf-left" src={elf.left} alt="" draggable={false} />
                <img className="wb-elf-f wb-elf-right" src={elf.right} alt="" draggable={false} />
                <img className="wb-elf-f wb-elf-blink" src={elf.blink} alt="" draggable={false} />
              </span>
            )}
          </div>
        );
      })}

      {profile.sleigh && (
        <div
          ref={sleighRef}
          className="wb-sleigh"
          style={{ "--cols": SLEIGH.cols, "--rows": SLEIGH.rows } as CSSProperties}
        >
          <span className="wb-sleigh-glow" />
          <SleighRig rig={rig} />
          <button
            ref={santaBtnRef}
            type="button"
            className="wb-santa-hit"
            aria-label="Santa's sleigh: press for a Christmas greeting"
            onClick={greetSanta}
          />
        </div>
      )}

      {profile.sleigh && (
        <div className="wb-greet-live" aria-live="polite">
          {greet && (
            <div
              key="greet"
              className={`wb-greet ${greet.below ? "wb-greet-below" : ""} ${greet.leaving ? "wb-greet-out" : ""}`}
              style={{ left: greet.left, top: greet.top }}
            >
              <span className="wb-greet-text">MERRY CHRISTMAS!</span>
            </div>
          )}
        </div>
      )}

      {/* not rendered at all in Low Quality Mode, so no frozen flakes are left behind */}
      {!noSnow && <canvas ref={canvasRef} className="wb-canvas" />}
    </div>
  );
}
