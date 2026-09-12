/**
 * Collapsing a day's food entries into one row per food.
 *
 * Kept out of the screen so it can be unit-tested: the screen imports
 * react-native and expo-router, neither of which loads under vitest's node
 * environment.
 */

import type { ConsumptionLog, Phase, Portion } from "@/constants/types";
import { generateId } from "./ids";

/**
 * Adds one consumption record per selected food to the front of `existing`.
 *
 * A meal is a single event, so the whole selection shares one timestamp and
 * therefore one phase — both resolved by the caller, which owns the ledger.
 *
 * This exists as a batch rather than as a loop over a single-item mutator
 * because AppContext's mutators are callbacks closed over the current array:
 * awaiting one per selected food made every iteration spread the pre-loop
 * state, so only the last food survived to disk.
 */
export function prependConsumptionLogs(
  existing: ConsumptionLog[],
  itemIds: string[],
  opts: {
    timestamp: string; phase: Phase; isAccident?: boolean;
    /** Portion per food id; a food absent from the map was not given one. */
    portions?: Record<string, Portion>;
    /** Shared by every food in this save — see lib/mealGroups.ts. */
    groupId?: string;
    /** The meal's name; defaults to "Meal" at the call site. */
    meal?: string;
  },
): ConsumptionLog[] {
  const created: ConsumptionLog[] = itemIds.map(itemId => ({
    id: generateId(),
    timestamp: opts.timestamp,
    item_id: itemId,
    phase: opts.phase,
    is_accident: opts.isAccident ?? false,
    // Left off entirely rather than nulled: `defined()` strips undefined on the
    // way to Firestore, so an unrecorded portion stores no field at all.
    ...(opts.portions?.[itemId] ? { portion: opts.portions[itemId] } : {}),
    // Both left off when absent, for the same reason the portion is: `defined()`
    // strips undefined on the way to Firestore, so an ungrouped log stores no
    // field rather than a null one.
    ...(opts.groupId ? { group_id: opts.groupId } : {}),
    ...(opts.meal ? { meal: opts.meal } : {}),
  }));
  return [...created, ...existing];
}

/** How long a logged food keeps its "you just ate this" cue on the card. */
const RECENT_WINDOW_MS = 3 * 60 * 60 * 1000;

/**
 * The foods logged within the last three hours, so a card can say so.
 *
 * Separate from selection: the picker's filled button means "queued for the
 * next Save", this means "already on today's log". Both can be true at once.
 */
export function recentlyLoggedIds(logs: ConsumptionLog[], now: number): Set<string> {
  const cutoff = now - RECENT_WINDOW_MS;
  const ids = new Set<string>();
  for (const l of logs) {
    if (new Date(l.timestamp).getTime() > cutoff) ids.add(l.item_id);
  }
  return ids;
}
