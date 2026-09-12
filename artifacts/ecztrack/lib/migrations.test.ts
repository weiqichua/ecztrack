import { describe, it, expect } from "vitest";
import { runSchemaMigration, SCHEMA_VERSION_KEY } from "./migrations";
import { STORAGE_KEYS, WIPE_STORAGE_KEYS } from "./storageKeys";

/** In-memory stand-in for AsyncStorage, scoped to exactly what the migration needs. */
function makeStore(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: async (key: string) => (data.has(key) ? data.get(key)! : null),
    setItem: async (key: string, value: string) => { data.set(key, value); },
    removeItem: async (key: string) => { data.delete(key); },
  };
}

const WIPE_KEYS = WIPE_STORAGE_KEYS;
const HABIT_KEYS = [STORAGE_KEYS.HABIT_DEFINITIONS, STORAGE_KEYS.HABIT_LOGS];

describe("WIPE_STORAGE_KEYS", () => {
  it("is exactly the five stale keys, and never a habit key", () => {
    // This is the literal list AppContext passes to runSchemaMigration. A test
    // that re-typed these as string literals would prove nothing about what
    // the app actually wipes — this asserts against the real constants.
    expect([...WIPE_STORAGE_KEYS].sort()).toEqual(
      [
        STORAGE_KEYS.CONSUMPTION_LOGS,
        STORAGE_KEYS.SYMPTOM_LOGS,
        STORAGE_KEYS.SCRATCH_LOGS,
        STORAGE_KEYS.CUSTOM_FOODS,
        STORAGE_KEYS.PHASE_CONFIG,
      ].sort(),
    );
    expect(WIPE_STORAGE_KEYS).not.toContain(STORAGE_KEYS.HABIT_DEFINITIONS);
    expect(WIPE_STORAGE_KEYS).not.toContain(STORAGE_KEYS.HABIT_LOGS);
  });
});

describe("runSchemaMigration", () => {
  it("clears the listed keys when no version has been stamped yet", async () => {
    const store = makeStore({
      [STORAGE_KEYS.CONSUMPTION_LOGS]: "[1,2,3]",
      [STORAGE_KEYS.HABIT_DEFINITIONS]: "[{\"id\":\"h1\"}]",
    });
    await runSchemaMigration(store, WIPE_KEYS);
    expect(store.data.has(STORAGE_KEYS.CONSUMPTION_LOGS)).toBe(false);
    expect(store.data.get(STORAGE_KEYS.HABIT_DEFINITIONS)).toBe("[{\"id\":\"h1\"}]");
  });

  it("clears the listed keys when the stored version is below 4", async () => {
    const store = makeStore({ [SCHEMA_VERSION_KEY]: "3", [STORAGE_KEYS.SYMPTOM_LOGS]: "[9]" });
    await runSchemaMigration(store, WIPE_KEYS);
    expect(store.data.has(STORAGE_KEYS.SYMPTOM_LOGS)).toBe(false);
    expect(store.data.get(SCHEMA_VERSION_KEY)).toBe("4");
  });

  it("keeps habit definitions and habit logs untouched", async () => {
    const store = makeStore({
      [STORAGE_KEYS.HABIT_DEFINITIONS]: "[{\"id\":\"h1\"}]",
      [STORAGE_KEYS.HABIT_LOGS]: "[{\"id\":\"l1\"}]",
      [STORAGE_KEYS.CONSUMPTION_LOGS]: "[1]",
    });
    await runSchemaMigration(store, WIPE_KEYS);
    for (const key of HABIT_KEYS) {
      expect(store.data.has(key)).toBe(true);
    }
  });

  it("stamps the version after wiping", async () => {
    const store = makeStore();
    await runSchemaMigration(store, WIPE_KEYS);
    expect(await store.getItem(SCHEMA_VERSION_KEY)).toBe("4");
  });

  it("is idempotent — a second run touches nothing further", async () => {
    const store = makeStore({ [STORAGE_KEYS.CONSUMPTION_LOGS]: "[1]" });
    await runSchemaMigration(store, WIPE_KEYS);
    // Re-seed a key as if the user had logged something new after the wipe.
    await store.setItem(STORAGE_KEYS.CONSUMPTION_LOGS, "[\"fresh\"]");
    await runSchemaMigration(store, WIPE_KEYS);
    expect(await store.getItem(STORAGE_KEYS.CONSUMPTION_LOGS)).toBe("[\"fresh\"]");
    expect(await store.getItem(SCHEMA_VERSION_KEY)).toBe("4");
  });

  it("does not wipe when the stored version already meets 4", async () => {
    const store = makeStore({ [SCHEMA_VERSION_KEY]: "4", [STORAGE_KEYS.CONSUMPTION_LOGS]: "[1]" });
    await runSchemaMigration(store, WIPE_KEYS);
    expect(await store.getItem(STORAGE_KEYS.CONSUMPTION_LOGS)).toBe("[1]");
  });
});
