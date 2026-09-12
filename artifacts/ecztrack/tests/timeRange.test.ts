import { describe, it, expect } from "vitest";
import { TIME_RANGES, filterByRecency } from "@/lib/timeRange";

const NOW = new Date("2026-08-31T12:00:00.000Z").getTime();
const at = (iso: string) => ({ timestamp: iso });

describe("filterByRecency", () => {
  it("keeps only the last 7 days for 'week'", () => {
    const items = [at("2026-08-30T12:00:00.000Z"), at("2026-08-20T12:00:00.000Z")];
    expect(filterByRecency(items, "week", NOW)).toHaveLength(1);
  });

  it("keeps everything for 'all'", () => {
    const items = [at("2020-01-01T00:00:00.000Z"), at("2026-08-30T12:00:00.000Z")];
    expect(filterByRecency(items, "all", NOW)).toHaveLength(2);
  });

  it("keeps an item exactly on the boundary", () => {
    // Inclusive on purpose: a log written seven days ago to the millisecond is
    // inside "last week" by every reading a person has of that phrase.
    const items = [at(new Date(NOW - 7 * 86400000).toISOString())];
    expect(filterByRecency(items, "week", NOW)).toHaveLength(1);
  });

  it("keeps a future-stamped log in every bounded range", () => {
    // Retimed meals and retrospective entries can sit slightly ahead of now.
    // A cutoff comparison that only checks the lower bound keeps them, which is
    // what we want — dropping them would hide the entry the user just edited.
    const items = [at("2026-09-05T12:00:00.000Z")];
    expect(filterByRecency(items, "week", NOW)).toHaveLength(1);
  });

  it("orders the ranges shortest first, with 'all' last", () => {
    expect(TIME_RANGES.map(r => r.key)).toEqual(["week", "fortnight", "month", "quarter", "all"]);
  });
});
