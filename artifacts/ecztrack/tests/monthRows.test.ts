import { describe, it, expect } from "vitest";
import { monthRows } from "@/lib/monthRows";
import type { SkinPhoto, SymptomLog } from "@/constants/types";

const TODAY = "2026-09-15";

describe("monthRows", () => {
  it("returns one row per day of the month, in order", () => {
    const rows = monthRows(2026, 8, [], [], TODAY); // month is 0-based: September
    expect(rows).toHaveLength(30);
    expect(rows[0].dateKey).toBe("2026-09-01");
    expect(rows[29].dateKey).toBe("2026-09-30");
  });

  it("handles February in a leap year", () => {
    expect(monthRows(2028, 1, [], [], "2028-02-15")).toHaveLength(29);
  });

  it("carries a day's average and its latest photo", () => {
    const logs: SymptomLog[] = [{ id: "l1", date: "2026-09-02", scores: { a: 4, b: 5 } }];
    const photos: SkinPhoto[] = [
      { id: "p1", date: "2026-09-02", file: "a.jpg", takenAt: "2026-09-02T08:00:00.000Z" },
      { id: "p2", date: "2026-09-02", file: "b.jpg", takenAt: "2026-09-02T20:00:00.000Z" },
    ];
    const row = monthRows(2026, 8, logs, photos, TODAY)[1];
    expect(row.average).toBe(4.5);
    expect(row.photo!.file).toBe("b.jpg");
  });

  it("leaves an unlogged day empty rather than omitting it", () => {
    // A run of blanks says the check-ins stopped, which is a finding. A list
    // that drops them makes three skipped days look like three consecutive
    // ones and misreads a flare's timeline.
    const row = monthRows(2026, 8, [], [], TODAY)[0];
    expect(row.average).toBeNull();
    expect(row.photo).toBeNull();
  });

  it("marks days after today as future", () => {
    const rows = monthRows(2026, 8, [], [], TODAY);
    expect(rows[14].isFuture).toBe(false);  // the 15th is today
    expect(rows[15].isFuture).toBe(true);
  });

  it("ignores a check-in that recorded nothing", () => {
    // Tapping a box and tapping it off again leaves a log with every score
    // null. That is not a check-in, and it must not read as one.
    const logs: SymptomLog[] = [{ id: "l1", date: "2026-09-01", scores: { a: null } }];
    expect(monthRows(2026, 8, logs, [], TODAY)[0].average).toBeNull();
  });
});
