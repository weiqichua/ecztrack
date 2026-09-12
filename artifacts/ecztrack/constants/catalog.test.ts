import { describe, it, expect } from "vitest";
import { activeItems, cleanItemName, reindex, itemName, isItemReferenced, deleteOrArchive, reorderByIds, type CatalogItem, type RoutineItem } from "./catalog";
import type { FoodItem } from "./foods";

const item = (id: string, order: number, isArchived = false): CatalogItem =>
  ({ id, name: id.toUpperCase(), order, isArchived });

const noLogs = { consumptionLogs: [], symptomLogs: [], scratchLogs: [], foods: [], skinPhotos: [], supplementLogs: [], activityLogs: [] };

describe("activeItems", () => {
  it("never yields an archived item", () => {
    // This is the whole guarantee behind archive-instead-of-delete: history
    // keeps referring to the item by id, but no picker may offer it again.
    const items = [item("a", 0), item("b", 1, true), item("c", 2)];
    expect(activeItems(items).map(i => i.id)).toEqual(["a", "c"]);
  });

  it("yields nothing when every item is archived", () => {
    expect(activeItems([item("a", 0, true), item("b", 1, true)])).toEqual([]);
  });

  it("sorts by order, not by array position", () => {
    // Stored arrays are append-ordered, so a reorder only moves `order`.
    const items = [item("c", 2), item("a", 0), item("b", 1)];
    expect(activeItems(items).map(i => i.id)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate or reorder the input array", () => {
    const items = [item("c", 2), item("a", 0)];
    activeItems(items);
    expect(items.map(i => i.id)).toEqual(["c", "a"]);
  });
});

describe("activeItems on an empty catalog", () => {
  it("yields nothing rather than throwing", () => {
    // Every catalog starts empty — there is no seed data — so this is the state
    // the pickers are in until the user adds their first item.
    expect(activeItems([])).toEqual([]);
  });
});

describe("itemName", () => {
  const items = [item("s_itch", 0), item("s_heat", 1)];

  it("resolves an id to its current name", () => {
    expect(itemName(items, "s_itch")).toBe("S_ITCH");
  });

  it("falls back to the id when the catalog no longer holds it", () => {
    // A log outlives the item it references. Rendering the id keeps the row on
    // screen and traceable rather than dropping real history.
    expect(itemName(items, "s_gone")).toBe("s_gone");
  });

  it("falls back for every id when the catalog is empty", () => {
    expect(itemName([], "s_gone")).toBe("s_gone");
  });

  it("renders nothing for an absent reference", () => {
    expect(itemName(items, null)).toBe("");
  });
});

describe("reindex", () => {
  it("closes the gap a delete leaves in order", () => {
    const remaining = [item("a", 0), item("c", 2), item("d", 3)];
    expect(reindex(remaining).map(i => i.order)).toEqual([0, 1, 2]);
  });

  it("preserves the existing relative order", () => {
    const items = [item("c", 9), item("a", 2), item("b", 5)];
    expect(reindex(items).map(i => i.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps archived items in the sequence so they can be restored", () => {
    // An archived item still owns a slot; dropping it here would renumber the
    // list differently every time one was hidden.
    const items = [item("a", 0), item("b", 1, true), item("c", 2)];
    expect(reindex(items).map(i => [i.id, i.order])).toEqual([["a", 0], ["b", 1], ["c", 2]]);
  });
});

describe("isItemReferenced", () => {
  const scratch = (location: string, cue: string, routine_id: string | null) =>
    ({ location, cue, routine_id });

  it("finds a symptom held by a stored check-in", () => {
    const logs = { ...noLogs, symptomLogs: [{ scores: { s_itch: 4 } }] };
    expect(isItemReferenced("symptom", "s_itch", logs)).toBe(true);
  });

  it("does not count an explicit null as a reference", () => {
    // null means "shown, left blank" — not an answer the catalog must
    // preserve history for.
    const logs = { ...noLogs, symptomLogs: [{ scores: { s_itch: null } }] };
    expect(isItemReferenced("symptom", "s_itch", logs)).toBe(false);
  });

  it("reports a symptom no check-in scored as unreferenced", () => {
    const logs = { ...noLogs, symptomLogs: [{ scores: { s_heat: 4 } }] };
    expect(isItemReferenced("symptom", "s_itch", logs)).toBe(false);
  });

  it("counts a score of 0 as a reference", () => {
    // The check is presence of the key, not its truthiness: a stored 0 is a
    // real answer, and mergeScores keeps it forever. Reading it as absent
    // would hard-delete a symptom that history still points at.
    const logs = { ...noLogs, symptomLogs: [{ scores: { s_itch: 0 } }] };
    expect(isItemReferenced("symptom", "s_itch", logs)).toBe(true);
  });

  it("survives a check-in whose score map is missing", () => {
    // Storage can hold a malformed log; a delete must not throw over it.
    const logs = { ...noLogs, symptomLogs: [{ scores: undefined as any }] };
    expect(isItemReferenced("symptom", "s_itch", logs)).toBe(false);
  });

  it("finds a body location, a cue and a routine held by one urge log", () => {
    const logs = { ...noLogs, scratchLogs: [scratch("l_arm", "c_stress", "r_fist")] };
    expect(isItemReferenced("bodyLocation", "l_arm", logs)).toBe(true);
    expect(isItemReferenced("cue", "c_stress", logs)).toBe(true);
    expect(isItemReferenced("routine", "r_fist", logs)).toBe(true);
  });

  it("does not confuse one kind's id for another's", () => {
    // Every kind's ids live in the same generated-id space, so a location id
    // could otherwise match a cue column and block a legitimate delete.
    const logs = { ...noLogs, scratchLogs: [scratch("l_arm", "c_stress", "r_fist")] };
    expect(isItemReferenced("cue", "l_arm", logs)).toBe(false);
    expect(isItemReferenced("bodyLocation", "c_stress", logs)).toBe(false);
    expect(isItemReferenced("routine", "c_stress", logs)).toBe(false);
  });

  it("treats an urge log with no routine as referencing no routine", () => {
    const logs = { ...noLogs, scratchLogs: [scratch("l_arm", "c_stress", null)] };
    expect(isItemReferenced("routine", "r_fist", logs)).toBe(false);
  });

  it("finds a body location held only by a skin photo's tag", () => {
    // A location can be tagged on a photo without ever appearing in an urge
    // log. Missing that holder is how a hard delete strands the photo's tag —
    // the location is gone but the photo still points at its id.
    const logs = { ...noLogs, skinPhotos: [{ location: "l_arm" }] };
    expect(isItemReferenced("bodyLocation", "l_arm", logs)).toBe(true);
  });

  it("does not let a photo's location match another kind's column", () => {
    const logs = { ...noLogs, skinPhotos: [{ location: "l_arm" }] };
    expect(isItemReferenced("cue", "l_arm", logs)).toBe(false);
  });

  it("finds a food held by a check-in log", () => {
    const logs = { ...noLogs, consumptionLogs: [{ item_id: "f_ramen" }] };
    expect(isItemReferenced("food", "f_ramen", logs)).toBe(true);
    expect(isItemReferenced("food", "f_rice", logs)).toBe(false);
  });

  it("reports everything as unreferenced when there are no logs at all", () => {
    expect(isItemReferenced("symptom", "s_itch", noLogs)).toBe(false);
    expect(isItemReferenced("food", "f_ramen", noLogs)).toBe(false);
  });
});

const food = (id: string, category: string, tags: Record<string, 0 | 1> = {}) =>
  ({ id, name: id, category, tags, is_elimination_safe: true }) as FoodItem;

describe("isItemReferenced for the food vocabulary", () => {
  it("finds a category a food is filed under", () => {
    const logs = { ...noLogs, foods: [food("f1", "Grains")] };
    expect(isItemReferenced("foodCategory", "Grains", logs)).toBe(true);
  });

  it("reports a category no food uses as unreferenced", () => {
    const logs = { ...noLogs, foods: [food("f1", "Grains")] };
    expect(isItemReferenced("foodCategory", "Sweets", logs)).toBe(false);
  });

  it("finds a tag a food actually carries", () => {
    const logs = { ...noLogs, foods: [food("f1", "Grains", { dairy: 1 })] };
    expect(isItemReferenced("foodTag", "dairy", logs)).toBe(true);
  });

  it("does NOT count a tag explicitly set to 0", () => {
    // The asymmetry with symptoms, and the one worth getting right: a stored 0
    // means "this food is not dairy", which pins nothing. Counting key presence
    // — as the symptom rule does, because a score of 0 is a real answer —
    // would make every tag undeletable the moment one food had been edited.
    const logs = { ...noLogs, foods: [food("f1", "Grains", { dairy: 0 })] };
    expect(isItemReferenced("foodTag", "dairy", logs)).toBe(false);
  });
});

describe("deleteOrArchive", () => {
  it("archives a referenced item instead of removing it", () => {
    // The point of the guard: the item stays in the array so itemName can
    // still resolve every log that points at it.
    const items = [item("a", 0), item("b", 1), item("c", 2)];
    const result = deleteOrArchive(items, "b", true);
    expect(result.outcome).toBe("archived");
    expect(result.items.map(i => i.id)).toEqual(["a", "b", "c"]);
    expect(result.items[1].isArchived).toBe(true);
  });

  it("leaves order untouched when archiving so the slot is held", () => {
    const items = [item("a", 0), item("b", 1), item("c", 2)];
    expect(deleteOrArchive(items, "b", true).items.map(i => i.order)).toEqual([0, 1, 2]);
  });

  it("stamps the archived item so the archive survives a restore", () => {
    // Without a timestamp the un-archived remote copy wins the recency merge
    // and the item reappears in every picker.
    const items = [item("a", 0)];
    expect(deleteOrArchive(items, "a", true).items[0].updated_at).toBeTypeOf("string");
  });

  it("hard-deletes an unreferenced item", () => {
    const items = [item("a", 0), item("b", 1), item("c", 2)];
    const result = deleteOrArchive(items, "b", false);
    expect(result.outcome).toBe("deleted");
    expect(result.items.map(i => i.id)).toEqual(["a", "c"]);
  });

  it("closes the order gap a hard delete leaves", () => {
    const items = [item("a", 0), item("b", 1), item("c", 2)];
    expect(deleteOrArchive(items, "b", false).items.map(i => i.order)).toEqual([0, 1]);
  });

  it("does not mutate the input list", () => {
    const items = [item("a", 0), item("b", 1)];
    deleteOrArchive(items, "a", true);
    expect(items[0].isArchived).toBe(false);
    expect(items.map(i => i.id)).toEqual(["a", "b"]);
  });

  it("keeps a routine's description when archiving it", () => {
    const routines: RoutineItem[] = [
      { id: "r_fist", name: "Clench fist", order: 0, isArchived: false, description: "10s" },
    ];
    expect(deleteOrArchive(routines, "r_fist", true).items[0].description).toBe("10s");
  });
});

describe("reorderByIds", () => {
  it("renumbers order to match the given sequence", () => {
    const items = [item("a", 0), item("b", 1), item("c", 2)];
    const result = reorderByIds(items, ["c", "a", "b"]);
    expect(result.map(i => [i.id, i.order])).toEqual([["c", 0], ["a", 1], ["b", 2]]);
  });

  it("stamps only the items whose order actually changed", () => {
    // A reorder is the one edit that lives entirely in `order`, so an
    // unstamped move loses to the remote copy and silently snaps back.
    const items = [item("a", 0), item("b", 1), item("c", 2)];
    const result = reorderByIds(items, ["a", "c", "b"]);
    expect(result[0].updated_at).toBeUndefined();
    expect(result[1].updated_at).toBeTypeOf("string");
    expect(result[2].updated_at).toBeTypeOf("string");
  });

  it("keeps items the caller did not list, after the ones it did", () => {
    // Reorder is driven by the visible list, which excludes archived items.
    // They must survive the write rather than being dropped from the catalog.
    const items = [item("a", 0), item("b", 1, true), item("c", 2)];
    const result = reorderByIds(items, ["c", "a"]);
    expect(result.map(i => [i.id, i.order])).toEqual([["c", 0], ["a", 1], ["b", 2]]);
  });

  it("ignores an id the catalog no longer holds", () => {
    const items = [item("a", 0), item("b", 1)];
    expect(reorderByIds(items, ["b", "gone", "a"]).map(i => i.id)).toEqual(["b", "a"]);
  });

  it("does not mutate the input list", () => {
    const items = [item("a", 0), item("b", 1)];
    reorderByIds(items, ["b", "a"]);
    expect(items.map(i => [i.id, i.order])).toEqual([["a", 0], ["b", 1]]);
  });
});

describe("reorderByIds on a list that is not in order sequence", () => {
  it("keeps unlisted items in their `order`, not their array position", () => {
    // A restore merge can hand back an array in any array order, so the
    // remainder has to be sorted by the field that means something. Reading
    // array position instead silently swapped two archived items.
    const items = [item("z", 2, true), item("a", 0), item("y", 1, true)];
    expect(reorderByIds(items, ["a"]).map(i => [i.id, i.order]))
      .toEqual([["a", 0], ["y", 1], ["z", 2]]);
  });

  it("ignores a repeated id, keeping only its first occurrence", () => {
    // A duplicate would otherwise put the same item in the catalog twice.
    const items = [item("a", 0), item("b", 1)];
    expect(reorderByIds(items, ["b", "a", "b"]).map(i => [i.id, i.order]))
      .toEqual([["b", 0], ["a", 1]]);
  });
});

describe("cleanItemName", () => {
  it("strips surrounding whitespace", () => {
    // "Arm" and "Arm " would otherwise be two indistinguishable picker rows.
    expect(cleanItemName("  Arm  ")).toBe("Arm");
  });

  it("leaves an already-clean name alone", () => {
    expect(cleanItemName("Left forearm")).toBe("Left forearm");
  });

  it("keeps the spaces inside a name", () => {
    expect(cleanItemName("  Left  forearm ")).toBe("Left  forearm");
  });

  it("rejects a name that is empty or only whitespace", () => {
    // Rejected, not silently stored: an unnamed item is unpickable and
    // unfindable, and the caller must not write anything at all.
    expect(cleanItemName("")).toBeNull();
    expect(cleanItemName("   ")).toBeNull();
    expect(cleanItemName("\n\t ")).toBeNull();
  });
});
