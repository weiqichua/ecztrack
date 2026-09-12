# User-Owned Items and the Phase Ledger — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Every item in the app is created by the user and synced to Firebase; phases become a per-day ledger driven by real calendar spans; and the eleven screen defects below are fixed.

**Architecture:** Three seeded catalogs (`FOOD_LIBRARY`, `BODY_LOCATIONS`, `SCRATCH_CUES`, `SCRATCH_ROUTINES`) plus five hardcoded symptom fields become user-owned collections in AsyncStorage, mirrored to Firestore by the existing backup layer. `PhaseConfig{current, history}` is replaced by `PhaseLedger` — an explicit `Record<dateKey, Phase>` plus a scheduled start — so a day's phase is stored data rather than a computation over ranges.

**Tech Stack:** Expo SDK 54, React Native 0.81, expo-router, AsyncStorage (source of truth), Firebase JS SDK v12 (optional backup), Vitest.

**Working directory:** `artifacts/ecztrack` — note the project was renamed from `artifacts/health-tracker`; the old directory is a stale leftover.

---

## Decisions already made

Settled with the user before this plan was written. Do not relitigate these.

| Question | Decision |
|---|---|
| Existing check-in / food / urge history | **Discard, no export first.** The user confirmed on 2026-08-18 that nothing on the device is worth keeping. There is no Phase 0 and no safety export step. |
| Food-log grouping | **One row per item per day, with a count.** Tap to expand to individual entries, each individually deletable. |
| Urge outcome (1–4 scale) | **Stays fixed and built-in.** Only locations, cues and routines become user-owned. |
| Skipped days in a running phase | **The phase owns them.** See "The phase model" below. |
| A day with no phase | **`"none"` — a real `Phase` member, never `null`.** See below. |

### `"none"` is a phase

`Phase` becomes `"elimination" | "challenge" | "maintenance" | "none"`. There is no
nullable phase anywhere: `phaseOnDate` returns `"none"` for a day outside every
phase, and a log written on such a day is stamped `phase: "none"`.

This is deliberately not `Phase | null`. Every colour map is
`Record<Phase, string>`, so adding a member makes tsc **fail** on any map that
forgets it, and makes every `switch` over `Phase` non-exhaustive until it handles
the case. A nullable phase would instead have produced `PHASE_COLORS[null] ===
undefined` — an invisible element at runtime that the typechecker cannot see.

Two consequences to hold onto:

- **`"none"` is never stored in `PhaseLedger.days`.** A day with no phase is simply
  absent from the map; the sentinel appears only on the read path. Writing it for
  every untracked calendar day would bloat storage for no gain.
- **It exports as `none`,** not as an empty cell, so the CSV distinguishes "no
  phase was running" from "this field is missing".

### The phase model

The user's rules, reconciled:

1. A **running phase owns every day in its span**, whether or not the app was opened. An elimination diet continues regardless of whether you check in, and "did I check in" is already shown separately by the calendar dots.
2. Days with **no phase running are blank** — in the past and in the future. A blank day is a real state, not a missing value.
3. **Elimination can be scheduled to start on a future date.** It becomes the active phase when that date arrives.
4. **A running elimination cannot be replaced.** The only exit is ending it early.
5. When an elimination's **last day passes, the next day is Maintenance**, and each later day inherits the previous day's phase.
6. Rule 5 is applied by a **materialiser that runs on app open**, walking the ledger forward from the last stamped day to today. Opening the app after a three-day gap fills all four days.

Rule 6 is the load-bearing one: because the walk is driven by dates rather than by app launches, the ledger is identical whether you opened the app every day or once a week.

### Global Constraints

- **AsyncStorage stays the source of truth.** Firebase is optional; the app must run fully with no Firebase config. Never call a Firebase accessor without `isFirebaseConfigured()`.
- **All writes go through `persist()`** in `context/AppContext.tsx`. Never call `AsyncStorage.setItem` directly from a mutator — a silent write failure is the worst outcome available.
- **All date keys come from `lib/dates.ts`.** Never `.split("T")[0]`; a source-scan test in `lib/dates.test.ts` enforces this.
- **No `Alert` from react-native.** Use `notify` / `confirmDestructive` from `lib/dialogs.ts` — react-native-web's `Alert.alert` is a no-op.
- **Never put a `*.test.ts` under `app/`.** expo-router treats every file there as a route and bundles it, which pulls vitest into the web bundle and breaks the build. Screen-logic tests go in `tests/`.
- **Every new `<MciIcon name="…">` needs its path in `components/mciPaths.ts`.** `PATHS` is typed `Record<string, string>`, so tsc cannot catch a missing icon — `components/MciIcon.test.ts` scans source and will fail.
- Verification per task: `pnpm typecheck && pnpm test`, plus `TZ=America/Los_Angeles pnpm test` for anything date-related.

---

## Phase 1 — User-owned items

This is the foundation. Every screen task depends on it, so it lands first and lands whole.

### Task 1: The catalog data model

**Files:** create `constants/catalog.ts`; modify `constants/types.ts`; test `constants/catalog.test.ts`

One generic shape covers four of the five catalogs:

```ts
/** A user-created item in one of the pickable lists. */
export interface CatalogItem {
  id: string;
  name: string;
  order: number;
  isArchived: boolean;
  /** ISO timestamp of last local edit — last-write-wins on restore. */
  updated_at?: string;
}

export type CatalogKind = "bodyLocation" | "cue" | "routine" | "symptom";
```

`routine` carries an optional `description` (the existing `SCRATCH_ROUTINES` shape has one, and the field is genuinely useful). `symptom` carries nothing extra — its scale is fixed 1–5, matching `SliderInput`.

Foods keep their own richer `FoodItem` type (category, tags, `is_elimination_safe`); they are not folded into `CatalogItem`. But they **do** gain `updated_at`, for the reason below.

#### Everything editable carries `updated_at`

Logs are append-only with unique ids, so a given id always has the same content and no merge conflict is possible. **Editable** records are different: without a timestamp the merge cannot tell which side is newer, so it falls back to local-wins and the device you happen to be holding imposes its version.

That is a live data-loss path. Edit a food on the second phone, then press Upload on the main phone, and the main phone's older copy overwrites the newer edit — permanently, since the cloud is the only other copy. Restoring first does not rescue it, because local also wins on the way down.

`HabitDefinition` already has `updated_at` and is already immune. This task extends the same treatment to every other editable record, so **which device presses which button stops mattering**:

- [ ] `FoodItem` gains `updated_at?: string`
- [ ] `CatalogItem` carries `updated_at?: string` (already in the shape above)
- [ ] **Every mutator that creates or edits one stamps it** — `addCustomFood`, `saveFood`, `addCatalogItem`, `updateCatalogItem`. A record written without a timestamp is the bug this is fixing, so a missing stamp is a defect, not a default.
- [ ] Extract the recency rule from `mergeSnapshots` into one shared helper and use it for all of them. It must keep the semantics fixed on 2026-08-18: **remote wins only when both sides carry a timestamp and remote's is strictly newer.** Comparing `(r.updated_at ?? "") > (l.updated_at ?? "")` made a local record with no timestamp lose to any remote copy that had one, including an older edit.
- [ ] Tests, mirroring the ones now in `lib/backup.test.ts`: newer remote wins; older remote loses; remote-with-timestamp does not beat local-without; neither-has-one keeps local.

Deliverables:

- [ ] `CatalogItem`, `CatalogKind`, and a `RoutineItem extends CatalogItem` with `description?: string`
- [ ] `SymptomLog.scores: Record<string, number>` replacing the five fixed fields; `reflux`/`redness`/`heat`/`itch`/`lip_status` are **deleted**, not deprecated
- [ ] `ScratchLog.routine_id` becomes `string | null` (competing routine is optional per the user)
- [ ] `ScratchLog.location` and `.cue` become **ids**, not display strings, so renaming an item does not orphan history
- [ ] Delete `BODY_LOCATIONS`, `SCRATCH_CUES`, `SCRATCH_ROUTINES` from `constants/types.ts`
- [ ] Keep `SUCCESS_LABELS` and `ABORT_REASONS` — both stay built-in
- [ ] Tests: an archived item never appears in a picker; `order` is dense after a delete; a rename does not change any id

### Task 2: Wipe and reseed nothing

**Files:** modify `context/AppContext.tsx`; delete `constants/foodLibrary.ts`

- [ ] Delete `constants/foodLibrary.ts` (63 entries) and every import of it
- [ ] `allFoods` becomes just `customFoods` — the merge-over-library `useMemo` goes away entirely, and with it the "Restore to Default" branch in Task 8
- [ ] Add a one-time storage migration keyed on a new `SCHEMA_VERSION` storage key: when the stored version is absent or `< 4`, clear `CONSUMPTION_LOGS`, `SYMPTOM_LOGS`, `SCRATCH_LOGS`, `CUSTOM_FOODS`, `PHASE_CONFIG` and stamp version 4. Habit definitions and habit logs are **kept** — the user did not ask to reset those and they are already user-created.
- [ ] Test the migration in isolation: given version-3 data it clears the five keys, keeps habits, and is idempotent on a second run

**Verification:** launch the app; every picker and list is empty; no crash on an empty catalog anywhere.

### Task 3: Catalog CRUD in AppContext

**Files:** modify `context/AppContext.tsx`

- [ ] Four new state arrays + storage keys: `bodyLocations`, `cues`, `routines`, `symptoms`
- [ ] Generic mutators — `addCatalogItem(kind, name, extra?)`, `updateCatalogItem(kind, item)`, `deleteCatalogItem(kind, id)`, `reorderCatalogItems(kind, ids)` — all writing through `persist()`
- [ ] **Delete is guarded by referential integrity.** Deleting an item that logs reference must not silently orphan them. Two behaviours, and the choice is per-kind:
  - `symptom`: archive instead of delete when any `SymptomLog.scores` holds its id, so historical check-ins stay readable. Offer a hard delete only when unreferenced.
  - `bodyLocation` / `cue` / `routine` / food: same rule — archive if referenced, hard-delete if not. Archived items vanish from pickers but still resolve for display.
- [ ] Tests for the archive-vs-delete decision in both directions

### Task 4: Catalogs in the Firebase backup

**Files:** modify `lib/backup.ts`, `lib/repo/paths.ts`, `lib/repo/converters.ts`; modify `lib/backup.test.ts`

**The requirement:** signing in on a new phone and restoring must bring back the
*items themselves*, not just the logs — otherwise the restored history references
foods and locations that device has never heard of. Every user-created list
therefore syncs.

Where each one stands:

| Collection | Status |
|---|---|
| `customFoods` | Already in `Snapshot`, but **its merge changes** from union/local-wins to recency, per Task 1. Also verify it survives the `FOOD_LIBRARY` removal |
| `habitDefinitions`, `habitLogs` | Already in `Snapshot`, unchanged |
| `consumptionLogs`, `symptomLogs`, `scratchLogs` | Already in `Snapshot`, unchanged |
| `bodyLocations`, `cues`, `routines`, `symptoms` | **New in this task** |
| `phaseConfig` | Replaced by `ledger` — see the bullet below |
| Urge outcomes (1–4) | **Needs no sync.** Fixed and built into the code, so every device has them by construction. |

- [ ] Add `bodyLocations`, `cues`, `routines`, `symptoms` to `Snapshot`, `emptySnapshot()`, `pushSnapshot`, `pullSnapshot`
- [ ] Replace `phaseConfig` with `ledger` in `Snapshot`. Merge it as **local-wins**, with the remote adopted only when this device has no real ledger.
      **Do not reproduce the bug this replaces:** `phaseConfig: local ?? remote`
      never reached the remote branch, because AppContext initialises the field
      to a default rather than leaving it null, so a new phone restored its logs
      and kept a blank phase. Test "has no ledger" explicitly — an
      `isEmptyLedger(ledger)` predicate mirroring `isEmptyPhaseConfig` in
      `lib/backup.ts` — never a null check. Fixed for `phaseConfig` on
      2026-08-18; the test is in `lib/backup.test.ts`.
- [ ] Verify `customFoods` still round-trips once `FOOD_LIBRARY` is gone: its converter and collection path are unchanged, but the snapshot previously held only the *custom* subset and now holds every food the user has.
- [ ] Add the four collection names to `paths.ts` and converters for `CatalogItem` / `RoutineItem`
- [ ] Merge them — and `customFoods` — with the **shared recency helper from Task 1**, then reindex `order` densely. This is the treatment `habitDefinitions` already gets, not the union-by-id used for logs. Logs keep union-by-id: they are append-only, so recency is meaningless for them.
- [ ] Extend the existing "never drops a local entry absent remotely" and idempotence tests to cover all four
- [ ] Confirm `pushSnapshot` still chunks under Firestore's 500-op batch limit with the new collections included

**Verification — this is the new-phone scenario, so test it as one:** with Firebase
configured, create a food, a body location, a cue and a routine on one device and
log an urge using all of them. **Back up now.** Then on a second device (or a
browser profile with storage cleared) sign in and **Restore**. Every item must be
present *and selectable in its picker*, and the restored urge log must render its
location and routine by name rather than as a raw id.

`pnpm run test:emulator` must also stay green.

---

## Phase 2 — The phase ledger

### Task 5: Replace PhaseConfig with PhaseLedger

**Files:** modify `constants/types.ts`; create `lib/phases.ts`; test `lib/phases.test.ts`

```ts
export interface PhaseLedger {
  /** Explicit phase per local date key. A missing key means no phase. */
  days: Record<string, Phase>;
  /** The elimination currently running or scheduled, if any. */
  elimination: {
    startDate: string;        // date key; may be in the future
    plannedDays: number;
    /** Set when it ends — naturally or early. Null while running. */
    endedOn: string | null;   // date key of its LAST day
  } | null;
  /** Last date key the materialiser has stamped. */
  materialisedThrough: string | null;
}
```

Functions in `lib/phases.ts`, all pure and all taking "today" as an argument so they are testable without faking the clock:

- [ ] Widen `Phase` to include `"none"` **first**, before anything else in this task.
      Fix the resulting typecheck failures — every `Record<Phase, …>` in the codebase
      will error until it defines the member, which is the point.
- [ ] `phaseOnDate(ledger, dateKey): Phase` — a lookup returning `"none"` for an
      absent key. No range arithmetic, and no nullable return
- [ ] `materialise(ledger, todayKey): PhaseLedger` — walks from `materialisedThrough + 1` to `todayKey` applying rules 1–5; **pure and idempotent**, returns the same object identity when there is nothing to do so React does not re-render pointlessly
- [ ] `scheduleElimination(ledger, startDateKey, days)` — rejects when an elimination is already running (rule 4)
- [ ] `endEliminationEarly(ledger, todayKey)` — sets `endedOn` to today; the next day materialises as Maintenance
- [ ] `eliminationDayNumber(ledger, todayKey)` and `eliminationDaysLeft` — day the phase starts reads as **Day 1**, matching the existing convention locked in by `constants/types.test.ts`

Delete `PhaseConfig`, `PhaseRecord`, `DEFAULT_PHASE_CONFIG`, `computeActivePhase`, `getPhaseOnDate`, `migratePhaseConfig`, `closePhaseRecord`, `addDays`, `daysBetween` — and their tests in `constants/types.test.ts`, which describe a model that no longer exists.

**Tests — this is where the correctness lives:**

- [ ] A running elimination owns every day in its span, including days never opened
- [ ] Materialising across a 3-day gap fills all 4 days
- [ ] Materialising twice changes nothing (idempotent) and returns identical output
- [ ] A future scheduled start produces no phase before its date, and elimination on it
- [ ] The day after the last elimination day is Maintenance; the day after that is Maintenance
- [ ] Days before the first phase ever started are `null`
- [ ] `scheduleElimination` refuses while one is running
- [ ] Ending early on day 3 of 14 makes day 4 Maintenance
- [ ] All of the above pass under `TZ=Asia/Singapore`, `TZ=America/Los_Angeles`, `TZ=Pacific/Chatham`

### Task 6: Wire the ledger into AppContext

**Files:** modify `context/AppContext.tsx`

- [ ] Replace `phaseConfig` / `activePhase` state with `ledger` and a derived `activePhase: Phase | null`
- [ ] Call `materialise` on load **and** on the existing `todayDateKey` rollover tick — the day-rollover machinery added on 2026-08-18 is exactly the hook this needs, so a phase change at midnight appears without a relaunch
- [ ] `addConsumptionLog` / `addSymptomLog` / `addScratchLog` stamp `phase` from `phaseOnDate(ledger, …)`, which always returns a value — no null handling needed at any call site
- [ ] Give `"none"` a muted colour in every `Record<Phase, string>` map, and confirm it reads as `None` in the UI (the existing `charAt(0).toUpperCase()` formatting handles the display for free)
- [ ] Replace `startPhase` / `updatePhaseEndDate` / `abortElimination` with `scheduleElimination` / `endEliminationEarly`

**Verification:** start an elimination dated 3 days out; confirm today is blank, and that after moving the device clock past the start date the phase card reads Day 1.

### Task 7: Phase UI

**Files:** modify `components/PhaseStartModal.tsx`, `components/PhaseEditModal.tsx`, `components/PhaseStatusCard.tsx`

- [ ] `PhaseStartModal` gains a start-date picker defaulting to today and allowing future dates; reuse `DateScroller`
- [ ] `PhaseStatusCard` renders three states, not one: no phase, scheduled (`Starts in 3 days`), and running (`Day 4 of 14`)
- [ ] `PhaseEditModal` offers **End elimination early**; the "set end date" control goes, since the end is now derived from `plannedDays`
- [ ] Guard both modals against double-submit with a `useRef`, not a `saving` state — the four existing modals use the state and the window is one frame, but a double phase-start is worth preventing properly

---

## Phase 3 — Screens

### Task 8: Food log

**Files:** modify `app/(tabs)/food-logger.tsx`, `components/FoodEditModal.tsx`

- [ ] **Whole page scrolls.** Move the header, the timestamp/accident bar and the "Today's Log" section into the `FlatList`'s `ListHeaderComponent`. They are currently siblings of a `flex: 1` list inside a `flex: 1` view, so only the food list scrolls and the log section squeezes as it grows. Do **not** nest a `ScrollView` around a `FlatList` — that breaks virtualization.
- [ ] **Search text is invisible:** `styles.searchInput` sets `height: 22` for 15px text, which clips the glyphs. Replace with `minHeight: 40` and `paddingVertical: 0`.
- [ ] Rename the header button **Custom → Add**. Every food is user-created now.
- [ ] **Delete actually deletes.** With `FOOD_LIBRARY` gone (Task 2) `isBuiltIn` is always false, so remove the `isBuiltIn` branch, the `restore` icon and the "Restore to Default" label. The button is always "Delete Food" and always calls `deleteCustomFood`. Route it through Task 3's archive-if-referenced guard so logged history stays readable.
- [ ] Add a per-row delete on each entry in Today's Log.
- [ ] **Group by item with a count**, per the decision above: one row per distinct food for the day showing `×N` and the latest time, expanding on tap to individually deletable entries.
- [ ] Add an explicit **Save** button matching the check-in screen's, rather than logging on tap. This changes the interaction model of the screen's primary action — read the note below.
- [ ] Test the grouping as a pure function in `tests/`, not through the component.

> **Flagging a tension, not blocking on it.** Today, tapping a food logs it immediately — one tap per item. Adding a Save button means select-then-save, so logging one food becomes two taps. That is slower for the common case but makes multi-item meals coherent and matches the check-in screen. I am implementing what was asked. If it feels worse in use, the fallback is to keep tap-to-log and show a transient "Logged ✓" confirmation instead.

### Task 9: Log Scratch Urge screen

**Files:** modify `app/(tabs)/scratch-tracker.tsx`; create `components/CatalogManagerModal.tsx`

- [ ] Increase the top margin on the screen header
- [ ] Each of the three pickers (body location, trigger/cue, competing routine) gets an inline **+ Add** and a long-press or edit affordance opening `CatalogManagerModal` for that kind — add, rename, reorder, delete
- [ ] `CatalogManagerModal` is generic over `CatalogKind`; one component serves all four catalogs and the check-in items in Task 10
- [ ] Competing routine is **optional** — the picker allows no selection and `routine_id` stays null
- [ ] Outcome keeps its fixed 1–4 scale
- [ ] Empty state on every picker: a clear "No body locations yet — add one" rather than a blank row

### Task 10: Symptom check-in

**Files:** modify `app/(tabs)/check-in.tsx`

- [ ] Render one `SliderInput` per non-archived `symptom` catalog item instead of five hardcoded ones
- [ ] Manage items through `CatalogManagerModal`
- [ ] `overallScore` averages whatever items exist; **guard the divide-by-zero** when there are none
- [ ] Empty state: "No check-in items yet — add one to get started", with Save disabled
- [ ] Preserve the two fixes made on 2026-08-18: hydration keyed on the log's identity and values (not just `activeType`), and the session type refreshed on focus rather than frozen at mount
- [ ] Rework `logKey` for the dynamic `scores` record

> **SKIPPED 2026-08-24 — absorbed into Task 13.** Every file this task touches,
> Task 13 deletes: `app/(tabs)/check-in.tsx` and the `SliderInput` the first
> checkbox asks for. Building this screen and then removing it a task later
> buys nothing, so it is not executed as a task of its own. Each surviving
> requirement is verified delivered by Task 13:
>
> | Requirement | Where Task 13 delivers it |
> |---|---|
> | Render one input per non-archived `symptom`, not five hardcoded | step 6, `activeItems(symptoms).map(…)` over `ScoreBoxInput` |
> | Manage items through `CatalogManagerModal` | step 6, as amended — the Symptoms section header's Manage button |
> | Guard the divide-by-zero on the average | step 8, `scored.length ? … : ""` in `buildSymptomCSV`; `SymptomLog` carries no `overallScore` field at all after step 1 |
> | Empty state, Save disabled | step 6 — the empty state stays; there is no Save button to disable, since each tap saves itself |
> | Preserve the 2026-08-18 hydration and focus fixes | moot: both were properties of the Morning/Evening screen's local draft state and its `activeType`, and step 6 removes the draft entirely — the boxes render straight from the stored log |
> | Rework `logKey` for the dynamic `scores` record | step 4 rekeys the Firestore document on `date` alone |
>
> Ruling recorded in the ledger. Cost if wrong: Task 13's dispatch must carry
> these six requirements explicitly, which it does.

### Task 11: Home page

**Files:** modify `app/(tabs)/index.tsx`, `components/WeekStrip.tsx`; create `components/ScratchLogEditModal.tsx`, `lib/dayStyle.ts`

- [ ] **Editable Habit Reversal entries.** There is no edit path for a scratch log today — only create and delete. Add `updateScratchLog` to AppContext and a `ScratchLogEditModal` reusing the create form; wire it to the entries under Habit Reversal on the home page and to `ScratchLogCard`.
- [ ] **Shared day styling.** Extract the calendar's phase-colour and three-dot logic (`calendar.tsx` `getDayStyle`, `PHASE_COLORS`, and the food/urge/check-in dots at lines ~243–246) into `lib/dayStyle.ts`, then use it in **both** `calendar.tsx` and `WeekStrip.tsx`. The colour codes must come from one place — two copies will drift.
- [ ] `WeekStrip` renders the phase colour as the day's fill and the three activity dots beneath, matching the month view
- [ ] Handle a null phase in the shared helper: no phase means no fill, not a lookup miss
- [ ] Test `lib/dayStyle.ts` as a pure function

### Task 12: Docs and final review

- [ ] Update `docs/TODO.md`, `docs/RUNNING.md` and `docs/FIREBASE-SETUP.md` for the new model and the new collections
- [ ] `pnpm typecheck && pnpm test` plus the three timezones; `pnpm run test:emulator`; `pnpm build`
- [ ] Whole-branch review

### Task 13: Single daily symptom check-in on the home page

**Files:** modify `constants/types.ts`, `constants/types.test.ts`, `constants/catalog.ts`, `constants/catalog.test.ts`, `context/AppContext.tsx`, `lib/repo/paths.ts`, `lib/repo/paths.test.ts`, `lib/repo/converters.ts`, `lib/repo/converters.test.ts`, `lib/backup.ts`, `lib/backup.test.ts`, `app/(tabs)/index.tsx`, `app/(tabs)/calendar.tsx`, `app/(tabs)/export.tsx`, `tests/exportCsv.test.ts`; create `components/ScoreBoxInput.tsx`, `lib/symptomLogs.ts`, `lib/symptomLogs.test.ts`; delete `app/(tabs)/check-in.tsx`, `components/SliderInput.tsx`

> **AMENDED 2026-08-24.** This task absorbs Task 10, which is skipped — see
> Task 10's note. Three amendments are marked inline below: the pure
> `upsertSymptomLog` helper plus the updater-form mutator (step 3), and the
> Manage button that gives the symptom catalog its only entry point (step 6).

There is one check-in per day, not two. Symptoms are entered directly on the
home page, so there is nothing to navigate to. This is a personal, single-user
app and the branch has already wiped stored logs (Task 2), so there is no
migration to write for the old `type: "Morning" | "Evening"` records — the
field is simply deleted, not deprecated.

#### 1. `SymptomLog` drops the morning/evening split; `scores` gains an explicit "not recorded"

**Files:** `constants/types.ts`, `constants/types.test.ts`

Today `mergeScores` is a plain `{ ...base, ...incoming }` spread over
`Record<string, number>`. That already does exactly what "un-select a box"
needs — a key **present with an explicit value** overwrites the stored one, a
key **absent** leaves the stored one untouched — but there is no value that
means "clear it." Widening the value type to `number | null` gives un-select
a value to send: `{ [id]: null }`. An **absent** key still means "this screen
never asked about this symptom" (e.g. it's archived); a **present `null`**
means "asked, deliberately left blank."

- [ ] Add two failing tests to the existing `describe("mergeScores", …)` block in `constants/types.test.ts`:

  ```ts
  it("an explicit null in the incoming map clears a previously recorded score", () => {
    // Un-selecting a box sends { [id]: null }, not an omitted key — omitting
    // the key would be indistinguishable from "this screen never showed it."
    expect(mergeScores({ s_itch: 4 }, { s_itch: null })).toEqual({ s_itch: null });
  });

  it("leaves a null score alone when the incoming map omits it", () => {
    expect(mergeScores({ s_itch: null, s_heat: 2 }, { s_heat: 3 })).toEqual({ s_itch: null, s_heat: 3 });
  });
  ```

- [ ] Run `pnpm test` — both fail on the type of `mergeScores`'s parameters (TS) before they even fail on behavior; that is expected, since the signature hasn't changed yet.
- [ ] In `constants/types.ts`, change `SymptomLog` and `mergeScores`:

  ```ts
  /** One check-in per day. */
  export interface SymptomLog {
    id: string;
    /** YYYY-MM-DD date key in the user's local calendar */
    date: string;
    phase?: Phase;
    /**
     * Score per symptom, keyed by `CatalogItem.id`. 1–5, low = severe.
     * `null` means the user was shown the box and left it unselected —
     * distinct from a key being absent, which means this log never offered
     * that symptom (e.g. it postdates the log, or was archived since).
     */
    scores: Record<string, number | null>;
  }

  /**
   * Folds a check-in's new scores onto the ones already stored.
   *
   * Saving a check-in overwrites the day's log in place, and the check-in UI
   * can only offer the symptoms currently in the catalog. Assigning the new
   * map straight over the old one would therefore delete the score for every
   * symptom the user has since archived — quietly, and again on each re-save.
   *
   * A key present in `incoming` always wins, including an explicit `null`
   * (the user un-selected that box just now). A key `incoming` omits keeps
   * whatever `existing` had — that is how an archived symptom's score
   * survives a re-save it was never shown in.
   *
   * Tolerates a missing or malformed stored map: a screen must not go down
   * because of what is on disk.
   */
  export function mergeScores(
    existing: Record<string, number | null> | undefined,
    incoming: Record<string, number | null>,
  ): Record<string, number | null> {
    const base = existing && typeof existing === "object" ? existing : {};
    return { ...base, ...incoming };
  }
  ```

- [ ] Run `pnpm test` — the two new tests pass, and every pre-existing `mergeScores` test still passes unchanged (the spread's behavior did not change, only the type).
- [ ] Delete `"Morning" | "Evening"` from every remaining use in this file if present (there should be none left after this edit — `type` is gone from the interface entirely).

#### 2. `isItemReferenced("symptom", …)` must not treat "not recorded" as a reference

**Files:** `constants/catalog.ts`, `constants/catalog.test.ts`

The current check is `id in l.scores` — key presence, deliberately not
truthiness, so a real score of `0` still counts as a reference. With `null`
now a legitimate stored value meaning "asked, left blank," key presence alone
over-counts: a symptom nobody has actually scored, only shown and skipped,
would count as referenced forever and could never be hard-deleted.

- [ ] Add a failing test in `constants/catalog.test.ts`, next to `"finds a symptom held by a stored check-in"`:

  ```ts
  it("does not count an explicit null as a reference", () => {
    // null means "shown, left blank" — not an answer the catalog must
    // preserve history for.
    const logs = { ...noLogs, symptomLogs: [{ scores: { s_itch: null } }] };
    expect(isItemReferenced("symptom", "s_itch", logs)).toBe(false);
  });
  ```

- [ ] Run `pnpm test` — fails (current code returns `true`, since `"s_itch" in { s_itch: null }` is `true`).
- [ ] In `constants/catalog.ts`, change the `"symptom"` case:

  ```ts
  case "symptom":
    // Key presence with a real value, not mere presence: a stored score of 0
    // is still an answer the user gave and mergeScores keeps it forever, but
    // an explicit null is "asked, left blank" and must not pin the symptom
    // in place. Reading a real score as absent would hard-delete a symptom
    // that history still points at.
    return logs.symptomLogs.some(l => !!l.scores && l.scores[id] != null);
  ```

- [ ] Run `pnpm test` — the new test passes, and the existing `"finds a symptom held by a stored check-in"` / `"...score of 0..."` / `"reports a symptom no check-in scored as unreferenced"` tests still pass (`!= null` keeps `0` as referenced and only excludes `null`/`undefined`).
- [ ] Commit: `git commit -m "Treat an explicit null symptom score as unanswered, not a reference"`

#### 3. One log per day in `AppContext`

**Files:** `context/AppContext.tsx`

No test file exists for `AppContext.tsx` today (it is exercised through the
screens it powers), so this step is verified by the screen work in step 5 and
by `pnpm typecheck`, which will fail at every remaining `l.type` /
`log.type` reference until they are removed.

**AMENDED 2026-08-24 — `addSymptomLog` must not read a captured array.** Every
mutator in this file is a `useCallback` closed over its current array, and
Task 8 shipped a Critical from exactly that: two writes derived from the same
snapshot, and only the last survives. Task 8's call site was a loop, which is
easy to spot. This task's is not — step 6 saves on **every box tap**, so two
boxes tapped faster than React commits the first update both fold onto the same
pre-tap `symptomLogs` and the second tap silently discards the first tap's
score. The fix is to derive the next state inside the `setState` updater, so
each call folds onto the latest committed value.

- [ ] First extract the decision as a pure function, because `AppContext.tsx`
      cannot be imported under vitest (react-native parse error; the vitest
      environment is `node` with no React harness). Create
      `lib/symptomLogs.ts` with tests in `lib/symptomLogs.test.ts`:

  ```ts
  /**
   * Folds one check-in onto the day's existing log, or creates it.
   *
   * Pure and total: it takes the logs it should build on as an argument rather
   * than closing over them, which is what lets the mutator call it from inside
   * a setState updater and stay correct when two taps land in one render.
   */
  export function upsertSymptomLog(
    logs: SymptomLog[],
    log: Omit<SymptomLog, "id">,
    phase: Phase,
    newId: () => string,
  ): SymptomLog[] {
    // A symptom log is keyed by date alone — at most one per day.
    const existing = logs.find(l => l.date === log.date);
    const newLog: SymptomLog = {
      id: existing?.id ?? newId(), ...log, phase,
      // Merged, not replaced — see mergeScores. The screen only knows about
      // the symptoms it can show, so a plain overwrite loses the rest.
      scores: mergeScores(existing?.scores, log.scores),
    };
    return existing
      ? logs.map(l => (l.id === existing.id ? newLog : l))
      : [newLog, ...logs];
  }
  ```

  Required tests, at minimum: creating the day's first log; folding a second
  score onto an existing day without disturbing the first; keeping the existing
  log's `id` on an update rather than minting a new one; an explicit `null`
  clearing a stored score; a score for an archived symptom surviving a re-save
  that never mentioned it; and — the one that pins the whole reason this
  function is pure — **two sequential `upsertSymptomLog` calls chained through
  each other's return value both survive, where two calls built from the same
  starting array would not.**

**CORRECTED 2026-08-24 — the first version of this amendment was worse than the
bug it fixed, and shipped before review caught it.** It had the mutator declare
`let updated: SymptomLog[] = []`, assign it inside a `setSymptomLogs(prev => …)`
updater, and then `await persist(KEY, updated)`. That assumes React invokes the
updater synchronously. It does not: when the fiber already has a pending update,
the updater is deferred to render, so `updated` is still its `[]` initialiser
when `persist` runs — and the mutator writes `"[]"` over the entire symptom-log
collection. The UI looks right, because state does eventually update; the loss
only appears on the next load, with every day of history gone. That trades
"lose one tap's score" for "lose everything", so **do not use an
assign-out-of-the-updater pattern anywhere in this file.**

The requirement stands and the shape changes: the mutator needs a value that is
correct *synchronously at call time*, so that back-to-back taps chain AND
`persist` writes something real.

- [ ] Extend `lib/symptomLogs.ts` with a latest-value cell, and test it. This
      belongs in the pure module rather than inline in the mutator for the same
      reason `lib/ledgerSync.ts` exists: `AppContext.tsx` cannot be imported
      under vitest, and an untestable guard on this branch has three times
      turned out to be an unpinned one.

  ```ts
  /**
   * Holds the newest symptom-log array, readable synchronously.
   *
   * The home page saves on every box tap, so two taps can land inside one
   * render. Reading React state there gives the pre-tap array to both, and the
   * second write discards the first tap's score. Reading a `setState` updater's
   * `prev` fixes that for state but not for persistence, because the updater
   * may not have run by the time the mutator persists.
   *
   * So the cell is the mutator's source of truth for both: updated
   * synchronously before `setState`, which makes each call fold onto the
   * previous one's result and gives `persist` a real value to write.
   */
  export function createLogCell(initial: SymptomLog[]) { … }
  ```

  Required tests, beyond `upsertSymptomLog`'s own: two `upsert`-through-the-cell
  calls with no intervening commit leave BOTH scores present; the value handed
  to the persist step after each call is the full array and **never empty**
  (this is the one that fails on the pattern that shipped); and a cell resynced
  from outside — a load or a restore — is what the next call builds on.

- [ ] `addSymptomLog` — key on `date` alone, drop `type`, and read the cell:

  ```ts
  const addSymptomLog = useCallback(async (log: Omit<SymptomLog, "id">) => {
    const logPhase = phaseOnDate(ledger, log.date);
    // Synchronous, so two taps in one render chain instead of racing, and so
    // persist() is handed a real array rather than whatever a deferred updater
    // has not yet assigned.
    const updated = upsertSymptomLog(cell.get(), log, logPhase, generateId);
    cell.set(updated);
    setSymptomLogs(updated);
    await persist(STORAGE_KEYS.SYMPTOM_LOGS, updated);
  }, [ledger]);
  ```

  Note `symptomLogs` leaves the dependency array — the callback no longer reads
  it. If tsc or the lint rule still wants it listed, that is a signal something
  else in the body is still reading the captured array; fix that rather than
  re-adding the dependency.

- [ ] **Enumerate every `setSymptomLogs` call site and resync the cell at each
      one.** This is the failure mode the cell introduces: a site that sets
      state without the cell leaves the cell stale, and the next tap rebuilds
      from an old array and resurrects deleted logs. Grep for it; the load path,
      the restore path and `deleteSymptomLog` all qualify. Prefer one small
      helper that sets both over remembering to do it twice.

- [ ] `getTodaySymptomLog` loses its `type` parameter:

  ```ts
  const getTodaySymptomLog = useCallback(() => {
    return symptomLogs.find(l => l.date === todayStr());
  }, [symptomLogs]);
  ```

  and the context interface: `getTodaySymptomLog: () => SymptomLog | undefined;`

- [ ] The load-time sanitize pass (`.map((l: SymptomLog) => ({ ...l, scores: mergeScores(l.scores, {}) }))`) is unchanged — it already tolerates the wider `scores` type.
- [ ] Run `pnpm typecheck` — fix every remaining error; each one is a real morning/evening call site from before this task (`app/(tabs)/check-in.tsx`, `app/(tabs)/index.tsx`, `app/(tabs)/calendar.tsx` — steps 5–7 below).

#### 4. Firestore key: one document per day, not per (date, type)

**Files:** `lib/repo/paths.ts`, `lib/repo/paths.test.ts`, `lib/repo/converters.ts`, `lib/repo/converters.test.ts`, `lib/backup.ts`, `lib/backup.test.ts`

- [ ] Update `lib/repo/paths.test.ts` first:

  ```ts
  it("keys a symptom log doc by date alone", () => {
    expect(symptomLogId("2026-08-17")).toBe("2026-08-17");
  });

  it("gives different dates different ids", () => {
    expect(symptomLogId("2026-08-17")).not.toBe(symptomLogId("2026-08-18"));
  });
  ```

  replacing the old `symptomLogId("2026-08-17", "Morning")` pair. Run `pnpm test` — fails (wrong arity).

- [ ] `lib/repo/paths.ts`:

  ```ts
  export function symptomLogId(date: string): string {
    return date;
  }
  ```

- [ ] `lib/repo/converters.ts` — `symptomLogConverter.fromDoc` drops `type`:

  ```ts
  export const symptomLogConverter: Converter<SymptomLog> = {
    toDoc: ({ id, ...rest }) => defined({ ...rest }),
    fromDoc: (id, d) => ({
      id,
      date: d.date as string,
      phase: d.phase as Phase | undefined,
      // The keys are user-created symptom ids, so nothing here may name them.
      // A document written before the user had any symptoms has no map at all.
      scores: (d.scores as Record<string, number | null> | undefined) ?? {},
    }),
  };
  ```

  Update `lib/repo/converters.test.ts`'s `symptomLogConverter.fromDoc("s1", { date: "2026-08-17", type: "Morning" })` assertion to drop `type` from the input fixture (the converter never reads it now, so leaving it in the fixture would silently test nothing).

- [ ] `lib/backup.ts` — the union key and the doc id both drop `type`:

  ```ts
  symptomLogs: unionBy(local.symptomLogs, remote.symptomLogs, l => l.date),
  ```

  ```ts
  for (const l of snap.symptomLogs) ops.push({ path: collectionPath(uid, "symptomLogs"), id: symptomLogId(l.date), data: c.symptomLogConverter.toDoc(l) });
  ```

- [ ] Update `lib/backup.test.ts`'s `sLog` helper and the two tests that exercise it:

  ```ts
  const sLog = (date: string, itch: number | null = 3) =>
    ({ id: date, date, scores: { itch } }) as any;
  ```

  ```ts
  it("keeps one symptom log per day, preferring local", () => {
    const local = { ...empty(), symptomLogs: [sLog("2026-08-17", 5)] };
    const remote = { ...empty(), symptomLogs: [sLog("2026-08-17", 1)] };
    const merged = mergeSnapshots(local, remote).symptomLogs;
    expect(merged).toHaveLength(1);
    expect(merged[0].scores.itch).toBe(5);
  });

  it("keeps both symptom logs when the date differs", () => {
    const local = { ...empty(), symptomLogs: [sLog("2026-08-17")] };
    const remote = { ...empty(), symptomLogs: [sLog("2026-08-18")] };
    expect(mergeSnapshots(local, remote).symptomLogs).toHaveLength(2);
  });
  ```

  and fix every other call site of `sLog(...)` in the file (the two-arg calls at the `consumptionLogs`/`symptomLogs` mixed-merge tests) to the new signature.

- [ ] Run `pnpm test` — all of the above green. Run `pnpm run test:emulator` if Firebase emulator is available locally; it is not required to pass in this environment but must not regress the converter contract.
- [ ] Commit: `git commit -m "Key symptom logs by date alone now that there is one per day"`

#### 5. `ScoreBoxInput`: 1–5 numbered boxes, tap-to-toggle-off

**Files:** create `components/ScoreBoxInput.tsx`; delete `components/SliderInput.tsx`

`SliderInput` becomes dead code the moment this task lands — it is used
nowhere but the check-in screen this task deletes — so it is removed as part
of this change rather than left behind, per "clean up only your own mess."

No test is added for `ScoreBoxInput.tsx` itself: this codebase does not unit
test React Native components (`SliderInput.tsx`, `PhaseStatusCard.tsx`, etc.
have no test files either) — only pure functions get `*.test.ts`, run through
`tests/` or beside their source.

- [ ] Create `components/ScoreBoxInput.tsx`:

  ```tsx
  import React from "react";
  import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
  import { useColors } from "@/hooks/useColors";

  interface ScoreBoxInputProps {
    label: string;
    /** null = not recorded. No box is selected. */
    value: number | null;
    onChange: (value: number | null) => void;
  }

  const VALUES = [1, 2, 3, 4, 5];

  function boxColor(value: number): string {
    if (value <= 2) return "#EF5350";
    if (value === 3) return "#FFB300";
    return "#66BB6A";
  }

  export default function ScoreBoxInput({ label, value, onChange }: ScoreBoxInputProps) {
    const colors = useColors();

    return (
      <View style={styles.container}>
        <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
        <View style={styles.boxRow}>
          {VALUES.map(n => {
            const selected = value === n;
            const color = boxColor(n);
            return (
              <TouchableOpacity
                key={n}
                style={[
                  styles.box,
                  {
                    borderColor: selected ? color : colors.border,
                    backgroundColor: selected ? color + "22" : "transparent",
                  },
                ]}
                // Tapping the already-selected box clears it back to null
                // rather than re-selecting the same value — there is no
                // "select 3 again" gesture, only "3 is set" and "3 is not set."
                onPress={() => onChange(selected ? null : n)}
                activeOpacity={0.7}
              >
                <Text style={[styles.boxText, { color: selected ? color : colors.mutedForeground }]}>
                  {n}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  }

  const styles = StyleSheet.create({
    container: { marginBottom: 16 },
    label: { fontSize: 15, fontFamily: "Inter_500Medium", marginBottom: 8 },
    boxRow: { flexDirection: "row", gap: 8 },
    box: {
      flex: 1,
      height: 40,
      borderRadius: 10,
      borderWidth: 1.5,
      alignItems: "center",
      justifyContent: "center",
    },
    boxText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  });
  ```

- [ ] Delete `components/SliderInput.tsx`.

#### 6. Delete the Morning/Evening check-in screen; move symptoms onto the home page

**Files:** modify `app/(tabs)/index.tsx`; delete `app/(tabs)/check-in.tsx`

- [ ] Delete `app/(tabs)/check-in.tsx` entirely — its tab toggle, its Save
      button and its route are all obsolete now that there is nothing to
      navigate to.
- [ ] In `app/(tabs)/index.tsx`, replace the imports of the removed pieces and add the new ones:

  ```ts
  import { activeItems } from "@/constants/catalog";
  import ScoreBoxInput from "@/components/ScoreBoxInput";
  ```

- [ ] Replace the two-tile `morningLog`/`eveningLog` derivation with a single log for the selected day:

  ```ts
  const selectedSymptomLog = selectedSymptomLogs[0]; // at most one, by construction
  const { symptoms } = useAppContext(); // add to the existing destructure
  const activeSymptoms = activeItems(symptoms);
  const recordedCount = activeSymptoms.filter(s => selectedSymptomLog?.scores[s.id] != null).length;
  ```

- [ ] Replace the "Check-ins" stat tile's `x/2` with a count against however
      many symptoms exist today, so the tile still means something once the
      catalog is user-sized rather than fixed at two sessions:

  ```tsx
  <View style={[styles.statTile, { backgroundColor: colors.card, borderColor: colors.border }]}>
    <MciIcon
      name="clipboard-pulse"
      size={22}
      color={activeSymptoms.length > 0 && recordedCount === activeSymptoms.length ? colors.success : colors.warning}
    />
    <Text style={[styles.statNum, { color: colors.foreground }]}>
      {recordedCount}/{activeSymptoms.length}
    </Text>
    <Text style={[styles.statTxt, { color: colors.mutedForeground }]}>Check-in</Text>
  </View>
  ```

- [ ] Replace the "Check-ins" section — the `sectionHeader` with its "Log Now"
      link plus the `checkInRow` of two `TouchableOpacity` cards — with an
      inline "Symptoms" section that **is** the input, editable only for
      today (matching how `PhaseStatusCard` is only interactive on `isToday`
      elsewhere on this same page — a past day is read-only history, not
      something to retroactively edit):

  **REVERSED 2026-08-24 at the user's request: a past day IS editable.** The
  read-only rule was inferred from how `PhaseStatusCard` behaves on this page,
  not from anything the user asked for, and it was wrong for this feature.
  Remembering to record a symptom a day or two late is the normal case for a
  symptom tracker, not an exception to guard against — and unlike starting a
  phase retroactively, filling in a past score rewrites nothing: the phase is
  re-derived from the ledger for that date, so the log is stamped with the phase
  the day was actually on. Only the `if (!isToday) return` guard and the
  `readOnly` prop are removed; future days need no guard because the week strip
  disables them.

  **AMENDED 2026-08-24 — the section header owns the symptom catalog.** The
  copy this step originally carried ("add one in Log Urge to get started") was
  factually wrong and would have shipped a feature the user could never reach.
  Symptoms were manageable only from `app/(tabs)/check-in.tsx`, which this step
  deletes; `scratch-tracker.tsx`'s manager is only ever opened for
  `bodyLocation`, `cue` and `routine` from the three pickers above it. With no
  entry point here, the symptom catalog starts empty and can never be filled —
  the home page would show that empty state forever. So the header carries a
  Manage button, and the empty state points at it rather than at another screen:

  ```tsx
  <View style={styles.sectionHeader}>
    <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Symptoms</Text>
    <TouchableOpacity onPress={() => setManagingSymptoms(true)}>
      <Text style={[styles.sectionLink, { color: colors.primary }]}>Manage</Text>
    </TouchableOpacity>
  </View>
  {activeSymptoms.length === 0 ? (
    <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
      No check-in items yet — tap Manage to add one
    </Text>
  ) : (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {activeSymptoms.map(symptom => (
        <ScoreBoxInput
          key={symptom.id}
          label={symptom.name}
          value={selectedSymptomLog?.scores[symptom.id] ?? null}
          onChange={value => {
            if (!isToday) return;
            addSymptomLog({
              date: selectedDate,
              // Only this one box's value. addSymptomLog merges it over
              // whatever today's log already holds, so every other box's
              // score (and any archived symptom's) survives untouched.
              scores: { [symptom.id]: value },
            });
          }}
        />
      ))}
    </View>
  )}
  ```

  Each tap saves immediately — there is no separate Save button on the home
  page. That is a deliberate simplification over the old check-in screen's
  explicit Save: a single box toggle is a complete, self-contained edit (unlike
  the food logger's multi-item selection in Task 8), so an extra button and an
  extra piece of "unsaved changes" state would add a step without adding
  safety. If that reads as too eager in practice, the fallback is a transient
  "Saved" toast rather than reintroducing a Save button.

  **`addSymptomLog` must be robust to two taps inside one render.** It is a
  `useCallback` closed over `symptomLogs`, so two boxes tapped in quick
  succession — faster than React commits the first update — both build their
  next array from the same pre-tap snapshot, and the second tap's write drops
  the first tap's score. This is the exact defect Task 8 shipped and had to fix,
  except save-per-tap makes it reachable by ordinary fast tapping rather than by
  a loop. Unlike Task 8 there is no batch to hoist, so fix it at the mutator:
  have `addSymptomLog` derive its next state inside the `setState` updater
  (`setSymptomLogs(prev => …)`) and persist what that updater produced, so each
  call folds onto the latest committed value rather than a captured one. Add a
  test in `tests/` that applies two merges built from the same starting snapshot
  and asserts both scores survive.

- [ ] Mount the symptom manager, using the same hold-the-kind-through-dismissal
      shape `scratch-tracker.tsx` already uses, and the same nesting comment:

  ```tsx
  const [managingSymptoms, setManagingSymptoms] = useState(false);
  // …at the end of the screen's tree:
  <CatalogManagerModal
    visible={managingSymptoms}
    kind="symptom"
    onClose={() => setManagingSymptoms(false)}
  />
  ```

  `CatalogManagerModal` is already generic over `CatalogKind` and reads its
  items and mutators from context by kind, so it needs no new props. Import it
  from `@/components/CatalogManagerModal`. Reuse the existing `sectionLink`
  style if the page has one; add it alongside `sectionTitle` if not.

- [ ] Add `addSymptomLog` and `symptoms` to the existing `useAppContext()`
      destructure at the top of the component; remove `getTodaySymptomLog`
      from it if nothing else on the page still calls it (`selectedSymptomLogs`
      already comes from filtering `symptomLogs`, so this is likely a plain
      removal).
- [ ] Delete the "Log Now" `TouchableOpacity` and the `checkInRow` block along
      with their `checkInRow` / `checkInCard` / `checkInType` / `completedBadge`
      / `completedText` / `pendingText` / `doneDot` styles that no longer have
      any consumer — check each with a source grep before deleting; do not
      remove a style still used elsewhere on the page.
- [ ] Run `pnpm typecheck` — this is where every stray `l.type` /
      `router.push("/(tabs)/check-in")` reference still outstanding surfaces
      as a compile error.

#### 7. `calendar.tsx`: one check-in block per day, not two

**Files:** modify `app/(tabs)/calendar.tsx`

The month view's day-detail modal renders a `CheckinBlock` per session
(`modalMorning`, `modalEvening`). With one log per day there is one block, and
`ScoreRow` must skip a `null` score rather than rendering `null/5`.

- [ ] Replace:

  ```ts
  const modalMorning = modalDayLogs.find(l => l.type === "Morning");
  const modalEvening = modalDayLogs.find(l => l.type === "Evening");
  ```

  with:

  ```ts
  const modalSymptomLog = modalDayLogs[0]; // at most one, by construction
  ```

  and the two render lines:

  ```tsx
  {modalMorning && <CheckinBlock log={modalMorning} label="Morning" />}
  {modalEvening && <CheckinBlock log={modalEvening} label="Evening" />}
  ```

  with one:

  ```tsx
  {modalSymptomLog && <CheckinBlock log={modalSymptomLog} label="Check-in" />}
  ```

- [ ] In `CheckinBlock`, skip unrecorded symptoms rather than averaging or
      rendering them:

  ```ts
  const scored = Object.entries(log.scores ?? {}).filter(
    (entry): entry is [string, number] => entry[1] != null,
  );
  ```

  (the rest of the function — `avg`, the `scored.map(...)` render — is
  unchanged; it already only ever saw numbers before this task, and now it
  is guaranteed to, by the filter rather than by the type.)

- [ ] `!modalMorning && !modalEvening ? (` (the empty-state branch further down)
      becomes `!modalSymptomLog ? (`.
- [ ] Run `pnpm typecheck && pnpm test`.
- [ ] Commit: `git commit -m "Show one check-in block per day in the calendar modal"`

#### 8. Export CSV: one row per day, no session-type column

**Files:** modify `app/(tabs)/export.tsx`, `tests/exportCsv.test.ts`

`buildSymptomCSV` currently emits a `session_type` column and picks the
nominal timestamp's hour from `l.type` (8am Morning / 8pm Evening — itself a
2026-08-18 bugfix for a UTC-literal day-shift). With one log per day there is
no session to pick an hour from; noon local is the least surprising nominal
instant, since it can never fall on the wrong local day regardless of the
device's UTC offset (unlike 8am/8pm, which is exactly what the comment on this
code says the *previous* version got wrong going the other way).

- [ ] Rewrite `tests/exportCsv.test.ts` for the single-timestamp case:

  ```ts
  import { describe, it, expect } from "vitest";
  import { localDateKey, startOfLocalDay } from "@/lib/dates";

  /**
   * The symptom CSV emits a nominal `timestamp_iso` for each check-in, since a
   * SymptomLog stores only a local date, not a real timestamp.
   *
   * That timestamp must agree with the `date` column sitting beside it. Noon
   * local is the nominal hour: unlike the old 8am/8pm Morning/Evening split
   * (see git history), no timezone offset pushes noon onto the adjacent local
   * day.
   *
   * This mirrors the construction in buildSymptomCSV rather than importing it:
   * export.tsx pulls in react-native-svg and cannot be loaded under a node
   * environment. It also lives here rather than beside export.tsx because
   * expo-router turns every file under `app/` into a route — a test file there
   * gets bundled, and pulling vitest into the web bundle breaks the build.
   */
  function nominalCheckInTimestamp(date: string): string {
    const at = startOfLocalDay(date);
    at.setHours(12, 0, 0, 0);
    return at.toISOString();
  }

  describe("symptom CSV timestamp", () => {
    const dates = ["2026-01-01", "2026-03-08", "2026-06-15", "2026-08-17", "2026-11-01", "2026-12-31"];

    it.each(dates)("stays on the same local day as its date column (%s)", (date) => {
      expect(localDateKey(nominalCheckInTimestamp(date))).toBe(date);
    });

    it("renders as the intended local hour", () => {
      for (const date of dates) {
        expect(new Date(nominalCheckInTimestamp(date)).getHours()).toBe(12);
      }
    });
  });
  ```

- [ ] Run `pnpm test` — fails (`export.tsx` still builds the Morning/Evening timestamp and the file's own shape hasn't moved yet — this test is standalone, so it actually fails only in the sense that it now describes behavior `export.tsx` doesn't yet match; treat `pnpm typecheck` on `export.tsx` as the forcing function for the next step).
- [ ] In `app/(tabs)/export.tsx`'s `buildSymptomCSV`, drop the `session_type` column, fix the nominal timestamp, and stop counting a `null` score into the average:

  ```ts
  const header = row(
    "log_id", "date", "timestamp_iso",
    "phase",
    ...symptomColumns, "symptom_avg",
  );
  const lines = symptomLogs.map(l => {
    // Averaged over the symptoms this log actually scored — neither a symptom
    // predating this log nor one shown and left unrecorded drags it down.
    const scores = l.scores ?? {};
    const scored = symptomIds.map(id => scores[id]).filter((v): v is number => v != null);
    const avg = scored.length ? (scored.reduce((a, b) => a + b, 0) / scored.length).toFixed(3) : "";
    // A nominal instant for the check-in, anchored in LOCAL noon — see
    // tests/exportCsv.test.ts for why noon and not a fixed UTC offset.
    const at = startOfLocalDay(l.date);
    at.setHours(12, 0, 0, 0);
    const ts = at.toISOString();
    return row(
      l.id, l.date, ts,
      l.phase ?? "",
      ...symptomIds.map(id => scores[id] ?? ""), avg,
    );
  });
  ```

  (`scores[id] ?? ""` already renders both an absent key and an explicit
  `null` as the empty CSV cell, since `??` treats `null` as nullish — no
  further change needed there.)

- [ ] Run `pnpm test` — `tests/exportCsv.test.ts` and everything else green.
- [ ] Commit: `git commit -m "Export one symptom row per day, dropping the session-type column"`

#### 9. Final check

- [ ] `pnpm typecheck && pnpm test`, plus `TZ=America/Los_Angeles pnpm test` and `TZ=Pacific/Chatham pnpm test`
- [ ] Manual check: open the home page, tap a box for a symptom, confirm it
      highlights; tap it again, confirm it clears; switch to a past day on the
      week strip and confirm the boxes are editable there too (see the
      REVERSED note in step 6 — past days were briefly read-only)
- [ ] Commit the remaining changes (steps 1, 3, 5, 6 land together since they
      touch the same data flow end-to-end): `git commit -m "Replace Morning/Evening check-ins with one daily check-in on the home page"`

---

## Risks

**The wipe is irreversible, and deliberately unguarded.** The user declined a
safety export, so Task 2 destroys the existing check-in, food and urge history
with no way back. Habit definitions and habit logs survive.

**~~`phase` becoming nullable~~ — retired by the `"none"` decision.** Widening `Phase` instead of making it nullable converts what would have been a hand-sweep of every consumer into a typecheck failure at each site. Task 5 does the widening first precisely so the compiler produces that list.

**Deleting a referenced catalog item is the main new data-loss surface.** Task 3's archive-if-referenced rule is the mitigation, and it needs tests in both directions before any screen calls it.

**Editable records need their timestamp stamped on every write.** The recency
merge is only as good as the field it reads, and a record saved without
`updated_at` silently falls back to local-wins — reintroducing exactly the loss
Task 1 removes. Any new mutator touching an editable collection must stamp it.

**Restore resurrects deletions.** The merge is union-only, so the cloud's
presence beats a local absence: delete a food, fail to back up, restore later,
and it returns. Fixing that needs tombstones, which is the machinery that caused
the original data loss — so it stays as a documented cost, not a bug to fix.

**Two schema changes land in one plan.** Catalogs (Phase 1) and the ledger (Phase 2) are independent — if the ledger work turns out harder than expected, Phase 1 plus Phase 3 is still a coherent, shippable app.
