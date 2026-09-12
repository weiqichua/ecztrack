import { describe, it, expect } from "vitest";
import { archivedByName, archivedItems, checkCatalogName, moveInList, restoreItem } from "./catalogEditing";

/**
 * The catalog mutators no-op on a blank name and never check uniqueness, so
 * both rules live here — the only place that can tell the user what went
 * wrong. These are the two pieces of the manager modal worth testing without
 * a renderer.
 */

const items = [
  { id: "a", name: "Left arm" },
  { id: "b", name: "Right arm" },
];

describe("checkCatalogName", () => {
  it("accepts a new name, trimmed", () => {
    expect(checkCatalogName("  Neck  ", items)).toEqual({ ok: true, name: "Neck" });
  });

  it("rejects an empty name", () => {
    expect(checkCatalogName("", items).ok).toBe(false);
  });

  it("rejects a whitespace-only name", () => {
    expect(checkCatalogName("   \n ", items).ok).toBe(false);
  });

  it("rejects a duplicate regardless of case and surrounding space", () => {
    const result = checkCatalogName("  left ARM ", items);
    expect(result.ok).toBe(false);
    // The message has to name the collision — "already exists" alone leaves the
    // user hunting through the list for which row they hit.
    if (!result.ok) expect(result.error).toContain("Left arm");
  });

  it("lets an item keep its own name when renamed", () => {
    expect(checkCatalogName("Left arm", items, "a")).toEqual({ ok: true, name: "Left arm" });
  });

  it("still rejects a rename onto another item's name", () => {
    expect(checkCatalogName("Right arm", items, "a").ok).toBe(false);
  });

  it("accepts a case change to the item's own name", () => {
    expect(checkCatalogName("left arm", items, "a")).toEqual({ ok: true, name: "left arm" });
  });
});

describe("moveInList", () => {
  const ids = ["a", "b", "c"];

  it("moves an item up", () => {
    expect(moveInList(ids, 2, -1)).toEqual(["a", "c", "b"]);
  });

  it("moves an item down", () => {
    expect(moveInList(ids, 0, 1)).toEqual(["b", "a", "c"]);
  });

  // The manager renders an up arrow on the first row and a down arrow on the
  // last; without this the array would silently wrap or shed an element.
  it("returns the list unchanged at either edge", () => {
    expect(moveInList(ids, 0, -1)).toEqual(ids);
    expect(moveInList(ids, 2, 1)).toEqual(ids);
  });

  it("does not mutate the input", () => {
    const original = [...ids];
    moveInList(ids, 0, 1);
    expect(ids).toEqual(original);
  });
});

describe("archivedItems", () => {
  const catalog = [
    { id: "a", name: "Left arm", order: 0, isArchived: false },
    { id: "c", name: "Neck", order: 2, isArchived: true },
    { id: "b", name: "Shin", order: 1, isArchived: true },
  ];

  it("returns only the archived items, in order", () => {
    expect(archivedItems(catalog).map(i => i.id)).toEqual(["b", "c"]);
  });

  it("is empty when nothing is archived", () => {
    expect(archivedItems([catalog[0]])).toEqual([]);
  });
});

describe("restoreItem", () => {
  // An archived item keeps the `order` it held when it was retired. Orders are
  // dense from 0 across the active+archived union, and a restore only flips
  // the flag — the item count doesn't change — so that slot is still unique.
  const catalog = [
    { id: "a", name: "Left arm", order: 0, isArchived: false },
    { id: "b", name: "Right arm", order: 1, isArchived: false },
    { id: "c", name: "Neck", order: 1, isArchived: true },
  ];

  it("clears the flag and leaves its order untouched", () => {
    const result = restoreItem(catalog[2], catalog);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.item).toMatchObject({ id: "c", isArchived: false, order: 1 });
  });

  // The regression this guards: overriding `order` to `items.length` on
  // restore breaks the dense, collision-free invariant `addCatalogItem`
  // relies on (it computes its new item's order as `items.length`). Here the
  // catalog is dense before the restore (0, 1, 2) — restoring "c" must not
  // disturb that, and the next add must land on a still-free slot with no
  // duplicate order across the whole catalog.
  it("keeps orders dense and collision-free, including a subsequent add", () => {
    const dense = [
      { id: "a", name: "Left arm", order: 0, isArchived: false },
      { id: "b", name: "Right arm", order: 1, isArchived: false },
      { id: "c", name: "Neck", order: 2, isArchived: true },
    ];
    const result = restoreItem(dense[2], dense);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const restored = dense.map(i => (i.id === "c" ? result.item : i));
    const orders = restored.map(i => i.order).sort((a, b) => a - b);
    expect(orders).toEqual([0, 1, 2]);

    // The next addCatalogItem computes `order: items.length` from this array.
    const nextOrder = restored.length;
    expect(restored.some(i => i.order === nextOrder)).toBe(false);
  });

  // The uniqueness rule deliberately lets an archived name be reused, so by
  // the time the user restores one an active item may hold it. Restoring
  // anyway would put two identical chips in every picker.
  it("refuses when an active item has taken the name", () => {
    const clashing = [...catalog, { id: "d", name: "neck", order: 2, isArchived: false }];
    const result = restoreItem(catalog[2], clashing);
    expect(result.ok).toBe(false);
    // Naming the active row is the only actionable half: that is the one the
    // user has to rename before the archived twin can come back.
    if (!result.ok) expect(result.error).toContain("neck");
  });

  // The name comparison must trim the existing (active) item's name too, not
  // just the item being restored — `key` is already trimmed from the item
  // being restored, so this only exercises the comparison's other side.
  // Without trimming it, "  itch  " and "itch" are distinct strings and the
  // clash below would slip through.
  it("refuses a clash that only appears once both names are trimmed", () => {
    const untrimmed = [
      { id: "a", name: "  itch  ", order: 0, isArchived: false },
      { id: "c", name: "Itch", order: 1, isArchived: true },
    ];
    const result = restoreItem(untrimmed[1], untrimmed);
    expect(result.ok).toBe(false);
  });

  it("ignores a clash with another archived item", () => {
    const twin = [...catalog, { id: "d", name: "Neck", order: 4, isArchived: true }];
    expect(restoreItem(catalog[2], twin).ok).toBe(true);
  });
});

describe("archivedByName", () => {
  // The food library's shape: no `order` at all, and `isArchived` absent on
  // every record written before archiving existed.
  const foods = [
    { id: "a", name: "Oats" },
    { id: "b", name: "Miso", isArchived: true },
    { id: "c", name: "Cheddar", isArchived: true },
    { id: "d", name: "Rice", isArchived: false },
  ];

  it("returns only the archived entries, alphabetically", () => {
    expect(archivedByName(foods).map(f => f.name)).toEqual(["Cheddar", "Miso"]);
  });

  it("treats an absent flag as active", () => {
    expect(archivedByName([{ id: "a", name: "Oats" }])).toEqual([]);
  });
});

describe("restoreItem — order-less records", () => {
  // Foods restore through the same function, which is why `order` is not in
  // its constraint. Nothing here may depend on a slot the record never had.
  const foods = [
    { id: "a", name: "Oats" },
    { id: "b", name: "Miso", isArchived: true },
  ];

  it("clears the flag on a record with no order", () => {
    const result = restoreItem(foods[1], foods);
    expect(result.ok && result.item).toEqual({ id: "b", name: "Miso", isArchived: false });
  });

  it("refuses when an active record has taken the name, and names it", () => {
    const clashing = [{ id: "c", name: "miso " }, foods[1]];
    const result = restoreItem(foods[1], clashing);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("miso");
  });
});
