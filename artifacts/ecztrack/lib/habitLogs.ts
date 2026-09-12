import type { HabitLog } from "@/constants/types";
import type { LogCell } from "./logCell";

/**
 * What a tap wants the value to become: outright, or as a function of whatever
 * is stored now.
 *
 * The function form exists because the tiles save on every tap and a screen
 * cannot compute the next value correctly. Reading React state gives it the
 * pre-tap value, so two taps on one count tile both send the same absolute
 * number and land as +1 instead of +2. Passing the arithmetic in lets it be
 * resolved here, against the newest array.
 */
export type HabitValue = number | ((current: number) => number);

/** One habit's stored value for one day; 0 when the day has no log. */
export function habitValueOn(logs: HabitLog[], habitId: string, date: string): number {
  return logs.find(l => l.habitId === habitId && l.date === date)?.value ?? 0;
}

/**
 * Sets one habit's value for one day, or removes the day's log entirely.
 *
 * A value of zero or less is not stored: "not done" is the absence of a log,
 * which is what every reader treats a missing entry as. Storing a zero would
 * make two shapes mean the same thing.
 *
 * Pure and total, like `upsertSymptomLog`, so the mutator can fold it onto the
 * newest array rather than onto whatever React state it closed over.
 */
export function upsertHabitLog(
  logs: HabitLog[],
  habitId: string,
  date: string,
  want: HabitValue,
  newId: () => string,
): HabitLog[] {
  const isThisDay = (l: HabitLog) => l.habitId === habitId && l.date === date;
  // Resolved against `logs`, which is the newest array — never against a value
  // the caller read from state a render ago.
  const value = typeof want === "function"
    ? want(habitValueOn(logs, habitId, date))
    : want;
  if (value <= 0) return logs.filter(l => !isThisDay(l));
  const existing = logs.find(isThisDay);
  return existing
    ? logs.map(l => (isThisDay(l) ? { ...l, value } : l))
    : [...logs, { id: newId(), habitId, date, value }];
}

/**
 * One habit-tile tap, minus storage: folds it onto the newest array, publishes
 * it, and returns the value the caller must persist.
 *
 * The tiles save on every tap, so three taps inside one render must chain
 * rather than each rebuild from the pre-tap array — see lib/logCell.ts.
 */
export function applyHabitLog(
  cell: LogCell<HabitLog>,
  habitId: string,
  date: string,
  want: HabitValue,
  newId: () => string,
): HabitLog[] {
  const updated = upsertHabitLog(cell.get(), habitId, date, want, newId);
  cell.set(updated);
  return updated;
}
