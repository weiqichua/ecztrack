/**
 * Holds the newest version of one collection, readable synchronously.
 *
 * The screens that save on every tap — the home page's check-in boxes, the
 * habit tiles — can land two saves inside one render. Reading React state in
 * the mutator gives the pre-tap array to both, and the second write discards
 * the first tap's change. Reading a `setState` updater's `prev` fixes that for
 * state but not for persistence: when the fiber already has a pending update
 * the updater is deferred to render, so anything the mutator assigned out of
 * it is still its initialiser when it persists — which writes an empty array
 * over the whole collection. That exact bug shipped here once.
 *
 * So the cell is the mutator's source of truth for both: updated synchronously
 * before React sees anything, which makes each call fold onto the previous
 * one's result and gives `persist` a real value to write.
 *
 * `set` publishes to React as well as to the cell, deliberately: a call site
 * that set state without the cell would leave the cell stale, and the next tap
 * would rebuild from an old array and resurrect deleted entries. There is one
 * way to publish, and it does both halves.
 *
 * Generic because two collections need it. The provider must hold each cell in
 * a lazily-initialised `useRef`, never a `useMemo`: React may discard a memo's
 * cache while the `useState` beside it survives, which reseeds the cell at its
 * initialiser and reproduces the same wipe. Ref contents are never discarded.
 */
export interface LogCell<T> {
  get(): T[];
  set(logs: T[]): void;
}

export function createLogCell<T>(
  initial: T[],
  publish: (logs: T[]) => void,
): LogCell<T> {
  let current = initial;
  return {
    get: () => current,
    set(logs: T[]) {
      current = logs;
      publish(logs);
    },
  };
}
