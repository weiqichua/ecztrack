/**
 * The two rules the catalog manager UI owns.
 *
 * `cleanItemName` trims and returns null for a blank name, and the context
 * mutators silently no-op on that — so a screen that just calls the mutator
 * looks like it saved and did nothing. Uniqueness is not checked anywhere
 * either. Both live here, returning a message rather than a boolean, because
 * only the editing screen can say which existing row collided.
 */

import { cleanItemName } from "@/constants/catalog";

export type NameCheck = { ok: true; name: string } | { ok: false; error: string };

/**
 * Validates a name typed into an add or rename field.
 *
 * `existing` should be the items a picker can actually offer — the active ones.
 * Archived names are deliberately reusable: an archived item appears in no
 * picker, so a new item sharing its name is never ambiguous to choose, and
 * blocking it would make the name unusable forever with no way to release it.
 *
 * Comparison is case- and whitespace-insensitive: "arm" and " Arm " are one
 * item to a reader and two indistinguishable chips in a picker.
 *
 * Pass `excludeId` when renaming, or an item fails validation against itself
 * and can never be recapitalised.
 */
export function checkCatalogName(
  raw: string,
  existing: { id: string; name: string }[],
  excludeId?: string,
): NameCheck {
  const name = cleanItemName(raw);
  if (!name) return { ok: false, error: "Enter a name first." };
  const key = name.toLowerCase();
  const clash = existing.find(i => i.id !== excludeId && i.name.trim().toLowerCase() === key);
  if (clash) return { ok: false, error: `"${clash.name}" is already on the list.` };
  return { ok: true, name };
}

/**
 * Moves one entry by `delta`, for feeding straight to `reorderCatalogItems`.
 *
 * A move off either end returns the list untouched rather than wrapping, so the
 * arrow buttons on the first and last row are simply inert.
 */
export function moveInList<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

/**
 * The archived items of a catalog, in display order.
 *
 * The mirror of `activeItems`, and the one read the pickers must never make.
 * It exists for the manager's recovery section: archiving is what deleting a
 * referenced item does, so without a list of them the ordinary delete action
 * leads somewhere the user cannot return from.
 */
export function archivedItems<T extends { order: number; isArchived: boolean }>(items: T[]): T[] {
  return items.filter(i => i.isArchived).sort((a, b) => a.order - b.order);
}

/**
 * The archived entries of a list that has no `order` to sort by — the food
 * library, whose records were never ordered — so alphabetical instead.
 *
 * Same purpose as `archivedItems`: a delete that history references archives
 * instead, and an archived record no list shows is a dead end.
 */
export function archivedByName<T extends { name: string; isArchived?: boolean }>(items: T[]): T[] {
  return items.filter(i => i.isArchived).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The item to write back to un-archive one, or why it cannot come back.
 *
 * Two things have to be decided here, and neither is obvious.
 *
 * The name: `checkCatalogName` deliberately lets an archived name be reused,
 * so an active item may have taken it since. Restoring anyway would put two
 * indistinguishable chips in every picker, so the restore is refused and the
 * user is told which row to rename first.
 *
 * `order` is deliberately absent from the constraint rather than merely
 * unwritten: a FoodItem has none at all, and the food library restores
 * through here too. Anything ordered keeps its slot untouched, for the reason
 * below.
 *
 * The order: a restore only flips the archived flag — the item count is
 * unchanged, so the item's existing `order` is still a unique, dense slot
 * over the active+archived union. Overriding it to `items.length` would
 * collide with the next `addCatalogItem`, which computes that same value
 * from a count the restore didn't actually change. `reorderByIds` already
 * migrates archived items behind the active block, so a restored item lands
 * at the end anyway in the common case; where there was no intervening
 * reorder, it returns to the position the user left it in.
 */
export function restoreItem<T extends { id: string; name: string; isArchived?: boolean }>(
  item: T,
  items: T[],
): { ok: true; item: T } | { ok: false; error: string } {
  const key = item.name.trim().toLowerCase();
  const clash = items.find(i => !i.isArchived && i.name.trim().toLowerCase() === key);
  if (clash) {
    return {
      ok: false,
      error: `"${clash.name}" is already on the list. Rename or remove it first, then restore this one.`,
    };
  }
  return { ok: true, item: { ...item, isArchived: false } };
}
