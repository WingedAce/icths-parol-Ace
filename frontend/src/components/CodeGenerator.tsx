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

function generateSketch(
  pins: number[],
  build: SequenceBuild,
  analysis: AudioAnalysis | undefined,
  loop: boolean,
): string {
  const pinList = pins.join(", ");
  const durationMs = analysis ? Math.round(analysis.duration * 1000) : 0;
  const lastEventMs = build.events.reduce(
    (latest, e) => Math.max(latest, e.timeMs),
    0,
  );
  const loopMs = Math.max(durationMs, lastEventMs);

  type Row = { wait: number; pin: number; value: number };
  const allRows: Row[] = [];
  let previousMs = 0;
  for (const e of build.events) {
    let wait = e.timeMs - previousMs;
    while (wait > 65535) {
      allRows.push({ wait: 65535, pin: 255, value: 0 });
      wait -= 65535;
    }
    allRows.push({ wait, pin: e.pin, value: e.value });
    previousMs = e.timeMs;
  }

  const tables: string[] = [];
  for (let start = 0; start < allRows.length; start += ROWS_PER_TABLE) {
    const lines: string[] = [];
    for (const r of allRows.slice(start, start + ROWS_PER_TABLE)) {
      lines.push(`  { ${r.wait}, ${r.pin}, ${r.value} },`);
    }
    tables.push(
      `const Event SHOW${tables.length}[] PROGMEM = {\n${lines.join("\n")}\n};`,
    );
  }

  const showTable =
    allRows.length > 0
      ? `${tables.join("\n\n")}

const uint32_t SHOW_LENGTH = ${allRows.length};
const uint16_t ROWS_PER_TABLE = ${ROWS_PER_TABLE};

uint32_t tableAddress(uint8_t t) {
  switch (t) {
${tables.map((_, i) => `    case ${i}: return pgm_get_far_address(SHOW${i});`).join("\n")}
  }
  return 0;
}`
      : `const uint32_t SHOW_LENGTH = 0;
const uint16_t ROWS_PER_TABLE = ${ROWS_PER_TABLE};
uint32_t tableAddress(uint8_t) { return 0; }`;

  return `#include <avr/pgmspace.h>

const uint8_t LED_PINS[] = { ${pinList} };
const uint16_t START_DELAY_MS = ${AUTO_START_DELAY_MS};
${loop ? `const uint32_t LOOP_LENGTH_MS = ${loopMs};\n` : ""}
struct Event {
  uint16_t waitMs;
  uint8_t pin;
  uint8_t value;
};

${showTable}

bool running = false;
uint32_t startTime = 0;
uint32_t nextRow = 0;
uint32_t rowTime = 0;

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
    if (e.pin != 255) analogWrite(e.pin, e.value);
    nextRow++;
  }

  if (now < LOOP_LENGTH_MS) return;

  allOff();
  nextRow = 0;
  rowTime = 0;
  startTime += LOOP_LENGTH_MS;
  Serial.println(F("Show restarted"));
}
`
      : `void loop() {
  if (!running) return;

  uint32_t now = millis() - startTime;

  while (nextRow < SHOW_LENGTH) {
    Event e;
    readRow(nextRow, e);
    uint32_t at = rowTime + e.waitMs;
    if (at > now) return;
    rowTime = at;
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
      generateSketch(pins, result, audioAnalysis, loopShow),
    );
  }

  function handleLoopChange(next: boolean) {
    setLoopShow(next);
    if (build && code) {
      setCode(
        generateSketch(pins, build, audioAnalysis, next),
      );
    }
  }

  const sketchName = `arduino_sketch_round${round}${loopShow ? "_loop" : ""}.ino`;

  const loopToggle = (
    <div className="flex max-w-md flex-col items-center gap-1 text-center">
      <label className="flex cursor-pointer items-center gap-3 text-xs text-fg-soft">
        <input
          type="checkbox"
          checked={loopShow}
          onChange={(event) => handleLoopChange(event.target.checked)}
          className="h-4 w-4 cursor-pointer accent-pine"
        />
        Play on a loop until the Arduino is disconnected from power
      </label>
      {loopShow && (
        <p className="text-xs text-fg-muted">
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
          <p className="font-medium text-fg-soft">
            You are done with the process, tap the button below to generate
            your code
          </p>

          {pinMappings.length === 0 && (
            <p className="text-xs text-fg-muted">
              No pins assigned yet — assign pins in the Zone Map first so the
              generated code has something to control.
            </p>
          )}

          {problems.length > 0 && (
            <div className="flex flex-col gap-1 text-xs text-holly-soft">
              {problems.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
          )}

          {parolWarning && (
            <p className="text-xs text-warn">⚠ {parolWarning}</p>
          )}

          <p className="max-w-md text-center text-xs text-fg-muted">
            Heads up: the lights start {AUTO_START_DELAY_MS / 1000} seconds
            after you press the RESET button on the Arduino.
          </p>

          {loopToggle}

          <button
            onClick={handleGenerate}
            disabled={!hasPins}
            className="cursor-pointer rounded-xl bg-fg px-6 py-3 font-medium text-canvas transition hover:bg-fg/90 disabled:cursor-default disabled:opacity-50"
          >
            Generate Arduino code
          </button>
        </div>
      ) : (
        <div className="flex w-full flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-fg-muted">
              {sketchName}
            </p>

            <div className="flex gap-2">
              <button
                onClick={handleCopy}
                className="cursor-pointer rounded-full px-4 py-1.5 text-xs text-fg-soft transition hover:text-fg bg-elevated hover:bg-line-strong"
              >
                {copyState === "copied"
                  ? "Copied!"
                  : copyState === "failed"
                    ? "Couldn't copy"
                    : "Copy"}
              </button>
              <button
                onClick={handleDownload}
                className="cursor-pointer rounded-full px-4 py-1.5 text-xs text-fg-soft transition hover:text-fg bg-elevated hover:bg-line-strong"
              >
                Download .ino
              </button>
            </div>
          </div>

          <div className="flex justify-center">{loopToggle}</div>

          <div className="overflow-hidden rounded-xl bg-surface">
            <pre className="codebox-scroll max-h-[28rem] overflow-y-auto px-5 py-4 font-mono text-[12.5px] leading-relaxed text-fg">
              <code>{code}</code>
            </pre>
          </div>

          {build && (
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="text-xs text-fg-muted">
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
                <p className="text-xs text-warn">
                  No lights are scheduled yet, so this sketch will NOT turn
                  anything on. Upload the song and turn pins on in the
                  keyframes first.
                </p>
              )}
              {[...(parolWarning ? [parolWarning] : []), ...build.warnings].map((w) => (
                <p key={w} className="text-xs text-warn">
                  ⚠ {w}
                </p>
              ))}
              <p className="text-xs text-fg-muted">
                {`Heads up: the lights start ${AUTO_START_DELAY_MS / 1000} seconds after you press the RESET button on the Arduino. Press play on the song when they start.`}
                {(audioAnalysis?.clipStart ?? 0) > 0 &&
                  ` Play the song from ${formatClock(audioAnalysis?.clipStart ?? 0)}, the part you picked on the Song tab.`}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="mt-12 flex w-full flex-col items-center gap-4 border-t border-line pt-10">
        <p className="text-xs text-fg-muted">
          Behind the Website
        </p>
        <button
          onClick={() => setShowCredits(true)}
          className="credits-btn group cursor-pointer rounded-xl border px-12 py-4 font-medium text-lg text-fg transition hover:bg-line-strong hover: sm:px-16 sm:text-xl border-transparent bg-line-strong"
        >
          <span className="mr-3 text-warn transition group-hover:text-fg-soft">
            ✦
          </span>
          Credits
          <span className="ml-3 text-warn transition group-hover:text-fg-soft">
            ✦
          </span>
        </button>
        <p className="text-xs text-fg-muted">
          Tap to meet the students
        </p>
      </div>

      {showCredits && <Credits onClose={() => setShowCredits(false)} />}
    </div>
  );
}

export default CodeGenerator;
