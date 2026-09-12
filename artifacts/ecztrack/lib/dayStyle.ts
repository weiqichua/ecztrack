/**
 * How a single day is coloured, wherever days are drawn.
 *
 * The month grid and the one-week strip show the same day, so they must show it
 * the same way. Every colour code and the whole fill/dot decision live here and
 * nowhere else — two copies of a palette drift the first time one of them gains
 * a phase or loses a dot, and the two screens then disagree about the same day.
 *
 * Pure, and takes "today" as an argument rather than reading the clock, so the
 * decision is unit-testable without a React renderer and cannot go stale in a
 * tab Expo Router mounted once and never unmounts.
 *
 * The one colour that is not fixed is today's own fill: that is the app's accent
 * and follows the theme, so the caller passes it in.
 */
import type { Phase } from "@/constants/types";
import { isOnLocalDay } from "@/lib/dates";

/**
 * A day's fill by the phase running on it.
 *
 * `none` is a real phase — a day nothing was running on — and is never shown in
 * a legend: "no phase" is the absence of a marker, not one of the markers.
 */
export const PHASE_COLORS: Record<Phase, string> = {
  none: "#78909C",
  elimination: "#81D4FA",
  challenge: "#FFB300",
};

/** The dots under a day, one per kind of thing that can be logged. */
export const ACTIVITY_COLORS = {
  food: "#66BB6A",
  urge: "#EF5350",
  checkin: "#81D4FA",
} as const;

export type ActivityKind = keyof typeof ACTIVITY_COLORS;

/** A checked-in day that no phase was running on. */
export const CHECKIN_FILL = ACTIVITY_COLORS.checkin;

/**
 * The phases a day's own logs were stamped with, in preference order.
 *
 * Only a fallback for a day the ledger has nothing for — `phaseOfRecord` decides
 * that, and a stored phase can never override the ledger. Both the month grid
 * and the week strip feed this the same two log arrays so the two views cannot
 * derive different facts for the same day.
 */
export function loggedPhases(
  dateKey: string,
  symptomLogs: { date: string; phase?: Phase; scores?: Record<string, number | null> }[],
  consumptionLogs: { timestamp: string; phase: Phase }[],
): (Phase | undefined)[] {
  return [
    // An emptied check-in is excluded for the same reason it does not light the
    // dot: tapping a box and tapping it off again leaves a log behind, and a day
    // the user recorded nothing on must not report a phase off that residue. A
    // day with real food or urge logs still gets its phase below.
    ...symptomLogs.filter(l => l.date === dateKey && isRecordedCheckin(l)).map(l => l.phase),
    ...consumptionLogs.filter(l => isOnLocalDay(l.timestamp, dateKey)).map(l => l.phase),
  ];
}

/**
 * Whether a log records an actual check-in.
 *
 * A log can exist with every score `null`: tapping a box and tapping it off
 * again leaves the day's record in place with nothing in it. That is "nothing
 * recorded", not a check-in — counting it lights the check-in dot on an empty
 * day and, on a past day, flips the missed fill to the checked-in one, so a
 * day the user cleared reads as done.
 *
 * Tolerates a missing or malformed stored map, like every other reader of
 * `scores`.
 */
export function isRecordedCheckin(log: { scores?: Record<string, number | null> }): boolean {
  return Object.values(log.scores ?? {}).some(v => v != null);
}

/**
 * Whether a day was checked in on, across the whole collection.
 *
 * Lives here rather than in the grid and the strip because both draw the same
 * day and must draw it the same way — the point of putting the fill/dot
 * decision in one place is that no view derives these facts on its own.
 */
export function hasCheckinOn(
  logs: { date: string; scores?: Record<string, number | null> }[],
  dateKey: string,
): boolean {
  return logs.some(l => l.date === dateKey && isRecordedCheckin(l));
}

/** Everything about a day that changes how it is drawn. */
export interface DayFacts {
  dateKey: string;
  todayKey: string;
  /** The phase of record — `"none"` for a day nothing was running on. */
  phase: Phase;
  hasFood: boolean;
  hasUrge: boolean;
  hasCheckin: boolean;
}

/** One activity dot. A null colour means the slot is held open but empty. */
export interface DayDot {
  kind: ActivityKind;
  color: string | null;
}

export interface DayStyle {
  /** The circle's background, or null for no fill at all. */
  fill: string | null;
  isToday: boolean;
  isFuture: boolean;
  /**
   * Always three dots, always in the same order. Empty slots are returned
   * rather than dropped so the row keeps its width and the days below a grid
   * do not shuffle sideways as activity comes and goes.
   */
  dots: DayDot[];
}

/**
 * The fill and dots for one day.
 *
 * `todayFill` is the theme's accent, used only for today before it has been
 * checked in on — a check-in always wins, because the phase it was logged
 * under says more about the day than "this is today" does.
 */
export function dayStyle(facts: DayFacts, todayFill: string): DayStyle {
  const isToday = facts.dateKey === facts.todayKey;
  const isFuture = facts.dateKey > facts.todayKey;
  const isPast = facts.dateKey < facts.todayKey;

  // A blank phase is not a lookup miss: the day is still filled, just not in a
  // phase's colour.
  const fill = facts.hasCheckin
    ? (facts.phase !== "none" ? PHASE_COLORS[facts.phase] : CHECKIN_FILL)
    : isToday ? todayFill
    : null;

  return {
    fill,
    isToday,
    isFuture,
    dots: [
      { kind: "food", color: facts.hasFood ? ACTIVITY_COLORS.food : null },
      { kind: "urge", color: facts.hasUrge ? ACTIVITY_COLORS.urge : null },
      { kind: "checkin", color: facts.hasCheckin ? ACTIVITY_COLORS.checkin : null },
    ],
  };
}
