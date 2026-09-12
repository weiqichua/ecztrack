/**
 * Local-calendar date helpers.
 *
 * The app has two kinds of date value and they must not be confused:
 *
 *   - a **timestamp** is a full ISO-8601 instant (`2026-08-17T14:03:00.000Z`)
 *     and records *when* something happened;
 *   - a **date key** is `YYYY-MM-DD` and records *which day* it belongs to,
 *     in the user's local calendar.
 *
 * Deriving a date key from a timestamp with `toISOString().split("T")[0]`
 * yields the UTC day, which disagrees with the local day for part of every
 * 24 hours — before 08:00 local in UTC+8, after ~16:00 local in the Americas.
 * Entries then get filed under, and searched for under, different days.
 * Always go through `localDateKey`.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** The local-calendar `YYYY-MM-DD` for an instant (defaults to now). */
export function localDateKey(d: Date | string = new Date()): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local midnight at the start of a date key. */
export function startOfLocalDay(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/** The last instant of a date key's local day, as an ISO timestamp. */
export function endOfLocalDayISO(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

/**
 * Adds calendar days to a date key.
 *
 * Operates on calendar fields, so a span that crosses a DST transition still
 * lands on the intended date rather than drifting by the offset change.
 */
export function addDaysToKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return localDateKey(new Date(y, m - 1, d + days, 12, 0, 0, 0));
}

/**
 * Whole calendar days from `from` to `to`. Negative if `to` precedes `from`.
 *
 * Both keys are anchored at local noon before subtracting, so a DST shift
 * inside the range cannot round the result to the wrong day.
 */
export function daysBetweenKeys(from: string, to: string): number {
  const at = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
  };
  return Math.round((at(to) - at(from)) / 86_400_000);
}

/** Whether an ISO timestamp falls on a given local day. */
export function isOnLocalDay(iso: string, key: string): boolean {
  return localDateKey(iso) === key;
}

/** Today's local date key. */
export function todayKey(): string {
  return localDateKey();
}

/**
 * Renders a date key or timestamp as e.g. `Aug 17, 2026`.
 *
 * A bare `YYYY-MM-DD` is parsed as local midnight rather than being handed to
 * `new Date()`, which would read it as UTC midnight and render the previous
 * day in any timezone behind UTC.
 */
export function formatShortDate(value: string): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? startOfLocalDay(value) : new Date(value);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Milliseconds until just after the next local midnight, for scheduling a
 * day-rollover tick.
 *
 * Built from calendar fields rather than `now + 24h` so it lands on the real
 * local midnight on DST transition days, where the day is 23 or 25 hours long.
 *
 * The result is clamped to [1s, 1h]. The upper clamp means the tick may fire
 * several times before it actually rolls the day, which is harmless and is what
 * keeps a device that sleeps through the deadline from missing it entirely.
 * The lower clamp keeps a tick scheduled at 23:59:59.9 from busy-looping.
 */
export function msUntilNextLocalMidnight(now: Date = new Date()): number {
  const nextMidnight = new Date(
    now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5,
  );
  return Math.min(Math.max(nextMidnight.getTime() - now.getTime(), 1000), 60 * 60 * 1000);
}
