import { describe, it, expect } from "vitest";
import { prependConsumptionLogs, recentlyLoggedIds } from "./foodLog";
import type { ConsumptionLog } from "@/constants/types";

describe("prependConsumptionLogs", () => {
  const ts = "2026-03-05T12:00:00.000Z";
  const opts = { timestamp: ts, phase: "elimination" as const };

  const existing: ConsumptionLog[] = [{
    id: "old", timestamp: "2026-03-04T09:00:00.000Z", item_id: "rice",
    phase: "elimination", is_accident: false,
  }];

  it("writes one record per selected food, not just the last one", () => {
    // The bug this pins: the screen used to await a single-item mutator once
    // per selection, and each call overwrote the previous one's array, so
    // saving toast + eggs + coffee persisted only coffee.
    const next = prependConsumptionLogs(existing, ["toast", "eggs", "coffee"], opts);
    expect(next).toHaveLength(4);
    expect(next.map(l => l.item_id)).toEqual(["toast", "eggs", "coffee", "rice"]);
  });

  it("gives every record in one batch a distinct id", () => {
    const next = prependConsumptionLogs([], ["toast", "eggs", "coffee"], opts);
    expect(new Set(next.map(l => l.id)).size).toBe(3);
  });

  it("stamps the whole batch with the one timestamp and phase it was given", () => {
    const next = prependConsumptionLogs([], ["toast", "eggs"], opts);
    expect(next.every(l => l.timestamp === ts && l.phase === "elimination")).toBe(true);
  });

  it("carries the accident flag onto every record", () => {
    const next = prependConsumptionLogs([], ["toast", "eggs"], { ...opts, isAccident: true });
    expect(next.every(l => l.is_accident)).toBe(true);
  });

  it("defaults the accident flag to false", () => {
    const [log] = prependConsumptionLogs([], ["toast"], opts);
    expect(log.is_accident).toBe(false);
  });

  it("returns the existing list untouched for an empty selection", () => {
    expect(prependConsumptionLogs(existing, [], opts)).toEqual(existing);
  });

  it("stamps every food in one save with the same group id", () => {
    const out = prependConsumptionLogs([], ["a", "b"], {
      timestamp: "2026-08-30T12:00:00.000Z", phase: "none",
      groupId: "g1", meal: "Dinner",
    });
    expect(out.every(l => l.group_id === "g1")).toBe(true);
    expect(out.every(l => l.meal === "Dinner")).toBe(true);
  });

  it("writes no group fields at all when none were given", () => {
    // Not null, not "": `defined()` only strips undefined, and a stored empty
    // string would group every legacy log together.
    const [l] = prependConsumptionLogs([], ["a"], {
      timestamp: "2026-08-30T12:00:00.000Z", phase: "none",
    });
    expect("group_id" in l).toBe(false);
    expect("meal" in l).toBe(false);
  });
});

describe("recentlyLoggedIds", () => {
  const now = new Date("2026-03-05T12:00:00.000Z").getTime();
  const log = (item_id: string, timestamp: string): ConsumptionLog => ({
    id: item_id + timestamp, timestamp, item_id,
    phase: "elimination", is_accident: false,
  });

  it("includes a food logged an hour ago", () => {
    const ids = recentlyLoggedIds([log("toast", "2026-03-05T11:00:00.000Z")], now);
    expect(ids.has("toast")).toBe(true);
  });

  it("drops a food logged four hours ago", () => {
    const ids = recentlyLoggedIds([log("toast", "2026-03-05T08:00:00.000Z")], now);
    expect(ids.has("toast")).toBe(false);
  });

  it("lists a food once however many times it was logged", () => {
    const ids = recentlyLoggedIds([
      log("toast", "2026-03-05T11:00:00.000Z"),
      log("toast", "2026-03-05T11:30:00.000Z"),
      log("eggs", "2026-03-05T11:30:00.000Z"),
    ], now);
    expect(ids).toEqual(new Set(["toast", "eggs"]));
  });
});

describe("portions", () => {
  const opts = { timestamp: "2026-03-01T12:00:00", phase: "none" as const };

  it("stamps each food with its own portion", () => {
    // Per food, not per Save: a slice of toast and a bowl of ice cream go in on
    // the same tap and are not the same exposure.
    const out = prependConsumptionLogs([], ["f1", "f2"], {
      ...opts, portions: { f1: "small", f2: "large" },
    });
    expect(out.find(l => l.item_id === "f1")?.portion).toBe("small");
    expect(out.find(l => l.item_id === "f2")?.portion).toBe("large");
  });

  it("leaves portion undefined when none was chosen", () => {
    // Deliberately not defaulted to "medium". A silent default would be
    // confidently wrong on most rows, and an analysis cannot tell a real medium
    // from a guess — the same absent-vs-explicit distinction the symptom scores
    // already make.
    const out = prependConsumptionLogs([], ["f1"], opts);
    expect(out[0].portion).toBeUndefined();
  });

  it("leaves the other foods undefined when only one was given a portion", () => {
    const out = prependConsumptionLogs([], ["f1", "f2"], { ...opts, portions: { f1: "large" } });
    expect(out.find(l => l.item_id === "f1")?.portion).toBe("large");
    expect(out.find(l => l.item_id === "f2")?.portion).toBeUndefined();
  });
});
