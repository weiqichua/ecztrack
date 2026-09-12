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
