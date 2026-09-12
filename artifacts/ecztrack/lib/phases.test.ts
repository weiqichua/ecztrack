import { describe, it, expect } from "vitest";
import type { PhaseLedger } from "@/constants/types";
import {
  EMPTY_LEDGER,
  phaseOnDate,
  spanOnDate,
  phaseOfRecord,
  openSpan,
  scheduleElimination,
  endEliminationEarly,
  startChallenge,
  endChallenge,
  spanLastDay,
  eliminationDayNumber,
  eliminationDaysLeft,
} from "./phases";
import type { PhaseSpan } from "@/constants/types";

const elim = (startDate: string, plannedDays: number, endedOn: string | null = null): PhaseSpan =>
  ({ id: "e1", kind: "elimination", startDate, what: "dairy", plannedDays, endedOn });
const chal = (startDate: string, what = "dairy", endedOn: string | null = null): PhaseSpan =>
  ({ id: "c1", kind: "challenge", startDate, what, endedOn });

describe("phaseOnDate", () => {
  it("reads the start date as part of the span", () => {
    const l = { spans: [elim("2026-03-01", 14)] };
    expect(phaseOnDate(l, "2026-03-01", "2026-03-10")).toBe("elimination");
  });

  it("covers the planned last day and not the day after", () => {
    const l = { spans: [elim("2026-03-01", 14)] };
    expect(phaseOnDate(l, "2026-03-14", "2026-03-20")).toBe("elimination");
    expect(phaseOnDate(l, "2026-03-15", "2026-03-20")).toBe("none");
  });

  it("says none for a day after an elimination ended, with no maintenance", () => {
    // The whole point of dropping maintenance: the day after is blank.
    const l = { spans: [elim("2026-03-01", 14, "2026-03-04")] };
    expect(phaseOnDate(l, "2026-03-05", "2026-03-20")).toBe("none");
  });

  it("colours nothing beyond today, even inside a running span", () => {
    const l = { spans: [elim("2026-03-01", 14)] };
    expect(phaseOnDate(l, "2026-03-06", "2026-03-05")).toBe("none");
  });

  it("treats an open challenge as running up to today and no further", () => {
    const l = { spans: [chal("2026-03-01")] };
    expect(phaseOnDate(l, "2026-03-05", "2026-03-05")).toBe("challenge");
    expect(phaseOnDate(l, "2026-03-06", "2026-03-05")).toBe("none");
  });

  it("keeps each span's own days when two run back to back", () => {
    const l = { spans: [elim("2026-03-01", 4, "2026-03-04"), chal("2026-03-05")] };
    expect(phaseOnDate(l, "2026-03-04", "2026-03-10")).toBe("elimination");
    expect(phaseOnDate(l, "2026-03-05", "2026-03-10")).toBe("challenge");
  });

  it("says none in a gap between two spans", () => {
    const l = { spans: [elim("2026-03-01", 2, "2026-03-02"), chal("2026-03-09")] };
    expect(phaseOnDate(l, "2026-03-05", "2026-03-10")).toBe("none");
  });

  it("says none for a scheduled elimination that has not started", () => {
    const l = { spans: [elim("2026-03-20", 14)] };
    expect(phaseOnDate(l, "2026-03-10", "2026-03-10")).toBe("none");
  });

  it("says none for an empty ledger", () => {
    expect(phaseOnDate(EMPTY_LEDGER, "2026-03-01", "2026-03-01")).toBe("none");
  });
});

describe("spanOnDate", () => {
  it("prefers the span that started later when two cover the same day", () => {
    // Ending an elimination and starting a challenge the same day is the
    // ordinary next step — you stop excluding and immediately reintroduce
    // something. Both spans then cover today. Taking the first match left the
    // day reading "elimination" and the challenge invisible until tomorrow, so
    // the card contradicted the action the user had just taken.
    const ledger: PhaseLedger = {
      spans: [
        { id: "e1", kind: "elimination", startDate: "2026-03-01", what: "dairy", plannedDays: 14, endedOn: "2026-03-05" },
        { id: "c1", kind: "challenge", startDate: "2026-03-05", what: "dairy", endedOn: null },
      ],
    };
    expect(spanOnDate(ledger, "2026-03-05", "2026-03-05")?.id).toBe("c1");
    // The days before the handover still belong to the elimination.
    expect(spanOnDate(ledger, "2026-03-04", "2026-03-05")?.id).toBe("e1");
  });

  it("gives a tie on the start date to the span appended later", () => {
    // Two spans really can share a start date: end a one-day elimination and
    // start a challenge the same day. Spans are only ever appended, so the
    // later entry is the newer one and owns the day. Narrowing the tie-break to
    // a strict `>` hands the day back to the elimination and the card
    // contradicts the action just taken — and no other test notices.
    const ledger: PhaseLedger = {
      spans: [
        { id: "e1", kind: "elimination", startDate: "2026-03-05", what: "dairy", plannedDays: 14, endedOn: "2026-03-05" },
        { id: "c1", kind: "challenge", startDate: "2026-03-05", what: "dairy", endedOn: null },
      ],
    };
    expect(spanOnDate(ledger, "2026-03-05", "2026-03-05")?.id).toBe("c1");
  });

  // The lookup `phaseOnDate` is built from. The phase card reads it about today
  // so the card and the calendar cannot disagree about the same day.
  it("returns the span itself, not just its kind", () => {
    const span = elim("2026-03-01", 14);
    expect(spanOnDate({ spans: [span] }, "2026-03-05", "2026-03-10")).toBe(span);
  });

  it("is null in a gap between two spans", () => {
    const l = { spans: [elim("2026-03-01", 2, "2026-03-02"), chal("2026-03-09")] };
    expect(spanOnDate(l, "2026-03-05", "2026-03-10")).toBeNull();
  });

  it("picks the right one of two spans running back to back", () => {
    const first = elim("2026-03-01", 4, "2026-03-04");
    const second = chal("2026-03-05");
    const l = { spans: [first, second] };
    expect(spanOnDate(l, "2026-03-04", "2026-03-10")).toBe(first);
    expect(spanOnDate(l, "2026-03-05", "2026-03-10")).toBe(second);
  });

  it("still finds a span on the day it was ended", () => {
    // The day End is pressed is still the span's day; only the action goes.
    const span = elim("2026-03-01", 14, "2026-03-04");
    expect(spanOnDate({ spans: [span] }, "2026-03-04", "2026-03-04")).toBe(span);
    expect(spanOnDate({ spans: [span] }, "2026-03-05", "2026-03-05")).toBeNull();
  });

  it("is null for a scheduled span that has not started", () => {
    expect(spanOnDate({ spans: [elim("2026-03-20", 14)] }, "2026-03-10", "2026-03-10")).toBeNull();
  });

  it("is null for an empty ledger", () => {
    expect(spanOnDate(EMPTY_LEDGER, "2026-03-01", "2026-03-01")).toBeNull();
  });
});

describe("spanLastDay", () => {
  it("is where a closed span actually stopped, however far back", () => {
    expect(spanLastDay(elim("2026-03-01", 14, "2026-03-04"), "2026-03-20")).toBe("2026-03-04");
  });

  it("is the planned last day once a running elimination's plan has elapsed", () => {
    expect(spanLastDay(elim("2026-03-01", 14), "2026-03-20")).toBe("2026-03-14");
  });

  it("clamps a running elimination's future plan to today", () => {
    expect(spanLastDay(elim("2026-03-01", 14), "2026-03-05")).toBe("2026-03-05");
  });

  it("clamps an open challenge, which has no planned end at all, to today", () => {
    expect(spanLastDay(chal("2026-03-01"), "2026-03-05")).toBe("2026-03-05");
  });
});

describe("openSpan", () => {
  it("is null when every span has ended", () => {
    expect(openSpan({ spans: [elim("2026-03-01", 4, "2026-03-04")] }, "2026-03-10")).toBeNull();
    expect(openSpan(EMPTY_LEDGER, "2026-03-10")).toBeNull();
  });

  it("finds the span still running, past the closed ones", () => {
    const open = chal("2026-03-05");
    expect(openSpan({ spans: [elim("2026-03-01", 4, "2026-03-04"), open] }, "2026-03-06"))
      .toBe(open);
  });

  it("is null for an elimination whose plan has run out, though nothing closed it", () => {
    // The lockout. Nothing writes `endedOn` when a plan simply elapses — that is
    // what removed the materialiser — so asking only whether `endedOn` is null
    // kept a finished elimination open forever: the card read "Nothing running"
    // while both mutators threw and the start sheet greyed out Start Challenge,
    // with no route back to any phase at all.
    expect(openSpan({ spans: [elim("2026-01-01", 14)] }, "2026-03-11")).toBeNull();
  });

  it("is still open on the planned last day, and not on the day after", () => {
    const l = { spans: [elim("2026-03-01", 14)] };
    expect(openSpan(l, "2026-03-14")?.id).toBe("e1");
    expect(openSpan(l, "2026-03-15")).toBeNull();
  });

  it("counts a scheduled elimination as open, its plan ending later still", () => {
    expect(openSpan({ spans: [elim("2026-03-20", 14)] }, "2026-03-10")?.id).toBe("e1");
  });

  it("counts a challenge opened months ago as open, having no planned end", () => {
    // Only a plan can run out, and a challenge has none: it runs until ended.
    expect(openSpan({ spans: [chal("2026-01-01")] }, "2026-03-11")?.id).toBe("c1");
  });
});

describe("eliminationDayNumber", () => {
  it("reads the start date as Day 1", () => {
    expect(eliminationDayNumber({ spans: [elim("2026-03-01", 14)] }, "2026-03-01")).toBe(1);
  });

  it("counts whole days from the start", () => {
    expect(eliminationDayNumber({ spans: [elim("2026-03-01", 14)] }, "2026-03-14")).toBe(14);
  });

  it("is null before the start and after the last planned day", () => {
    const l = { spans: [elim("2026-03-01", 5)] };
    expect(eliminationDayNumber(l, "2026-02-28")).toBeNull();
    expect(eliminationDayNumber(l, "2026-03-06")).toBeNull();
  });

  it("is null when there is no elimination", () => {
    expect(eliminationDayNumber(EMPTY_LEDGER, "2026-03-01")).toBeNull();
    expect(eliminationDayNumber({ spans: [chal("2026-03-01")] }, "2026-03-01")).toBeNull();
  });

  it("is null on a day inside an elimination that has already been ended", () => {
    // Today keeps its colour, but the running elimination is over — which is
    // what takes the End button away the moment it is pressed.
    const l = { spans: [elim("2026-03-01", 14, "2026-03-03")] };
    expect(phaseOnDate(l, "2026-03-03", "2026-03-03")).toBe("elimination");
    expect(eliminationDayNumber(l, "2026-03-03")).toBeNull();
  });
});

describe("eliminationDaysLeft", () => {
  it("counts the days after today, so day 1 of 14 has 13 left", () => {
    expect(eliminationDaysLeft({ spans: [elim("2026-03-01", 14)] }, "2026-03-01")).toBe(13);
  });

  it("is 0 on the final day", () => {
    expect(eliminationDaysLeft({ spans: [elim("2026-03-01", 14)] }, "2026-03-14")).toBe(0);
  });

  it("is null when no elimination is running today", () => {
    expect(eliminationDaysLeft(EMPTY_LEDGER, "2026-03-01")).toBeNull();
    expect(eliminationDaysLeft({ spans: [elim("2026-03-01", 14)] }, "2026-03-15")).toBeNull();
  });
});

describe("phaseOfRecord", () => {
  const elimination = { spans: [elim("2026-03-01", 14)] };

  it("lets the ledger win over a log stamped with something else", () => {
    // A log's `phase` is a copy taken at write time and can be stale or plain
    // wrong. It must never override the ledger.
    expect(phaseOfRecord(elimination, "2026-03-05", "2026-03-05", ["challenge"]))
      .toBe("elimination");
  });

  it("ignores a log stamped \"none\" so it cannot blank out a real phase", () => {
    // The regression this exists to stop: every log written before the ledger
    // covered its day carries phase "none", and "none" is not nullish, so a
    // `??` fallback let those stored rows outrank the ledger permanently.
    expect(phaseOfRecord(elimination, "2026-03-05", "2026-03-05", ["none"]))
      .toBe("elimination");
  });

  it("falls back to a log's phase on a day the ledger does not cover", () => {
    expect(phaseOfRecord(EMPTY_LEDGER, "2026-03-05", "2026-03-05", ["challenge"]))
      .toBe("challenge");
  });

  it("skips \"none\" and undefined when choosing among a day's logs", () => {
    expect(phaseOfRecord(EMPTY_LEDGER, "2026-03-05", "2026-03-05", ["none", undefined, "challenge"]))
      .toBe("challenge");
  });

  it("is \"none\" when neither the ledger nor any log has an answer", () => {
    expect(phaseOfRecord(EMPTY_LEDGER, "2026-03-05", "2026-03-05", [])).toBe("none");
    expect(phaseOfRecord(EMPTY_LEDGER, "2026-03-05", "2026-03-05", ["none", undefined]))
      .toBe("none");
  });
});

describe("the mutators", () => {
  it("refuses a second span while one is open", () => {
    const l = { spans: [elim("2026-03-01", 14)] };
    expect(() => scheduleElimination(l, "2026-03-20", 14, "2026-03-05", "dairy", () => "x")).toThrow();
    expect(() => startChallenge(l, "2026-03-05", "dairy", () => "x")).toThrow();
  });

  it("lets the next phase start once an elimination's plan has run out", () => {
    // The lockout, from the mutators' side: a 14-day elimination started ten
    // weeks ago finished on its own terms, and must not go on refusing every
    // phase after it. Nothing wrote `endedOn` for it and nothing ever will.
    const l = { spans: [elim("2026-01-01", 14)] };
    expect(() => startChallenge(l, "2026-03-11", "dairy", () => "c9")).not.toThrow();
    expect(() => scheduleElimination(l, "2026-03-15", 14, "2026-03-11", "dairy", () => "e9")).not.toThrow();
  });

  it("still refuses both while an elimination is only scheduled", () => {
    // The other side of the same rule: a plan that has not started has not run
    // out either, so it is open and it still blocks.
    const l = { spans: [elim("2026-03-20", 14)] };
    expect(() => scheduleElimination(l, "2026-03-25", 14, "2026-03-10", "dairy", () => "x")).toThrow();
    expect(() => startChallenge(l, "2026-03-10", "dairy", () => "x")).toThrow();
  });

  it("still refuses both while a challenge opened months ago is open", () => {
    const l = { spans: [chal("2026-01-01")] };
    expect(() => scheduleElimination(l, "2026-03-15", 14, "2026-03-11", "dairy", () => "x")).toThrow();
    expect(() => startChallenge(l, "2026-03-11", "dairy", () => "x")).toThrow();
  });

  it("has nothing left to end once an elimination's plan has run out", () => {
    // The consequence of "open" meaning open today, and the right one: the run
    // is already over, and stamping `endedOn` on it now would rewrite a span
    // that finished on its own terms.
    const l = { spans: [elim("2026-01-01", 14)] };
    expect(endEliminationEarly(l, "2026-03-11")).toBe(l);
  });

  it("refuses a challenge with a blank label", () => {
    expect(() => startChallenge(EMPTY_LEDGER, "2026-03-05", "   ", () => "x")).toThrow();
  });

  it("stores the challenge label trimmed", () => {
    const l = startChallenge(EMPTY_LEDGER, "2026-03-05", "  dairy  ", () => "c9");
    expect(l.spans[0]).toMatchObject({ kind: "challenge", what: "dairy", endedOn: null });
  });

  it("ends a challenge on the day it is ended, keeping that day", () => {
    const started = startChallenge(EMPTY_LEDGER, "2026-03-01", "dairy", () => "c9");
    const ended = endChallenge(started, "2026-03-05");
    expect(phaseOnDate(ended, "2026-03-05", "2026-03-09")).toBe("challenge");
    expect(phaseOnDate(ended, "2026-03-06", "2026-03-09")).toBe("none");
  });

  it("drops a scheduled elimination cancelled before it began", () => {
    const l = scheduleElimination(EMPTY_LEDGER, "2026-03-20", 14, "2026-03-10", "dairy", () => "e9");
    expect(endEliminationEarly(l, "2026-03-10").spans).toEqual([]);
  });

  it("keeps a one-day span when a phase is started and ended on the same day", () => {
    // The boundary between "cancel a schedule that never began" and "shorten a
    // run to its first day". The start modal seeds the start date as TODAY, so
    // starting and abandoning on one day is the ordinary path, not an edge:
    // treating it as a cancellation would delete the day's record and drop its
    // colour off the calendar.
    const l = scheduleElimination(EMPTY_LEDGER, "2026-03-01", 14, "2026-03-01", "dairy", () => "e9");
    const ended = endEliminationEarly(l, "2026-03-01");
    expect(ended.spans).toHaveLength(1);
    expect(ended.spans[0]).toMatchObject({ endedOn: "2026-03-01" });
    expect(phaseOnDate(ended, "2026-03-01", "2026-03-05")).toBe("elimination");
  });

  it("shortens an elimination ended on one of its own days", () => {
    const l = scheduleElimination(EMPTY_LEDGER, "2026-03-01", 14, "2026-03-04", "dairy", () => "e9");
    const ended = endEliminationEarly(l, "2026-03-04");
    expect(openSpan(ended, "2026-03-04")).toBeNull();
    expect(phaseOnDate(ended, "2026-03-04", "2026-03-09")).toBe("elimination");
    expect(phaseOnDate(ended, "2026-03-05", "2026-03-09")).toBe("none");
  });

  it("leaves an elimination whose plan has elapsed closed without a write", () => {
    // No materialiser: a finished elimination is finished by computation.
    const l = { spans: [elim("2026-03-01", 3)] };
    expect(phaseOnDate(l, "2026-03-04", "2026-03-20")).toBe("none");
  });

  it("keeps every earlier span when a new one starts", () => {
    const first = scheduleElimination(EMPTY_LEDGER, "2026-03-01", 4, "2026-03-04", "dairy", () => "e9");
    const ended = endEliminationEarly(first, "2026-03-04");
    const second = startChallenge(ended, "2026-03-05", "dairy", () => "c9");
    expect(second.spans.map(s => s.id)).toEqual(["e9", "c9"]);
    expect(phaseOnDate(second, "2026-03-02", "2026-03-06")).toBe("elimination");
  });

  it("will not end a phase of the other kind", () => {
    // Both buttons exist in the same modal; each must only close its own span.
    const challenging = startChallenge(EMPTY_LEDGER, "2026-03-01", "dairy", () => "c9");
    expect(endEliminationEarly(challenging, "2026-03-05")).toBe(challenging);

    const eliminating = scheduleElimination(EMPTY_LEDGER, "2026-03-01", 14, "2026-03-01", "dairy", () => "e9");
    expect(endChallenge(eliminating, "2026-03-05")).toBe(eliminating);
  });

  it("returns the ledger untouched when there is nothing open to end", () => {
    expect(endEliminationEarly(EMPTY_LEDGER, "2026-03-05")).toBe(EMPTY_LEDGER);
    expect(endChallenge(EMPTY_LEDGER, "2026-03-05")).toBe(EMPTY_LEDGER);
  });
});
