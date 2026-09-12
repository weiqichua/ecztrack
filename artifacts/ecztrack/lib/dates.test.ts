import { describe, it, expect } from "vitest";
import {
  localDateKey,
  startOfLocalDay,
  endOfLocalDayISO,
  addDaysToKey,
  daysBetweenKeys,
  isOnLocalDay,
  formatShortDate,
  msUntilNextLocalMidnight,
} from "./dates";

/**
 * These assertions hold in any timezone: they are stated in terms of the
 * device's own local calendar rather than fixed UTC offsets. The bug this
 * module exists to fix was UTC-derived keys being compared against
 * local-derived ones, so "agrees with the local calendar" is the property
 * that matters.
 */
describe("localDateKey", () => {
  it("formats as YYYY-MM-DD", () => {
    expect(localDateKey(new Date())).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("uses local calendar fields, not UTC ones", () => {
    // 23:30 local on a fixed local day. In any timezone ahead of UTC this
    // instant is still the same local day, while toISOString() would roll
    // over for negative offsets; either way the local day is what we want.
    const d = new Date(2026, 0, 15, 23, 30, 0);
    expect(localDateKey(d)).toBe("2026-01-15");
  });

  it("uses local fields at the other end of the day too", () => {
    const d = new Date(2026, 0, 15, 0, 30, 0);
    expect(localDateKey(d)).toBe("2026-01-15");
  });

  it("zero-pads single-digit months and days", () => {
    expect(localDateKey(new Date(2026, 2, 5, 12, 0, 0))).toBe("2026-03-05");
  });

  it("accepts an ISO timestamp string", () => {
    const iso = new Date(2026, 5, 9, 14, 0, 0).toISOString();
    expect(localDateKey(iso)).toBe("2026-06-09");
  });

  it("round-trips with startOfLocalDay", () => {
    const key = "2026-04-01";
    expect(localDateKey(startOfLocalDay(key))).toBe(key);
  });
});

describe("startOfLocalDay", () => {
  it("returns local midnight for the key", () => {
    const d = startOfLocalDay("2026-04-01");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(3);
    expect(d.getDate()).toBe(1);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });
});

describe("endOfLocalDayISO", () => {
  it("is an instant on the same local day, later than the start", () => {
    const key = "2026-04-01";
    const end = new Date(endOfLocalDayISO(key));
    expect(localDateKey(end)).toBe(key);
    expect(end.getTime()).toBeGreaterThan(startOfLocalDay(key).getTime());
  });

  it("orders correctly against the next day's start", () => {
    expect(new Date(endOfLocalDayISO("2026-04-01")).getTime()).toBeLessThan(
      startOfLocalDay("2026-04-02").getTime(),
    );
  });
});

describe("addDaysToKey", () => {
  it("advances by calendar days", () => {
    expect(addDaysToKey("2026-01-15", 14)).toBe("2026-01-29");
  });

  it("crosses month boundaries", () => {
    expect(addDaysToKey("2026-01-31", 1)).toBe("2026-02-01");
  });

  it("crosses year boundaries", () => {
    expect(addDaysToKey("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("handles leap years", () => {
    expect(addDaysToKey("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("goes backwards", () => {
    expect(addDaysToKey("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("is exact across a DST transition (calendar days, not 24h multiples)", () => {
    // US DST begins 2026-03-08. A 14-day window from Feb 25 must land on
    // Mar 11 regardless of any offset change in between.
    expect(addDaysToKey("2026-02-25", 14)).toBe("2026-03-11");
  });
});

describe("daysBetweenKeys", () => {
  it("counts calendar days", () => {
    expect(daysBetweenKeys("2026-01-01", "2026-01-15")).toBe(14);
  });

  it("is zero for the same day", () => {
    expect(daysBetweenKeys("2026-01-01", "2026-01-01")).toBe(0);
  });

  it("is negative when the range runs backwards", () => {
    expect(daysBetweenKeys("2026-01-15", "2026-01-01")).toBe(-14);
  });

  it("is unaffected by a DST transition inside the range", () => {
    expect(daysBetweenKeys("2026-02-25", "2026-03-11")).toBe(14);
  });

  it("inverts addDaysToKey", () => {
    expect(daysBetweenKeys("2026-05-01", addDaysToKey("2026-05-01", 37))).toBe(37);
  });
});

describe("isOnLocalDay", () => {
  it("matches a timestamp taken on that local day", () => {
    const iso = new Date(2026, 7, 17, 3, 0, 0).toISOString();
    expect(isOnLocalDay(iso, "2026-08-17")).toBe(true);
  });

  it("rejects a timestamp from the next local day", () => {
    const iso = new Date(2026, 7, 18, 3, 0, 0).toISOString();
    expect(isOnLocalDay(iso, "2026-08-17")).toBe(false);
  });

  it("matches just before local midnight", () => {
    const iso = new Date(2026, 7, 17, 23, 59, 0).toISOString();
    expect(isOnLocalDay(iso, "2026-08-17")).toBe(true);
  });

  it("matches just after local midnight", () => {
    const iso = new Date(2026, 7, 17, 0, 1, 0).toISOString();
    expect(isOnLocalDay(iso, "2026-08-17")).toBe(true);
  });
});

describe("no source file derives a date key from UTC", () => {
  // The first migration pass swept for `toISOString().split("T")[0]` and
  // missed six call sites doing `.split("T")[0]` on an already-stored ISO
  // timestamp, which is the same UTC-day bug in a different shape.
  it("has no .split(\"T\")[0] outside this module's documentation", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const roots = ["app", "components", "context", "constants", "lib"].map((d) =>
      join(__dirname, "..", d),
    );
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) {
          readFileSync(p, "utf8")
            .split("\n")
            .forEach((line, i) => {
              if (line.includes('split("T")[0]') && !line.trimStart().startsWith("*")) {
                offenders.push(`${p.split("/").slice(-2).join("/")}:${i + 1}`);
              }
            });
        }
      }
    };
    roots.forEach(walk);
    expect(offenders).toEqual([]);
  });
});

describe("TimestampPicker round-trip", () => {
  // The picker splits an instant into { dateStr, hour, minute } and rebuilds
  // it on confirm. It used to take dateStr from the UTC calendar and the time
  // from the local one, so confirming without editing anything could move a
  // log by a full day. Opening and confirming must be an identity.
  const split = (iso: string) => {
    const d = new Date(iso);
    return { dateStr: localDateKey(d), hour: d.getHours(), minute: d.getMinutes() };
  };
  const rebuild = (dateStr: string, hour: number, minute: number) =>
    new Date(`${dateStr}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`).toISOString();

  it.each([
    [2026, 7, 17, 23, 30],
    [2026, 7, 17, 0, 15],
    [2026, 0, 1, 12, 0],
    [2026, 11, 31, 23, 59],
  ])("is an identity for %i-%i-%i %i:%i local", (y, mo, d, h, mi) => {
    const iso = new Date(y, mo, d, h, mi, 0, 0).toISOString();
    const s = split(iso);
    expect(rebuild(s.dateStr, s.hour, s.minute)).toBe(iso);
  });

  // Known limitation, asserted so it cannot regress silently into something
  // worse: during the repeated hour of a DST "fall back", a local wall-clock
  // time maps to two instants and `new Date("YYYY-MM-DDTHH:mm:00")` picks one.
  // Confirming an untouched picker can therefore shift the log by the offset
  // delta. It is bounded by that delta (<= 1h) and never changes the calendar
  // day, so it cannot reproduce the day-shift bug this module was written to
  // fix. Asia/Singapore, the only timezone this app is used in, has no DST.
  it("stays on the same calendar day even in an ambiguous DST hour", () => {
    for (const [y, mo, d, h] of [[2026, 10, 1, 1], [2026, 2, 8, 1]] as const) {
      const iso = new Date(y, mo, d, h, 30, 0, 0).toISOString();
      const s = split(iso);
      const rebuilt = rebuild(s.dateStr, s.hour, s.minute);
      expect(localDateKey(rebuilt)).toBe(s.dateStr);
      expect(Math.abs(new Date(rebuilt).getTime() - new Date(iso).getTime())).toBeLessThanOrEqual(
        3_600_000,
      );
    }
  });
});

describe("formatShortDate", () => {
  it("renders the same calendar day it was given", () => {
    expect(formatShortDate("2026-08-17")).toContain("17");
    expect(formatShortDate("2026-08-17")).toContain("Aug");
    expect(formatShortDate("2026-08-17")).toContain("2026");
  });

  it("does not shift the day for a date key", () => {
    // The old implementation parsed "YYYY-MM-DD" as UTC midnight and then
    // rendered it in local time, showing the previous day west of UTC.
    for (const key of ["2026-01-01", "2026-06-15", "2026-12-31"]) {
      const [, , dd] = key.split("-");
      expect(formatShortDate(key)).toContain(String(Number(dd)));
    }
  });

  it("accepts a full ISO timestamp and renders its local day", () => {
    const iso = new Date(2026, 7, 17, 22, 0, 0).toISOString();
    expect(formatShortDate(iso)).toContain("17");
  });
});

/**
 * Day rollover. Expo Router mounts each tab once and never unmounts it, so
 * anything derived from "now" at mount goes stale. AppContext schedules a tick
 * from this to refresh today's date key.
 */
describe("msUntilNextLocalMidnight", () => {
  it("is clamped to at most an hour, so a sleeping device cannot miss the day", () => {
    for (let h = 0; h < 24; h++) {
      const ms = msUntilNextLocalMidnight(new Date(2026, 7, 17, h, 30));
      expect(ms).toBeLessThanOrEqual(60 * 60 * 1000);
      expect(ms).toBeGreaterThanOrEqual(1000);
    }
  });

  it("never returns zero or negative, even a millisecond before midnight", () => {
    expect(msUntilNextLocalMidnight(new Date(2026, 7, 17, 23, 59, 59, 999)))
      .toBeGreaterThanOrEqual(1000);
  });

  it("lands after local midnight, not before it", () => {
    // 23:10 is inside the one-hour clamp, so the raw distance is returned and
    // the resulting instant must actually be on the next local day.
    const now = new Date(2026, 7, 17, 23, 10);
    const fires = new Date(now.getTime() + msUntilNextLocalMidnight(now));
    expect(localDateKey(fires)).toBe("2026-08-18");
  });

  it("uses calendar fields, so a short DST day still resolves to real midnight", () => {
    // Only meaningful under a DST zone; the assertion holds everywhere because
    // the target is built from calendar fields rather than now + 24h.
    const now = new Date(2026, 2, 8, 23, 30);
    const fires = new Date(now.getTime() + msUntilNextLocalMidnight(now));
    expect(localDateKey(fires)).toBe(addDaysToKey(localDateKey(now), 1));
  });
});
