# User-owned food vocabulary — design

**Date:** 2026-08-24
**Status:** approved in principle; written for review.

Two lists in the food form are still hardcoded, and both are the developer's
guesses about someone else's diet: **Category** (11 strings) and **Contains**
(13 tags). They become user-owned, editable and deletable, seeded with what is
there today so nothing is lost.

## The two halves are not the same size

**Category is nearly free.** `FoodItem.category` is already a plain `string`. The
only hardcoded parts are two literal arrays — `components/FoodEditModal.tsx:20`
and `app/(tabs)/food-logger.tsx:28`, the latter with an `"All"` filter entry
prepended.

**Contains is a type change.** `FoodTags` is a 13-key interface, and those keys
are spelled out again in `EMPTY_TAGS`, in `TAG_META` (which also carries a label
and an icon per tag), field-by-field in `lib/repo/converters.ts`, and as 13 fixed
`tag_*` columns in the CSV. A user-created tag has no key, no icon and no column.

## The shape

Both become catalog kinds, reusing machinery that already exists:

```ts
export type CatalogKind =
  | "bodyLocation" | "cue" | "routine" | "symptom"
  | "foodCategory" | "foodTag";
```

That inherits add / rename / delete / reorder, `CatalogManagerModal`,
archive-if-referenced deletes with restore, the recency merge, and the exhaustive
backup table that makes a forgotten collection a compile error.

`CatalogItem` gains one optional field:

```ts
export interface CatalogItem {
  id: string;
  name: string;
  order: number;
  isArchived: boolean;
  updated_at?: string;
  /** Only `foodTag` uses this — the icon shown on a food card's chip. */
  icon?: string;
}
```

Adding it to `CatalogItem` rather than to a new subtype keeps the generic
mutators' signatures unchanged; `RoutineItem`'s `description` sets the precedent
for a field only one kind uses.

`FoodTags` stops being a type:

```ts
/** Which tags a food carries, keyed by `CatalogItem.id`. 1 = yes, 0 = no. */
export type FoodTagMap = Record<string, 0 | 1>;
```

`EMPTY_TAGS` becomes `{}` and `TAG_META` is deleted — the catalog carries the
name and icon now.

## Seeded ids are the values already on disk

This is the decision that makes the whole change cheap.

The tag catalog seeds as `{ id: "caffeine", name: "Caffeine", icon: "coffee" }`,
and the category catalog as `{ id: "Grains", name: "Grains" }`. Because
`FoodItem.tags` is already keyed by exactly those strings and `FoodItem.category`
already holds exactly those strings, **no stored food needs rewriting**, the
Firestore documents keep their shape, and the original 13 CSV columns keep their
names.

Renaming stays safe: the id never moves, only the label. A category id that looks
like a display string is mildly ugly and is worth it.

## Seeding must not use the schema migration

`runSchemaMigration` wipes consumption logs, symptom logs, scratch logs and
custom foods when the stored version is below `CURRENT_SCHEMA_VERSION`. Bumping
that number to trigger seeding would **delete the user's data**.

Instead: on load, if a catalog's storage key has never been written — `getItem`
returns `null`, which is distinct from a stored empty array — write the defaults
once. A user who deletes every tag keeps an empty list rather than having it
refilled on next launch.

This is the one place the branch's "nothing is seeded" rule is relaxed, and
deliberately: the user asked to keep the existing entries and prune them
themselves.

## Referential integrity, and one asymmetry worth stating

Deleting a referenced item archives it, as for every other kind.
`isItemReferenced` gains two cases:

- `foodCategory` — referenced when any food has `category === id`.
- `foodTag` — referenced when any food has `tags[id] === 1`.

**A stored `0` must not count as a reference.** For symptoms, key presence with a
real value counts, because a score of `0` is an answer the user gave. For tags,
`0` means "explicitly not this tag", which pins nothing. Getting this backwards
would make every tag undeletable the moment one food had been edited.

This requires the foods array in `ItemReferences`, which currently carries only
the three log collections.

## The CSV becomes dynamic

The consumption export writes 13 fixed `tag_*` columns. It must instead emit one
column per active tag, named `tag_<id>` and ordered by the catalog's `order`, so
the original 13 keep their names and headers stay stable between exports unless
the catalog changes. The header and the row builder must derive from one list, or
they will drift apart.

## Icons

A user-created tag needs one, and every `MciIcon` path must be registered in
`components/mciPaths.ts` or `components/MciIcon.test.ts` fails the build. So the
picker offers a **curated set** — roughly 30 food-relevant icons, including the
13 already in use — rendered as a grid in the tag manager. Not free text, and not
the full Material icon set.

A tag with no icon renders as a text-only chip; the field is optional and a
missing icon is not an error.

## Backup

Two new collections in `CollectionSpecs`, with paths and converters. They are
editable records, so they merge by recency like the other catalogs, and
`reindex` runs after the merge because two devices each append at what they
think is the next free slot. Nothing about the merge rules changes.

## Out of scope

Folding `FoodItem` into `CatalogItem`. Foods keep their richer type — category,
tags, `is_elimination_safe` — and their own edit modal.

Migrating existing foods. By construction there is nothing to migrate; if a
stored food carries a tag key with no catalog entry, it renders by its raw id,
exactly as an archived item does today.

## Testing

The pure parts — `isItemReferenced`'s two new cases, the seeding decision, the
CSV column derivation — are unit-testable and must be. `constants/catalog.ts`,
`lib/backup.ts` and `lib/exportCsv.ts` are all already importable under vitest.

Every guard gets a mutation check before it is called done. On the previous two
branches, seven guards turned out to pin nothing, and every one was found this
way rather than by reading. Specifically: the `tags[id] === 1` check must fail a
test if widened to `!= null`, and the seeding check must fail if `null` and `[]`
are conflated.
