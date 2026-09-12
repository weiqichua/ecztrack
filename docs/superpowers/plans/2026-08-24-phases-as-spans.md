# Phases as Spans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-day phase map with a list of phase spans, so a Challenge can be ended and can record what is being challenged, and Maintenance disappears.

**Architecture:** `PhaseLedger` becomes `{ spans: PhaseSpan[] }`, a discriminated union over `elimination` and `challenge`. A day's phase is computed by finding the span containing it, clamped to today, rather than read from a stamped map. The materialiser, the day map and `lib/ledgerSync.ts` are deleted outright.

**Tech Stack:** Expo SDK 54, React Native 0.81, expo-router, AsyncStorage (source of truth), Firebase JS SDK v12 (optional manual backup), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-phase-spans-design.md`

**Working directory:** `artifacts/ecztrack`. Run every command from there.

## Global Constraints

- **AsyncStorage stays the source of truth.** Firebase is optional; the app must run fully with no Firebase config. Never call a Firebase accessor without `isFirebaseConfigured()`.
- **All writes go through `persist()`** in `context/AppContext.tsx`. Never call `AsyncStorage.setItem` directly from a mutator.
- **All date keys come from `lib/dates.ts`.** Never `.split("T")[0]`; a source-scan test in `lib/dates.test.ts` enforces this.
- **No `Alert` from react-native.** Use `notify` / `confirmDestructive` from `lib/dialogs.ts` — react-native-web's `Alert.alert` is a complete no-op and this app runs in a browser.
- **Never put a `*.test.ts` under `app/`.** expo-router bundles every file there and the web build breaks. Screen tests go in `tests/`; lib tests sit beside their module.
- **Every new `<MciIcon name="…">` needs its path in `components/mciPaths.ts`** — `components/MciIcon.test.ts` scans source and will fail otherwise.
- **`context/AppContext.tsx` and React Native components cannot be imported under vitest** (react-native parse error; the environment is `node` with no React harness). Logic that needs a test goes in a pure `lib/` module.
- **Do NOT bump `CURRENT_SCHEMA_VERSION`.** It is 4. Raising it re-fires `runSchemaMigration`'s wipe of consumption logs, symptom logs, scratch logs and custom foods.
- **Every mutator in AppContext is a `useCallback` closed over its current array.** Do not introduce a loop over one; do not restructure the ones this plan does not name.
- Verification per task: `pnpm typecheck && pnpm test`, plus `TZ=Pacific/Chatham pnpm test` for anything date-related.

**Expect a red tree between Tasks 1 and 4.** Changing the ledger shape breaks its consumers until they are rewritten, and `pnpm typecheck` is the checklist for finding them. Each task still commits; only the final task must leave every gate green.

---

## File structure

| File | Responsibility after this plan |
|---|---|
| `constants/types.ts` | `Phase` (three members), `PhaseSpan`, `PhaseLedger` |
| `lib/phases.ts` | The whole span model: reading a day, and the four mutators |
| `lib/phaseLabels.ts` | Turning the open span into card copy |
| `lib/dayStyle.ts` | Phase palette, minus maintenance |
| `context/AppContext.tsx` | Holds the ledger, threads `todayDateKey`, exposes mutators |
| `components/PhaseStartModal.tsx` | Starting either phase; the challenge label field |
| `components/PhaseEditModal.tsx` | Ending whichever phase is open |
| `components/PhaseStatusCard.tsx` | Showing the open span |
| `lib/backup.ts` | `isEmptyLedger` over spans |
| *(deleted)* | `lib/ledgerSync.ts`, `lib/ledgerSync.test.ts` |

---

### Task 1: The span model

**Files:**
- Modify: `constants/types.ts:9` (the `Phase` union stays as-is for now), `constants/types.ts:25-37` (`PhaseLedger`)
- Rewrite: `lib/phases.ts`
- Rewrite: `lib/phases.test.ts`

**Interfaces:**
- Produces: `PhaseSpan`, `PhaseLedger { spans }`, `EMPTY_LEDGER`, `phaseOnDate(ledger, dateKey, todayKey)`, `phaseOfRecord(ledger, dateKey, todayKey, loggedPhases)`, `openSpan(ledger)`, `spanLastDay(span, todayKey)`, `scheduleElimination(ledger, startDateKey, plannedDays, newId)`, `endEliminationEarly(ledger, todayKey)`, `startChallenge(ledger, todayKey, what, newId)`, `endChallenge(ledger, todayKey)`, `eliminationDayNumber(ledger, todayKey)`, `eliminationDaysLeft(ledger, todayKey)`
- Consumes: `addDaysToKey`, `daysBetweenKeys` from `lib/dates.ts`

**Leave `Phase`'s `"maintenance"` member alone in this task.** Removing it breaks `PHASE_COLORS` in `lib/dayStyle.ts`, which Task 4 owns. Nothing in the new `lib/phases.ts` will produce it.

- [ ] **Step 1: Replace the ledger types in `constants/types.ts`**

```ts
/**
 * One run of a phase.
 *
 * A discriminated union rather than one shape with optional fields: a challenge
 * without its label is the record the analysis cannot use, so it is a compile
 * error rather than a blank chip.
 */
export type PhaseSpan =
  | { id: string; kind: "elimination"; startDate: string; plannedDays: number; endedOn: string | null }
  | { id: string; kind: "challenge";   startDate: string; what: string;        endedOn: string | null };

/**
 * Every phase ever run.
 *
 * This replaced a `Record<dateKey, Phase>` plus a single elimination record.
 * The map could not hold a challenge's label, and once challenges became a list
 * the two were duplicate representations of one history that had to agree.
 */
export interface PhaseLedger {
  /** In start order. An open span has `endedOn: null`. */
  spans: PhaseSpan[];
}
```

- [ ] **Step 2: Write the failing tests in `lib/phases.test.ts`**

Replace the file's `phaseOnDate` / `materialise` describes with these. Keep any test of `phaseOfRecord`'s `"none"` handling — that guard must survive.

```ts
const elim = (startDate: string, plannedDays: number, endedOn: string | null = null): PhaseSpan =>
  ({ id: "e1", kind: "elimination", startDate, plannedDays, endedOn });
const chal = (startDate: string, what = "dairy", endedOn: string | null = null): PhaseSpan =>
  ({ id: "c1", kind: "challenge", startDate, what, endedOn });

describe("phaseOnDate", () => {
  it("reads the start date as part of the span", () => {
    const l = { spans: [elim("2026-03-01", 14)] };
    expect(phaseOnDate(l, "2026-03-01", "2026-03-10")).toBe("elimination");
  });

  it("covers the planned last day and not the day after", () => {
    const l = { spans: [elim("2026-03-01", 14)] };
    expect(phaseOnDate(l, "2026-03-14", "2026-03-20")).toBe("elimination");
    expect(phaseOnDate(l, "2026-03-15", "2026-03-20")).toBe("none");
  });

  it("says none for a day after an elimination ended, with no maintenance", () => {
    // The whole point of dropping maintenance: the day after is blank.
    const l = { spans: [elim("2026-03-01", 14, "2026-03-04")] };
    expect(phaseOnDate(l, "2026-03-05", "2026-03-20")).toBe("none");
  });

  it("colours nothing beyond today, even inside a running span", () => {
    const l = { spans: [elim("2026-03-01", 14)] };
    expect(phaseOnDate(l, "2026-03-06", "2026-03-05")).toBe("none");
  });

  it("treats an open challenge as running up to today and no further", () => {
    const l = { spans: [chal("2026-03-01")] };
    expect(phaseOnDate(l, "2026-03-05", "2026-03-05")).toBe("challenge");
    expect(phaseOnDate(l, "2026-03-06", "2026-03-05")).toBe("none");
  });

  it("keeps each span's own days when two run back to back", () => {
    const l = { spans: [elim("2026-03-01", 4, "2026-03-04"), chal("2026-03-05")] };
    expect(phaseOnDate(l, "2026-03-04", "2026-03-10")).toBe("elimination");
    expect(phaseOnDate(l, "2026-03-05", "2026-03-10")).toBe("challenge");
  });

  it("says none in a gap between two spans", () => {
    const l = { spans: [elim("2026-03-01", 2, "2026-03-02"), chal("2026-03-09")] };
    expect(phaseOnDate(l, "2026-03-05", "2026-03-10")).toBe("none");
  });

  it("says none for a scheduled elimination that has not started", () => {
    const l = { spans: [elim("2026-03-20", 14)] };
    expect(phaseOnDate(l, "2026-03-10", "2026-03-10")).toBe("none");
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `pnpm test phases`
Expected: failures naming `phaseOnDate` — it takes two arguments, not three.

- [ ] **Step 4: Write the read path in `lib/phases.ts`**

Delete `materialise`, `walkFrom`, `phaseForDay`, `lastDayOf`, `unfinished` and the `Elimination` type alias. Write:

```ts
export const EMPTY_LEDGER: PhaseLedger = { spans: [] };

/**
 * The last day a span covers, never later than today.
 *
 * An open challenge has no planned end, and a running elimination's planned end
 * is a real future date. Neither should colour days that have not happened, so
 * both clamp — which is what the old materialiser achieved by only ever
 * stamping up to today.
 */
export function spanLastDay(span: PhaseSpan, todayKey: string): string {
  if (span.endedOn !== null) return span.endedOn;
  const planned = span.kind === "elimination"
    ? addDaysToKey(span.startDate, span.plannedDays - 1)
    : todayKey;
  return planned < todayKey ? planned : todayKey;
}

/** The span still running or scheduled, if any. At most one exists — see the mutators. */
export function openSpan(ledger: PhaseLedger): PhaseSpan | null {
  return ledger.spans.find(s => s.endedOn === null) ?? null;
}

export function phaseOnDate(ledger: PhaseLedger, dateKey: string, todayKey: string): Phase {
  const span = ledger.spans.find(
    s => dateKey >= s.startDate && dateKey <= spanLastDay(s, todayKey),
  );
  return span ? span.kind : "none";
}
```

Update `phaseOfRecord` to take `todayKey` and pass it through. **Keep its `!== "none"` check exactly as it is** — `"none"` is not nullish, and reading it as a `??` fallback made a logged phase override the ledger. That bug shipped once.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `pnpm test phases` — the read-path describes pass.

- [ ] **Step 6: Write the failing mutator tests**

```ts
describe("the mutators", () => {
  it("refuses a second span while one is open", () => {
    const l = { spans: [elim("2026-03-01", 14)] };
    expect(() => scheduleElimination(l, "2026-03-20", 14, () => "x")).toThrow();
    expect(() => startChallenge(l, "2026-03-05", "dairy", () => "x")).toThrow();
  });

  it("refuses a challenge with a blank label", () => {
    expect(() => startChallenge(EMPTY_LEDGER, "2026-03-05", "   ", () => "x")).toThrow();
  });

  it("stores the challenge label trimmed", () => {
    const l = startChallenge(EMPTY_LEDGER, "2026-03-05", "  dairy  ", () => "c9");
    expect(l.spans[0]).toMatchObject({ kind: "challenge", what: "dairy", endedOn: null });
  });

  it("ends a challenge on the day it is ended, keeping that day", () => {
    const started = startChallenge(EMPTY_LEDGER, "2026-03-01", "dairy", () => "c9");
    const ended = endChallenge(started, "2026-03-05");
    expect(phaseOnDate(ended, "2026-03-05", "2026-03-09")).toBe("challenge");
    expect(phaseOnDate(ended, "2026-03-06", "2026-03-09")).toBe("none");
  });

  it("drops a scheduled elimination cancelled before it began", () => {
    const l = scheduleElimination(EMPTY_LEDGER, "2026-03-20", 14, () => "e9");
    expect(endEliminationEarly(l, "2026-03-10").spans).toEqual([]);
  });

  it("shortens an elimination ended on one of its own days", () => {
    const l = scheduleElimination(EMPTY_LEDGER, "2026-03-01", 14, () => "e9");
    const ended = endEliminationEarly(l, "2026-03-04");
    expect(openSpan(ended)).toBeNull();
    expect(phaseOnDate(ended, "2026-03-04", "2026-03-09")).toBe("elimination");
    expect(phaseOnDate(ended, "2026-03-05", "2026-03-09")).toBe("none");
  });

  it("leaves an elimination whose plan has elapsed closed without a write", () => {
    // No materialiser: a finished elimination is finished by computation.
    const l = { spans: [elim("2026-03-01", 3)] };
    expect(phaseOnDate(l, "2026-03-04", "2026-03-20")).toBe("none");
  });
});
```

- [ ] **Step 7: Run and confirm failure, then write the mutators**

```ts
export function scheduleElimination(
  ledger: PhaseLedger, startDateKey: string, plannedDays: number, newId: () => string,
): PhaseLedger {
  if (openSpan(ledger)) {
    throw new Error("A phase is already running or scheduled. End it before starting another.");
  }
  return {
    spans: [...ledger.spans, {
      id: newId(), kind: "elimination", startDate: startDateKey, plannedDays, endedOn: null,
    }],
  };
}

export function startChallenge(
  ledger: PhaseLedger, todayKey: string, what: string, newId: () => string,
): PhaseLedger {
  if (openSpan(ledger)) {
    throw new Error("A phase is already running or scheduled. End it before starting another.");
  }
  const label = what.trim();
  // Refused rather than stored blank: an unlabelled challenge is exactly the
  // record that cannot be read back later, on the card or in an export.
  if (!label) throw new Error("Say what you are challenging.");
  return {
    spans: [...ledger.spans, {
      id: newId(), kind: "challenge", startDate: todayKey, what: label, endedOn: null,
    }],
  };
}

/** Shared by both end paths: a span cancelled before it began leaves no trace. */
function closeOpenSpan(ledger: PhaseLedger, todayKey: string, kind: PhaseSpan["kind"]): PhaseLedger {
  const open = openSpan(ledger);
  if (!open || open.kind !== kind) return ledger;
  if (todayKey < open.startDate) {
    return { spans: ledger.spans.filter(s => s.id !== open.id) };
  }
  return { spans: ledger.spans.map(s => (s.id === open.id ? { ...s, endedOn: todayKey } : s)) };
}

export function endEliminationEarly(ledger: PhaseLedger, todayKey: string): PhaseLedger {
  return closeOpenSpan(ledger, todayKey, "elimination");
}

export function endChallenge(ledger: PhaseLedger, todayKey: string): PhaseLedger {
  return closeOpenSpan(ledger, todayKey, "challenge");
}
```

Rewrite `eliminationDayNumber` and `eliminationDaysLeft` against `openSpan`, returning `null` unless the open span is an elimination covering `todayKey`. Their existing tests — start date as Day 1, the last planned day, the day after — must keep passing.

- [ ] **Step 8: Run the full suite in two timezones**

Run: `pnpm test phases && TZ=Pacific/Chatham pnpm test phases`
Expected: PASS. Other files are red; that is expected until Task 4.

- [ ] **Step 9: Mutation-check the two guards that matter**

Commit first — an untracked new file cannot be restored with `git checkout`, and that has already cost time on this repo.

1. Change `spanLastDay`'s clamp `planned < todayKey ? planned : todayKey` to `planned`. Expect the "colours nothing beyond today" and open-challenge tests to fail. Restore.
2. Change `phaseOnDate`'s `dateKey <= spanLastDay(...)` to `<`. Expect the last-planned-day and end-day tests to fail. Restore.

Record both failure counts in the task report. A mutation that leaves the suite green is a finding, not a pass.

- [ ] **Step 10: Commit**

```bash
git add constants/types.ts lib/phases.ts lib/phases.test.ts
git commit -m "Make a day's phase a span lookup rather than a stamped map"
```

---

### Task 2: Card copy for the open span

**Files:**
- Modify: `lib/phaseLabels.ts`, `lib/phaseLabels.test.ts`

**Interfaces:**
- Consumes: `openSpan`, `spanLastDay`, `eliminationDayNumber`, `eliminationDaysLeft` from Task 1
- Produces: `phaseStatus(ledger, todayKey)` returning
  `{ kind: "none" }`
  | `{ kind: "scheduled"; startDate; daysAway; label }`
  | `{ kind: "running"; phase: "elimination"; startDate; lastDay; dayNumber; totalDays; daysLeft; progress; label }`
  | `{ kind: "running"; phase: "challenge"; startDate; what; dayNumber; label }`

`eliminationStatus` is renamed to `phaseStatus` because it now answers for both kinds. Update its importers in `components/PhaseStatusCard.tsx` and `components/PhaseEditModal.tsx` — Task 4 owns their rendering, but the import must compile.

- [ ] **Step 1: Write the failing tests**

```ts
it("reports nothing running once an elimination has been ended", () => {
  // The reported bug: ending on day 4 left `running` for the rest of that day,
  // so the End button stayed live with nothing left to end.
  const l = { spans: [{ id: "e1", kind: "elimination", startDate: "2026-03-01", plannedDays: 14, endedOn: "2026-03-04" }] } as PhaseLedger;
  expect(phaseStatus(l, "2026-03-04").kind).toBe("none");
});

it("reports a running challenge with its label and day number", () => {
  const l = { spans: [{ id: "c1", kind: "challenge", startDate: "2026-03-01", what: "dairy", endedOn: null }] } as PhaseLedger;
  const s = phaseStatus(l, "2026-03-03");
  expect(s).toMatchObject({ kind: "running", phase: "challenge", what: "dairy", dayNumber: 3 });
});

it("still reads the elimination's start date as Day 1", () => {
  const l = { spans: [{ id: "e1", kind: "elimination", startDate: "2026-03-01", plannedDays: 14, endedOn: null }] } as PhaseLedger;
  expect(phaseStatus(l, "2026-03-01")).toMatchObject({ dayNumber: 1, totalDays: 14, daysLeft: 13 });
});

it("still reports a future elimination as scheduled", () => {
  const l = { spans: [{ id: "e1", kind: "elimination", startDate: "2026-03-20", plannedDays: 14, endedOn: null }] } as PhaseLedger;
  expect(phaseStatus(l, "2026-03-10")).toMatchObject({ kind: "scheduled", daysAway: 10 });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm test phaseLabels` — fails on `phaseStatus` not existing.

- [ ] **Step 3: Implement `phaseStatus` on top of `openSpan`**

`kind: "none"` when `openSpan` is null. Otherwise `scheduled` when `todayKey < span.startDate`, else `running`. Keep the ended-early shortening already in this file: an elimination ended on day 4 of a planned 14 reports `totalDays: 4` and `progress: 1`, so the label and the bar agree.

- [ ] **Step 4: Run in two timezones, then mutation-check**

Run: `pnpm test phaseLabels && TZ=Pacific/Chatham pnpm test phaseLabels`

Mutation: make `phaseStatus` ignore `endedOn` when deciding `none`. The first test must fail — that is the reported bug, and it must stay caught.

- [ ] **Step 5: Commit**

```bash
git add lib/phaseLabels.ts lib/phaseLabels.test.ts
git commit -m "Answer phase status for a challenge as well as an elimination"
```

---

### Task 3: Wire the ledger into AppContext

**Files:**
- Modify: `context/AppContext.tsx`
- Delete: `lib/ledgerSync.ts`, `lib/ledgerSync.test.ts`

**Interfaces:**
- Consumes: everything Task 1 produces
- Produces: context gains `endChallenge: () => Promise<void>`; `startChallenge` becomes `(what: string) => Promise<void>`

- [ ] **Step 1: Delete the materialiser wiring**

Remove the effect that calls `materialise` and the `ledgerToPersist` import, and delete both `lib/ledgerSync.*` files. **Keep the `todayDateKey` refresh** in the midnight/foreground effect — other screens depend on it. Only the ledger write goes.

- [ ] **Step 2: Thread `todayDateKey` into every phase stamp**

`phaseOnDate` now takes three arguments. These five call sites each need `todayDateKey`:

- `context/AppContext.tsx:285` — `activePhase`
- `:446` — `addConsumptionLog`
- `:469` — `addSymptomLog`
- `:489` — `addScratchLog`
- `:504` — `updateScratchLog`

Add `todayDateKey` to each mutator's `useCallback` dependency array. **Do not otherwise change these mutators** — `addSymptomLog` reads a synchronously-updated cell rather than captured state, and that shape must survive untouched.

- [ ] **Step 3: Make the load path tolerate the old ledger shape**

```ts
/**
 * A ledger from before spans — `{ days, elimination, materialisedThrough }` —
 * cannot be read as spans, so it is discarded rather than migrated. There is no
 * data to lose; this exists so a stale value on disk cannot crash the load.
 *
 * Deliberately NOT a schema-version bump: raising CURRENT_SCHEMA_VERSION
 * re-fires the wipe of consumption, symptom, scratch and custom-food storage.
 */
function readLedger(raw: unknown): PhaseLedger {
  if (raw && typeof raw === "object" && Array.isArray((raw as PhaseLedger).spans)) {
    return raw as PhaseLedger;
  }
  return EMPTY_LEDGER;
}
```

- [ ] **Step 4: Add the `endChallenge` mutator and widen `startChallenge`**

Both write through `persistLedger`, exactly as `endEliminationEarly` already does. `startChallenge` takes the label and passes `generateId` from `lib/ids.ts`.

- [ ] **Step 5: Typecheck to find every remaining consumer**

Run: `pnpm typecheck`
Expected: errors only in `app/(tabs)/index.tsx`, `app/(tabs)/calendar.tsx`, `components/WeekStrip.tsx`, `components/Phase*.tsx`, `lib/dayStyle.ts`, `lib/backup.ts`. Those are Tasks 4 and 5. Fix only AppContext's own errors here.

- [ ] **Step 6: Commit**

```bash
git add -A context/AppContext.tsx lib/
git commit -m "Drop the materialiser: a span lookup needs no daily stamping"
```

---

### Task 4: The screens, and the end of Maintenance

**Files:**
- Modify: `constants/types.ts:9`, `lib/dayStyle.ts:25-30`, `components/PhaseStartModal.tsx`, `components/PhaseEditModal.tsx`, `components/PhaseStatusCard.tsx`, `app/(tabs)/index.tsx`, `app/(tabs)/calendar.tsx`, `components/WeekStrip.tsx`

- [ ] **Step 1: Remove `"maintenance"` from `Phase`**

```ts
export type Phase = "none" | "elimination" | "challenge";
```

Then delete the `maintenance` key from `PHASE_COLORS`. `Record<Phase, string>` makes tsc list every other site that must change — work that list.

- [ ] **Step 2: Pass `todayKey` wherever a day's phase is read**

`app/(tabs)/index.tsx:91`, and the `dayPhase` helpers in `calendar.tsx` and `WeekStrip.tsx`, all call `phaseOnDate` or `phaseOfRecord`. Both screens already compute today per render — `todayStr` and `todayKey()` respectively. Use those; do not capture a value at mount, because expo-router mounts each tab once and never unmounts it.

- [ ] **Step 3: Add the challenge label field to `PhaseStartModal`**

A `TextInput` labelled "What are you challenging?", placeholder "e.g. dairy". Start stays `disabled` while it is blank after trimming. Pass the value to the context's `startChallenge`. Keep the existing gate that refuses while any phase is open, and keep its copy naming the pending phase rather than implying one is running.

- [ ] **Step 4: Make `PhaseEditModal` end whichever phase is open**

Title and button read "End Elimination" or "End Challenge" from the open span's kind, calling the matching mutator. The modal is only reachable when `phaseStatus(...).kind !== "none"`, which is what removes the stale End button — no extra condition needed.

- [ ] **Step 5: Show the challenge label on `PhaseStatusCard`**

A running challenge reads `Challenge · dairy`. A running elimination is unchanged.

- [ ] **Step 6: Verify**

Run: `pnpm typecheck && pnpm test && TZ=Pacific/Chatham pnpm test`
Then: `EXPO_NO_TELEMETRY=1 CI=1 pnpm build` — must print `Exported: dist`. This is the only gate that catches a stale import of a deleted symbol.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Show and end a labelled challenge, and retire the maintenance phase"
```

---

### Task 5: Backup, export and docs

**Files:**
- Modify: `lib/backup.ts:115-118`, `lib/backup.test.ts`, `lib/exportCsv.ts`, `docs/TODO.md`, `docs/HANDOFF-2026-08-24.md`

- [ ] **Step 1: Write the failing test for `isEmptyLedger`**

```ts
it("calls a ledger with any span real, so a backup never replaces it", () => {
  const l = { spans: [{ id: "c1", kind: "challenge", startDate: "2026-03-01", what: "dairy", endedOn: "2026-03-04" }] } as PhaseLedger;
  expect(isEmptyLedger(l)).toBe(false);
});

it("calls a ledger with no spans empty, so a first restore can adopt the remote one", () => {
  expect(isEmptyLedger({ spans: [] })).toBe(true);
});
```

The first test is the one that matters: the previous version only recognised a ledger as real via `elimination` or a stamped `days` map, and a challenge-only user's history was invisible to it.

- [ ] **Step 2: Implement, run, and mutation-check**

`return l.spans.length === 0;` guarded by the existing null check. Mutation: make it `return true` unconditionally — the first test must fail.

- [ ] **Step 3: Confirm the phase CSV column**

`lib/exportCsv.ts` writes `l.phase ?? ""`. With `maintenance` gone the possible values are `elimination`, `challenge`, `none` and empty. No code change; check no test asserts `maintenance`.

- [ ] **Step 4: Update the docs**

In `docs/TODO.md`, the "Known trade-offs" entry saying the phase ledger is a single record with no merge story stays true — spans do not change that. Remove the parked "ledger `days` map grows forever" item from `docs/HANDOFF-2026-08-24.md`: spans are bounded by phases actually run, so the problem is gone rather than deferred.

- [ ] **Step 5: Full gate sweep**

```bash
pnpm typecheck
pnpm test
TZ=UTC pnpm test && TZ=America/Los_Angeles pnpm test && TZ=Pacific/Chatham pnpm test && TZ=Asia/Tokyo pnpm test
EXPO_NO_TELEMETRY=1 CI=1 pnpm build
pnpm run test:emulator
```

`test:emulator` exits with code 2 even when it passes — firebase-tools cannot write its update-check config under this sandbox. Read its result from stdout, never the exit code.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Recognise a spans ledger in the backup, and close out the docs"
```

---

## Manual verification

Not runnable here — there is no interactive browser in this environment.

- Start a Challenge, confirm it refuses a blank label, give it one, confirm the card reads `Challenge · <label>`.
- End the Challenge; confirm today keeps its colour and the pencil disappears.
- Start an Elimination, end it early, confirm today still reads Elimination and the End action is gone for the rest of the day.
- Confirm the day after an ended Elimination is blank rather than green.
