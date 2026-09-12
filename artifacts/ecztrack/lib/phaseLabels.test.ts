import { describe, it, expect } from "vitest";
import { phaseStatus } from "./phaseLabels";
import { openSpan, phaseOnDate } from "./phases";
import type { PhaseLedger } from "@/constants/types";

/**
 * A ledger with one elimination span on it. `todayKey` is what every answer
 * is computed against; the span's own dates are the other half.
 */
function eliminationLedger(
  startDate: string,
  plannedDays: number,
  endedOn: string | null = null,
): PhaseLedger {
  return { spans: [{ id: "e1", kind: "elimination", startDate, what: "dairy", plannedDays, endedOn }] };
}

function challengeLedger(
  startDate: string,
  what: string,
  endedOn: string | null = null,
): PhaseLedger {
  return { spans: [{ id: "c1", kind: "challenge", startDate, what, endedOn }] };
}

describe("phaseStatus", () => {
  describe("with no span on the ledger", () => {
    it("is the absent state", () => {
      const ledger: PhaseLedger = { spans: [] };
      expect(phaseStatus(ledger, "2026-08-23")).toEqual({ kind: "none" });
    });
  });

  describe("elimination scheduled to start in the future", () => {
    it("reads as tomorrow the day before the start date", () => {
      const status = phaseStatus(eliminationLedger("2026-08-24", 14), "2026-08-23");
      expect(status).toMatchObject({ kind: "scheduled", label: "Starts tomorrow · dairy" });
    });

    it("counts whole days out when the start is further off", () => {
      const status = phaseStatus(eliminationLedger("2026-08-26", 14), "2026-08-23");
      expect(status).toMatchObject({ kind: "scheduled", label: "Starts in 3 days · dairy" });
    });

    it("carries the start date and days away through", () => {
      expect(phaseStatus(eliminationLedger("2026-08-26", 21), "2026-08-23")).toEqual({
        kind: "scheduled",
        startDate: "2026-08-26",
        what: "dairy",
        daysAway: 3,
        label: "Starts in 3 days · dairy",
      });
    });

    it("crosses a month boundary by calendar days, not by 30-day maths", () => {
      const status = phaseStatus(eliminationLedger("2026-09-01", 14), "2026-08-30");
      expect(status).toMatchObject({ kind: "scheduled", label: "Starts in 2 days · dairy" });
    });

    it("still reports a future elimination as scheduled", () => {
      const l = { spans: [{ id: "e1", kind: "elimination", startDate: "2026-03-20", what: "dairy", plannedDays: 14, endedOn: null }] } as PhaseLedger;
      expect(phaseStatus(l, "2026-03-10")).toMatchObject({ kind: "scheduled", daysAway: 10 });
    });

    it("survives the span-covering-today lookup finding nothing", () => {
      // The trap: a scheduled span starts in the future, so no span covers today
      // and the covering lookup is empty — exactly what an absent day looks like.
      // Only the explicit `today < startDate` fallback tells the two apart, and
      // losing it silently turns every scheduled card into "Nothing running".
      expect(phaseOnDate(eliminationLedger("2026-08-26", 14), "2026-08-23", "2026-08-23"))
        .toBe("none");
      expect(phaseStatus(eliminationLedger("2026-08-26", 14), "2026-08-23")).toEqual({
        kind: "scheduled",
        startDate: "2026-08-26",
        what: "dairy",
        daysAway: 3,
        label: "Starts in 3 days · dairy",
      });
    });
  });

  describe("elimination running", () => {
    it("makes the start date Day 1, not Day 0", () => {
      expect(phaseStatus(eliminationLedger("2026-08-23", 14), "2026-08-23")).toEqual({
        kind: "running",
        phase: "elimination",
        startDate: "2026-08-23",
        what: "dairy",
        lastDay: "2026-09-05",
        dayNumber: 1,
        totalDays: 14,
        daysLeft: 13,
        progress: 1 / 14,
        canEnd: true,
        label: "Day 1 of 14 · dairy · 13 days left",
      });
    });

    it("can still be ended while it is open", () => {
      expect(phaseStatus(eliminationLedger("2026-08-20", 14), "2026-08-23"))
        .toMatchObject({ kind: "running", canEnd: true });
    });

    it("still reads the elimination's start date as Day 1", () => {
      const l = { spans: [{ id: "e1", kind: "elimination", startDate: "2026-03-01", what: "dairy", plannedDays: 14, endedOn: null }] } as PhaseLedger;
      expect(phaseStatus(l, "2026-03-01")).toMatchObject({ dayNumber: 1, totalDays: 14, daysLeft: 13 });
    });

    it("counts the fourth day as Day 4", () => {
      expect(phaseStatus(eliminationLedger("2026-08-20", 14), "2026-08-23")).toMatchObject({
        dayNumber: 4,
        label: "Day 4 of 14 · dairy · 10 days left",
      });
    });

    it("says 'day' rather than 'days' with one left", () => {
      expect(phaseStatus(eliminationLedger("2026-08-10", 14), "2026-08-22")).toMatchObject({
        label: "Day 13 of 14 · dairy · 1 day left",
      });
    });

    it("calls the last planned day the last day rather than '0 days left'", () => {
      expect(phaseStatus(eliminationLedger("2026-08-10", 14), "2026-08-23")).toMatchObject({
        kind: "running",
        dayNumber: 14,
        daysLeft: 0,
        progress: 1,
        label: "Day 14 of 14 · dairy · last day",
      });
    });

    it("is absent again the day after the last planned day, with the span still open", () => {
      expect(phaseStatus(eliminationLedger("2026-08-10", 14), "2026-08-24")).toEqual({ kind: "none" });
    });

    it("reads as absent rather than scheduled for a zero-day plan on its own start date", () => {
      // plannedDays: 0 makes the last day the day *before* startDate, so
      // eliminationDayNumber already reads today as past the end and returns
      // null even though today equals startDate. The scheduled check must stay
      // strictly `<` so today doesn't get misread as "starts tomorrow".
      expect(phaseStatus(eliminationLedger("2026-08-23", 0), "2026-08-23")).toEqual({ kind: "none" });
    });
  });

  describe("elimination whose planned days have simply run out", () => {
    // Nothing writes `endedOn` when a plan elapses, so this ledger is exactly
    // what a 14-day elimination started ten weeks ago still looks like on disk.
    // The card reads `phaseStatus` and the start sheet reads `openSpan`, and
    // while those two disagreed the app was locked out of every phase: "Nothing
    // running" on one panel, "Not available while an elimination is on" on the
    // other, with no route out of the state.
    const runOut = eliminationLedger("2026-01-01", 14);

    it("is the absent state, with nothing left open to contradict it", () => {
      expect(phaseStatus(runOut, "2026-03-11")).toEqual({ kind: "none" });
      expect(openSpan(runOut, "2026-03-11")).toBeNull();
      expect(phaseOnDate(runOut, "2026-03-11", "2026-03-11")).toBe("none");
    });

    it("is not confused with a schedule, which is still open and still ahead", () => {
      const scheduled = eliminationLedger("2026-03-20", 14);
      expect(phaseStatus(scheduled, "2026-03-10")).toMatchObject({ kind: "scheduled" });
      expect(openSpan(scheduled, "2026-03-10")).not.toBeNull();
    });
  });

  describe("elimination ended today", () => {
    // The span still covers today — `phaseOnDate` keeps colouring it on the
    // calendar and the week strip — so the card has to keep saying so too, or
    // the two contradict each other about the same day. Only the action goes.
    const endedOnDay4 = eliminationLedger("2026-03-01", 14, "2026-03-04");

    it("keeps reporting the day as running, with the End action gone", () => {
      expect(phaseStatus(endedOnDay4, "2026-03-04")).toMatchObject({
        kind: "running",
        phase: "elimination",
        dayNumber: 4,
        canEnd: false,
      });
    });

    it("shortens the plan to where it actually stopped", () => {
      // Day 4 of an ended run *is* the last day, so the total it is measured
      // against shrinks to 4. Leave `plannedDays` in and "last day" sits above
      // a bar reading a stale 4/14.
      expect(phaseStatus(endedOnDay4, "2026-03-04")).toMatchObject({
        totalDays: 4,
        daysLeft: 0,
        progress: 1,
        lastDay: "2026-03-04",
        label: "Day 4 of 4 · dairy · last day",
      });
    });

    it("agrees with the calendar about today", () => {
      expect(phaseOnDate(endedOnDay4, "2026-03-04", "2026-03-04")).toBe("elimination");
      expect(phaseStatus(endedOnDay4, "2026-03-04").kind).toBe("running");
    });

    it("is absent the day after it was ended too", () => {
      expect(phaseStatus(eliminationLedger("2026-08-20", 14, "2026-08-23"), "2026-08-24")).toEqual({
        kind: "none",
      });
    });

    it("is absent for a scheduled elimination that was cancelled before starting", () => {
      // `endEliminationEarly` nulls the record outright in that case, but a
      // record with an end date behind its start must not read as scheduled.
      expect(phaseStatus(eliminationLedger("2026-08-26", 14, "2026-08-23"), "2026-08-23")).toEqual({
        kind: "none",
      });
    });
  });

  describe("challenge running", () => {
    it("reports a running challenge with its label and day number", () => {
      const l = { spans: [{ id: "c1", kind: "challenge", startDate: "2026-03-01", what: "dairy", endedOn: null }] } as PhaseLedger;
      const s = phaseStatus(l, "2026-03-03");
      expect(s).toMatchObject({ kind: "running", phase: "challenge", what: "dairy", dayNumber: 3 });
    });

    it("makes the start date Day 1, not Day 0", () => {
      expect(phaseStatus(challengeLedger("2026-03-01", "dairy"), "2026-03-01")).toMatchObject({
        kind: "running",
        phase: "challenge",
        dayNumber: 1,
        canEnd: true,
      });
    });

    it("keeps its label and loses only the End action on the day it is ended", () => {
      // Same rule as an elimination ended today: the day is still the challenge's,
      // so the card must still name what was being challenged.
      expect(phaseStatus(challengeLedger("2026-03-01", "dairy", "2026-03-04"), "2026-03-04"))
        .toMatchObject({
          kind: "running",
          phase: "challenge",
          what: "dairy",
          dayNumber: 4,
          canEnd: false,
          label: "Day 4 · dairy",
        });
    });

    it("is absent the day after it was ended", () => {
      expect(phaseStatus(challengeLedger("2026-03-01", "dairy", "2026-03-04"), "2026-03-05"))
        .toEqual({ kind: "none" });
    });
  });
});
