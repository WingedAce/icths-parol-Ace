// Run with: npm test   (Node's built-in test runner, no extra packages)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  activeRun,
  clampDuration,
  DEFAULT_DURATION_MIN,
  formatClock,
  LEAD_IN_MS,
  runBeginsAt,
  runEndsAt,
  timerAt,
} from "../src/lib/specialTimer.ts";

const MIN = 60_000;
const locked = { unlocked: false, runStartedAt: null, durationMin: 15, test: null };

test("default duration is 15 minutes (900 seconds)", () => {
  assert.equal(DEFAULT_DURATION_MIN, 15);
  const run = activeRun({ ...locked, unlocked: true, runStartedAt: 1000 });
  assert.equal(run?.durationMs, 900_000);
});

test("nothing runs while locked and no test run is on", () => {
  assert.equal(activeRun(locked), null);
  assert.equal(
    activeRun({ ...locked, test: { active: false, startedAt: 5 } }),
    null,
  );
});

test("a test run is its own run and does not unlock anything", () => {
  const run = activeRun({ ...locked, test: { active: true, startedAt: 5000 } });
  assert.equal(run?.kind, "test");
  assert.equal(run?.startedAt, 5000);
});

test("the official round always wins over a test run", () => {
  const run = activeRun({
    ...locked,
    unlocked: true,
    runStartedAt: 9000,
    test: { active: true, startedAt: 5000 },
  });
  assert.equal(run?.kind, "official");
  assert.equal(run?.startedAt, 9000);
});

test("unlocked without a known start time has no timer (old database)", () => {
  assert.equal(activeRun({ ...locked, unlocked: true }), null);
});

test("remaining time counts down and hits zero exactly at the end", () => {
  const start = 1_000_000;
  const begin = start + LEAD_IN_MS; // the minutes start after GET READY!
  const run = { kind: "official" as const, startedAt: start, durationMs: 15 * MIN };
  assert.equal(timerAt(run, begin).remainingMs, 15 * MIN);
  assert.equal(timerAt(run, begin + 5 * MIN).remainingMs, 10 * MIN);
  assert.equal(timerAt(run, begin + 15 * MIN - 1).finished, false);
  const end = timerAt(run, begin + 15 * MIN);
  assert.equal(end.finished, true);
  assert.equal(end.remainingMs, 0);
  assert.equal(timerAt(run, begin + 99 * MIN).remainingMs, 0);
});

test("GET READY! lasts 15 seconds: counts 15..1, shows the full time, then starts", () => {
  assert.equal(LEAD_IN_MS, 15_000);
  const run = { kind: "official" as const, startedAt: 5_000_000, durationMs: 15 * MIN };
  assert.equal(runBeginsAt(run), 5_015_000);
  assert.equal(runEndsAt(run), 5_015_000 + 15 * MIN);
  const first = timerAt(run, 5_000_000);
  assert.equal(first.counting, true);
  assert.equal(Math.ceil(first.countdownMs / 1000), 15);
  assert.equal(first.remainingMs, 15 * MIN); // minutes have not started
  // someone who opens the tab 8 seconds in sees 7, like everyone else
  assert.equal(Math.ceil(timerAt(run, 5_000_000 + 8_000).countdownMs / 1000), 7);
  assert.equal(Math.ceil(timerAt(run, 5_014_999).countdownMs / 1000), 1);
  const go = timerAt(run, 5_015_000);
  assert.equal(go.counting, false);
  assert.equal(go.countdownMs, 0);
  assert.equal(go.finished, false);
  assert.equal(timerAt(run, 5_015_000 + 1000).remainingMs, 15 * MIN - 1000);
});

test("a clock slightly before the start never shows more than the total", () => {
  const run = { kind: "test" as const, startedAt: 1_000_000, durationMs: 15 * MIN };
  const t = timerAt(run, 1_000_000 - 3000);
  assert.equal(t.remainingMs, 15 * MIN);
  assert.equal(t.finished, false);
  assert.equal(t.counting, true);
});

test("devices with different local clocks agree once adjusted to the server", () => {
  const run = { kind: "official" as const, startedAt: 2_000_000, durationMs: 15 * MIN };
  const serverNow = 2_000_000 + LEAD_IN_MS + 7 * MIN;
  // device A is 3 minutes fast, device B is 40 seconds slow
  const aLocal = serverNow + 3 * MIN;
  const bLocal = serverNow - 40_000;
  const aOffset = serverNow - aLocal;
  const bOffset = serverNow - bLocal;
  assert.equal(
    timerAt(run, aLocal + aOffset).remainingMs,
    timerAt(run, bLocal + bOffset).remainingMs,
  );
});

test("changing the duration changes the end for everyone", () => {
  const start = 3_000_000;
  const at = start + LEAD_IN_MS + 14 * MIN;
  const before = timerAt({ kind: "official", startedAt: start, durationMs: 15 * MIN }, at);
  const after = timerAt({ kind: "official", startedAt: start, durationMs: 20 * MIN }, at);
  assert.equal(before.remainingMs, 1 * MIN);
  assert.equal(after.remainingMs, 6 * MIN);
});

test("duration is kept between 1 and 60 minutes", () => {
  assert.equal(clampDuration(0), 1);
  assert.equal(clampDuration(-5), 1);
  assert.equal(clampDuration(61), 60);
  assert.equal(clampDuration(15), 15);
  assert.equal(clampDuration(Number.NaN), 15);
});

test("clock text", () => {
  assert.equal(formatClock(15 * MIN), "15:00");
  assert.equal(formatClock(61_000), "01:01");
  assert.equal(formatClock(1), "00:01");
  assert.equal(formatClock(0), "00:00");
});

test("the deadline is still December 7, 2026, 3:00 PM Philippine time", () => {
  const src = readFileSync(
    new URL("../src/lib/specialRound.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    src,
    /SPECIAL_ROUND_DEADLINE = Date\.parse\("2026-12-07T15:00:00\+08:00"\)/,
  );
  // 3:00 PM at UTC+8 is 07:00 UTC, independent of any device's local clock.
  assert.equal(
    Date.parse("2026-12-07T15:00:00+08:00"),
    Date.UTC(2026, 11, 7, 7, 0, 0),
  );
});
