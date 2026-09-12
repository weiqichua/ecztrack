/**
 * User-created catalogs — the lists the logging screens pick from.
 *
 * Four of the five catalogs need nothing beyond a name, an order and an
 * archive flag, so they share one shape. Foods keep their own richer
 * `FoodItem` (category, tags, elimination flag) in `constants/foods.ts`.
 *
 * Ids are generated once and never reused as display text. Logs store the id,
 * so renaming an item retitles every past entry instead of orphaning it — and
 * that is also why items are archived rather than deleted: history keeps
 * pointing at an item nobody can pick any more.
 */

import { stamp } from "@/lib/recency";
import type { FoodItem } from "@/constants/foods";

/** A user-created item in one of the pickable lists. */
export interface CatalogItem {
  id: string;
  name: string;
  /** Display order index — dense from 0 across the whole catalog. */
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

/** A competing routine, the one catalog with a second field worth showing. */
export interface RoutineItem extends CatalogItem {
  description?: string;
}

export type CatalogKind =
  | "bodyLocation" | "cue" | "routine" | "symptom"
  | "foodCategory" | "foodTag" | "supplement" | "activity";

/**
 * The items a picker may offer: not archived, in display order.
 *
 * Every picker must go through this rather than filtering inline. An archived
 * item leaking into a list is not a cosmetic bug — picking it writes new
 * history against something the user deliberately retired.
 */
export function activeItems<T extends { order: number; isArchived: boolean }>(items: T[]): T[] {
  return items.filter(i => !i.isArchived).sort((a, b) => a.order - b.order);
}

/**
 * Renumbers `order` densely from 0, keeping the current relative order.
 *
 * Run this after any removal. Leaving the gap behind is harmless on its own,
 * but appending then uses `items.length` as the next order and collides with
 * an existing one, and two items sharing an order sort unpredictably.
 *
 * Archived items keep their slot — they are still in the list, just hidden.
 */
export function reindex<T extends { order: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order).map((item, i) => ({ ...item, order: i }));
}

/**
 * The display name for a stored id.
 *
 * Falls back to the id itself because logs outlive catalogs. A log holds an id
 * forever; the item behind it can be gone — archived out of view, or removed by
 * a bug or a partial restore. Rendering the id keeps the row visible and
 * traceable, where returning "" would make real history silently disappear from
 * the screen. This is a net for the broken case, not a translation layer.
 */
export function itemName<T extends { id: string; name: string }>(items: T[], id: string | null): string {
  if (!id) return "";
  return items.find(i => i.id === id)?.name ?? id;
}

/**
 * The log fields a delete has to consult before removing an item.
 *
 * Structural rather than the real log types so this module keeps no dependency
 * on `constants/types` — and so a test can state a reference in one line
 * instead of building three full log records around it.
 */
export interface ItemReferences {
  consumptionLogs: { item_id: string }[];
  symptomLogs: { scores: Record<string, number | null> }[];
  scratchLogs: { location: string; cue: string; routine_id: string | null }[];
  foods: FoodItem[];
  skinPhotos: { location?: string }[];
  supplementLogs: { item_id: string }[];
  activityLogs: { item_id: string }[];
}

/** Everything a user can create and therefore ask to delete. */
export type DeletableKind = CatalogKind | "food";

/** What a delete actually did. The caller has to tell the user which. */
export type DeleteOutcome = "archived" | "deleted";

/**
 * Whether any stored log still points at this item.
 *
 * The one input to the archive-vs-delete decision. Each kind is referenced
 * from exactly one column, and every kind's ids share one generated-id space,
 * so the column has to be chosen by kind — checking all of them would let a
 * body location's id match a cue and block a legitimate delete.
 */
export function isItemReferenced(kind: DeletableKind, id: string, logs: ItemReferences): boolean {
  switch (kind) {
    case "food":
      return logs.consumptionLogs.some(l => l.item_id === id);
    case "bodyLocation":
      return logs.scratchLogs.some(l => l.location === id) ||
        logs.skinPhotos.some(p => p.location === id);
    case "cue":
      return logs.scratchLogs.some(l => l.cue === id);
    case "routine":
      return logs.scratchLogs.some(l => l.routine_id === id);
    case "symptom":
      // Key presence with a real value, not mere presence: a stored score of 0
      // is still an answer the user gave and mergeScores keeps it forever, but
      // an explicit null is "asked, left blank" and must not pin the symptom
      // in place. Reading a real score as absent would hard-delete a symptom
      // that history still points at.
      return logs.symptomLogs.some(l => !!l.scores && l.scores[id] != null);
    case "foodCategory":
      return logs.foods.some(f => f.category === id);
    case "foodTag":
      // `=== 1`, not `!= null`: a stored 0 is "explicitly not this tag".
      return logs.foods.some(f => f.tags[id] === 1);
    case "supplement":
      return logs.supplementLogs.some(l => l.item_id === id);
    case "activity":
      return logs.activityLogs.some(l => l.item_id === id);
  }
}

/**
 * Removes an item, or archives it when history still needs it.
 *
 * A referenced item is archived: it leaves every picker but stays in the array
 * so `itemName` can still title the logs that hold its id. An unreferenced item
 * is genuinely gone, and the catalog is renumbered densely behind it.
 *
 * The hard delete needs no cleanup pass over stored logs, and that is a
 * consequence of the guard rather than luck: "unreferenced" is defined as no
 * log — or skin photo — holding the id, so there is nothing for `mergeScores`
 * to preserve and nothing to purge. Weakening the reference check would break
 * that.
 *
 * Pure, and separate from the context mutator that calls it, so the decision
 * this makes is unit-testable — AppContext itself cannot be imported by a test.
 */
export function deleteOrArchive<T extends CatalogItem>(
  items: T[],
  id: string,
  isReferenced: boolean,
): { items: T[]; outcome: DeleteOutcome } {
  if (isReferenced) {
    return {
      // Stamped: an unstamped archive loses the recency merge to the remote
      // copy that is still active, and the item returns to every picker.
      items: items.map(i => (i.id === id ? stamp({ ...i, isArchived: true }) : i)),
      outcome: "archived",
    };
  }
  return { items: reindex(items.filter(i => i.id !== id)), outcome: "deleted" };
}

/**
 * Renumbers `order` to match the given id sequence.
 *
 * Callers reorder what they can see, which is `activeItems` — so ids the caller
 * omitted (the archived ones) keep their relative order after the listed ones
 * rather than being dropped from the catalog. That remainder is sorted by
 * `order`, not by array position: a restore merge can hand back the catalog in
 * any array order, and reading position there swapped two archived items every
 * time it did.
 *
 * A repeated id counts once, at its first occurrence. Taking it twice would put
 * the same item in the catalog twice.
 *
 * Only moved items are stamped. A reorder lives entirely in `order`, so an
 * unstamped move loses the recency merge and snaps back on the next restore;
 * stamping the items that did not move would just as wrongly overrule a real
 * edit made to them on another device.
 */
export function reorderByIds<T extends CatalogItem>(items: T[], ids: string[]): T[] {
  const taken = new Set<string>();
  const listed: T[] = [];
  for (const id of ids) {
    if (taken.has(id)) continue;
    const found = items.find(i => i.id === id);
    if (!found) continue;
    taken.add(id);
    listed.push(found);
  }
  const rest = items.filter(i => !taken.has(i.id)).sort((a, b) => a.order - b.order);
  return [...listed, ...rest].map((item, i) =>
    item.order === i ? item : stamp({ ...item, order: i }),
  );
}

/**
 * A name fit to store, or null when the user gave none.
 *
 * Trimmed because " Arm" and "Arm" are one item to a reader and two
 * indistinguishable rows in a picker. Null rather than "" for the empty case so
 * a caller cannot mistake "nothing to write" for a valid name — an unnamed item
 * is unpickable and unfindable once stored.
 *
 * Uniqueness is deliberately NOT checked here: the add and rename screens own
 * that, because only they can tell the user which existing item collided.
 */
export function cleanItemName(name: string): string | null {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : null;
}
