/**
 * The phase ledger: reading a day out of it, and the rules that write it.
 *
 * A ledger is a list of **spans** — one record per phase actually run, carrying
 * its own dates and, for a challenge, what was being challenged. A day's phase
 * is not stored anywhere; it is found by asking which span contains the day.
 *
 * The shape this replaced stamped a phase onto every calendar day and needed a
 * materialiser walking forward on each app open to keep the map in step with
 * the clock. Two things killed it. A `Record<dateKey, Phase>` has nowhere to put
 * a challenge's label, and once challenges became a list, the map and the list
 * were two representations of one history that had to agree. Spans are the one
 * representation, and they are bounded by how many phases you run rather than
 * by how long the app has existed.
 *
 * The rules that survive from that model:
 *
 *   1. A span owns every day between its start and its last day, whether or not
 *      the app was opened. An elimination diet continues either way.
 *   2. A day inside no span is blank — `"none"`, in the past and the future
 *      alike. That is a state, not a missing value.
 *   3. An elimination may be scheduled to start on a future date.
 *   4. Only one span may be open at a time. Starting either phase while one is
 *      running or scheduled is refused; the exit is ending it.
 *   5. Ending early shortens a span, it does not delete it — except for one
 *      that never began, which leaves no trace.
 *
 * An elimination whose planned last day has passed is over *by computation*.
 * Nothing has to be written for that to be true, which is what removed the
 * materialiser altogether — and every reader has to honour it, `openSpan`
 * included. Asking only whether `endedOn` is null makes a finished elimination
 * open forever, which is a lockout rather than a stale label: the two mutators
 * both refuse while a span is open.
 *
 * Every function here is pure and takes "today" as an argument rather than
 * reading the clock, so the model is testable without faking time — and so the
 * answer for a given day cannot change depending on when it is asked.
 *
 * Date keys are `YYYY-MM-DD`, so lexicographic order is chronological order and
 * `<` / `>` between two of them is a valid date comparison. Day *arithmetic*
 * still goes through `lib/dates.ts`, which works in local calendar fields — the
 * app must not drift by a day for anyone whose offset is not a whole hour, or
 * across a DST transition.
 */
import { addDaysToKey, daysBetweenKeys } from "./dates";
import type { Phase, PhaseLedger, PhaseSpan } from "@/constants/types";

/** A ledger that has never had a phase in it. */
export const EMPTY_LEDGER: PhaseLedger = { spans: [] };

/**
 * The last day a span covers, never later than today.
 *
 * An open challenge has no planned end, and a running elimination's planned end
 * is a real future date. Neither should colour days that have not happened, so
 * both clamp — which is what the old materialiser achieved by only ever
 * stamping up to today.
 */
export function spanLastDay(span: PhaseSpan, todayKey: string): string {
  if (span.endedOn !== null) return span.endedOn;
  const planned = span.kind === "elimination"
    ? addDaysToKey(span.startDate, span.plannedDays - 1)
    : todayKey;
  return planned < todayKey ? planned : todayKey;
}

/**
 * Whether a span is still open **on `todayKey`** — the question every guard here
 * is really asking.
 *
 * `endedOn === null` alone is not it. Nothing writes `endedOn` when an
 * elimination's plan simply elapses, deliberately: `spanLastDay` works the last
 * day out from `plannedDays`, so no write is needed and the materialiser this
 * model replaced stays deleted. But that means a finished elimination keeps a
 * null `endedOn` forever, and "not ended" read as "still open" locked the app
 * out of every phase permanently — the card said "Nothing running" while both
 * mutators threw and the start sheet greyed out Start Challenge, with no route
 * out of the state at all.
 *
 * So an elimination is open only while its planned last day has not gone past,
 * which also keeps a *scheduled* one open: its plan ends later still. A
 * challenge has no planned length and runs until it is ended, so it is open
 * whenever it has not been.
 */
function isOpenOn(span: PhaseSpan, todayKey: string): boolean {
  if (span.endedOn !== null) return false;
  if (span.kind === "challenge") return true;
  return addDaysToKey(span.startDate, span.plannedDays - 1) >= todayKey;
}

/**
 * The span still running or scheduled today, if any. At most one exists — see
 * the mutators.
 *
 * Takes today because "open" is a fact about today, not about the record: see
 * `isOpenOn`. A span whose plan has run out is closed here without anything
 * having been written to close it.
 */
export function openSpan(ledger: PhaseLedger, todayKey: string): PhaseSpan | null {
  return ledger.spans.find(s => isOpenOn(s, todayKey)) ?? null;
}

/**
 * The span covering a day, or null.
 *
 * The one lookup: `phaseOnDate` is this plus `.kind`, and the phase card asks it
 * about today. Callers used to answer "what is running" from `openSpan`, which
 * is a different question — a span ended today is no longer open but still owns
 * today, and reading the day off the open span made the card say "Nothing
 * running" over a day the calendar was still colouring.
 */
export function spanOnDate(
  ledger: PhaseLedger, dateKey: string, todayKey: string,
): PhaseSpan | null {
  // The LATEST-starting span wins, not the first one found. Two can cover one
  // day: ending an elimination and starting a challenge the same day is the
  // ordinary next step, and both then own that date. Taking the first match
  // left the day reading "elimination" with the challenge invisible until
  // tomorrow, so the screen contradicted the action just taken. Later start
  // wins, and a tie goes to the span added later — which is the newer one,
  // since spans are only ever appended.
  let best: PhaseSpan | null = null;
  for (const s of ledger.spans) {
    if (dateKey < s.startDate || dateKey > spanLastDay(s, todayKey)) continue;
    if (!best || s.startDate >= best.startDate) best = s;
  }
  return best;
}

/** The phase a day belongs to: the span containing it, or `"none"` — rule 2. */
export function phaseOnDate(ledger: PhaseLedger, dateKey: string, todayKey: string): Phase {
  const span = spanOnDate(ledger, dateKey, todayKey);
  return span ? span.kind : "none";
}

/**
 * The phase of record for a day: the ledger's answer, and only where it has none
 * the phase a log written that day was stamped with.
 *
 * The ledger is authoritative. A log carries a denormalised copy of the phase
 * taken at write time, and that copy can be wrong — written before the ledger
 * covered the day, or written while the ledger was still blank. Reading it as a
 * `??` fallback made it an *override* instead, because `"none"` is not nullish:
 * a stored `"none"` beat the ledger's real answer, and no repair afterwards
 * could fix rows already on disk.
 *
 * A logged `"none"` is therefore not an answer at all, only the absence of one.
 * `loggedPhases` is in preference order; the first real phase in it wins.
 */
export function phaseOfRecord(
  ledger: PhaseLedger,
  dateKey: string,
  todayKey: string,
  loggedPhases: (Phase | undefined)[],
): Phase {
  const fromLedger = phaseOnDate(ledger, dateKey, todayKey);
  if (fromLedger !== "none") return fromLedger;
  return loggedPhases.find((p): p is Phase => p !== undefined && p !== "none") ?? "none";
}

/**
 * Schedules an elimination starting on `startDateKey`, which may be in the
 * future (rule 3).
 *
 * Refuses outright while a span is already open (rule 4) — a throw rather than
 * a silent no-op, because the caller is acting on a user's decision and must
 * not report success for something that did not happen.
 *
 * `todayKey` is what "already open" is judged against, and it is deliberately
 * not `startDateKey`: scheduling next month's elimination while this month's is
 * still running has to be refused, and asking about the start date instead would
 * quietly allow a queue of phases rule 4 does not have.
 *
 * The id comes from the caller so this stays pure: two runs with the same
 * arguments give the same ledger, and the test suite does not have to stub a
 * random source.
 */
export function scheduleElimination(
  ledger: PhaseLedger,
  startDateKey: string,
  plannedDays: number,
  todayKey: string,
  what: string,
  newId: () => string,
): PhaseLedger {
  if (openSpan(ledger, todayKey)) {
    throw new Error("A phase is already running or scheduled. End it before starting another.");
  }
  const label = what.trim();
  if (!label) throw new Error("Say what you are eliminating.");
  return {
    spans: [...ledger.spans, {
      id: newId(), kind: "elimination", startDate: startDateKey, what: label, plannedDays, endedOn: null,
    }],
  };
}

/** Starts a challenge today, labelled with what is being challenged. */
export function startChallenge(
  ledger: PhaseLedger, todayKey: string, what: string, newId: () => string,
): PhaseLedger {
  if (openSpan(ledger, todayKey)) {
    throw new Error("A phase is already running or scheduled. End it before starting another.");
  }
  const label = what.trim();
  // Refused rather than stored blank: an unlabelled challenge is exactly the
  // record that cannot be read back later, on the card or in an export.
  if (!label) throw new Error("Say what you are challenging.");
  return {
    spans: [...ledger.spans, {
      id: newId(), kind: "challenge", startDate: todayKey, what: label, endedOn: null,
    }],
  };
}

/** Updates an existing phase */
export function updatePhase(
  ledger: PhaseLedger, phaseId: string, what: string, plannedDays?: number
): PhaseLedger {
  const label = what.trim();
  if (!label) throw new Error("Say what you are eliminating or challenging.");
  return {
    spans: ledger.spans.map(s => {
      if (s.id !== phaseId) return s;
      if (s.kind === "elimination") {
         return { ...s, what: label, plannedDays: plannedDays ?? s.plannedDays };
      }
      return { ...s, what: label };
    })
  };
}

/**
 * Shared by both end paths: a span cancelled before it began leaves no trace.
 *
 * Ending the kind that is not open is a no-op returning the same object, so the
 * two buttons in one modal cannot close each other's phase, and a stale tap
 * cannot rewrite a span that has already been closed.
 *
 * An elimination whose plan has already run out is no longer open either, so
 * ending it is a no-op too. That is the right answer and not a gap: there is
 * nothing left to end, and stamping `endedOn` on it would only rewrite a run
 * that finished on its own terms.
 */
function closeOpenSpan(ledger: PhaseLedger, todayKey: string, kind: PhaseSpan["kind"]): PhaseLedger {
  const open = openSpan(ledger, todayKey);
  if (!open || open.kind !== kind) return ledger;
  
  const yesterdayKey = addDaysToKey(todayKey, -1);
  if (yesterdayKey < open.startDate) {
    return { spans: ledger.spans.filter(s => s.id !== open.id) };
  }
  return { spans: ledger.spans.map(s => (s.id === open.id ? { ...s, endedOn: yesterdayKey } : s)) };
}

/** Ends the running elimination, today being its last day — rule 5. */
export function endEliminationEarly(ledger: PhaseLedger, todayKey: string): PhaseLedger {
  return closeOpenSpan(ledger, todayKey, "elimination");
}

/** Ends the running challenge, today being its last day. */
export function endChallenge(ledger: PhaseLedger, todayKey: string): PhaseLedger {
  return closeOpenSpan(ledger, todayKey, "challenge");
}

/**
 * The open elimination if today is one of its days, with the last day of its
 * *plan* rather than the clamped one.
 *
 * Deliberately not `spanLastDay`: that stops at today so nothing beyond today
 * gets coloured, and counting the days still to come is exactly the question
 * that needs to see past it.
 *
 * A span that has been ended is not open, so today reads `null` here even
 * though `phaseOnDate` still calls today an elimination day. That is the point:
 * the day keeps its colour and its history, and only the action goes.
 */
function runningElimination(
  ledger: PhaseLedger,
  todayKey: string,
): { startDate: string; lastDay: string } | null {
  const open = openSpan(ledger, todayKey);
  if (!open || open.kind !== "elimination") return null;
  const lastDay = addDaysToKey(open.startDate, open.plannedDays - 1);
  if (todayKey < open.startDate || todayKey > lastDay) return null;
  return { startDate: open.startDate, lastDay };
}

/** Today's day within the running elimination, the start date reading as Day 1. */
export function eliminationDayNumber(ledger: PhaseLedger, todayKey: string): number | null {
  const e = runningElimination(ledger, todayKey);
  if (!e) return null;
  return daysBetweenKeys(e.startDate, todayKey) + 1;
}

/** Days of the running elimination still to come after today — 0 on its last day. */
export function eliminationDaysLeft(ledger: PhaseLedger, todayKey: string): number | null {
  const e = runningElimination(ledger, todayKey);
  if (!e) return null;
  return daysBetweenKeys(todayKey, e.lastDay);
}
