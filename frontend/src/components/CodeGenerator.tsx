import { useState } from "react";

import Credits from "./Credits.tsx";

import type {
  AudioAnalysis,
  BpmChange,
  Frame,
  PinMapping,
  TricolorGroup,
} from "../types";
import { effectiveAnalysis } from "../utils/bpmChanges";
import {
  LED_MAX_PER_PIN,
  LED_PAROL_LIMIT,
  LED_PAROL_WARN,
  formatPin,
  pinLedLoad,
  totalLeds,
} from "../utils/pins";
import { buildSequence, type SequenceBuild } from "../utils/sequenceExport";

type CodeGeneratorProps = {
  pinMappings: PinMapping[];
  tricolorGroups?: TricolorGroup[];
  frames?: Frame[];
  audioAnalysis?: AudioAnalysis;
  // BPM change points of the song. The beats used for the sketch are the
  // stored beats with these applied, same as the Preview tab.
  bpmChanges?: BpmChange[];
  songName: string;
  // Which round (1-3) this sketch is for.
  round?: number;
};

// Pin 53 stays reserved (kept free of zones) even though the sketch no longer
// uses it.
const RESERVED_PIN_53 = 53;

// The show starts by itself this long after power-up or after pressing the
// board's RESET button, so the sketch needs no extra hardware.
const AUTO_START_DELAY_MS = 5000;

// Arduino Mega 2560: digital pins 0-53, then the analog pins A0-A15 which
// are ordinary digital pins numbered 54-69 (70 total). Pins 0 and 1 are the
// USB/serial pins (they interfere with uploading), and pin 53 is kept
// reserved, so none of those can drive a zone.
const MEGA_MAX_PIN = 69;
const ANALOG_PIN_BASE = 54; // A0 === 54, A15 === 69
const RESERVED_PINS = new Set([0, 1, RESERVED_PIN_53]);

// Accepts a plain pin number (54-69 for analog) or an "A0"-"A15" label,
// and returns the Arduino pin number, or null if it can't be understood.
function normalizePin(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isInteger(raw) ? raw : null;
  if (typeof raw === "string") {
    const text = raw.trim().toUpperCase();
    const analog = /^A(\d{1,2})$/.exec(text);
    if (analog) {
      const n = Number(analog[1]);
      return n <= 15 ? ANALOG_PIN_BASE + n : null;
    }
    if (/^\d+$/.test(text)) return Number(text);
  }
  return null;
}

// Cleans the Zone Map pins into a sorted, de-duplicated list and reports
// anything that would make the sketch wrong on a Mega.
function analyzePins(pinMappings: PinMapping[]): {
  pins: number[];
  problems: string[];
} {
  const found = new Set<number>();
  const problems: string[] = [];

  for (const m of pinMappings) {
    const raw: unknown = m.pin;
    const pin = normalizePin(raw);
    if (pin === null) {
      problems.push(`"${String(raw)}" is not a valid pin.`);
    } else if (pin < 0 || pin > MEGA_MAX_PIN) {
      problems.push(`Pin ${pin} doesn't exist on a Mega (0-${MEGA_MAX_PIN}).`);
    } else if (RESERVED_PINS.has(pin)) {
      problems.push(
        pin === RESERVED_PIN_53
          ? `Pin ${pin} is reserved — pick another pin for that zone.`
          : `Pin ${pin} is a USB/serial pin — pick another pin for that zone.`,
      );
    } else {
      found.add(pin);
    }
  }

  // Same hard limit as the Zone Map: no pin may drive more than 10 LEDs.
  for (const pin of new Set(pinMappings.map((m) => m.pin))) {
    const load = pinLedLoad(pinMappings, pin);
    if (load > LED_MAX_PER_PIN) {
      problems.push(
        `Pin ${formatPin(pin)} drives ${load} LEDs; the limit is ${LED_MAX_PER_PIN}. Fix it in the Zone Map.`,
      );
    }
  }

  return {
    pins: Array.from(found).sort((a, b) => a - b),
    problems: Array.from(new Set(problems)),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// m:ss.t
function formatClock(seconds: number) {
  const tenths = Math.round(seconds * 10);
  const minutes = Math.floor(tenths / 600);
  const secs = Math.floor((tenths % 600) / 10);
  return `${minutes}:${String(secs).padStart(2, "0")}.${tenths % 10}`;
}

const oneLine = (text: string) => text.replace(/[\r\n]+/g, " ").trim();

// Builds the ready-to-upload .ino sketch. It is deliberately plain: a list of
// pins, a table of "at this millisecond, set this pin to this value", and a
// short loop that plays the table back with millis().
function generateSketch(
  pins: number[],
  songName: string,
  build: SequenceBuild,
  analysis: AudioAnalysis | undefined,
  round: number,
): string {
  const pinList = pins.join(", ");
  const durationMs = analysis ? Math.round(analysis.duration * 1000) : 0;
  const bpm = analysis ? round1(analysis.bpm) : 0;

  const segmentLines = (analysis?.tempoSegments ?? []).map(
    (seg) =>
      `//   from ${formatClock(seg.start)}: ${round1(seg.bpm)} BPM`,
  );
  const tempoHeader =
    segmentLines.length > 0
      ? `// Length: ${formatClock(durationMs / 1000)}\n// BPM changes during the song:\n${segmentLines.join("\n")}`
      : `// Length: ${formatClock(durationMs / 1000)}   BPM: ${bpm}`;

  const dimHeader =
    build.dimmablePins.length > 0
      ? `// Dimmable pins (brightness 0-255): ${build.dimmablePins.join(", ")}\n`
      : "";

  const tricolorHeader =
    build.tricolor.length > 0
      ? "// Tricolor LEDs (red, green, blue pins):\n" +
        build.tricolor
          .map((g) => `//   ${g.pins.join(", ")}`)
          .join("\n") +
        "\n"
      : "";

  // One comment line each time the time changes, then the rows for it.
  const rows: string[] = [];
  let lastTime = -1;
  for (const e of build.events) {
    if (e.timeMs !== lastTime) {
      rows.push(`  // ${e.note}`);
      lastTime = e.timeMs;
    }
    rows.push(`  { ${e.timeMs}, ${e.pin}, ${e.value} },`);
  }

  const showTable =
    rows.length > 0
      ? `const Event SHOW[] PROGMEM = {
${rows.join("\n")}
};
const uint16_t SHOW_LENGTH = sizeof(SHOW) / sizeof(Event);`
      : `// No lights are scheduled yet, so this table is empty and nothing will turn on.
const Event SHOW[1] PROGMEM = { { 0, 0, 0 } };
const uint16_t SHOW_LENGTH = 0;`;

  // The keyframe times start at 0 = the beginning of the part of the song the
  // student picked on the Song tab. If that part doesn't start at 0:00, the
  // song has to be played from there to line up with the lights.
  const clipStart = analysis?.clipStart ?? 0;
  const playFrom =
    clipStart > 0 ? ` from ${formatClock(clipStart)}` : "";

  const startSteps = `//   2. The show starts by itself ${AUTO_START_DELAY_MS / 1000} seconds after the board
//      powers up or after you press its RESET button. Press play on the
//      song${playFrom} when it starts.
//      (Press RESET again to run the show again.)`;

  return `// I-Parol - Round ${round}
// Song: ${oneLine(songName || "untitled")}
${tempoHeader}
${clipStart > 0 ? `// Play the song from: ${formatClock(clipStart)} (the part you picked on the Song tab)\n` : ""}// Pins used: ${pinList}
${dimHeader}${tricolorHeader}//
// HOW TO USE
//   1. Upload this sketch to the Arduino Mega 2560.
${startSteps}

// ---------- Settings ----------
const uint8_t LED_PINS[] = { ${pinList} };
// The show starts this long after power-up or reset.
const uint16_t START_DELAY_MS = ${AUTO_START_DELAY_MS};

// ---------- The light show ----------
// Each row is: time in ms after the start, pin, brightness (0 = off, 255 = on).
// Pins without PWM can only be fully on or off. That is handled for you.
struct Event {
  uint32_t timeMs;
  uint8_t pin;
  uint8_t value;
};

// PROGMEM keeps the table in the Mega's flash (its RAM is too small for it).
${showTable}

// ---------- Code (no need to change anything below) ----------
bool running = false;
uint32_t startTime = 0;
uint16_t nextRow = 0;

void allOff() {
  for (uint8_t i = 0; i < sizeof(LED_PINS); i++) {
    digitalWrite(LED_PINS[i], LOW);
  }
}

void startShow() {
  allOff();
  nextRow = 0;
  startTime = millis();
  running = true;
  Serial.println(F("Show started"));
}

void setup() {
  Serial.begin(9600);
  for (uint8_t i = 0; i < sizeof(LED_PINS); i++) {
    pinMode(LED_PINS[i], OUTPUT);
  }
  allOff();
  Serial.println(F("Starting in ${AUTO_START_DELAY_MS / 1000} seconds..."));
  delay(START_DELAY_MS);
  startShow();
}

void loop() {
  if (!running) return; // finished. Press RESET to run again.

  uint32_t now = millis() - startTime;

  while (nextRow < SHOW_LENGTH) {
    Event e;
    memcpy_P(&e, &SHOW[nextRow], sizeof(Event));
    if (e.timeMs > now) return;
    // analogWrite dims PWM pins and simply switches other pins on or off.
    analogWrite(e.pin, e.value);
    nextRow++;
  }

  allOff();
  running = false;
  Serial.println(F("Show finished"));
}
`;
}

function CodeGenerator({
  pinMappings,
  tricolorGroups = [],
  frames = [],
  audioAnalysis: storedAnalysis,
  bpmChanges,
  songName,
  round = 1,
}: CodeGeneratorProps) {
  // Stored beats plus the BPM change points.
  const audioAnalysis = effectiveAnalysis(storedAnalysis, bpmChanges);
  const [code, setCode] = useState<string | null>(null);
  const [build, setBuild] = useState<SequenceBuild | null>(null);
  const [showCredits, setShowCredits] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const { pins, problems } = analyzePins(pinMappings);
  const hasPins = pins.length > 0 && problems.length === 0;

  // Over the whole-parol limit is only a warning (same as the Zone Map), so
  // it never blocks generating the code.
  const parolLeds = totalLeds(pinMappings);
  const parolWarning =
    parolLeds > LED_PAROL_LIMIT
      ? `The parol has ${parolLeds} LEDs, which is over the ${LED_PAROL_LIMIT} LED limit.`
      : parolLeds >= LED_PAROL_WARN
        ? `The parol has ${parolLeds} LEDs, close to the ${LED_PAROL_LIMIT} LED limit.`
        : "";

  function handleGenerate() {
    if (!hasPins) return;
    const result = buildSequence(
      audioAnalysis,
      frames,
      pinMappings,
      tricolorGroups,
    );
    setBuild(result);
    setCode(generateSketch(pins, songName, result, audioAnalysis, round));
  }

  function handleDownload() {
    if (!code) return;
    const url = URL.createObjectURL(new Blob([code], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `arduino_sketch_round${round}.ino`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleCopy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopyState("copied");
    } catch {
      // Blocked by the browser (for example on a non-https page).
      setCopyState("failed");
    }
    setTimeout(() => setCopyState("idle"), 2500);
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center gap-6">
      {!code ? (
        <div className="flex max-w-xl flex-col items-center gap-4 text-center">
          <p className="font-serif text-white/70">
            You are done with the process, tap the button below to generate
            your code
          </p>

          {pinMappings.length === 0 && (
            <p className="text-xs text-white/25">
              No pins assigned yet — assign pins in the Zone Map first so the
              generated code has something to control.
            </p>
          )}

          {problems.length > 0 && (
            <div className="flex flex-col gap-1 text-xs text-red-300/70">
              {problems.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
          )}

          {parolWarning && (
            <p className="text-xs text-amber-300/80">⚠ {parolWarning}</p>
          )}

          <p className="max-w-md text-center text-xs text-white/40">
            Heads up: the lights start {AUTO_START_DELAY_MS / 1000} seconds
            after you press the RESET button on the Arduino.
          </p>

          <button
            onClick={handleGenerate}
            disabled={!hasPins}
            className="cursor-pointer rounded-xl bg-white px-6 py-3 font-serif text-black transition hover:bg-white/90 disabled:cursor-default disabled:opacity-50"
          >
            Generate Arduino code
          </button>
        </div>
      ) : (
        <div className="flex w-full flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-[0.3em] text-white/30">
              {`arduino_sketch_round${round}.ino`}
            </p>

            <div className="flex gap-2">
              <button
                onClick={handleCopy}
                className="cursor-pointer rounded-full border border-white/10 px-4 py-1.5 text-[11px] uppercase tracking-wider text-white/60 transition hover:border-white/25 hover:text-white"
              >
                {copyState === "copied"
                  ? "Copied!"
                  : copyState === "failed"
                    ? "Couldn't copy"
                    : "Copy"}
              </button>
              <button
                onClick={handleDownload}
                className="cursor-pointer rounded-full border border-white/10 px-4 py-1.5 text-[11px] uppercase tracking-wider text-white/60 transition hover:border-white/25 hover:text-white"
              >
                Download .ino
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
            <pre className="codebox-scroll max-h-[28rem] overflow-y-auto px-5 py-4 font-mono text-[12.5px] leading-relaxed text-white/80">
              <code>{code}</code>
            </pre>
          </div>

          {build && (
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="text-[11px] text-white/40">
                {audioAnalysis
                  ? `${
                      audioAnalysis.tempoSegments
                        ? audioAnalysis.tempoSegments
                            .map((seg) => round1(seg.bpm))
                            .join(" → ")
                        : round1(audioAnalysis.bpm)
                    } BPM · ${audioAnalysis.duration.toFixed(1)}s · `
                  : ""}
                {build.events.length} event{build.events.length === 1 ? "" : "s"}{" "}
                · about {Math.max(1, Math.ceil((build.events.length * 6) / 1024))} KB
                of the Mega's flash
              </p>
              {build.events.length === 0 && (
                <p className="text-xs text-amber-300/80">
                  No lights are scheduled yet, so this sketch will NOT turn
                  anything on. Upload the song and turn pins on in the
                  keyframes first.
                </p>
              )}
              {[...(parolWarning ? [parolWarning] : []), ...build.warnings].map((w) => (
                <p key={w} className="text-xs text-amber-300/80">
                  ⚠ {w}
                </p>
              ))}
              <p className="text-[11px] text-white/25">
                {`Heads up: the lights start ${AUTO_START_DELAY_MS / 1000} seconds after you press the RESET button on the Arduino. Press play on the song when they start.`}
                {(audioAnalysis?.clipStart ?? 0) > 0 &&
                  ` Play the song from ${formatClock(audioAnalysis?.clipStart ?? 0)}, the part you picked on the Song tab.`}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="mt-12 flex w-full flex-col items-center gap-4 border-t border-white/10 pt-10">
        <p className="text-[11px] uppercase tracking-[0.35em] text-white/40">
          Behind the Website
        </p>
        <button
          onClick={() => setShowCredits(true)}
          className="group cursor-pointer rounded-2xl border border-white/30 bg-white/[0.06] px-12 py-4 font-serif text-lg uppercase tracking-[0.3em] text-white shadow-[0_0_30px_rgba(255,255,255,0.08)] transition hover:border-white/60 hover:bg-white/[0.12] hover:shadow-[0_0_40px_rgba(255,255,255,0.18)] sm:px-16 sm:text-xl"
        >
          <span className="mr-3 text-amber-200/90 transition group-hover:text-amber-100">
            ✦
          </span>
          Credits
          <span className="ml-3 text-amber-200/90 transition group-hover:text-amber-100">
            ✦
          </span>
        </button>
        <p className="text-[11px] tracking-[0.2em] text-white/40">
          Tap to meet the students
        </p>
      </div>

      {showCredits && <Credits onClose={() => setShowCredits(false)} />}
    </div>
  );
}

export default CodeGenerator;
