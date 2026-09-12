# Meals, tag intensity and UI fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group a save's foods into a renamable, re-timeable meal; grade how much of a tag a food carries; make the symptom CSV human-readable; and clear a batch of small UI defects.

**Architecture:** Two schema additions, both optional and both absent-means-unset, so nothing on disk is rewritten and no migration runs. `ConsumptionLog` gains `group_id` and `meal`; `FoodItem` gains `tag_intensity`. All grouping, filtering and dose logic lands in pure `lib/` modules that vitest can import; the screens only render what those modules return.

**Tech Stack:** Expo SDK 54, React Native 0.81, expo-router, TypeScript, AsyncStorage, optional Firestore sync, vitest.

**Spec:** Design settled in conversation on 2026-08-31; the decisions and their reasoning are inlined per task below. Background specs that still bind: `docs/superpowers/specs/2026-08-24-user-owned-food-vocabulary-design.md` and `docs/superpowers/specs/2026-08-24-phase-spans-design.md`.

## Global Constraints

- `CURRENT_SCHEMA_VERSION` **stays 4**. Raising it fires `runSchemaMigration`, which wipes consumption logs, symptom logs, scratch logs and custom foods. No task in this plan may change it.
- Never create a `*.test.ts` under `app/`. expo-router bundles that directory and `pnpm build` breaks. All tests go in `artifacts/ecztrack/tests/`.
- Never import `context/AppContext.tsx` from a test. It fails to parse under vitest. Logic that needs testing goes in a pure `lib/` module.
- `Alert.alert` is a no-op on react-native-web. Use `notify` / `confirmDestructive` from `lib/dialogs.ts`.
- `"none"` is a real `Phase` member and is **not** nullish. Never use `??` over a phase value.
- Date keys are `YYYY-MM-DD` from `lib/dates.ts`. Never `.split("T")[0]`. Day arithmetic goes through `addDaysToKey` / `daysBetweenKeys`.
- Every AppContext mutator is a `useCallback` closed over its current array. Two writes derived from one snapshot lose one. Batch mutations in a single pure function (see `prependConsumptionLogs`), or read `lib/logCell.ts`.
- New fields are written only when present. `defined()` in `lib/repo/converters.ts` strips `undefined` on the way to Firestore; never write an explicit default in its place.
- Every guard added in this plan gets a mutation check: change the guard to the obvious wrong thing and confirm a test fails. On the previous two branches seven guards pinned nothing, and only mutation testing found that.
- Run from `artifacts/ecztrack`: `pnpm test` (vitest), `pnpm typecheck`, `pnpm lint`.

---

## Task 1: Mechanical UI batch

Four independent one-to-few-line edits with no shared logic. One commit.

**Files:**
- Modify: `artifacts/ecztrack/components/FoodCard.tsx:70-76`
- Modify: `artifacts/ecztrack/app/(tabs)/export.tsx:397-404`
- Modify: `artifacts/ecztrack/components/HabitEditModal.tsx:262-268`
- Modify: `artifacts/ecztrack/components/ScratchLogEditModal.tsx:129-131,303-310`
- Modify: `artifacts/ecztrack/app/(tabs)/scratch-tracker.tsx:357-359`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing later tasks rely on.

- [ ] **Step 1: Remove the "Custom" badge from food cards**

In `components/FoodCard.tsx`, delete the whole badge `<View>` whose `<Text>` reads `Custom` (around line 74), together with the `food.is_custom &&` condition that guards it. Leave the `is_custom` field on `FoodItem` alone — it is still written by `addCustomFood` and read by the backup merge; only the badge goes.

After deleting, check whether `styles.badge` / `styles.badgeText` are still referenced anywhere in the file. If the "Warning" chip beside it uses them, keep them; if nothing does, delete those two style entries too.

- [ ] **Step 2: Remove the Python quick-start card from the Export screen**

In `app/(tabs)/export.tsx`, delete the entire `{/* Python snippet */}` `<View style={[styles.codeCard, …]}>` block, including its `codeTitle` and `code` children. Then delete the now-unused `codeCard`, `codeTitle` and `code` entries from the `StyleSheet.create` block at the bottom of the same file.

- [ ] **Step 3: Fix the top margin on the New Habit modal**

`components/FoodEditModal.tsx` is the correct reference: its header applies `paddingTop: Platform.OS === "web" ? 20 : insets.top + 8`. `HabitEditModal` instead hardcodes `paddingTop: 20` in its stylesheet, so on Android the title sits under the status bar.

In `components/HabitEditModal.tsx`, delete `paddingTop: 20` from the `header` style block (line 268), and apply it inline on the header `<View>` instead. It already has `insets` in scope from `useSafeAreaInsets()` at line 28:

```tsx
<View style={[styles.header, { borderBottomColor: colors.border, paddingTop: Platform.OS === "web" ? 20 : insets.top + 8 }]}>
```

Confirm `Platform` is imported in this file; add it to the `react-native` import if it is not.

- [ ] **Step 4: Fix the top margin on the Log Scratch Urge modal**

`components/ScratchLogEditModal.tsx` never reads safe-area insets at all. Add the import and hook, matching `HabitEditModal`:

```tsx
import { useSafeAreaInsets } from "react-native-safe-area-context";
```

and inside the component:

```tsx
const insets = useSafeAreaInsets();
```

Then apply the same inline padding to the `modalHeader` `<View>` at line 130:

```tsx
<View style={[styles.modalHeader, { borderBottomColor: colors.border, paddingTop: Platform.OS === "web" ? 20 : insets.top + 8 }]}>
```

Leave `paddingVertical: 14` in the `modalHeader` style — the inline `paddingTop` overrides it for the top edge only, which is the intent.

- [ ] **Step 5: Rename the Habit Reversal section**

In `app/(tabs)/scratch-tracker.tsx` line 359, change the section title text from `Habit Reversal` to `Urges Tracked`. Change only this visible string. Do not rename `ScratchLog`, `scratchLogs`, the storage key, the CSV filename, or any identifier — the on-disk names are load-bearing and a rename would orphan data.

- [ ] **Step 6: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all pass. No test covers these strings, so the suite should be unchanged at its current count.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Drop the Custom badge, the Python card, and two bad top margins"
```

---

## Task 2: Symptom CSV columns headed by name

**Files:**
- Modify: `artifacts/ecztrack/lib/exportCsv.ts:117-121`
- Test: `artifacts/ecztrack/tests/exportCsv.test.ts`

**Interfaces:**
- Consumes: `itemName(items, id)` from `constants/catalog`, already imported.
- Produces: nothing later tasks rely on.

**Why:** the header currently reads `<id> (<name>)`, and a user-created symptom's id is a `Date.now()` string, so a spreadsheet column reads `1787915098118 (Itching)` with the name cut off. The id was there to be the stable key across exports. The JSON export already carries the full `symptoms` catalog with ids, and that is what an analysis reads, so the CSV can be for humans.

- [ ] **Step 1: Write the failing test**

Add to `tests/exportCsv.test.ts`, inside the existing `describe("buildSymptomCSV", …)` block:

```ts
it("heads each symptom column with its name, not its id", () => {
  const symptoms = [{ id: "1787915098118", name: "Itching", order: 0, isArchived: false }];
  const logs = [{ id: "l1", date: "2026-08-30", scores: { "1787915098118": 3 } }];
  const [header] = buildSymptomCSV(logs, symptoms).split("\n");
  expect(header).toContain("Itching");
  expect(header).not.toContain("1787915098118");
});

it("falls back to the raw id when the symptom is not in the catalog", () => {
  // An archived-then-purged symptom still has scores on old logs. A blank
  // column heading would make the sheet unreadable and could collide with
  // another blank.
  const logs = [{ id: "l1", date: "2026-08-30", scores: { gone: 3 } }];
  const [header] = buildSymptomCSV(logs, []).split("\n");
  expect(header.split(",")).toContain("gone");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test tests/exportCsv.test.ts`
Expected: FAIL — the header contains `1787915098118 (Itching)`, so `not.toContain` fails.

- [ ] **Step 3: Change the header builder**

In `lib/exportCsv.ts`, replace the `symptomColumns` block (lines 117-121) with:

```ts
  // Headed by name, for a human opening the sheet. `itemName` returns the id
  // unchanged when the symptom is gone from the catalog, which is the right
  // fallback: an unreadable heading beats a blank one, and two purged symptoms
  // would otherwise produce two identical empty columns.
  //
  // The id is not lost — the JSON export carries the whole `symptoms` catalog,
  // and that is the file an analysis actually loads. This one is for reading.
  const symptomColumns = symptomIds.map(id => itemName(symptoms, id));
```

Leave the `symptomIds` collection loop and every row builder untouched — the rows are keyed by id and must stay that way.

- [ ] **Step 4: Verify**

Run: `pnpm test tests/exportCsv.test.ts`
Expected: PASS, including the pre-existing symptom CSV tests.

- [ ] **Step 5: Mutation-check the fallback**

Temporarily replace `itemName(symptoms, id)` with `symptoms.find(s => s.id === id)?.name ?? ""`. Re-run the tests. The second new test MUST fail. Restore the real line.

If it does not fail, the fallback assertion is not pinning anything — fix the test before moving on.

- [ ] **Step 6: Commit**

```bash
git add artifacts/ecztrack/lib/exportCsv.ts artifacts/ecztrack/tests/exportCsv.test.ts
git commit -m "Head symptom columns with the name a person can read"
```

---

## Task 3: Time-range filter on the urge log

**Files:**
- Create: `artifacts/ecztrack/lib/timeRange.ts`
- Create: `artifacts/ecztrack/tests/timeRange.test.ts`
- Modify: `artifacts/ecztrack/app/(tabs)/scratch-tracker.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `lib/timeRange.ts` exporting `TIME_RANGES`, `type TimeRangeKey`, and `filterByRecency<T extends { timestamp: string }>(items, range, nowMs)`. Nothing later in this plan uses it, but keep the generic signature — the food log is the obvious second caller.

**Why:** the urge list is an unbounded `FlatList` over every log ever written. At 100+ entries it is one long scroll with no way to look at just this week.

- [ ] **Step 1: Write the failing test**

Create `tests/timeRange.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { TIME_RANGES, filterByRecency } from "@/lib/timeRange";

const NOW = new Date("2026-08-31T12:00:00.000Z").getTime();
const at = (iso: string) => ({ timestamp: iso });

describe("filterByRecency", () => {
  it("keeps only the last 7 days for 'week'", () => {
    const items = [at("2026-08-30T12:00:00.000Z"), at("2026-08-20T12:00:00.000Z")];
    expect(filterByRecency(items, "week", NOW)).toHaveLength(1);
  });

  it("keeps everything for 'all'", () => {
    const items = [at("2020-01-01T00:00:00.000Z"), at("2026-08-30T12:00:00.000Z")];
    expect(filterByRecency(items, "all", NOW)).toHaveLength(2);
  });

  it("keeps an item exactly on the boundary", () => {
    // Inclusive on purpose: a log written seven days ago to the millisecond is
    // inside "last week" by every reading a person has of that phrase.
    const items = [at(new Date(NOW - 7 * 86400000).toISOString())];
    expect(filterByRecency(items, "week", NOW)).toHaveLength(1);
  });

  it("keeps a future-stamped log in every bounded range", () => {
    // Retimed meals and retrospective entries can sit slightly ahead of now.
    // A cutoff comparison that only checks the lower bound keeps them, which is
    // what we want — dropping them would hide the entry the user just edited.
    const items = [at("2026-09-05T12:00:00.000Z")];
    expect(filterByRecency(items, "week", NOW)).toHaveLength(1);
  });

  it("orders the ranges shortest first, with 'all' last", () => {
    expect(TIME_RANGES.map(r => r.key)).toEqual(["week", "fortnight", "month", "quarter", "all"]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test tests/timeRange.test.ts`
Expected: FAIL — `Cannot find module '@/lib/timeRange'`.

- [ ] **Step 3: Write the module**

Create `lib/timeRange.ts`:

```ts
/**
 * How far back a list looks.
 *
 * Pure and clock-injected, like everything in lib/phases.ts: the caller passes
 * `nowMs`, so a test needs no fake timers and the same input always gives the
 * same answer.
 */

/** `null` days means no lower bound at all. */
export const TIME_RANGES = [
  { key: "week",      label: "7 days",   days: 7 },
  { key: "fortnight", label: "14 days",  days: 14 },
  { key: "month",     label: "30 days",  days: 30 },
  { key: "quarter",   label: "90 days",  days: 90 },
  { key: "all",       label: "All time", days: null },
] as const;

export type TimeRangeKey = typeof TIME_RANGES[number]["key"];

const DAY_MS = 86_400_000;

/**
 * The items stamped within `range` of `nowMs`.
 *
 * Only a lower bound is applied. A log stamped slightly in the future is real —
 * a retimed meal, or a retrospective entry saved a minute fast — and dropping
 * it would hide the row the user just edited.
 *
 * The bound is inclusive: an item exactly seven days old is inside "7 days".
 */
export function filterByRecency<T extends { timestamp: string }>(
  items: T[],
  range: TimeRangeKey,
  nowMs: number,
): T[] {
  const spec = TIME_RANGES.find(r => r.key === range);
  if (!spec || spec.days === null) return items;
  const cutoff = nowMs - spec.days * DAY_MS;
  return items.filter(i => new Date(i.timestamp).getTime() >= cutoff);
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test tests/timeRange.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation-check the inclusive bound and the future case**

Change `>= cutoff` to `> cutoff` and re-run: the boundary test MUST fail. Then add `&& new Date(i.timestamp).getTime() <= nowMs` to the filter and re-run: the future-stamped test MUST fail. Restore the real line after each.

- [ ] **Step 6: Wire the filter into the urge list**

In `app/(tabs)/scratch-tracker.tsx`:

Import the module:

```tsx
import { TIME_RANGES, filterByRecency, type TimeRangeKey } from "@/lib/timeRange";
```

Add state beside the screen's other `useState` calls. Default to `"month"` — long enough to see a pattern, short enough that the list stays scrollable:

```tsx
const [range, setRange] = useState<TimeRangeKey>("month");
```

Derive the list per render, not in a `useMemo` keyed on mount — this tab is mounted once and never unmounts, so `Date.now()` must be read on each render or the window freezes at whenever the app was opened:

```tsx
const visibleLogs = filterByRecency(scratchLogs, range, Date.now());
```

Change the `FlatList`'s `data={scratchLogs}` to `data={visibleLogs}`.

Render a chip row directly under the `Urges Tracked` section header, inside `ListHeader`, styled like the food logger's category chips:

```tsx
<ScrollView
  horizontal
  showsHorizontalScrollIndicator={false}
  contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 12 }}
>
  {TIME_RANGES.map(r => (
    <TouchableOpacity
      key={r.key}
      onPress={() => setRange(r.key)}
      activeOpacity={0.7}
      style={{
        paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
        backgroundColor: range === r.key ? colors.primary : colors.card,
        borderWidth: 1, borderColor: colors.border,
      }}
    >
      <Text style={{
        fontSize: 13, fontFamily: "Inter_600SemiBold",
        color: range === r.key ? colors.primaryForeground : colors.mutedForeground,
      }}>
        {r.label}
      </Text>
    </TouchableOpacity>
  ))}
</ScrollView>
```

`ScrollView` is already imported in this file; confirm before adding it.

- [ ] **Step 7: Fix the stats and the empty state**

The `totalLogs`, `resistRate` and `resistedCount` tiles currently count every log. Leave them counting **all** logs, not the filtered ones — they are a lifetime summary and making them jump when a chip is tapped would misread as data loss. Add a `Text` under the chip row when `range !== "all"`, reading:

```tsx
{range !== "all" && (
  <Text style={{ paddingHorizontal: 16, marginBottom: 10, fontSize: 12, color: colors.mutedForeground }}>
    Showing {visibleLogs.length} of {scratchLogs.length} entries · stats above cover all time
  </Text>
)}
```

The `ListEmptyComponent` currently says "No urge events yet" with a "Log First Entry" button. That is wrong when the list is empty only because of the filter. Change it to branch:

```tsx
ListEmptyComponent={
  scratchLogs.length > 0 ? (
    <View style={styles.emptyScratch}>
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Nothing in this range</Text>
      <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
        Pick a longer range to see older entries.
      </Text>
    </View>
  ) : (
    /* the existing "No urge events yet" block, unchanged */
  )
}
```

- [ ] **Step 8: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Let the urge log show one window at a time"
```

---

## Task 4: Meals in the data model

The pure half of meal grouping. No UI in this task.

**Files:**
- Modify: `artifacts/ecztrack/constants/types.ts` (`ConsumptionLog`)
- Create: `artifacts/ecztrack/lib/mealGroups.ts`
- Create: `artifacts/ecztrack/tests/mealGroups.test.ts`
- Modify: `artifacts/ecztrack/lib/foodLog.ts` (`prependConsumptionLogs`)
- Modify: `artifacts/ecztrack/tests/foodLog.test.ts`
- Modify: `artifacts/ecztrack/lib/repo/converters.ts` (`consumptionLogConverter`)

**Interfaces:**
- Consumes: `generateId()` from `lib/ids`, `localDateKey` from `lib/dates`, `phaseOnDate` from `lib/phases`.
- Produces, for Task 5 and Task 6:
  - `ConsumptionLog.group_id?: string` and `ConsumptionLog.meal?: string`
  - `DEFAULT_MEAL_LABEL = "Meal"` from `lib/mealGroups`
  - `interface MealGroup { groupId: string; label: string; entries: ConsumptionLog[]; timestamp: string; hasAccident: boolean }`
  - `groupLogsByMeal(logs: ConsumptionLog[]): MealGroup[]`
  - `renameMealIn(logs, groupId, label): ConsumptionLog[]`
  - `retimeMealIn(logs, groupId, iso, phase): ConsumptionLog[]`
  - `prependConsumptionLogs` opts gain `groupId?: string; meal?: string`

**Why a shared id and not a shared timestamp:** two separate saves seconds apart would merge into one meal the user never ate together. The id is written once at save time and is the only thing that says "these went in together".

**Why the label lives on every log and not in a side table:** a side table is a second representation of one fact that has to stay in step with deletes, the backup merge and the Firestore sync. Copying a short string onto each row of one save costs nothing and makes each log self-describing in the CSV.

- [ ] **Step 1: Extend the type**

In `constants/types.ts`, add to `ConsumptionLog` after `portion`:

```ts
  /**
   * The save this log came in with. Every food selected in one Save shares
   * one id, and that id — not a shared timestamp — is what makes them one
   * meal: two saves a few seconds apart are two meals, not one.
   *
   * Absent on every log written before meals existed. Such a log stands alone,
   * which is exactly how it was displayed at the time.
   */
  group_id?: string;
  /**
   * What the meal is called. Defaults to "Meal" at save time and is renamable
   * afterwards. Stored on each log of the group rather than in a side table:
   * one string per row keeps every log self-describing and removes a second
   * representation that deletes, sync and the backup merge would all have to
   * keep in step.
   */
  meal?: string;
```

- [ ] **Step 2: Write the failing tests**

Create `tests/mealGroups.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { groupLogsByMeal, renameMealIn, retimeMealIn, DEFAULT_MEAL_LABEL } from "@/lib/mealGroups";
import type { ConsumptionLog } from "@/constants/types";

const log = (over: Partial<ConsumptionLog>): ConsumptionLog => ({
  id: "x", timestamp: "2026-08-30T12:00:00.000Z", item_id: "f", phase: "none",
  is_accident: false, ...over,
});

describe("groupLogsByMeal", () => {
  it("puts one save's foods in one group", () => {
    const logs = [
      log({ id: "a", item_id: "bread", group_id: "g1", meal: "Dinner" }),
      log({ id: "b", item_id: "eggs",  group_id: "g1", meal: "Dinner" }),
    ];
    const groups = groupLogsByMeal(logs);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Dinner");
    expect(groups[0].entries.map(e => e.item_id)).toEqual(["bread", "eggs"]);
  });

  it("keeps two saves apart even at the same timestamp", () => {
    // The whole reason group_id exists. Two saves in the same minute are two
    // meals; grouping on the timestamp would silently merge them.
    const logs = [
      log({ id: "a", group_id: "g1" }),
      log({ id: "b", group_id: "g2" }),
    ];
    expect(groupLogsByMeal(logs)).toHaveLength(2);
  });

  it("gives a log with no group_id its own group", () => {
    // Every log written before meals existed. It must still render.
    const logs = [log({ id: "old" })];
    const groups = groupLogsByMeal(logs);
    expect(groups).toHaveLength(1);
    expect(groups[0].groupId).toBe("old");
    expect(groups[0].label).toBe(DEFAULT_MEAL_LABEL);
  });

  it("orders groups newest first by instant, not by string", () => {
    // A retrospective entry can carry a +08:00 offset instead of Z, so string
    // order and time order disagree.
    const logs = [
      log({ id: "a", group_id: "g1", timestamp: "2026-08-30T01:00:00.000Z" }),
      log({ id: "b", group_id: "g2", timestamp: "2026-08-30T08:00:00+08:00" }),
    ];
    expect(groupLogsByMeal(logs).map(g => g.groupId)).toEqual(["g1", "g2"]);
  });

  it("flags a group where any one entry was accidental", () => {
    const logs = [
      log({ id: "a", group_id: "g1", is_accident: false }),
      log({ id: "b", group_id: "g1", is_accident: true }),
    ];
    expect(groupLogsByMeal(logs)[0].hasAccident).toBe(true);
  });

  it("takes the group's timestamp from its earliest entry", () => {
    const logs = [
      log({ id: "a", group_id: "g1", timestamp: "2026-08-30T13:00:00.000Z" }),
      log({ id: "b", group_id: "g1", timestamp: "2026-08-30T12:00:00.000Z" }),
    ];
    expect(groupLogsByMeal(logs)[0].timestamp).toBe("2026-08-30T12:00:00.000Z");
  });
});

describe("renameMealIn", () => {
  it("renames every log in the group and nothing else", () => {
    const logs = [
      log({ id: "a", group_id: "g1", meal: "Meal" }),
      log({ id: "b", group_id: "g1", meal: "Meal" }),
      log({ id: "c", group_id: "g2", meal: "Meal" }),
    ];
    const out = renameMealIn(logs, "g1", "  Dinner  ");
    expect(out.filter(l => l.meal === "Dinner")).toHaveLength(2);
    expect(out.find(l => l.id === "c")!.meal).toBe("Meal");
  });

  it("falls back to the default rather than storing a blank name", () => {
    // A blank label renders as an empty row with no way to tell what it was.
    const logs = [log({ id: "a", group_id: "g1", meal: "Dinner" })];
    expect(renameMealIn(logs, "g1", "   ")[0].meal).toBe(DEFAULT_MEAL_LABEL);
  });
});

describe("retimeMealIn", () => {
  it("moves every log in the group and restamps the phase", () => {
    const logs = [
      log({ id: "a", group_id: "g1", phase: "none" }),
      log({ id: "b", group_id: "g1", phase: "none" }),
      log({ id: "c", group_id: "g2", phase: "none" }),
    ];
    const out = retimeMealIn(logs, "g1", "2026-08-25T09:00:00.000Z", "elimination");
    expect(out.filter(l => l.timestamp === "2026-08-25T09:00:00.000Z")).toHaveLength(2);
    expect(out.filter(l => l.phase === "elimination")).toHaveLength(2);
    expect(out.find(l => l.id === "c")!.phase).toBe("none");
  });
});
```

- [ ] **Step 3: Run and watch it fail**

Run: `pnpm test tests/mealGroups.test.ts`
Expected: FAIL — `Cannot find module '@/lib/mealGroups'`.

- [ ] **Step 4: Write the module**

Create `lib/mealGroups.ts`:

```ts
/**
 * A meal: the foods that went in on one Save.
 *
 * Grouping is a view of the logs, not a second record of them. Each
 * ConsumptionLog still stands alone with its own id, food, portion and phase —
 * which is what keeps the CSV one row per food and the analysis unchanged. All
 * a group does is decide which rows are drawn together.
 *
 * Pure, so vitest can import it: the screen it serves imports react-native and
 * expo-router, neither of which loads under the node environment.
 */
import type { ConsumptionLog, Phase } from "@/constants/types";

/** What an unnamed meal is called. */
export const DEFAULT_MEAL_LABEL = "Meal";

export interface MealGroup {
  /** The shared `group_id`, or the lone log's own id when it has none. */
  groupId: string;
  label: string;
  /** The individual logs, oldest first — the order they were selected in. */
  entries: ConsumptionLog[];
  /** When the meal was eaten: its earliest entry's timestamp. */
  timestamp: string;
  /** True if any one entry was an accidental exposure. */
  hasAccident: boolean;
}

const at = (l: ConsumptionLog) => new Date(l.timestamp).getTime();

/**
 * One group per save, newest first.
 *
 * A log with no `group_id` becomes a singleton keyed by its own id. Every log
 * written before meals existed is in that state, and it must still render —
 * falling back to the id rather than to a shared empty-string key matters,
 * because one shared key would collapse the entire history into one meal.
 *
 * Ordering compares instants, not the timestamp strings. A retrospective entry
 * can be stamped with a UTC offset instead of `Z`, so string order and time
 * order disagree, and the wrong meal would sort to the top.
 */
export function groupLogsByMeal(logs: ConsumptionLog[]): MealGroup[] {
  const byGroup = new Map<string, ConsumptionLog[]>();
  for (const l of logs) {
    const key = l.group_id ?? l.id;
    const existing = byGroup.get(key);
    if (existing) existing.push(l);
    else byGroup.set(key, [l]);
  }
  return [...byGroup.entries()]
    .map(([groupId, entries]) => {
      const sorted = [...entries].sort((a, b) => at(a) - at(b));
      return {
        groupId,
        // Read off the first entry: a rename writes every log in the group, so
        // they agree. A group whose logs somehow disagree still renders.
        label: sorted[0].meal?.trim() || DEFAULT_MEAL_LABEL,
        entries: sorted,
        timestamp: sorted[0].timestamp,
        hasAccident: sorted.some(l => l.is_accident),
      };
    })
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

/**
 * Renames one meal.
 *
 * A blank name is replaced by the default rather than stored: an empty label
 * renders as a nameless row with nothing to identify it by, and the user
 * cannot then tap it to fix it.
 */
export function renameMealIn(
  logs: ConsumptionLog[], groupId: string, label: string,
): ConsumptionLog[] {
  const name = label.trim() || DEFAULT_MEAL_LABEL;
  return logs.map(l => ((l.group_id ?? l.id) === groupId ? { ...l, meal: name } : l));
}

/**
 * Moves one meal to another time, restamping its phase.
 *
 * The phase is passed in rather than derived here, so this stays pure and the
 * ledger stays the caller's business — the same split `updateScratchLog` uses.
 * It must be re-derived and not carried over: moving a meal into an
 * elimination window has to stamp elimination, or the export disagrees with
 * the calendar.
 */
export function retimeMealIn(
  logs: ConsumptionLog[], groupId: string, iso: string, phase: Phase,
): ConsumptionLog[] {
  return logs.map(l =>
    (l.group_id ?? l.id) === groupId ? { ...l, timestamp: iso, phase } : l);
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm test tests/mealGroups.test.ts`
Expected: PASS.

- [ ] **Step 6: Mutation-check three guards**

Each of these MUST make a test fail. Restore the real line after each.

1. Change `l.group_id ?? l.id` to `l.group_id ?? ""` in `groupLogsByMeal` — the ungrouped-log test must fail.
2. Change `sorted[0].meal?.trim() || DEFAULT_MEAL_LABEL` to `sorted[0].meal ?? DEFAULT_MEAL_LABEL` — the blank-rename test must fail. (If it does not, add a `groupLogsByMeal` case for a log whose stored `meal` is `"   "`.)
3. Change `at(a) - at(b)` to a string comparison — the offset-timestamp ordering test must fail.

- [ ] **Step 7: Write the group id at save time**

In `lib/foodLog.ts`, extend the `prependConsumptionLogs` options and the created record:

```ts
  opts: {
    timestamp: string; phase: Phase; isAccident?: boolean;
    portions?: Record<string, Portion>;
    /** Shared by every food in this save — see lib/mealGroups.ts. */
    groupId?: string;
    /** The meal's name; defaults to "Meal" at the call site. */
    meal?: string;
  },
```

and inside the `map`, after the portion spread:

```ts
    // Both left off when absent, for the same reason the portion is: `defined()`
    // strips undefined on the way to Firestore, so an ungrouped log stores no
    // field rather than a null one.
    ...(opts.groupId ? { group_id: opts.groupId } : {}),
    ...(opts.meal ? { meal: opts.meal } : {}),
```

Add to `tests/foodLog.test.ts`, in the existing `prependConsumptionLogs` describe block:

```ts
it("stamps every food in one save with the same group id", () => {
  const out = prependConsumptionLogs([], ["a", "b"], {
    timestamp: "2026-08-30T12:00:00.000Z", phase: "none",
    groupId: "g1", meal: "Dinner",
  });
  expect(out.every(l => l.group_id === "g1")).toBe(true);
  expect(out.every(l => l.meal === "Dinner")).toBe(true);
});

it("writes no group fields at all when none were given", () => {
  // Not null, not "": `defined()` only strips undefined, and a stored empty
  // string would group every legacy log together.
  const [l] = prependConsumptionLogs([], ["a"], {
    timestamp: "2026-08-30T12:00:00.000Z", phase: "none",
  });
  expect("group_id" in l).toBe(false);
  expect("meal" in l).toBe(false);
});
```

- [ ] **Step 8: Round-trip the new fields through Firestore**

In `lib/repo/converters.ts`, add to `consumptionLogConverter.fromDoc`, after `portion`:

```ts
    // Absent stays absent, exactly like portion: a log written before meals
    // existed must not come back claiming a group.
    group_id: d.group_id as string | undefined,
    meal: d.meal as string | undefined,
```

`toDoc` spreads the whole record through `defined()`, so it needs no change — confirm this by reading it rather than assuming.

Add to the converters test file, in the consumption converter block:

```ts
it("round-trips a meal's group id and label", () => {
  const log = {
    id: "l1", timestamp: "2026-08-30T12:00:00.000Z", item_id: "f", phase: "none" as const,
    is_accident: false, group_id: "g1", meal: "Dinner",
  };
  const back = consumptionLogConverter.fromDoc("l1", consumptionLogConverter.toDoc(log));
  expect(back.group_id).toBe("g1");
  expect(back.meal).toBe("Dinner");
});
```

If `tests/converters.test.ts` does not exist, find the file that tests `lib/repo/converters.ts` and add it there; if none exists, create `tests/converters.test.ts` with this one block.

**Mutation check:** delete the `group_id` line from `fromDoc` and confirm this test fails. This is exactly the class of bug that lost tag icons on restore — a field written by `toDoc` and never read back.

- [ ] **Step 9: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Give a save's foods one shared meal"
```

---

## Task 5: Meals on screen

**Files:**
- Modify: `artifacts/ecztrack/context/AppContext.tsx`
- Modify: `artifacts/ecztrack/app/(tabs)/food-logger.tsx`
- Create: `artifacts/ecztrack/components/MealEditModal.tsx`

**Interfaces:**
- Consumes: everything Task 4 produced.
- Produces: AppContext gains `renameMeal(groupId, label)` and `retimeMeal(groupId, iso)`.

**Target rendering**, from the user's description:

```
11:12 PM   Dinner                        ⌄
           Bread, Coffee, Eggs
```

Expanding shows the individual entries with their delete buttons, as today.

- [ ] **Step 1: Add the two mutators to AppContext**

Add to the context interface, beside `deleteConsumptionLog`:

```ts
  /** Renames one meal. A blank name falls back to "Meal". */
  renameMeal: (groupId: string, label: string) => Promise<void>;
  /**
   * Moves one meal to another time. Every log in it moves together and the
   * phase is re-derived from the ledger for the new date — carrying the old
   * phase over would make the export disagree with the calendar.
   */
  retimeMeal: (groupId: string, iso: string) => Promise<void>;
```

Implement them beside `deleteConsumptionLog`:

```ts
  const renameMeal = useCallback(async (groupId: string, label: string) => {
    const updated = renameMealIn(consumptionLogs, groupId, label);
    setConsumptionLogs(updated);
    await persist(STORAGE_KEYS.CONSUMPTION_LOGS, updated);
  }, [consumptionLogs]);

  const retimeMeal = useCallback(async (groupId: string, iso: string) => {
    const phase = phaseOnDate(ledger, localDateKey(iso), todayDateKey);
    const updated = retimeMealIn(consumptionLogs, groupId, iso, phase);
    setConsumptionLogs(updated);
    await persist(STORAGE_KEYS.CONSUMPTION_LOGS, updated);
  }, [consumptionLogs, ledger, todayDateKey]);
```

Import `renameMealIn`, `retimeMealIn` and `DEFAULT_MEAL_LABEL` from `@/lib/mealGroups`, and add both mutators to the context value object around line 873.

Note the closure hazard from the global constraints: each of these derives from `consumptionLogs` and writes once. That is safe. Do **not** call them in a loop.

- [ ] **Step 2: Pass a group id and label from the save**

In `addConsumptionLogs` in AppContext, mint the id once per call and default the label:

```ts
    const updated = prependConsumptionLogs(consumptionLogs, itemIds, {
      timestamp: ts,
      phase: phaseOnDate(ledger, localDateKey(ts), todayDateKey),
      isAccident: opts.isAccident,
      portions: opts.portions,
      // One id per call, so one Save is one meal. Minted here rather than by
      // the caller so every entry point gets grouping without opting in.
      groupId: generateId(),
      meal: DEFAULT_MEAL_LABEL,
    });
```

Confirm `generateId` is imported in AppContext; add `import { generateId } from "@/lib/ids";` if not.

This means a single-food save is a one-food meal. That is correct and keeps the display uniform.

- [ ] **Step 3: Build the meal edit modal**

Create `components/MealEditModal.tsx`. It has two controls: a name field and a `TimestampPicker`.

```tsx
import { useState, useEffect } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Modal, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MciIcon from "@/components/MciIcon";
import TimestampPicker from "@/components/TimestampPicker";
import { useColors } from "@/hooks/useColors";
import { useAppContext } from "@/context/AppContext";
import type { MealGroup } from "@/lib/mealGroups";

interface Props {
  group: MealGroup | null;
  onClose: () => void;
}

export default function MealEditModal({ group, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { renameMeal, retimeMeal } = useAppContext();
  const [label, setLabel] = useState("");
  const [iso, setIso] = useState("");
  const [saving, setSaving] = useState(false);

  // Re-seeded whenever a different meal is opened. The modal is mounted once
  // and reused, so state left from the last meal would leak into this one.
  useEffect(() => {
    if (!group) return;
    setLabel(group.label);
    setIso(group.timestamp);
  }, [group]);

  async function handleSave() {
    if (!group || saving) return;
    setSaving(true);
    try {
      // Two writes, sequenced with await. They must not be fired together:
      // both mutators close over the same consumptionLogs snapshot, so a
      // parallel pair would lose one edit. See the global constraints.
      await renameMeal(group.groupId, label);
      if (iso !== group.timestamp) await retimeMeal(group.groupId, iso);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={!!group} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.modal, { backgroundColor: colors.background }]}>
        <View style={[
          styles.header,
          { borderBottomColor: colors.border, paddingTop: Platform.OS === "web" ? 20 : insets.top + 8 },
        ]}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MciIcon name="close" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground }]}>Edit Meal</Text>
          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }]}
            onPress={handleSave}
            disabled={saving}
          >
            <Text style={[styles.saveText, { color: colors.primaryForeground }]}>
              {saving ? "Saving…" : "Save"}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Meal Name</Text>
            <TextInput
              style={[styles.input, { color: colors.foreground }]}
              value={label}
              onChangeText={setLabel}
              placeholder="Meal"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="sentences"
              autoFocus
            />
          </View>

          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <TimestampPicker value={iso} onChange={setIso} label="Eaten at" />
          </View>

          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            Changing the time moves every food in this meal.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1,
  },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  saveBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10 },
  saveText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  content: { padding: 16, gap: 14 },
  section: { borderRadius: 14, borderWidth: 1, padding: 14 },
  sectionLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginBottom: 8 },
  input: { fontSize: 16, fontFamily: "Inter_400Regular", paddingVertical: 6 },
  hint: { fontSize: 12, paddingHorizontal: 4 },
});
```

Check `hooks/useColors` and `components/MciIcon`'s default-vs-named export against `HabitEditModal.tsx` and match whatever it does — do not guess the import style.

- [ ] **Step 4: Render Today's Log as meals**

In `app/(tabs)/food-logger.tsx`, replace the `logGroups` derivation with:

```tsx
const mealGroups = groupLogsByMeal(todayLogs);
```

importing `groupLogsByMeal, type MealGroup` from `@/lib/mealGroups`.

Change `expandedGroups` to hold `groupId` values and add modal state:

```tsx
const [editingMeal, setEditingMeal] = useState<MealGroup | null>(null);
```

Replace the `logExpanded && logGroups.map(…)` block (lines 298-353) with:

```tsx
{logExpanded && mealGroups.map((group, idx) => {
  const expanded = expandedGroups.includes(group.groupId);
  const names = group.entries.map(e => foodName(e.item_id)).join(", ");
  const anyUnsafe = group.entries.some(e => allFoods.find(f => f.id === e.item_id)?.is_elimination_safe === false);
  return (
    <View key={group.groupId}>
      {idx > 0 && <View style={[styles.logDivider, { backgroundColor: colors.border }]} />}
      <TouchableOpacity
        style={styles.logRow}
        onPress={() => toggleGroup(group.groupId)}
        activeOpacity={0.7}
      >
        <View style={[styles.logDot, { backgroundColor: anyUnsafe ? colors.destructive : colors.success }]} />
        <View style={styles.logInfo}>
          <Text style={[styles.logName, { color: colors.foreground }]} numberOfLines={1}>
            {group.label}
          </Text>
          <Text style={[styles.logMeta, { color: colors.mutedForeground }]} numberOfLines={2}>
            {formatTime(group.timestamp)} · {names}
            {group.hasAccident ? " · ⚠ Accident" : ""}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={() => setEditingMeal(group)}
          activeOpacity={0.7}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        >
          <MciIcon name="pencil-outline" size={16} color={colors.mutedForeground} />
        </TouchableOpacity>
        <MciIcon
          name={expanded ? "chevron-up" : "chevron-down"}
          size={18}
          color={colors.mutedForeground}
        />
      </TouchableOpacity>

      {expanded && group.entries.map(entry => renderEntry(entry))}
    </View>
  );
})}
```

Every group is expandable now, including a one-food meal — the individual row is where the delete button lives, so it must always be reachable.

Mount the modal as a sibling of the scroll view, next to the other modals in this file:

```tsx
<MealEditModal group={editingMeal} onClose={() => setEditingMeal(null)} />
```

- [ ] **Step 5: Clean up the orphan**

`groupLogsByItem` in `lib/foodLog.ts` was Today's Log's only caller. Check:

```bash
grep -rn "groupLogsByItem\|FoodLogGroup\|GroupableLog" --exclude-dir=node_modules artifacts/ecztrack
```

If the only remaining references are its own definition and `tests/foodLog.test.ts`, delete the function, both interfaces, and its test block — your change orphaned them. If any screen still calls it, leave it entirely alone.

- [ ] **Step 6: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all pass. `pnpm build` matters here — this task adds a component and touches a routed screen.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Show a save as one meal you can name and re-time"
```

---

## Task 6: How much of a tag a food carries

**Files:**
- Modify: `artifacts/ecztrack/constants/foods.ts` (`FoodItem`)
- Create: `artifacts/ecztrack/lib/tagIntensity.ts`
- Create: `artifacts/ecztrack/tests/tagIntensity.test.ts`
- Modify: `artifacts/ecztrack/components/FoodEditModal.tsx`
- Modify: `artifacts/ecztrack/lib/repo/converters.ts` (`customFoodConverter`)

**Interfaces:**
- Consumes: `FoodTagMap`, `FoodItem` from `constants/foods`.
- Produces, for Task 7:
  - `FoodItem.tag_intensity?: Record<string, TagIntensity>` where `type TagIntensity = 1 | 2 | 3`
  - `DEFAULT_INTENSITY: TagIntensity` (= 2)
  - `intensityOf(food, tagId): TagIntensity` — the stored grade or the default
  - `gradedIntensity(food, tagId): TagIntensity | null` — the stored grade, or null when ungraded
  - `carriedIntensities(food): Record<string, TagIntensity> | undefined` — the grades for tags the food actually carries, or undefined when there are none
  - `INTENSITY_LABELS: Record<TagIntensity, string>` = `{ 1: "Low", 2: "Average", 3: "High" }`

**The design decision, and why it is not the obvious one.** Binary tags flatten a real difference: coffee and tea both read `caffeine: 1`, so a per-tag analysis treats a large dose gap as identical. The fix is a grade multiplied by the log's portion.

It is stored in a **separate map**, not by widening `FoodTagMap` from `0 | 1`. `isItemReferenced` checks `tags[id] === 1` and that narrowness is deliberate — widening it to a truthiness test would make every tag undeletable once one food had been edited. Widening the value type reopens exactly that bug for no gain.

Ungraded is stored as **absent, not as 2**. Writing 2 everywhere makes "I graded this average" and "I never graded this" the same byte on disk, and the export can never tell them apart again. Absent-means-2 gives identical arithmetic with none of that loss, and no migration runs.

- [ ] **Step 1: Extend the type**

In `constants/foods.ts`, add to `FoodItem` after `tags`:

```ts
  /**
   * How much of each tag this food carries — 1 Low, 2 Average, 3 High.
   *
   * Keyed by the same `CatalogItem.id` as `tags`, and only meaningful where
   * `tags[id] === 1`. A tag absent from this map is ungraded, which every
   * reader treats as 2: the arithmetic matches a stored default while the
   * export can still say which foods you actually graded.
   *
   * Kept apart from `tags` rather than widening it to more values, because
   * `isItemReferenced` tests `tags[id] === 1` and that narrowness is what
   * keeps a tag deletable once a food has been edited.
   */
  tag_intensity?: Record<string, 1 | 2 | 3>;
```

- [ ] **Step 2: Write the failing test**

Create `tests/tagIntensity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { intensityOf, gradedIntensity, DEFAULT_INTENSITY, INTENSITY_LABELS } from "@/lib/tagIntensity";
import type { FoodItem } from "@/constants/foods";

const food = (over: Partial<FoodItem>): FoodItem => ({
  id: "f", name: "Coffee", category: "Beverages", tags: { caffeine: 1 },
  is_elimination_safe: false, ...over,
});

describe("intensityOf", () => {
  it("returns the stored grade", () => {
    expect(intensityOf(food({ tag_intensity: { caffeine: 3 } }), "caffeine")).toBe(3);
  });

  it("returns Average for an ungraded tag", () => {
    expect(intensityOf(food({}), "caffeine")).toBe(DEFAULT_INTENSITY);
    expect(DEFAULT_INTENSITY).toBe(2);
  });

  it("returns Average for a food with no map at all", () => {
    // Every food written before grading existed.
    expect(intensityOf(food({ tag_intensity: undefined }), "caffeine")).toBe(2);
  });

  it("ignores a stored value outside 1-3", () => {
    // Nothing in the app writes one, but a synced document from a future
    // version might, and a 7 would silently multiply every dose by 7.
    const bad = food({ tag_intensity: { caffeine: 7 as 1 } });
    expect(intensityOf(bad, "caffeine")).toBe(2);
  });
});

describe("gradedIntensity", () => {
  it("is null when the tag was never graded", () => {
    // This is the whole point of storing absence: the export must be able to
    // say which foods the user actually graded.
    expect(gradedIntensity(food({}), "caffeine")).toBeNull();
  });

  it("is the grade when it was", () => {
    expect(gradedIntensity(food({ tag_intensity: { caffeine: 1 } }), "caffeine")).toBe(1);
  });
});

describe("carriedIntensities", () => {
  it("keeps the grade for a tag the food carries", () => {
    const f = food({ tags: { caffeine: 1 }, tag_intensity: { caffeine: 3 } });
    expect(carriedIntensities(f)).toEqual({ caffeine: 3 });
  });

  it("drops a grade for a tag the food does not carry", () => {
    // The stale-grade case. A food that says caffeine: 0 must not ship a
    // caffeine grade to anyone reading the JSON export.
    const f = food({ tags: { caffeine: 0 }, tag_intensity: { caffeine: 3 } });
    expect(carriedIntensities(f)).toBeUndefined();
  });

  it("drops a grade for a tag missing from the map entirely", () => {
    const f = food({ tags: {}, tag_intensity: { caffeine: 3 } });
    expect(carriedIntensities(f)).toBeUndefined();
  });

  it("is undefined, not an empty object, when nothing survives", () => {
    // `{}` would export as "graded nothing", which is a different claim from
    // "never graded" and the one thing the absent-means-ungraded design exists
    // to keep apart.
    expect(carriedIntensities(food({ tag_intensity: {} }))).toBeUndefined();
  });

  it("keeps the carried grades and drops the rest in one food", () => {
    const f = food({
      tags: { caffeine: 1, dairy: 0 },
      tag_intensity: { caffeine: 1, dairy: 3 },
    });
    expect(carriedIntensities(f)).toEqual({ caffeine: 1 });
  });
});

describe("INTENSITY_LABELS", () => {
  it("names all three levels", () => {
    expect(INTENSITY_LABELS).toEqual({ 1: "Low", 2: "Average", 3: "High" });
  });
});
```

Add `carriedIntensities` to the import at the top of this test file.

- [ ] **Step 3: Run and watch it fail**

Run: `pnpm test tests/tagIntensity.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the module**

Create `lib/tagIntensity.ts`:

```ts
/**
 * How much of a tag a food carries.
 *
 * `tags` says whether coffee contains caffeine. This says how much, so that a
 * dose can be computed as intensity × the log's portion — without it, coffee
 * and tea are the same row and a real difference in exposure is invisible to
 * any per-tag analysis.
 *
 * Ungraded is absent, never a stored 2. A stored default would be
 * indistinguishable from a deliberate "Average" forever after, and the export
 * could not tell the reader which foods carry a real judgement.
 */
import type { FoodItem } from "@/constants/foods";

export type TagIntensity = 1 | 2 | 3;

/** What an ungraded tag counts as. */
export const DEFAULT_INTENSITY: TagIntensity = 2;

export const INTENSITY_LABELS: Record<TagIntensity, string> = {
  1: "Low", 2: "Average", 3: "High",
};

function valid(v: unknown): v is TagIntensity {
  return v === 1 || v === 2 || v === 3;
}

/**
 * The grade the user actually gave, or null.
 *
 * The distinction this preserves is the reason the field is optional: an
 * analysis needs to know which foods were graded before it trusts a dose.
 */
export function gradedIntensity(food: FoodItem, tagId: string): TagIntensity | null {
  const v = food.tag_intensity?.[tagId];
  return valid(v) ? v : null;
}

/**
 * The grade to compute with: the stored one, or Average.
 *
 * Validates rather than trusting the stored value. Nothing in this app writes
 * anything but 1-3, but a document synced from another version might, and an
 * out-of-range number would multiply straight into a dose without complaint.
 */
export function intensityOf(food: FoodItem, tagId: string): TagIntensity {
  return gradedIntensity(food, tagId) ?? DEFAULT_INTENSITY;
}

/**
 * The grades for the tags this food actually carries.
 *
 * The editor clears a grade when its tag is switched off, so in practice a
 * stale entry should not exist. This is the second line: a food restored from
 * a backup, synced from another device, or written by a version that did not
 * clear could still hold one, and an export is where a stale grade does real
 * damage — a reader that takes `food.tag_intensity["caffeine"]` without first
 * checking `tags["caffeine"]` would see a caffeine grade on a food declared
 * caffeine-free, and no amount of care in the analysis notebook can recover
 * from a file that already says the wrong thing.
 *
 * Returns undefined rather than `{}` when nothing survives, so the caller can
 * leave the key off entirely instead of exporting an empty object that reads
 * as "graded nothing" rather than "never graded".
 */
export function carriedIntensities(food: FoodItem): Record<string, TagIntensity> | undefined {
  const out: Record<string, TagIntensity> = {};
  for (const tagId of Object.keys(food.tag_intensity ?? {})) {
    // `=== 1`, never a truthiness test: a stored 0 means "explicitly not this
    // tag", and treating it as carried is the same inversion that would make
    // every tag undeletable in `isItemReferenced`.
    if (food.tags?.[tagId] !== 1) continue;
    const g = gradedIntensity(food, tagId);
    if (g !== null) out[tagId] = g;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
```

- [ ] **Step 5: Run the tests and mutation-check**

Run: `pnpm test tests/tagIntensity.test.ts` — expect PASS.

Then, each of these MUST break a test; restore after each:

1. Replace `valid(v) ? v : null` with `(v as TagIntensity) ?? null` — the out-of-range test must fail.
2. Make `gradedIntensity` return `DEFAULT_INTENSITY` instead of `null` — the ungraded test must fail.
3. Change `food.tags?.[tagId] !== 1` to `!food.tags?.[tagId]` in `carriedIntensities` — the not-carried test must fail. (It should not: `!0` is true, so this particular mutation still drops the grade. If the test passes, the assertion is not pinning the `=== 1` rule — add a case where the stored tag value is some other truthy number and confirm it is dropped.)
4. Return `out` unconditionally instead of `undefined` when empty — the empty-object test must fail.

- [ ] **Step 6: Add the control to the food editor**

In `components/FoodEditModal.tsx`:

Add state beside `tags`:

```tsx
const [tagIntensity, setTagIntensity] = useState<Record<string, TagIntensity>>({});
```

Seed it where `setTags({ ...food.tags })` runs (line 72):

```tsx
setTagIntensity({ ...(food.tag_intensity ?? {}) });
```

and reset it to `{}` wherever `tags` is reset for a new food.

Change `toggleTag` so turning a tag **off** drops its grade — a grade for a tag the food does not carry is ghost data that the export would have to decide what to do with:

```tsx
function toggleTag(id: string) {
  setTags(prev => {
    const on = prev[id] === 1;
    return { ...prev, [id]: on ? 0 : 1 };
  });
  setTagIntensity(prev => {
    if (!(tags[id] === 1)) return prev;   // turning ON: nothing to clear
    const next = { ...prev };
    delete next[id];
    return next;
  });
}
```

Render a three-way selector under each tag row, only when the tag is on. Put it inside the existing tag `map` at line 232, after the switch:

```tsx
{tags[tag.id] === 1 && (
  <View style={{ flexDirection: "row", gap: 6, paddingLeft: 30, paddingBottom: 10 }}>
    {([1, 2, 3] as TagIntensity[]).map(level => {
      const selected = (tagIntensity[tag.id] ?? DEFAULT_INTENSITY) === level;
      const graded = tagIntensity[tag.id] !== undefined;
      return (
        <TouchableOpacity
          key={level}
          onPress={() => setTagIntensity(prev => ({ ...prev, [tag.id]: level }))}
          activeOpacity={0.7}
          style={{
            paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
            borderWidth: 1,
            borderColor: selected ? colors.primary : colors.border,
            backgroundColor: selected ? colors.primary + "22" : "transparent",
          }}
        >
          <Text style={{
            fontSize: 12, fontFamily: "Inter_600SemiBold",
            // An ungraded tag shows Average selected but dimmed, so the user
            // can see it is a fallback rather than something they chose.
            color: selected ? (graded ? colors.primary : colors.mutedForeground) : colors.mutedForeground,
          }}>
            {INTENSITY_LABELS[level]}
          </Text>
        </TouchableOpacity>
      );
    })}
  </View>
)}
```

Include it in the saved food where the modal builds `foodData` (around line 103):

```tsx
  tags,
  // Omitted entirely when nothing was graded, so an untouched food stores no
  // field — `defined()` strips undefined, and an empty object would be a
  // written record of a decision the user never made.
  ...(Object.keys(tagIntensity).length > 0 ? { tag_intensity: tagIntensity } : {}),
```

Import `DEFAULT_INTENSITY`, `INTENSITY_LABELS` and `type TagIntensity` from `@/lib/tagIntensity`.

- [ ] **Step 7: Round-trip the field**

In `lib/repo/converters.ts`, add to `customFoodConverter.fromDoc`, beside the other optional fields:

```ts
    if (d.tag_intensity !== undefined) {
      item.tag_intensity = d.tag_intensity as FoodItem["tag_intensity"];
    }
```

Add a converter test asserting the round trip, and **mutation-check it by deleting that line** — the test must fail. This is the same defect class that lost tag icons on restore.

- [ ] **Step 8: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Let a food say how much of a tag it carries"
```

---

## Task 7: Meals and dose in the export

**Files:**
- Modify: `artifacts/ecztrack/lib/exportCsv.ts`
- Modify: `artifacts/ecztrack/tests/exportCsv.test.ts`

**Interfaces:**
- Consumes: `gradedIntensity` from `lib/tagIntensity` (Task 6); `group_id` / `meal` on `ConsumptionLog` (Task 4).
- Produces: the column set Task 8 documents.

- [ ] **Step 1: Write the failing tests**

Add to `tests/exportCsv.test.ts`, in the `buildConsumptionCSV` block:

```ts
it("carries the meal id and name on every row of a save", () => {
  const [header, ...rows] = buildConsumptionCSV(
    [log({ id: "a", item_id: "coffee", group_id: "g1", meal: "Dinner" })],
    [FOOD_COFFEE], TAGS,
  ).split("\n");
  expect(header.split(",")).toContain("meal_id");
  expect(header.split(",")).toContain("meal_name");
  expect(rows[0]).toContain("Dinner");
});

it("leaves the meal columns blank for a log written before meals existed", () => {
  const [, line] = buildConsumptionCSV(
    [log({ id: "a", item_id: "coffee" })], [FOOD_COFFEE], TAGS,
  ).split("\n");
  const c = cells(line);
  expect(c[c.length - 1]).not.toBe("undefined");
});

it("emits an intensity column beside each tag column", () => {
  const [header] = buildConsumptionCSV([], [], TAGS).split("\n");
  const cols = header.split(",");
  expect(cols).toContain("tag_caffeine");
  expect(cols).toContain("tag_caffeine_intensity");
});

it("writes the graded intensity and blanks an ungraded one", () => {
  const graded = { ...FOOD_COFFEE, tags: { caffeine: 1 as const }, tag_intensity: { caffeine: 3 as const } };
  const ungraded = { ...FOOD_COFFEE, id: "tea", tags: { caffeine: 1 as const } };
  const out = buildConsumptionCSV(
    [log({ id: "a", item_id: "coffee" }), log({ id: "b", item_id: "tea" })],
    [graded, ungraded], TAGS,
  ).split("\n");
  const header = out[0].split(",");
  const col = header.indexOf("tag_caffeine_intensity");
  expect(cells(out[1])[col]).toBe("3");
  // Blank, not "2". A default written into the file is a judgement the user
  // never made, and no reader could tell it apart from a real Average.
  expect(cells(out[2])[col]).toBe("");
});

it("blanks the intensity for a tag the food does not carry", () => {
  const f = { ...FOOD_COFFEE, tags: { caffeine: 0 as const }, tag_intensity: { caffeine: 3 as const } };
  const out = buildConsumptionCSV([log({ id: "a", item_id: "coffee" })], [f], TAGS).split("\n");
  const col = out[0].split(",").indexOf("tag_caffeine_intensity");
  expect(cells(out[1])[col]).toBe("");
});
```

`cells(line)` already exists at the top of the file. Add these two fixtures beside the existing `SYMPTOMS` and `CATALOGS` constants, and a `log` helper if the `buildConsumptionCSV` block does not already have one:

```ts
const TAGS: CatalogItem[] = [
  { id: "caffeine", name: "Caffeine", order: 0, isArchived: false, icon: "coffee" },
];

const FOOD_COFFEE: FoodItem = {
  id: "coffee", name: "Coffee", category: "Beverages",
  tags: { caffeine: 1 }, is_elimination_safe: false,
};

const log = (over: Partial<ConsumptionLog>): ConsumptionLog => ({
  id: "l1", timestamp: "2026-08-30T12:00:00.000Z", item_id: "coffee",
  phase: "none", is_accident: false, ...over,
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm test tests/exportCsv.test.ts`
Expected: FAIL on all five.

- [ ] **Step 3: Extend the consumption CSV**

In `buildConsumptionCSV`, add two columns to the header after `"portion"`:

```ts
    "is_elimination_safe", "is_accident", "portion", "meal_id", "meal_name",
```

and to each row, after the portion cell:

```ts
      // Blank for a log written before meals existed. One row per food either
      // way — grouping is a display fact, and nothing about the analysis
      // changes because two rows share an id.
      l.group_id ?? "",
      l.meal ?? "",
```

Then pair each tag column with an intensity column. Replace the header's tag spread:

```ts
    ...tagColumns.flatMap(t => [`tag_${t.id}`, `tag_${t.id}_intensity`]),
```

and the row's:

```ts
      // The binary flag, then the grade — 1-3 where the user set one, blank
      // where they did not and blank where the food does not carry the tag at
      // all. Deliberately NOT the default 2: a written default is a judgement
      // the user never made, and the reader could never tell the two apart.
      // Anything consuming this should read `dose = (intensity or 2) × portion`
      // and check how much of the column is filled before trusting it.
      ...tagColumns.flatMap(t => {
        const carried = tags?.[t.id] ?? 0;
        const graded = food && carried === 1 ? gradedIntensity(food, t.id) : null;
        return [carried, graded ?? ""];
      }),
```

`flatMap` on both sides is what keeps header and row derived from one array — the comment at the top of the function explains why two lists must never exist here.

Import `gradedIntensity` from `@/lib/tagIntensity`.

- [ ] **Step 4: Gate the JSON's attached food on the tag it is grading**

`buildJSON` spreads the whole `ConsumptionLog` and attaches the whole `FoodItem`, so `group_id` and `meal` appear automatically and need no change.

`tag_intensity` does need one. Attaching the food verbatim ships every stored grade, including one left behind for a tag the food no longer carries — and a reader taking `food.tag_intensity["caffeine"]` without first checking `food.tags["caffeine"]` would then see a caffeine grade on a food declared caffeine-free. The editor clears a grade when its tag is switched off, so this should never arise; a backup restore or a document synced from an older build can still produce it, and the export is the worst place to find out.

In `buildJSON`, replace the food attachment inside `consumption_logs`:

```ts
    consumption_logs: consumptionLogs.map(l => {
      const food = allFoods.find(f => f.id === l.item_id) ?? null;
      return {
        ...withLocalDay(l),
        // Grades are pruned to the tags the food actually carries. Not
        // cosmetic: a stale grade in this file is wrong in a way no care in
        // the analysis can undo, because the file already says it.
        food: food ? { ...food, tag_intensity: carriedIntensities(food) } : null,
      };
    }),
```

`carriedIntensities` returns `undefined` when nothing survives, and `JSON.stringify` omits an undefined value, so an ungraded food's `food` object carries no `tag_intensity` key at all — which is the same thing it says today.

Import `carriedIntensities` from `@/lib/tagIntensity` alongside `gradedIntensity`.

Add the assertions:

The signature is `buildJSON(consumptionLogs, symptomLogs, scratchLogs, allFoods, habitLogs, habitDefinitions, ledger, catalogs)` — note that `allFoods` is the FOURTH argument, before the two habit arrays. Add to the existing `describe("buildJSON", ...)` block:

```ts
it("carries meals and tag intensity through the JSON export", () => {
  const graded: FoodItem = { ...FOOD_COFFEE, tag_intensity: { caffeine: 3 } };
  const parsed = JSON.parse(buildJSON(
    [log({ group_id: "g1", meal: "Dinner" })],
    [], [], [graded], [], [], EMPTY_LEDGER, CATALOGS,
  ));
  expect(parsed.consumption_logs[0].meal).toBe("Dinner");
  expect(parsed.consumption_logs[0].group_id).toBe("g1");
  expect(parsed.consumption_logs[0].food.tag_intensity).toEqual({ caffeine: 3 });
});

it("does not ship a grade for a tag the food no longer carries", () => {
  // A food restored from a backup written before the editor cleared grades on
  // toggle-off. The JSON must not hand a reader a caffeine grade for a food
  // that says caffeine: 0.
  const stale: FoodItem = { ...FOOD_COFFEE, tags: { caffeine: 0 }, tag_intensity: { caffeine: 3 } };
  const parsed = JSON.parse(buildJSON(
    [log({})], [], [], [stale], [], [], EMPTY_LEDGER, CATALOGS,
  ));
  expect(parsed.consumption_logs[0].food.tag_intensity).toBeUndefined();
});
```

- [ ] **Step 5: Run the tests and mutation-check**

Run: `pnpm test tests/exportCsv.test.ts` — expect PASS.

Then change `graded ?? ""` to `graded ?? 2` and re-run. The blank-for-ungraded test MUST fail. Restore.

Then change `carried === 1` to `carried != null` and re-run. The not-carried test MUST fail. Restore. This mirrors the `isItemReferenced` asymmetry from the food-vocabulary spec, and getting it backwards is the same mistake in a new place.

Then drop the `carriedIntensities` wrapper in `buildJSON`, attaching `food` verbatim again, and re-run. The stale-grade JSON test MUST fail. Restore.

- [ ] **Step 6: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Export the meal a food belonged to and how strong its tags are"
```

---

## Task 8: Rewrite the analysis guide against the schema it now has

**Files:**
- Modify: `docs/ANALYSING-TRIGGERS.md`

This is documentation only — no code, no tests. It lands last because Tasks 4-7 change the schema it describes, and writing it earlier means writing it twice.

**Interfaces:**
- Consumes: the final column set from Task 7 and the JSON keys from Task 4 and Task 6.

- [ ] **Step 1: Read the current guide's structure**

Run: `grep -n "^#\|^##\|^###" docs/ANALYSING-TRIGGERS.md`

The sections that must change are `## 0. What you are working with`, `## 1. Loading and reshaping`, `## 2. Feature engineering that respects the biology` and its `### Dose, now that you have some of it` subsection. Everything from `## 3. Start with the boring thing` onward describes statistics, not schema, and should be left alone unless a variable it names has been renamed.

- [ ] **Step 2: Update the dataset description**

In `## 0. What you are working with`, add the new fields to whatever inventory of the JSON export that section carries:

- `consumption_logs[].group_id` — the save this food came in with. Several rows sharing one id were eaten together. Present only on logs written after 2026-08-31.
- `consumption_logs[].meal` — the meal's name, `"Meal"` unless renamed. Descriptive only; no analysis should key on it.
- `consumption_logs[].food.tag_intensity` — `{tagId: 1|2|3}` for 1 Low, 2 Average, 3 High. **Absent means ungraded, not average.** Only the tags the food carries appear.

State plainly that a meal is a display grouping and changes nothing about the unit of analysis: the row is still one food eaten at one time, and `group_id` is useful only if you want to model a meal as a co-exposure set rather than as independent foods.

- [ ] **Step 3: Rewrite the dose subsection**

Replace `### Dose, now that you have some of it` with a version built on both fields. The formula:

```python
# features.py
PORTION_WEIGHT = {"small": 0.5, "medium": 1.0, "large": 2.0}
DEFAULT_INTENSITY = 2      # what the app treats an ungraded tag as
INTENSITY_WEIGHT = {1: 0.5, 2: 1.0, 3: 2.0}

def tag_dose(row, tag):
    """Exposure to one tag from one food, on an arbitrary but consistent scale.

    Two independent multipliers: how much of the food you ate (portion) and how
    much of the tag the food contains (intensity). Neither substitutes for the
    other — a large cup of weak tea and a small strong coffee are different
    exposures, and the binary tag alone calls them identical.
    """
    if not row[f"tag_{tag}"]:
        return 0.0
    portion = PORTION_WEIGHT.get(row["portion"], 1.0)
    grade = row.get(f"tag_{tag}_intensity")
    intensity = INTENSITY_WEIGHT[int(grade)] if pd.notna(grade) else INTENSITY_WEIGHT[DEFAULT_INTENSITY]
    return portion * intensity
```

Carry over, in prose, the two warnings the existing dose section already makes about portion, because both apply again to intensity and more sharply:

**Coverage first, always.** Before using a dose feature, print how many exposures actually carry a grade. If most of the column is imputed at 2 then the dose is the portion feature wearing a hat, and you should say so rather than report it as dose. The guide should show the check:

```python
for tag in TAGS:
    exposed = food[food[f"tag_{tag}"] == 1]
    graded = exposed[f"tag_{tag}_intensity"].notna().mean()
    print(f"{tag}: {len(exposed)} exposures, {graded:.0%} graded")
```

**Grading is not missing at random.** You grade the foods you eat often and think about. Those are also the foods you have opinions about. An intensity column filled in exactly where you already suspect a trigger will confirm that suspicion whether or not it is true. Say this outright — it is the same selection argument the guide already makes about when portions get recorded, and it is the more dangerous version.

**The weights are a choice, not a measurement.** 0.5 / 1 / 2 on both axes is a doubling ladder picked for being defensible, not for being right. Any conclusion that flips when the weights change to 1 / 2 / 3 is a conclusion about the weights. Tell the reader to re-run the headline result under a second weighting and report both.

- [ ] **Step 4: Update the loading section**

In `## 1. Loading and reshaping`, make sure the loader reads the new columns and that any hardcoded column list includes the `tag_*_intensity` pairs and the two meal columns. If the loader enumerates tag columns by prefix, ensure the pattern does not accidentally sweep `tag_caffeine_intensity` into the binary tag list — that is the one concrete bug this section can introduce:

```python
tag_cols = [c for c in food.columns if c.startswith("tag_") and not c.endswith("_intensity")]
```

- [ ] **Step 5: Fix stale references**

Search the guide for anything the earlier tasks invalidated:

```bash
grep -n "symptom_avg\|1787\| (.*)\|Quick Start" docs/ANALYSING-TRIGGERS.md
```

The symptom CSV headers are now bare names (Task 2). If the guide tells the reader to parse `<id> (<name>)` headings, or to strip an id prefix, fix it — and point out that the id-to-name mapping now comes from the JSON's `symptoms` array, which is authoritative and survives renames.

- [ ] **Step 6: Verify by reading**

There is no test for a document. Read the changed sections end to end and check three things: every column name matches what `lib/exportCsv.ts` actually emits after Task 7; every Python snippet's variables are defined either in that snippet or in a named earlier one; and no snippet contradicts the "Getting set up" section about where to run it.

Confirm the guide still says to run the analysis locally rather than in a hosted notebook. The export is a medical history and that warning must survive this edit.

- [ ] **Step 7: Commit**

```bash
git add docs/ANALYSING-TRIGGERS.md
git commit -m "Teach the guide about meals and how strong a tag is"
```

---

## Deferred

**Item 1 — matching the Overview tiles to the calendar's dot colours.** Held at the user's request on 2026-08-31. Not deferred for cost: the Overview tiles do not currently mean "activity type". The check-in icon is green when the day's check-in is complete and amber when it is not, and the urges icon is green only when an urge was resisted. Recolouring them to the calendar's fixed green / red / blue would throw both signals away, and that trade needs a decision before it is worth planning.

## Manual verification after the branch

None of this is reachable from a test — there is no interactive browser in the implementation environment.

Tap Save with three foods selected and confirm one row appears reading "Meal" with all three names. Expand it and delete one food; confirm the other two stay grouped. Rename it to "Dinner" and confirm the name survives a tab switch and an app restart. Re-time it to a day inside an elimination window, then check the calendar colours that day and the CSV's `phase` column agrees.

Save two foods, then immediately save a third; confirm they are two meals, not one.

Grade a food's caffeine as High, export, and confirm `tag_caffeine_intensity` reads 3 for it and blank for an ungraded food. Turn the caffeine tag off, save, re-open, turn it back on, and confirm the grade is gone rather than remembered — Average, dimmed.

Then check the second line holds. Grade a food High, back it up, turn the tag off, restore the backup, and export the JSON: the restored food's `tag_intensity` must not carry a grade for a tag its `tags` map says it does not have.

Open New Habit and Log Scratch Urge on the phone and confirm neither title sits under the status bar. Confirm no food card says "Custom" and the Export screen has no Python block.

Set the urge filter to 7 days with older entries present, confirm the count line reads correctly and the empty state says "Nothing in this range" rather than offering to log a first entry.
