import { useState } from "react";

import Credits from "./Credits.tsx";

import type {
  AudioAnalysis,
  BpmChange,
  Frame,
  PinMapping,
  TricolorGroup,
  Zone,
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
import {
  MAX_SHOW_ROWS,
  ROWS_PER_TABLE,
  buildSequence,
  type SequenceBuild,
} from "../utils/sequenceExport";

type CodeGeneratorProps = {
  pinMappings: PinMapping[];
  tricolorGroups?: TricolorGroup[];
  zones?: Zone[];
  frames?: Frame[];
  audioAnalysis?: AudioAnalysis;
  bpmChanges?: BpmChange[];
  songName: string;
  round?: number;
};


const AUTO_START_DELAY_MS = 5000;

const MEGA_MAX_PIN = 69;
const ANALOG_PIN_BASE = 54;
const RESERVED_PINS = new Set([0]);

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
        `Pin ${pin} is a USB/serial pin — pick another pin for that zone.`,
      );
    } else {
      found.add(pin);
    }
  }

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

function formatClock(seconds: number) {
  const tenths = Math.round(seconds * 10);
  const minutes = Math.floor(tenths / 600);
  const secs = Math.floor((tenths % 600) / 10);
  return `${minutes}:${String(secs).padStart(2, "0")}.${tenths % 10}`;
}

const oneLine = (text: string) => text.replace(/[\r\n]+/g, " ").trim();

function generateSketch(
  pins: number[],
  songName: string,
  build: SequenceBuild,
  analysis: AudioAnalysis | undefined,
  round: number,
  loop: boolean,
): string {
  const pinList = pins.join(", ");
  const durationMs = analysis ? Math.round(analysis.duration * 1000) : 0;
  const lastEventMs = build.events.reduce(
    (latest, e) => Math.max(latest, e.timeMs),
    0,
  );
  const loopMs = Math.max(durationMs, lastEventMs);
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
      ? "// Tricolor LEDs (pins are the RED, GREEN and BLUE legs, in this order):\n" +
        build.tricolor
          .map((g) => `//   ${g.pins.join(", ")}`)
          .join("\n") +
        "\n"
      : "";

  const withNotes = build.events.length <= 4000;
  type Row = { wait: number; pin: number; value: number; note?: string };
  const allRows: Row[] = [];
  let lastTime = -1;
  let previousMs = 0;
  for (const e of build.events) {
    let note: string | undefined;
    if (e.timeMs !== lastTime) {
      note = e.note;
      lastTime = e.timeMs;
    }
    let wait = e.timeMs - previousMs;
    while (wait > 65535) {
      allRows.push({ wait: 65535, pin: 255, value: 0 });
      wait -= 65535;
    }
    allRows.push({ wait, pin: e.pin, value: e.value, note });
    previousMs = e.timeMs;
  }

  const tables: string[] = [];
  for (let start = 0; start < allRows.length; start += ROWS_PER_TABLE) {
    const lines: string[] = [];
    for (const r of allRows.slice(start, start + ROWS_PER_TABLE)) {
      if (withNotes && r.note) lines.push(`  // ${r.note}`);
      lines.push(`  { ${r.wait}, ${r.pin}, ${r.value} },`);
    }
    tables.push(
      `const Event SHOW${tables.length}[] PROGMEM = {\n${lines.join("\n")}\n};`,
    );
  }

  const showTable =
    allRows.length > 0
      ? `${tables.join("\n\n")}

const uint32_t SHOW_LENGTH = ${allRows.length}; // rows in total
const uint16_t ROWS_PER_TABLE = ${ROWS_PER_TABLE};

// Flash address of the start of each table.
uint32_t tableAddress(uint8_t t) {
  switch (t) {
${tables.map((_, i) => `    case ${i}: return pgm_get_far_address(SHOW${i});`).join("\n")}
  }
  return 0;
}`
      : `// No lights are scheduled yet, so there is nothing to play.
const uint32_t SHOW_LENGTH = 0;
const uint16_t ROWS_PER_TABLE = ${ROWS_PER_TABLE};
uint32_t tableAddress(uint8_t) { return 0; }`;

  const clipStart = analysis?.clipStart ?? 0;
  const playFrom =
    clipStart > 0 ? ` from ${formatClock(clipStart)}` : "";

  const startSteps = loop
    ? `//   2. The show starts by itself ${AUTO_START_DELAY_MS / 1000} seconds after the board
//      powers up or after you press its RESET button. Press play on the
//      song${playFrom} when it starts, and set the song to repeat.
//   3. LOOP MODE: the show plays again and again, every ${formatClock(loopMs / 1000)},
//      until the Arduino is disconnected from its power source.
//      (The ${AUTO_START_DELAY_MS / 1000} second wait happens only once, at power-up.)`
    : `//   2. The show starts by itself ${AUTO_START_DELAY_MS / 1000} seconds after the board
//      powers up or after you press its RESET button. Press play on the
//      song${playFrom} when it starts.
//      (Press RESET again to run the show again.)`;

  return `// I-Parol - Round ${round}
// Song: ${oneLine(songName || "untitled")}
${tempoHeader}
${clipStart > 0 ? `// Play the song from: ${formatClock(clipStart)} (the part you picked on the Song tab)\n` : ""}// Pins used: ${pinList}
${pins.includes(1) ? "// NOTE: pin 1 is the Mega's USB transmit line. Unplug the wire from pin 1 while uploading this sketch, then plug it back in.\n" : ""}${dimHeader}${tricolorHeader}//
// HOW TO USE
//   1. Upload this sketch to the Arduino Mega 2560.
${startSteps}

#include <avr/pgmspace.h>

// ---------- Settings ----------
const uint8_t LED_PINS[] = { ${pinList} };
// The show starts this long after power-up or reset.
const uint16_t START_DELAY_MS = ${AUTO_START_DELAY_MS};
${loop ? `// LOOP MODE: the show starts over after this many ms (the length of the song),\n// and keeps repeating until the Arduino loses power.\nconst uint32_t LOOP_LENGTH_MS = ${loopMs};\n` : ""}
// ---------- The light show ----------
// Each row is: ms to wait after the previous row, pin, brightness
// (0 = off, 255 = on). Pin 255 means "do nothing" (only used to wait).
// Pins without PWM can only be fully on or off. That is handled for you.
struct Event {
  uint16_t waitMs;
  uint8_t pin;
  uint8_t value;
};

// PROGMEM keeps the tables in the Mega's flash (its RAM is too small for them).
${showTable}

// ---------- Code (no need to change anything below) ----------
bool running = false;
uint32_t startTime = 0;
uint32_t nextRow = 0;
uint32_t rowTime = 0; // when the previous row played, in ms after the start

// Copies row number "index" out of flash (far access, so it works past 64 KB).
void readRow(uint32_t index, Event &e) {
  uint32_t address = tableAddress(index / ROWS_PER_TABLE) +
                     (uint32_t)(index % ROWS_PER_TABLE) * sizeof(Event);
  e.waitMs = pgm_read_word_far(address);
  e.pin = pgm_read_byte_far(address + 2);
  e.value = pgm_read_byte_far(address + 3);
}

void allOff() {
  for (uint8_t i = 0; i < sizeof(LED_PINS); i++) {
    digitalWrite(LED_PINS[i], LOW);
  }
}

void startShow() {
  allOff();
  nextRow = 0;
  rowTime = 0;
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

${
    loop
      ? `void loop() {
  uint32_t now = millis() - startTime;

  while (nextRow < SHOW_LENGTH) {
    Event e;
    readRow(nextRow, e);
    uint32_t at = rowTime + e.waitMs;
    if (at > now) return;
    rowTime = at;
    // analogWrite dims PWM pins and simply switches other pins on or off.
    if (e.pin != 255) analogWrite(e.pin, e.value);
    nextRow++;
  }

  // Every row has played. Wait out the rest of the song, then start over.
  if (now < LOOP_LENGTH_MS) return;

  allOff();
  nextRow = 0;
  rowTime = 0;
  // Adding the length (instead of reading millis() again) stops the loop
  // from slowly drifting away from the song.
  startTime += LOOP_LENGTH_MS;
  Serial.println(F("Show restarted"));
}
`
      : `void loop() {
  if (!running) return; // finished. Press RESET to run again.

  uint32_t now = millis() - startTime;

  while (nextRow < SHOW_LENGTH) {
    Event e;
    readRow(nextRow, e);
    uint32_t at = rowTime + e.waitMs;
    if (at > now) return;
    rowTime = at;
    // analogWrite dims PWM pins and simply switches other pins on or off.
    if (e.pin != 255) analogWrite(e.pin, e.value);
    nextRow++;
  }

  allOff();
  running = false;
  Serial.println(F("Show finished"));
}
`
  }`;
}

function CodeGenerator({
  pinMappings,
  tricolorGroups = [],
  zones = [],
  frames = [],
  audioAnalysis: storedAnalysis,
  bpmChanges,
  songName,
  round = 1,
}: CodeGeneratorProps) {
  const audioAnalysis = effectiveAnalysis(storedAnalysis, bpmChanges);
  const [code, setCode] = useState<string | null>(null);
  const [build, setBuild] = useState<SequenceBuild | null>(null);
  const [showCredits, setShowCredits] = useState(false);
  const [loopShow, setLoopShow] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const { pins, problems } = analyzePins(pinMappings);
  const hasPins = pins.length > 0 && problems.length === 0;

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
      zones,
    );
    setBuild(result);
    setCode(
      generateSketch(pins, songName, result, audioAnalysis, round, loopShow),
    );
  }

  function handleLoopChange(next: boolean) {
    setLoopShow(next);
    if (build && code) {
      setCode(
        generateSketch(pins, songName, build, audioAnalysis, round, next),
      );
    }
  }

  const sketchName = `arduino_sketch_round${round}${loopShow ? "_loop" : ""}.ino`;

  const loopToggle = (
    <div className="flex max-w-md flex-col items-center gap-1 text-center">
      <label className="flex cursor-pointer items-center gap-3 text-xs text-white/70">
        <input
          type="checkbox"
          checked={loopShow}
          onChange={(event) => handleLoopChange(event.target.checked)}
          className="h-4 w-4 cursor-pointer accent-amber-200"
        />
        Play on a loop until the Arduino is disconnected from power
      </label>
      {loopShow && (
        <p className="text-[11px] text-white/35">
          The show starts over every time it reaches the end of the song
          {audioAnalysis ? ` (${formatClock(audioAnalysis.duration)})` : ""}.
          Set your song to repeat as well and start both together so they stay
          in step.
        </p>
      )}
    </div>
  );

  function handleDownload() {
    if (!code) return;
    const url = URL.createObjectURL(new Blob([code], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = sketchName;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleCopy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopyState("copied");
    } catch {
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

          {loopToggle}

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
              {sketchName}
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

          <div className="flex justify-center">{loopToggle}</div>

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
                · about {Math.max(1, Math.ceil((build.events.length * 4) / 1024))} KB
                of the Mega's flash (it has about {Math.floor((MAX_SHOW_ROWS * 4) / 1024)} KB free for a show)
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
