import { describe, it, expect } from "vitest";
import { createLoadGate } from "./loadGate";

/**
 * Mirrors how AppContext's persist() consults the gate: refuse the write
 * entirely when the gate is closed, so a mutator can never stamp an
 * in-memory default over what storage already holds.
 */
function guardedWrite(gate: ReturnType<typeof createLoadGate>, store: Map<string, string>, key: string, value: string) {
  if (!gate.canWrite()) return;
  store.set(key, value);
}

describe("createLoadGate", () => {
  it("refuses writes before anything has loaded", () => {
    const gate = createLoadGate();
    expect(gate.canWrite()).toBe(false);
  });

  it("allows writes once the load has succeeded", () => {
    const gate = createLoadGate();
    gate.succeed();
    expect(gate.canWrite()).toBe(true);
  });

  it("stays closed forever when succeed() is never called — the failed-load case", () => {
    // AppContext's loadData calls succeed() only on its happy path. A load
    // that throws simply never reaches it, which is what this guards against.
    const gate = createLoadGate();
    gate.canWrite();
    gate.canWrite();
    expect(gate.canWrite()).toBe(false);
  });

  it("a mutator can never overwrite existing stored data after a failed load", () => {
    const store = new Map([["habit_definitions", "[{\"id\":\"h1\"}]"]]);
    const gate = createLoadGate();
    // The load throws before calling succeed() — e.g. the schema migration
    // rejected. In-memory state is still the empty default [].
    guardedWrite(gate, store, "habit_definitions", JSON.stringify([]));
    expect(store.get("habit_definitions")).toBe("[{\"id\":\"h1\"}]");
  });

  it("a mutator writes normally once the load has succeeded", () => {
    const store = new Map<string, string>();
    const gate = createLoadGate();
    gate.succeed();
    guardedWrite(gate, store, "habit_definitions", JSON.stringify([{ id: "h2" }]));
    expect(store.get("habit_definitions")).toBe("[{\"id\":\"h2\"}]");
  });
});


describe("restoreFromBackup-shaped guard", () => {
  // AppContext.tsx itself cannot be imported into vitest (react-native's
  // entry fails to parse under Node), so this mirrors restoreFromBackup's
  // actual shape: check the gate before touching EITHER React state or
  // storage, and refuse outright rather than partially applying the merge.
  function simulateRestore(
    gate: ReturnType<typeof createLoadGate>,
    store: Map<string, string>,
    setState: (v: unknown[]) => void,
    merged: { habitDefinitions: unknown[] },
  ) {
    if (!gate.canWrite()) return;
    setState(merged.habitDefinitions);
    guardedWrite(gate, store, "habit_definitions", JSON.stringify(merged.habitDefinitions));
  }

  it("a blocked restore leaves stored data AND in-memory state untouched", () => {
    const store = new Map([["habit_definitions", "[{\"id\":\"h1\"}]"]]);
    let reactState: unknown[] = [{ id: "h1" }];
    const gate = createLoadGate(); // never succeeded — the failed-load case

    // A restore attempt whose merge was built on empty local defaults.
    simulateRestore(gate, store, v => { reactState = v; }, { habitDefinitions: [] });

    expect(store.get("habit_definitions")).toBe("[{\"id\":\"h1\"}]");
    expect(reactState).toEqual([{ id: "h1" }]);
  });

  it("an allowed restore updates both storage and in-memory state", () => {
    const store = new Map<string, string>();
    let reactState: unknown[] = [];
    const gate = createLoadGate();
    gate.succeed();

    simulateRestore(gate, store, v => { reactState = v; }, { habitDefinitions: [{ id: "h2" }] });

    expect(store.get("habit_definitions")).toBe("[{\"id\":\"h2\"}]");
    expect(reactState).toEqual([{ id: "h2" }]);
  });
});


describe("restoreFromBackup-shaped partial-failure reporting", () => {
  // Mirrors restoreFromBackup's actual reporting logic: persist() resolves a
  // boolean per write (it swallows the real AsyncStorage error itself), so a
  // caller with a status field to fill in must check the results rather than
  // just awaiting Promise.all and assuming success.
  async function runNamedWrites(
    writes: [string, Promise<boolean>][],
  ): Promise<{ status: "success" | "error"; error: string | null }> {
    const results = await Promise.all(writes.map(([, p]) => p));
    const failed = writes.filter((_, i) => !results[i]).map(([label]) => label);
    if (failed.length > 0) {
      return {
        status: "error",
        error: `Restored data is on screen, but ${failed.join(", ")} did not save to this device.`,
      };
    }
    return { status: "success", error: null };
  }

  it("reports success when every write lands", async () => {
    const result = await runNamedWrites([
      ["check-in log", Promise.resolve(true)],
      ["habits", Promise.resolve(true)],
    ]);
    expect(result).toEqual({ status: "success", error: null });
  });

  it("reports an error naming the collection when one write fails — not success", async () => {
    // e.g. localStorage's quota rejected mid-restore on the "habits" write;
    // persist() swallows that and resolves false rather than rejecting.
    const result = await runNamedWrites([
      ["check-in log", Promise.resolve(true)],
      ["habits", Promise.resolve(false)],
    ]);
    expect(result.status).toBe("error");
    expect(result.error).toContain("habits");
  });
});
