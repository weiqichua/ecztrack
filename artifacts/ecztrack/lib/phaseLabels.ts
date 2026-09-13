/**
 * A phase's status as the phase card has to say it out loud.
 *
 * There are three states and the old card only ever rendered one: a scheduled
 * elimination read as "Since <a date that has not happened yet>". Splitting the
 * three apart is the fix, and doing it here rather than inside the component is
 * what makes the day arithmetic testable — the day before the start, the start
 * day itself, the last planned day, and the day after are all off-by-one
 * candidates, and there is no harness that can render a component to check them.
 *
 * `eliminationStatus` was renamed `phaseStatus` because a ledger's open span can
 * now be either kind: a challenge has no planned length, so "running" splits by
 * `phase` and only the elimination branch carries a day count and a progress bar.
 *
 * Pure, and takes "today" as an argument like everything in `lib/phases.ts`.
 */
import { addDaysToKey, daysBetweenKeys } from "./dates";
import { openSpan, spanOnDate } from "./phases";
import type { PhaseLedger } from "@/constants/types";

export type PhaseStatus =
  /** Nothing running and nothing scheduled — a state, not a missing value. */
  | { kind: "none" }
  | { kind: "scheduled"; id: string; startDate: string; what: string; daysAway: number; label: string }
  /** Today is one of the elimination's days. */
  | {
      kind: "running";
      phase: "elimination";
      id: string;
      startDate: string;
      what: string;
      /** Where it stopped, or the final day of the plan while it is on. */
      lastDay: string;
      dayNumber: number;
      totalDays: number;
      daysLeft: number;
      progress: number;
      /** Whether there is still something to end — false once it has been ended. */
      canEnd: boolean;
      label: string;
    }
  /** Today is one of the challenge's days. A challenge has no planned length. */
  | {
      kind: "running";
      phase: "challenge";
      id: string;
      startDate: string;
      what: string;
      dayNumber: number;
      /** Whether there is still something to end — false once it has been ended. */
      canEnd: boolean;
      label: string;
    };

function startsInLabel(daysAway: number, what: string): string {
  if (daysAway === 1) return `Starts tomorrow · ${what}`;
  return `Starts in ${daysAway} days · ${what}`;
}

function runningLabel(dayNumber: number, totalDays: number, daysLeft: number, what: string): string {
  // "0 days left" is technically true on the final day and reads like a bug.
  const tail = daysLeft === 0
    ? "last day"
    : `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left`;
  return `Day ${dayNumber} of ${totalDays} · ${what} · ${tail}`;
}

/**
 * What the phase card says about today.
 *
 * The question is "which span covers today", not "which span is open". Those
 * differ for exactly one day: the day a phase is ended. Ending sets `endedOn`
 * to today, so the span stops being open immediately, but it still owns today —
 * `phaseOnDate` keeps colouring today on the calendar and the week strip. Asking
 * `openSpan` here made the card read "Nothing running" over a day still painted
 * as elimination, which is the contradiction this ordering exists to prevent.
 *
 * `canEnd` carries the difference the card actually needs: the pencil and the
 * edit modal are gated on it, so ending removes the action and leaves the record.
 */
export function phaseStatus(ledger: PhaseLedger, todayKey: string): PhaseStatus {
  const span = spanOnDate(ledger, todayKey, todayKey);

  if (span) {
    const dayNumber = daysBetweenKeys(span.startDate, todayKey) + 1;
    const canEnd = span.endedOn === null;

    if (span.kind === "challenge") {
      return {
        kind: "running",
        phase: "challenge",
        id: span.id,
        startDate: span.startDate,
        what: span.what,
        dayNumber,
        canEnd,
        label: `Day ${dayNumber} · ${span.what}`,
      };
    }

    // Ending early shortens the plan itself, not just where it stopped: day 4
    // of an ended-early run *is* the last day, so the total it's measured
    // against has to shrink to 4 as well. Otherwise the label says "last day"
    // while the bar it sits above reads a stale 29% (4 of the original 14).
    const lastDay = span.endedOn !== null
      ? span.endedOn
      : addDaysToKey(span.startDate, span.plannedDays - 1);
    const totalDays = span.endedOn !== null
      ? daysBetweenKeys(span.startDate, span.endedOn) + 1
      : span.plannedDays;
    const daysLeft = daysBetweenKeys(todayKey, lastDay);
    return {
      kind: "running",
      phase: "elimination",
      id: span.id,
      startDate: span.startDate,
      what: span.what,
      lastDay,
      dayNumber,
      totalDays,
      daysLeft,
      progress: Math.min(dayNumber / totalDays, 1),
      canEnd,
      label: runningLabel(dayNumber, totalDays, daysLeft, span.what),
    };
  }

  // Only a *scheduled* span reaches here with a card to show: it starts in the
  // future, so it covers no day yet and `spanOnDate` cannot find it. This branch
  // is the whole of what keeps that card visible, which is why it must be a
  // direct `startDate` comparison — inferring "scheduled" from a day number
  // coming back null would also catch every genuinely absent day.
  const open = openSpan(ledger, todayKey);
  if (open && todayKey < open.startDate) {
    const daysAway = daysBetweenKeys(todayKey, open.startDate);
    return { kind: "scheduled", id: open.id, startDate: open.startDate, what: open.what, daysAway, label: startsInLabel(daysAway, open.what) };
  }

  return { kind: "none" };
}
