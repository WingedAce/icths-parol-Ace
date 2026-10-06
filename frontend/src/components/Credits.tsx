import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type CreditsProps = {
  onClose: () => void;
};

type CreditGroup = {
  title: string;
  names: { name: string }[];
};

const GROUPS: CreditGroup[] = [
  {
    title: "Website Developers",
    names: [
      { name: "Reece Mangune" },
      { name: "Xander Pacat" },
      { name: "Yuan Cabrera" },
      { name: "Enzo Yutuc" },
      { name: "Josh Sanchez" },
      { name: "Red Reyes" },
      { name: "ESPECIALLY Jacob Magtata" },
    ],
  },
  {
    title: "Special thanks to",
    names: [
      { name: "Sir Gerald Baking" },
    ],
  },
];

// Points of an n-pointed star, used for the parol star at the top.
function starPoints(cx: number, cy: number, outer: number, inner: number, n: number) {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / n - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

// A glowing parol star with little tails, the centerpiece at the top.
function ParolStar() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 120 150"
      className="credits-float h-[129px] w-[110px] sm:h-[166px] sm:w-[129px]"
      style={{ filter: "drop-shadow(0 0 18px rgba(255, 214, 120, 0.45))" }}
    >
      {/* tails */}
      <g stroke="rgba(255, 214, 120, 0.7)" strokeWidth="1.5" strokeLinecap="round">
        <line x1="60" y1="108" x2="60" y2="146" />
        <line x1="48" y1="104" x2="42" y2="136" />
        <line x1="72" y1="104" x2="78" y2="136" />
      </g>
      <polygon
        points={starPoints(60, 58, 54, 26, 8)}
        fill="rgba(255, 214, 120, 0.12)"
        stroke="rgba(255, 214, 120, 0.85)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <polygon
        points={starPoints(60, 58, 30, 14, 8)}
        fill="rgba(255, 214, 120, 0.22)"
        stroke="rgba(255, 236, 190, 0.9)"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="60" cy="58" r="5" fill="rgba(255, 244, 214, 0.95)" />
    </svg>
  );
}

// Small star-and-lines divider placed between the credit groups.
function StarDivider() {
  return (
    <div aria-hidden="true" className="flex items-center gap-4 text-amber-200/70">
      <span className="h-px w-16 bg-gradient-to-r from-transparent to-amber-200/40 sm:w-24" />
      <svg viewBox="0 0 24 24" className="h-5 w-5">
        <polygon
          points={starPoints(12, 12, 11, 4.5, 4)}
          fill="currentColor"
        />
      </svg>
      <span className="h-px w-16 bg-gradient-to-l from-transparent to-amber-200/40 sm:w-24" />
    </div>
  );
}

// Falling snowflakes: [x %, size px, fall seconds, delay s, drift px, spin deg].
const FLAKES = [
  [6, 16, 22, 0, 30, 180], [16, 12, 28, 6, -20, -120], [27, 18, 25, 12, 25, 200],
  [38, 10, 30, 3, -30, 140], [52, 14, 26, 15, 20, -160], [63, 17, 24, 8, -25, 190],
  [74, 12, 29, 18, 30, -140], [85, 16, 23, 5, -20, 170], [94, 13, 27, 11, 25, -180],
];

// Candy canes drift down more slowly and only near the sides.
const CANES = [
  [5, 36, 38, 2, 20, 40], [91, 41, 42, 14, -25, -45],
  [14, 31, 46, 24, -15, 35], [82, 34, 40, 30, 20, -35],
];

function Snowflake({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="text-sky-100">
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none">
        {[0, 60, 120].map((deg) => (
          <g key={deg} transform={`rotate(${deg} 12 12)`}>
            <line x1="12" y1="2" x2="12" y2="22" />
            <polyline points="9,5 12,8 15,5" />
            <polyline points="9,19 12,16 15,19" />
          </g>
        ))}
      </g>
    </svg>
  );
}

function CandyCane({ size }: { size: number }) {
  const d = "M10 44 V14 A7 7 0 0 1 24 14";
  return (
    <svg viewBox="0 0 34 48" width={size} height={(size * 48) / 34}>
      <path d={d} fill="none" stroke="#f5f5f5" strokeWidth="6" strokeLinecap="round" />
      <path
        d={d}
        fill="none"
        stroke="#e5484d"
        strokeWidth="6"
        strokeDasharray="4 6"
        strokeLinecap="butt"
      />
    </svg>
  );
}

// Twinkling background stars (x, y in %, size in px, animation delay in s).
const SPARKS = [
  [8, 12, 3, 0], [22, 30, 2, 1.2], [14, 58, 3, 0.6], [6, 80, 2, 2],
  [30, 90, 2, 0.9], [92, 10, 3, 0.4], [80, 26, 2, 1.8], [90, 52, 3, 1],
  [76, 74, 2, 0.2], [94, 88, 3, 1.5], [40, 8, 2, 2.2], [62, 94, 2, 0.7],
  [50, 20, 2, 1.4], [18, 44, 2, 2.4], [84, 40, 2, 0.3],
];

// A thin line that fades out at one end, used on either side of a title.
function Ornament({ flip }: { flip?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`h-px w-14 ${
        flip
          ? "bg-gradient-to-l from-transparent to-white/30"
          : "bg-gradient-to-r from-transparent to-white/30"
      }`}
    />
  );
}

// Full-screen credits. Opens from the "Credits" button on the Code tab; the
// Back button at the bottom (or the Esc key) closes it.
function Credits({ onClose }: CreditsProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Fade in on the next frame, and stop the page behind from scrolling.
    const frame = requestAnimationFrame(() => setVisible(true));
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);

    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Credits"
      className={`fixed inset-0 z-50 overflow-y-auto bg-[#050505] transition-opacity duration-500 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <style>{`
        @keyframes credits-twinkle { 0%,100% { opacity: .15; transform: scale(.8); } 50% { opacity: .9; transform: scale(1.2); } }
        @keyframes credits-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        @keyframes credits-fall { from { transform: translate3d(0, -12vh, 0) rotate(0deg); } to { transform: translate3d(var(--drift), 112vh, 0) rotate(var(--spin)); } }
        .credits-fall { position: absolute; top: 0; animation: credits-fall linear infinite; will-change: transform; }
        .credits-spark { animation: credits-twinkle 3.5s ease-in-out infinite; }
        .credits-float { animation: credits-float 5s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .credits-spark, .credits-float { animation: none; } .credits-fall { display: none; } }
      `}</style>

      {/* warm glow behind the star */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 h-96 bg-[radial-gradient(ellipse_at_top,rgba(255,200,100,0.12),transparent_70%)]"
      />

      {/* twinkling stars */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0">
        {SPARKS.map(([x, y, size, delay], i) => (
          <span
            key={i}
            className="credits-spark absolute rounded-full bg-amber-100"
            style={{
              left: `${x}%`,
              top: `${y}%`,
              width: size,
              height: size,
              animationDelay: `${delay}s`,
            }}
          />
        ))}
      </div>

      {/* festive snowflakes and candy canes, kept few and faint */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
        {FLAKES.map(([x, size, dur, delay, drift, spin], i) => (
          <span
            key={`f${i}`}
            className="credits-fall opacity-40"
            style={{
              left: `${x}%`,
              animationDuration: `${dur}s`,
              animationDelay: `-${delay}s`,
              ["--drift" as string]: `${drift}px`,
              ["--spin" as string]: `${spin}deg`,
            }}
          >
            <Snowflake size={size} />
          </span>
        ))}
        {CANES.map(([x, size, dur, delay, drift, spin], i) => (
          <span
            key={`c${i}`}
            className="credits-fall opacity-60"
            style={{
              left: `${x}%`,
              animationDuration: `${dur}s`,
              animationDelay: `-${delay}s`,
              ["--drift" as string]: `${drift}px`,
              ["--spin" as string]: `${spin}deg`,
            }}
          >
            <CandyCane size={size} />
          </span>
        ))}
      </div>

      <div className="relative mx-auto flex min-h-full max-w-2xl flex-col items-center px-6 py-12 text-center sm:py-16">
        <ParolStar />

        <div className="mb-12 mt-6 flex items-center gap-5 sm:mb-16">
          <Ornament />
          <h2 className="font-serif text-2xl uppercase tracking-[0.4em] text-white sm:text-4xl">
            Credits
          </h2>
          <Ornament flip />
        </div>

        <div className="flex flex-col items-center gap-12 sm:gap-14">
          {GROUPS.map((group, index) => (
            <div key={group.title} className="flex flex-col items-center gap-12 sm:gap-14">
              {index > 0 && <StarDivider />}
              <section className="flex flex-col items-center">
                <p className="mb-6 text-sm uppercase tracking-[0.35em] text-amber-200/70 sm:text-base">
                  {group.title}
                </p>
                <div className="flex flex-col items-center gap-4 sm:gap-5">
                  {group.names.map(({ name }) => (
                    <p
                      key={name}
                      className="font-serif text-[22.5px] text-white/90 sm:text-4xl"
                    >
                      {name}
                    </p>
                  ))}
                </div>
              </section>
            </div>
          ))}
        </div>

        {/* mt-auto keeps Back at the very bottom on tall screens */}
        <div className="mt-auto pt-16">
          <button
            onClick={onClose}
            className="flex cursor-pointer items-center gap-4 rounded-full border border-white/20 px-8 py-3 text-base uppercase tracking-[0.35em] text-white/80 transition hover:border-white/50 hover:text-white"
          >
            <Ornament />
            Back
            <Ornament flip />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default Credits;
