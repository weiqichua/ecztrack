/**
 * Guards writes against a load that never actually finished.
 *
 * Every mutator in AppContext sets state optimistically and then persists
 * it. If the initial read from storage threw partway through, every state
 * array is still sitting at its empty default — persisting from there
 * would stamp that emptiness over whatever storage already holds, deleting
 * it. `persist()` is the one path every mutator writes through, so a gate
 * checked there is a guarantee, not a convention each mutator has to
 * remember.
 *
 * A gate starts closed and opens only on an explicit `succeed()`. There is
 * no `fail()`: a failed load simply never calls `succeed()`, so the gate
 * stays closed until the next full load attempt.
 */
export interface LoadGate {
  succeed(): void;
  canWrite(): boolean;
}

export function createLoadGate(): LoadGate {
  let loaded = false;
  return {
    succeed() {
      loaded = true;
    },
    canWrite() {
      return loaded;
    },
  };
}
