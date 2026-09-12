# User-Owned Food Vocabulary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A food's Category and its Contains tags become user-created lists you can add to, rename, reorder and delete, seeded with the entries that exist today.

**Architecture:** Two new `CatalogKind` members, `"foodCategory"` and `"foodTag"`, reusing the existing catalog machinery. `FoodTags` stops being a 13-key interface and becomes `Record<string, 0 | 1>` keyed by catalog item id. Seeded ids are the strings already stored on disk, so no food needs migrating.

**Tech Stack:** Expo SDK 54, React Native 0.81, expo-router, AsyncStorage (source of truth), Firebase JS SDK v12 (optional manual backup), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-user-owned-food-vocabulary-design.md`

**Working directory:** `artifacts/ecztrack`. Run every command from there.

## Global Constraints

- **AsyncStorage stays the source of truth.** Firebase is optional; the app must run fully with no Firebase config. Never call a Firebase accessor without `isFirebaseConfigured()`.
- **All writes go through `persist()`** in `context/AppContext.tsx`. Never `AsyncStorage.setItem` from a mutator.
- **Do NOT bump `CURRENT_SCHEMA_VERSION`.** It is 4. Raising it re-fires `runSchemaMigration`'s wipe of consumption logs, symptom logs, scratch logs and custom foods.
- **All date keys come from `lib/dates.ts`.** Never `.split("T")[0]`; a source-scan test enforces it.
- **No `Alert` from react-native.** Use `notify` / `confirmDestructive` from `lib/dialogs.ts` — `Alert.alert` is a complete no-op on react-native-web and this app runs in a browser.
- **Never a `*.test.ts` under `app/`** — expo-router bundles it and the web build breaks. Screen tests go in `tests/`; lib tests sit beside their module.
- **Every `<MciIcon name="…">` needs its path in `components/mciPaths.ts`.** `PATHS` is `Record<string, string>` so tsc cannot catch a missing icon, but `components/MciIcon.test.ts` scans source and will fail.
- **`context/AppContext.tsx` and React Native components cannot be imported under vitest** (react-native parse error; node environment, no React harness). Logic needing a test goes in a pure `lib/` or `constants/` module.
- **Every mutator in AppContext is a `useCallback` closed over its current array.** Do not loop one; do not restructure the ones this plan does not name.
- Verification per task: `pnpm typecheck && pnpm test`.

**A red tree is expected between Tasks 3 and 5.** Changing `FoodTags` breaks its consumers until they are rewritten, and `pnpm typecheck` is the checklist for finding them. Only Task 6 must leave every gate green.

---

## File structure

| File | Responsibility after this plan |
|---|---|
| `constants/catalog.ts` | `CatalogItem.icon`, the six `CatalogKind`s, `isItemReferenced`'s two new cases |
| `constants/foods.ts` | `FoodItem`, `FoodTagMap`, the seed lists. `FoodTags` and `TAG_META` are gone |
| `lib/seedCatalogs.ts` *(new)* | The pure "has this key ever been written" decision |
| `lib/storageKeys.ts` | Two new keys |
| `context/AppContext.tsx` | Two new state arrays, seeding on load |
| `lib/repo/paths.ts`, `lib/repo/converters.ts`, `lib/backup.ts` | Two new synced collections |
| `lib/exportCsv.ts` | Tag columns derived from the catalog |
| `components/FoodEditModal.tsx` | Category and tag pickers from the catalogs |
| `components/FoodCard.tsx` | Tag chips resolved through the catalog |
| `app/(tabs)/food-logger.tsx` | Category filter from the catalog |
| `components/CatalogManagerModal.tsx` | Copy for the two kinds, plus the icon picker |
| `components/IconPicker.tsx` *(new)* | The curated icon grid |

---

### Task 1: Two new catalog kinds

**Files:** modify `constants/catalog.ts`, `constants/catalog.test.ts`

**Interfaces:**
- Produces: `CatalogKind` with `"foodCategory" | "foodTag"`; `CatalogItem.icon?: string`; `isItemReferenced` accepting a `foods` array
- Consumes: nothing new

- [ ] **Step 1: Widen the types**

```ts
export interface CatalogItem {
  id: string;
  name: string;
  order: number;
  isArchived: boolean;
  /** ISO timestamp of last local edit — last-write-wins on restore. */
  updated_at?: string;
  /**
   * Only `foodTag` uses this: the icon on a food card's chip. Optional, and a
   * tag without one renders as a text-only chip rather than failing.
   */
  icon?: string;
}

export type CatalogKind =
  | "bodyLocation" | "cue" | "routine" | "symptom"
  | "foodCategory" | "foodTag";
```

- [ ] **Step 2: Write the failing tests for the two new reference rules**

```ts
const food = (id: string, category: string, tags: Record<string, 0 | 1> = {}) =>
  ({ id, name: id, category, tags, is_elimination_safe: true }) as FoodItem;

describe("isItemReferenced for the food vocabulary", () => {
  it("finds a category a food is filed under", () => {
    const logs = { ...NO_LOGS, foods: [food("f1", "Grains")] };
    expect(isItemReferenced("foodCategory", "Grains", logs)).toBe(true);
  });

  it("reports a category no food uses as unreferenced", () => {
    const logs = { ...NO_LOGS, foods: [food("f1", "Grains")] };
    expect(isItemReferenced("foodCategory", "Sweets", logs)).toBe(false);
  });

  it("finds a tag a food actually carries", () => {
    const logs = { ...NO_LOGS, foods: [food("f1", "Grains", { dairy: 1 })] };
    expect(isItemReferenced("foodTag", "dairy", logs)).toBe(true);
  });

  it("does NOT count a tag explicitly set to 0", () => {
    // The asymmetry with symptoms, and the one worth getting right: a stored 0
    // means "this food is not dairy", which pins nothing. Counting key presence
    // — as the symptom rule does, because a score of 0 is a real answer —
    // would make every tag undeletable the moment one food had been edited.
    const logs = { ...NO_LOGS, foods: [food("f1", "Grains", { dairy: 0 })] };
    expect(isItemReferenced("foodTag", "dairy", logs)).toBe(false);
  });
});
```

`NO_LOGS` is the existing empty-collections fixture in this file; add `foods: []` to it.

- [ ] **Step 3: Run and confirm failure**

Run: `pnpm test catalog`
Expected: FAIL — `foodCategory` and `foodTag` are not cases in `isItemReferenced`, and `ItemReferences` has no `foods`.

- [ ] **Step 4: Implement**

Add `foods: FoodItem[]` to `ItemReferences`, and two cases:

```ts
    case "foodCategory":
      return logs.foods.some(f => f.category === id);
    case "foodTag":
      // `=== 1`, not `!= null`: a stored 0 is "explicitly not this tag".
      return logs.foods.some(f => f.tags[id] === 1);
```

- [ ] **Step 5: Run tests, then mutation-check**

Run: `pnpm test catalog` — passes.

Commit first, then mutate `f.tags[id] === 1` to `f.tags[id] != null` and confirm the "explicitly set to 0" test fails. Restore, confirm green, and report the failure count. A mutation that leaves the suite green is a finding.

- [ ] **Step 6: Commit**

```bash
git add constants/catalog.ts constants/catalog.test.ts
git commit -m "Let a food's category and tags be catalog items"
```

---

### Task 2: Seeding, without touching the schema migration

**Files:** create `lib/seedCatalogs.ts`, `lib/seedCatalogs.test.ts`; modify `constants/foods.ts`, `lib/storageKeys.ts`

**Interfaces:**
- Produces: `SEED_FOOD_CATEGORIES`, `SEED_FOOD_TAGS`, `seedIfUnwritten(raw, seed)`
- Consumes: `CatalogItem` from Task 1

- [ ] **Step 1: Add the two storage keys**

In `lib/storageKeys.ts`, beside the other catalogs:

```ts
  FOOD_CATEGORIES: "@health_tracker_food_categories",
  FOOD_TAGS: "@health_tracker_food_tags",
```

Leave `WIPE_STORAGE_KEYS` alone — these are new keys, so no device has ever written stale data under them.

- [ ] **Step 2: Write the seed lists in `constants/foods.ts`**

**The ids are the strings already stored on disk.** That is what makes migration unnecessary: `FoodItem.category` already holds `"Grains"`, and `FoodItem.tags` is already keyed by `"caffeine"`.

```ts
/**
 * The categories and tags the app shipped with, as catalog items.
 *
 * Each `id` is the value already written into stored foods, so adopting the
 * catalog rewrites nothing: a food filed under "Grains" keeps pointing at the
 * item whose id is "Grains", and a rename moves only the label.
 */
export const SEED_FOOD_CATEGORIES: CatalogItem[] = [
  "Grains", "Vegetables", "Fruits", "Proteins", "Fats", "Legumes",
  "Dairy", "Beverages", "Condiments", "Sweets", "Snacks",
].map((name, order) => ({ id: name, name, order, isArchived: false }));

export const SEED_FOOD_TAGS: CatalogItem[] = [
  { id: "caffeine",    name: "Caffeine",    icon: "coffee" },
  { id: "dairy",       name: "Dairy",       icon: "cow" },
  { id: "soy",         name: "Soy",         icon: "leaf" },
  { id: "oat",         name: "Oat",         icon: "barley" },
  { id: "high_sugar",  name: "High Sugar",  icon: "cube-outline" },
  { id: "palm_oil",    name: "Palm Oil",    icon: "tree" },
  { id: "gluten",      name: "Gluten",      icon: "grain" },
  { id: "egg",         name: "Egg",         icon: "egg" },
  { id: "fried",       name: "Fried",       icon: "fire" },
  { id: "high_sodium", name: "High Sodium", icon: "shaker-outline" },
  { id: "high_fat",    name: "High Fat",    icon: "water" },
  { id: "spicy",       name: "Spicy",       icon: "chili-hot" },
  { id: "lye",         name: "Lye",         icon: "flask-outline" },
].map((t, order) => ({ ...t, order, isArchived: false }));
```

- [ ] **Step 3: Write the failing test for the seeding decision**

```ts
describe("seedIfUnwritten", () => {
  const seed: CatalogItem[] = [{ id: "a", name: "A", order: 0, isArchived: false }];

  it("seeds when the key has never been written", () => {
    expect(seedIfUnwritten(null, seed)).toEqual(seed);
  });

  it("does NOT seed over a stored empty list", () => {
    // The distinction the whole feature rests on. A user who deleted every tag
    // has an empty ARRAY stored; refilling it on next launch would undo their
    // deletions every time they opened the app.
    expect(seedIfUnwritten("[]", seed)).toEqual([]);
  });

  it("returns what is stored when there is something", () => {
    expect(seedIfUnwritten('[{"id":"z","name":"Z","order":0,"isArchived":false}]', seed))
      .toEqual([{ id: "z", name: "Z", order: 0, isArchived: false }]);
  });

  it("seeds rather than throwing on unparseable storage", () => {
    expect(seedIfUnwritten("{not json", seed)).toEqual(seed);
  });
});
```

- [ ] **Step 4: Run, confirm failure, then implement `lib/seedCatalogs.ts`**

```ts
/**
 * What a catalog should hold at startup, given its raw AsyncStorage value.
 *
 * `null` means the key has never been written, which is the only case that
 * seeds. A stored `"[]"` is a user who deleted everything, and must stay empty
 * — this is why the check is not `!stored.length`.
 *
 * Deliberately NOT driven by the schema version: `runSchemaMigration` wipes the
 * user's logs and custom foods when the version rises, so triggering seeding
 * that way would trade a seeded list for deleted history.
 */
export function seedIfUnwritten(raw: string | null, seed: CatalogItem[]): CatalogItem[] {
  if (raw === null) return seed;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : seed;
  } catch {
    return seed;
  }
}
```

- [ ] **Step 5: Run, then mutation-check**

Commit first. Then change `raw === null` to `!raw || raw === "[]"` and confirm the stored-empty test fails. Restore and report the count.

- [ ] **Step 6: Commit**

```bash
git add lib/seedCatalogs.ts lib/seedCatalogs.test.ts constants/foods.ts lib/storageKeys.ts
git commit -m "Seed the food vocabulary once, from a key that was never written"
```

---

### Task 3: `FoodTags` becomes a map

**Files:** modify `constants/foods.ts`, `lib/repo/converters.ts`, `lib/repo/converters.test.ts`

- [ ] **Step 1: Replace the type**

```ts
/** Which tags a food carries, keyed by `CatalogItem.id`. 1 = yes, 0 = no. */
export type FoodTagMap = Record<string, 0 | 1>;

export const EMPTY_TAGS: FoodTagMap = {};
```

Delete `FoodTags` and `TAG_META`. Change `FoodItem.tags` to `FoodTagMap`.

- [ ] **Step 2: Make the converter pass the map through**

`lib/repo/converters.ts:89-99` copies 13 fields by name. Replace with a pass-through that tolerates a missing or malformed stored value — a document is only as well-formed as what is on disk, and a bad one must not take a screen down:

```ts
    tags: (d.tags as FoodTagMap | undefined) ?? {},
```

- [ ] **Step 3: Add a test that a user-created tag survives the round trip**

```ts
it("carries a tag the app never shipped with", () => {
  const doc = { name: "Kimchi", category: "Vegetables", tags: { nightshade: 1 }, is_elimination_safe: false };
  expect(customFoodConverter.fromDoc("f1", doc).tags).toEqual({ nightshade: 1 });
});
```

- [ ] **Step 4: Run typecheck to find every consumer**

Run: `pnpm typecheck`
Expected: errors in `components/FoodCard.tsx`, `components/FoodEditModal.tsx`, `lib/exportCsv.ts` and anything else naming `FoodTags` or `TAG_META`. Those are Tasks 4 and 5. Fix nothing outside your own files; report the list.

- [ ] **Step 5: Commit**

```bash
git add constants/foods.ts lib/repo/converters.ts lib/repo/converters.test.ts
git commit -m "Key a food's tags by catalog id rather than by a fixed interface"
```

---

### Task 4: Sync and export the two catalogs

**Files:** modify `lib/repo/paths.ts`, `lib/repo/converters.ts`, `lib/backup.ts`, `lib/backup.test.ts`, `lib/exportCsv.ts`, `tests/exportCsv.test.ts`

- [ ] **Step 1: Add the collections**

Two Firestore paths and converters mirroring the existing catalogs, then two entries in `Snapshot` and in `collectionSpecs`. The `CollectionSpecs` mapped type makes a missing entry a compile error — that is the point of it, so let tsc drive this.

They are editable records: merge by recency, then `reindex`, exactly as `bodyLocations` and the rest do.

- [ ] **Step 2: Write the failing test for dynamic CSV columns**

```ts
it("emits one tag column per catalog tag, in catalog order", () => {
  const tags: CatalogItem[] = [
    { id: "dairy", name: "Dairy", order: 0, isArchived: false },
    { id: "nightshade", name: "Nightshade", order: 1, isArchived: false },
  ];
  const header = buildConsumptionCSV([], [], tags).split("\n")[0];
  expect(header).toContain("tag_dairy,tag_nightshade");
});

it("writes 1 only for the tags a food carries", () => {
  const tags: CatalogItem[] = [
    { id: "dairy", name: "Dairy", order: 0, isArchived: false },
    { id: "nightshade", name: "Nightshade", order: 1, isArchived: false },
  ];
  const food = { id: "f1", name: "Milk", category: "Dairy", tags: { dairy: 1 }, is_elimination_safe: false } as FoodItem;
  const log = { id: "c1", item_id: "f1", timestamp: "2026-03-01T12:00:00", phase: "none", is_challenge: false, is_accident: false } as ConsumptionLog;
  const row = buildConsumptionCSV([log], [food], tags).split("\n")[1];
  expect(row).toContain(",1,0");
});
```

- [ ] **Step 3: Implement, deriving header and row from ONE list**

`buildConsumptionCSV` takes the tag catalog and builds its columns from `activeItems(tags)`. The header names and the row values must come from the same array in the same order — two separate lists would drift the moment a tag is added. Pass the catalog from `app/(tabs)/export.tsx`.

- [ ] **Step 4: Run, then mutation-check**

Commit first. Mutate the row builder to emit `1` for every tag and confirm the second test fails; mutate the header to reverse the order and confirm the first fails. Report both counts.

- [ ] **Step 5: Commit**

```bash
git add -A lib/ tests/ "app/(tabs)/export.tsx"
git commit -m "Sync the food vocabulary, and size the CSV to it"
```

---

### Task 5: The food screens

**Files:** modify `components/FoodEditModal.tsx`, `components/FoodCard.tsx`, `app/(tabs)/food-logger.tsx`, `context/AppContext.tsx`

- [ ] **Step 1: Two new state arrays and their mutators in AppContext**

`foodCategories` and `foodTags`, loaded through `seedIfUnwritten`, wired into `CATALOG_KEYS` so the generic mutators cover them, and added to `isItemReferenced`'s call with the foods array. Follow exactly what the four existing catalogs do; do not add a parallel set of mutators.

- [ ] **Step 2: `FoodEditModal` reads both catalogs**

The category picker maps `activeItems(foodCategories)`; the tag toggles map `activeItems(foodTags)`, rendering `item.icon` when present and the name alone when not. Each gains a "Manage" affordance opening `CatalogManagerModal` for its kind — without one, a new tag can only be created from somewhere else, which is the dead end this project has already shipped twice.

- [ ] **Step 3: `FoodCard` resolves chips through the catalog**

It used `TAG_META` to find a label and icon. It now takes the tag catalog and renders a chip per tag whose value is `1`, using `itemName(tags, id)` so an archived or deleted tag still shows its name rather than a raw id.

- [ ] **Step 4: The category filter**

`app/(tabs)/food-logger.tsx:28`'s literal array becomes `["All", ...activeItems(foodCategories).map(c => c.name)]`. Keep "All" first.

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm test`, then `EXPO_NO_TELEMETRY=1 CI=1 pnpm build` — the build is the only gate that catches a stale import of a deleted symbol, and `TAG_META` is one.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Pick a food's category and tags from lists you control"
```

---

### Task 6: The manager, the icon picker, and the docs

**Files:** create `components/IconPicker.tsx`; modify `components/CatalogManagerModal.tsx`, `components/mciPaths.ts`, `docs/TODO.md`

- [ ] **Step 1: Add copy for the two new kinds**

`COPY` in `CatalogManagerModal.tsx:28` is `Record<CatalogKind, …>`, so tsc already demands the two entries. Titles "Food Categories" and "Contains Tags"; empty states and placeholders matching the existing voice.

- [ ] **Step 2: Build the curated icon grid**

`components/IconPicker.tsx`: a grid of ~30 food-relevant icon names, **including the 13 the seed tags use**, each rendered with `MciIcon`. Selecting one calls back with its name; selecting the current one clears it.

**Every name must be registered in `components/mciPaths.ts`** or `components/MciIcon.test.ts` fails. Add any that are not already there.

- [ ] **Step 3: Show it only for `foodTag`**

The manager gains an icon row when `kind === "foodTag"`, exactly as it gains a description input only for `routine`. Saving writes `icon` through the existing `updateCatalogItem` / `addCatalogItem`.

- [ ] **Step 4: Update `docs/TODO.md`**

Its "Known trade-offs" entry on catalog merging now covers six kinds rather than four. No other doc claims the food lists are fixed; check rather than assume.

- [ ] **Step 5: Full gate sweep**

```bash
pnpm typecheck
pnpm test
TZ=UTC pnpm test && TZ=America/Los_Angeles pnpm test && TZ=Pacific/Chatham pnpm test && TZ=Asia/Tokyo pnpm test
EXPO_NO_TELEMETRY=1 CI=1 pnpm build
pnpm run test:emulator
```

`test:emulator` exits code 2 even when it passes — firebase-tools cannot write its update-check config under this sandbox. Read stdout, never the exit code.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Manage the food vocabulary, icons and all"
```

---

## Manual verification

Not runnable here — no interactive browser in this environment.

- Add a category, file a food under it, confirm it appears in the logger's filter.
- Add a tag with an icon, tick it on a food, confirm the chip shows on the card.
- Delete a tag no food carries — it should vanish. Delete one a food carries — it should archive and stay readable on that food.
- Delete every tag, close and reopen the app, and confirm the list is still empty rather than reseeded.
