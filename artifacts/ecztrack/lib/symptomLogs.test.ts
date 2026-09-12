import { describe, it, expect } from "vitest";
import { applyCheckin, createLogCell, upsertSymptomLog } from "./symptomLogs";
import type { SymptomLog } from "@/constants/types";

/** A counter rather than the real generator, so an id is readable in a failure. */
function idGen(prefix = "new") {
  let n = 0;
  return () => `${prefix}${++n}`;
}

describe("upsertSymptomLog", () => {
  it("creates the day's first log", () => {
    const out = upsertSymptomLog([], { date: "2026-08-17", scores: { s_itch: 4 } }, "elimination", idGen());
    expect(out).toEqual([
      { id: "new1", date: "2026-08-17", phase: "elimination", scores: { s_itch: 4 } },
    ]);
  });

  it("folds a second score onto an existing day without disturbing the first", () => {
    const day: SymptomLog = { id: "s1", date: "2026-08-17", phase: "none", scores: { s_itch: 4 } };
    const out = upsertSymptomLog([day], { date: "2026-08-17", scores: { s_heat: 2 } }, "none", idGen());
    expect(out).toHaveLength(1);
    expect(out[0].scores).toEqual({ s_itch: 4, s_heat: 2 });
  });

  it("keeps the existing log's id rather than minting a new one", () => {
    // The id is what the Firestore write and every local reference key off, so
    // a re-save that re-mints it would fork the day into two records.
    const day: SymptomLog = { id: "s1", date: "2026-08-17", scores: {} };
    const out = upsertSymptomLog([day], { date: "2026-08-17", scores: { s_itch: 1 } }, "none", idGen());
    expect(out[0].id).toBe("s1");
  });

  it("stamps the phase it is given over the one the incoming check-in carries", () => {
    // The ledger always wins. If the incoming log's own `phase` could outrank
    // it — a spread order of `{ id, phase, ...log }` is all it takes — this is
    // the "log's phase beats the ledger" bug this branch already fixed once.
    const out = upsertSymptomLog(
      [],
      { date: "2026-08-17", phase: "elimination", scores: {} } as Omit<SymptomLog, "id">,
      "challenge",
      idGen(),
    );
    expect(out[0].phase).toBe("challenge");
  });

  it("stamps the phase it is given over whatever the log stored", () => {
    // The ledger is authoritative for a day's phase; the log's own copy is only
    // a fallback for readers, never a source the upsert should preserve.
    const day: SymptomLog = { id: "s1", date: "2026-08-17", phase: "none", scores: {} };
    const out = upsertSymptomLog([day], { date: "2026-08-17", scores: {} }, "challenge", idGen());
    expect(out[0].phase).toBe("challenge");
  });

  it("clears a stored score when the incoming map holds an explicit null", () => {
    const day: SymptomLog = { id: "s1", date: "2026-08-17", scores: { s_itch: 4 } };
    const out = upsertSymptomLog([day], { date: "2026-08-17", scores: { s_itch: null } }, "none", idGen());
    expect(out[0].scores).toEqual({ s_itch: null });
  });

  it("keeps an archived symptom's score through a re-save that never mentioned it", () => {
    const day: SymptomLog = { id: "s1", date: "2026-08-17", scores: { s_itch: 4, s_archived: 2 } };
    const out = upsertSymptomLog([day], { date: "2026-08-17", scores: { s_itch: 5 } }, "none", idGen());
    expect(out[0].scores).toEqual({ s_itch: 5, s_archived: 2 });
  });

  it("leaves other days alone", () => {
    const other: SymptomLog = { id: "s0", date: "2026-08-16", scores: { s_itch: 1 } };
    const out = upsertSymptomLog([other], { date: "2026-08-17", scores: { s_itch: 5 } }, "none", idGen());
    expect(out).toHaveLength(2);
    expect(out.find(l => l.date === "2026-08-16")).toEqual(other);
  });

  it("keeps both scores when two calls are chained through each other's result", () => {
    // This is the whole reason the function is pure. Two boxes tapped faster
    // than React commits the first update must both survive, which they only do
    // if the second fold builds on the first's output — i.e. if the mutator
    // calls this from inside a setState updater rather than over a captured
    // array. Built from the same starting array instead (below), the second
    // write silently discards the first.
    const start: SymptomLog[] = [];
    const gen = idGen();
    const first = upsertSymptomLog(start, { date: "2026-08-17", scores: { s_itch: 4 } }, "none", gen);
    const chained = upsertSymptomLog(first, { date: "2026-08-17", scores: { s_heat: 2 } }, "none", gen);
    expect(chained).toHaveLength(1);
    expect(chained[0].scores).toEqual({ s_itch: 4, s_heat: 2 });

    const raced = upsertSymptomLog(start, { date: "2026-08-17", scores: { s_heat: 2 } }, "none", gen);
    expect(raced[0].scores).toEqual({ s_heat: 2 });
  });

  it("tolerates a stored log whose score map is malformed", () => {
    const day = { id: "s1", date: "2026-08-17", scores: undefined } as unknown as SymptomLog;
    const out = upsertSymptomLog([day], { date: "2026-08-17", scores: { s_itch: 3 } }, "none", idGen());
    expect(out[0].scores).toEqual({ s_itch: 3 });
  });
});

describe("createLogCell", () => {
  it("reads back what was set, synchronously", () => {
    const cell = createLogCell<SymptomLog>([], () => {});
    const logs: SymptomLog[] = [{ id: "s1", date: "2026-08-17", scores: {} }];
    cell.set(logs);
    expect(cell.get()).toBe(logs);
  });

  it("publishes every set to React state as well as to the cell", () => {
    // The two halves are one operation on purpose: a site that sets state
    // without the cell leaves the cell stale, and the next check-in rebuilds
    // from an old array.
    const published: SymptomLog[][] = [];
    const cell = createLogCell<SymptomLog>([], logs => published.push(logs));
    cell.set([{ id: "s1", date: "2026-08-17", scores: {} }]);
    cell.set([]);
    expect(published).toEqual([[{ id: "s1", date: "2026-08-17", scores: {} }], []]);
  });
});

describe("applyCheckin", () => {
  /**
   * A cell whose publisher does nothing, which is exactly what React does when
   * the fiber already has a pending update: state does not change during this
   * call, so anything the mutator needs *now* has to come from the cell.
   */
  function deferredCell(initial: SymptomLog[] = []) {
    return createLogCell(initial, () => {});
  }

  it("hands the persist step the full array, never an empty one", () => {
    // This is the test that fails on the pattern that shipped: it assigned the
    // array out of a `setSymptomLogs` updater, so on a second tap before the
    // first commit `persist` was handed the `[]` initialiser and wrote it over
    // every day of history.
    const cell = deferredCell();
    const gen = idGen();
    const persisted = [
      applyCheckin(cell, { date: "2026-08-17", scores: { s_itch: 4 } }, "none", gen),
      applyCheckin(cell, { date: "2026-08-17", scores: { s_heat: 2 } }, "none", gen),
      applyCheckin(cell, { date: "2026-08-18", scores: { s_itch: 1 } }, "none", gen),
    ];
    expect(persisted.map(p => p.length)).toEqual([1, 1, 2]);
    for (const p of persisted) expect(p).not.toHaveLength(0);
    expect(persisted[2]).toEqual(cell.get());
  });

  it("keeps both scores when two calls land with no commit in between", () => {
    const cell = deferredCell();
    const gen = idGen();
    applyCheckin(cell, { date: "2026-08-17", scores: { s_itch: 4 } }, "none", gen);
    const second = applyCheckin(cell, { date: "2026-08-17", scores: { s_heat: 2 } }, "none", gen);
    expect(second).toHaveLength(1);
    expect(second[0].scores).toEqual({ s_itch: 4, s_heat: 2 });
  });

  it("builds on a cell resynced from outside", () => {
    // A load or a restore replaces the collection wholesale. The next check-in
    // must fold onto what landed, not onto what the cell held before it.
    const cell = deferredCell([{ id: "old", date: "2026-08-17", scores: { s_itch: 4 } }]);
    cell.set([{ id: "restored", date: "2026-08-17", scores: { s_heat: 5 } }]);
    const out = applyCheckin(cell, { date: "2026-08-17", scores: { s_itch: 1 } }, "none", idGen());
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("restored");
    expect(out[0].scores).toEqual({ s_heat: 5, s_itch: 1 });
  });

  it("does not resurrect a log the cell no longer holds", () => {
    const cell = deferredCell([{ id: "s1", date: "2026-08-17", scores: { s_itch: 4 } }]);
    cell.set([]); // deleteSymptomLog
    const out = applyCheckin(cell, { date: "2026-08-18", scores: { s_itch: 2 } }, "none", idGen());
    expect(out.map(l => l.date)).toEqual(["2026-08-18"]);
  });
});
