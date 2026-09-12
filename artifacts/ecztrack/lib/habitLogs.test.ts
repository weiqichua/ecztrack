import { describe, it, expect } from "vitest";
import { applyHabitLog, habitValueOn, upsertHabitLog } from "./habitLogs";
import { createLogCell } from "./logCell";
import type { HabitLog } from "@/constants/types";

function idGen(prefix = "new") {
  let n = 0;
  return () => `${prefix}${++n}`;
}

const log = (habitId: string, date: string, value: number, id = `${habitId}_${date}`): HabitLog =>
  ({ id, habitId, date, value });

describe("upsertHabitLog", () => {
  it("creates the day's first entry", () => {
    expect(upsertHabitLog([], "h1", "2026-08-20", 1, idGen())).toEqual([
      { id: "new1", habitId: "h1", date: "2026-08-20", value: 1 },
    ]);
  });

  it("updates the day's entry in place, keeping its id", () => {
    const out = upsertHabitLog([log("h1", "2026-08-20", 1)], "h1", "2026-08-20", 3, idGen());
    expect(out).toEqual([{ id: "h1_2026-08-20", habitId: "h1", date: "2026-08-20", value: 3 }]);
  });

  it("removes the day's entry when the value drops to zero", () => {
    expect(upsertHabitLog([log("h1", "2026-08-20", 1)], "h1", "2026-08-20", 0, idGen())).toEqual([]);
  });

  it("leaves other habits and other days alone", () => {
    const logs = [log("h1", "2026-08-20", 1), log("h2", "2026-08-20", 1), log("h1", "2026-08-19", 1)];
    const out = upsertHabitLog(logs, "h1", "2026-08-20", 0, idGen());
    expect(out.map(l => l.id).sort()).toEqual(["h1_2026-08-19", "h2_2026-08-20"]);
  });
});

describe("applyHabitLog", () => {
  it("keeps all three of three taps that land inside one render", () => {
    // The tiles save per tap and React has not re-rendered between them, so
    // each call must fold onto the previous call's result rather than onto the
    // pre-tap array. Publishing to a stale setter is what dropped two ticks.
    const published: HabitLog[][] = [];
    const cell = createLogCell<HabitLog>([], l => published.push(l));
    applyHabitLog(cell, "h1", "2026-08-20", 1, idGen("a"));
    applyHabitLog(cell, "h2", "2026-08-20", 1, idGen("b"));
    const last = applyHabitLog(cell, "h3", "2026-08-20", 1, idGen("c"));
    expect(last.map(l => l.habitId)).toEqual(["h1", "h2", "h3"]);
    // What the caller persists and what React is handed are the same value.
    expect(published[published.length - 1]).toEqual(last);
  });

  it("does not resurrect an entry a preceding tap removed", () => {
    const cell = createLogCell<HabitLog>([log("h1", "2026-08-20", 1)], () => {});
    applyHabitLog(cell, "h1", "2026-08-20", 0, idGen());
    const out = applyHabitLog(cell, "h2", "2026-08-20", 1, idGen());
    expect(out.map(l => l.habitId)).toEqual(["h2"]);
  });
});

describe("a value derived from what is stored", () => {
  it("resolves the function against the newest array, so two count taps both land", () => {
    // The bug this pins: the screen used to compute `current + 1` from React
    // state and send the absolute number, so two taps inside one render both
    // sent the same value and two taps counted as one.
    const cell = createLogCell<HabitLog>([log("h1", "2026-08-20", 3)], () => {});
    applyHabitLog(cell, "h1", "2026-08-20", c => c + 1, idGen());
    const out = applyHabitLog(cell, "h1", "2026-08-20", c => c + 1, idGen());
    expect(habitValueOn(out, "h1", "2026-08-20")).toBe(5);
  });

  it("toggles off and back on across two taps rather than sticking", () => {
    const cell = createLogCell<HabitLog>([log("h1", "2026-08-20", 1)], () => {});
    applyHabitLog(cell, "h1", "2026-08-20", c => (c > 0 ? 0 : 1), idGen());
    const out = applyHabitLog(cell, "h1", "2026-08-20", c => (c > 0 ? 0 : 1), idGen());
    expect(habitValueOn(out, "h1", "2026-08-20")).toBe(1);
  });

  it("sees 0 for a day with no log, so the first tap on an untouched tile counts", () => {
    const out = upsertHabitLog([], "h1", "2026-08-20", c => c + 1, idGen());
    expect(habitValueOn(out, "h1", "2026-08-20")).toBe(1);
  });

  it("still accepts a plain number", () => {
    const out = upsertHabitLog([], "h1", "2026-08-20", 4, idGen());
    expect(habitValueOn(out, "h1", "2026-08-20")).toBe(4);
  });

  it("clamps a decrement at zero by removing the day's log", () => {
    const out = upsertHabitLog([log("h1", "2026-08-20", 1)], "h1", "2026-08-20", c => Math.max(0, c - 1), idGen());
    expect(out).toEqual([]);
  });
});
