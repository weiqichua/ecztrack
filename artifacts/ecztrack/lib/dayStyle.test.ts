import { describe, it, expect } from "vitest";
import {
  dayStyle,
  ACTIVITY_COLORS,
  CHECKIN_FILL,
  hasCheckinOn,
  isRecordedCheckin,
  loggedPhases,
  PHASE_COLORS,
  type DayFacts,
} from "./dayStyle";

const TODAY = "2026-08-23";
const TODAY_FILL = "#0284C7";

/** A day with nothing on it. Each test overrides only the fact it is about. */
function facts(over: Partial<DayFacts> = {}): DayFacts {
  return {
    dateKey: TODAY,
    todayKey: TODAY,
    phase: "none",
    hasFood: false,
    hasUrge: false,
    hasCheckin: false,
    ...over,
  };
}

describe("PHASE_COLORS", () => {
  // The tests above only compare a rendered fill against this same constant,
  // so a changed hex is invisible to them — the mapping stays right even if
  // the actual colour drifts. Pin the literal values too.
  it("pins the actual hex values", () => {
    expect(PHASE_COLORS).toEqual({
      none: "#78909C",
      elimination: "#81D4FA",
      challenge: "#FFB300",
    });
  });
});

describe("dayStyle", () => {
  describe("the fill", () => {
    it("is the phase colour on a day that was checked in on", () => {
      const style = dayStyle(facts({ phase: "challenge", hasCheckin: true }), TODAY_FILL);
      expect(style.fill).toBe(PHASE_COLORS.challenge);
    });

    it("is the check-in colour when a checked-in day was on no phase", () => {
      // "none" is a real answer, not a lookup miss: the day is still filled,
      // just not in a phase's colour.
      const style = dayStyle(facts({ phase: "none", hasCheckin: true }), TODAY_FILL);
      expect(style.fill).toBe(CHECKIN_FILL);
    });

    it("is the caller's today colour on today with no check-in", () => {
      expect(dayStyle(facts(), TODAY_FILL).fill).toBe(TODAY_FILL);
    });

    it("is absent on a past day with no check-in", () => {
      const style = dayStyle(facts({ dateKey: "2026-08-22" }), TODAY_FILL);
      expect(style.fill).toBeNull();
    });

    it("is absent on a future day", () => {
      const style = dayStyle(facts({ dateKey: "2026-08-24" }), TODAY_FILL);
      expect(style.fill).toBeNull();
    });

    it("prefers the phase colour over the today colour on today", () => {
      const style = dayStyle(
        facts({ phase: "elimination", hasCheckin: true }),
        TODAY_FILL,
      );
      expect(style.fill).toBe(PHASE_COLORS.elimination);
    });
  });

  describe("today and future flags", () => {
    it("marks today", () => {
      expect(dayStyle(facts(), TODAY_FILL)).toMatchObject({ isToday: true, isFuture: false });
    });

    it("marks a future day", () => {
      expect(dayStyle(facts({ dateKey: "2026-09-01" }), TODAY_FILL))
        .toMatchObject({ isToday: false, isFuture: true });
    });

    it("marks a past day as neither", () => {
      expect(dayStyle(facts({ dateKey: "2026-01-01" }), TODAY_FILL))
        .toMatchObject({ isToday: false, isFuture: false });
    });
  });

  describe("the activity dots", () => {
    it("are always three, in food / urge / check-in order", () => {
      expect(dayStyle(facts(), TODAY_FILL).dots.map(d => d.kind))
        .toEqual(["food", "urge", "checkin"]);
    });

    it("are colourless when nothing was logged", () => {
      expect(dayStyle(facts(), TODAY_FILL).dots.every(d => d.color === null)).toBe(true);
    });

    it("colour only the activities the day has", () => {
      const style = dayStyle(facts({ hasFood: true, hasCheckin: true }), TODAY_FILL);
      expect(style.dots).toEqual([
        { kind: "food", color: ACTIVITY_COLORS.food },
        { kind: "urge", color: null },
        { kind: "checkin", color: ACTIVITY_COLORS.checkin },
      ]);
    });

    it("colours an urge day", () => {
      const style = dayStyle(facts({ hasUrge: true }), TODAY_FILL);
      expect(style.dots[1]).toEqual({ kind: "urge", color: ACTIVITY_COLORS.urge });
    });
  });
});

describe("isRecordedCheckin", () => {
  it("counts a log with any non-null score", () => {
    expect(isRecordedCheckin({ scores: { s_itch: 3 } })).toBe(true);
    expect(isRecordedCheckin({ scores: { s_itch: null, s_heat: 1 } })).toBe(true);
  });

  it("does not count a log whose every score is null", () => {
    // Tapping a box and tapping it off again leaves the day's log in place with
    // nothing in it. Counting that lights the dot on an empty day and, on a
    // past day, replaces the missed fill with the checked-in one.
    expect(isRecordedCheckin({ scores: { s_itch: null } })).toBe(false);
  });

  it("does not count an empty or malformed score map", () => {
    expect(isRecordedCheckin({ scores: {} })).toBe(false);
    expect(isRecordedCheckin({})).toBe(false);
  });

  it("counts a zero, which is a score and not an absence", () => {
    expect(isRecordedCheckin({ scores: { s_itch: 0 } })).toBe(true);
  });
});

describe("hasCheckinOn", () => {
  const logs = [
    { date: "2026-08-21", scores: { s_itch: 4 } },
    { date: "2026-08-22", scores: { s_itch: null } },
  ];

  it("is true for a day with a recorded score", () => {
    expect(hasCheckinOn(logs, "2026-08-21")).toBe(true);
  });

  it("is false for a day whose log holds nothing", () => {
    expect(hasCheckinOn(logs, "2026-08-22")).toBe(false);
  });

  it("is false for a day with no log at all", () => {
    expect(hasCheckinOn(logs, "2026-08-20")).toBe(false);
  });
});

describe("an emptied check-in through dayStyle", () => {
  const logs = [{ date: "2026-08-20", scores: { s_itch: null } }];
  const past = "2026-08-20";

  it("leaves a cleared past day with no fill, not as done", () => {
    const style = dayStyle(
      facts({ dateKey: past, hasCheckin: hasCheckinOn(logs, past), phase: "elimination" }),
      TODAY_FILL,
    );
    expect(style.fill).toBeNull();
    expect(style.dots.find(d => d.kind === "checkin")!.color).toBeNull();
  });
});

describe("loggedPhases", () => {
  const consumption = [{ timestamp: "2026-08-20T12:00:00", phase: "challenge" as const }];

  it("reports the phase a real check-in was stamped with", () => {
    const logs = [{ date: "2026-08-20", phase: "elimination" as const, scores: { s_itch: 3 } }];
    expect(loggedPhases("2026-08-20", logs, [])).toEqual(["elimination"]);
  });

  it("ignores a check-in the user cleared, so a day with nothing recorded reports no phase", () => {
    // The residue of tapping a box and tapping it off again must not become a
    // phase for the day — same rule that keeps it from lighting the dot.
    const logs = [{ date: "2026-08-20", phase: "elimination" as const, scores: { s_itch: null } }];
    expect(loggedPhases("2026-08-20", logs, [])).toEqual([]);
  });

  it("still reports a food log's phase on a day whose check-in was cleared", () => {
    const logs = [{ date: "2026-08-20", phase: "elimination" as const, scores: { s_itch: null } }];
    expect(loggedPhases("2026-08-20", logs, consumption)).toEqual(["challenge"]);
  });
});
