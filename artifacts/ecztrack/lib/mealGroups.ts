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
      const sorted = [...entries].sort((a, b) => at(a) - at(b) || a.id.localeCompare(b.id));
      return {
        groupId,
        // Read off the earliest entry, id-tiebroken: a backup merge can
        // resurrect a log carrying an older label than its groupmates, so the
        // group's own logs are not guaranteed to agree. The tiebreak just
        // needs to be stable, so two devices render the same winner even when
        // a merge has left the group disagreeing.
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
  // A named meal must be a keyed meal: writing `meal` without stamping
  // `group_id` on a legacy log ships a label with no group, and the blank
  // meal_id column silently fuses every such renamed legacy log across
  // history into one bucket for anyone who groups by it. The stamped id
  // equals the key groupLogsByMeal already derives, so nothing changes on
  // screen.
  return logs.map(l =>
    (l.group_id ?? l.id) === groupId
      ? { ...l, meal: name, group_id: l.group_id ?? l.id }
      : l);
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

/**
 * Deletes all logs belonging to a meal group.
 */
export function deleteMealIn(logs: ConsumptionLog[], groupId: string): ConsumptionLog[] {
  return logs.filter(l => (l.group_id ?? l.id) !== groupId);
}

