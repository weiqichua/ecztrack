import { describe, it, expect } from "vitest";
import { groupLogsByMeal, renameMealIn, retimeMealIn, deleteMealIn, DEFAULT_MEAL_LABEL } from "@/lib/mealGroups";
import type { ConsumptionLog } from "@/constants/types";

const log = (over: Partial<ConsumptionLog>): ConsumptionLog => ({
  id: "x", timestamp: "2026-08-30T12:00:00.000Z", item_id: "f", phase: "none",
  is_accident: false, ...over,
});

describe("groupLogsByMeal", () => {
  it("puts one save's foods in one group", () => {
    const logs = [
      log({ id: "a", item_id: "bread", group_id: "g1", meal: "Dinner" }),
      log({ id: "b", item_id: "eggs",  group_id: "g1", meal: "Dinner" }),
    ];
    const groups = groupLogsByMeal(logs);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Dinner");
    expect(groups[0].entries.map(e => e.item_id)).toEqual(["bread", "eggs"]);
  });

  it("keeps two saves apart even at the same timestamp", () => {
    // The whole reason group_id exists. Two saves in the same minute are two
    // meals; grouping on the timestamp would silently merge them.
    const logs = [
      log({ id: "a", group_id: "g1" }),
      log({ id: "b", group_id: "g2" }),
    ];
    expect(groupLogsByMeal(logs)).toHaveLength(2);
  });

  it("gives a log with no group_id its own group", () => {
    // Every log written before meals existed. It must still render.
    const logs = [log({ id: "old" })];
    const groups = groupLogsByMeal(logs);
    expect(groups).toHaveLength(1);
    expect(groups[0].groupId).toBe("old");
    expect(groups[0].label).toBe(DEFAULT_MEAL_LABEL);
  });

  it("orders groups newest first by instant, not by string", () => {
    // A retrospective entry can carry a +08:00 offset instead of Z, so string
    // order and time order disagree.
    const logs = [
      log({ id: "a", group_id: "g1", timestamp: "2026-08-30T01:00:00.000Z" }),
      log({ id: "b", group_id: "g2", timestamp: "2026-08-30T08:00:00+08:00" }),
    ];
    expect(groupLogsByMeal(logs).map(g => g.groupId)).toEqual(["g1", "g2"]);
  });

  it("flags a group where any one entry was accidental", () => {
    const logs = [
      log({ id: "a", group_id: "g1", is_accident: false }),
      log({ id: "b", group_id: "g1", is_accident: true }),
    ];
    expect(groupLogsByMeal(logs)[0].hasAccident).toBe(true);
  });

  it("takes the group's timestamp from its earliest entry", () => {
    const logs = [
      log({ id: "a", group_id: "g1", timestamp: "2026-08-30T13:00:00.000Z" }),
      log({ id: "b", group_id: "g1", timestamp: "2026-08-30T12:00:00.000Z" }),
    ];
    expect(groupLogsByMeal(logs)[0].timestamp).toBe("2026-08-30T12:00:00.000Z");
  });

  it("orders one group's own entries oldest first by instant, not by string", () => {
    // Same trap as group ordering, but within one group's entries: a +08:00
    // offset is numerically earlier than a same-day Z timestamp even though
    // its string sorts later.
    const logs = [
      log({ id: "a", item_id: "later", group_id: "g1", timestamp: "2026-08-30T01:00:00.000Z" }),
      log({ id: "b", item_id: "earlier", group_id: "g1", timestamp: "2026-08-30T08:00:00+08:00" }),
    ];
    expect(groupLogsByMeal(logs)[0].entries.map(e => e.item_id)).toEqual(["earlier", "later"]);
  });

  it("falls back to the default for a stored blank meal name", () => {
    // A log whose `meal` field was somehow saved as whitespace must still
    // render a real label, not a blank row.
    const logs = [log({ id: "a", group_id: "g1", meal: "   " })];
    expect(groupLogsByMeal(logs)[0].label).toBe(DEFAULT_MEAL_LABEL);
  });

  it("picks a deterministic label when merged logs disagree", () => {
    // A backup merge can resurrect a log carrying an older label. The winner
    // need only be stable: same array, any insertion order, same answer.
    const a = log({ id: "a", group_id: "g1", meal: "Dinner" });
    const b = log({ id: "b", group_id: "g1", meal: "Toast only" });
    expect(groupLogsByMeal([a, b])[0].label).toBe(groupLogsByMeal([b, a])[0].label);
  });
});

describe("renameMealIn", () => {
  it("renames every log in the group and nothing else", () => {
    const logs = [
      log({ id: "a", group_id: "g1", meal: "Meal" }),
      log({ id: "b", group_id: "g1", meal: "Meal" }),
      log({ id: "c", group_id: "g2", meal: "Meal" }),
    ];
    const out = renameMealIn(logs, "g1", "  Dinner  ");
    expect(out.filter(l => l.meal === "Dinner")).toHaveLength(2);
    expect(out.find(l => l.id === "c")!.meal).toBe("Meal");
  });

  it("falls back to the default rather than storing a blank name", () => {
    // A blank label renders as an empty row with no way to tell what it was.
    const logs = [log({ id: "a", group_id: "g1", meal: "Dinner" })];
    expect(renameMealIn(logs, "g1", "   ")[0].meal).toBe(DEFAULT_MEAL_LABEL);
  });

  it("stamps a legacy log's own id as its group id when renaming it", () => {
    // Renamed-but-ungrouped is the one state the export cannot represent:
    // meal_name filled, meal_id blank, and every such log across history
    // falls into one blank bucket for anything that groups by meal_id.
    const out = renameMealIn([log({ id: "old" })], "old", "Breakfast");
    expect(out[0].group_id).toBe("old");
    expect(out[0].meal).toBe("Breakfast");
  });
});

describe("retimeMealIn", () => {
  it("moves every log in the group and restamps the phase", () => {
    const logs = [
      log({ id: "a", group_id: "g1", phase: "none" }),
      log({ id: "b", group_id: "g1", phase: "none" }),
      log({ id: "c", group_id: "g2", phase: "none" }),
    ];
    const out = retimeMealIn(logs, "g1", "2026-08-25T09:00:00.000Z", "elimination");
    expect(out.filter(l => l.timestamp === "2026-08-25T09:00:00.000Z")).toHaveLength(2);
    expect(out.filter(l => l.phase === "elimination")).toHaveLength(2);
    expect(out.find(l => l.id === "c")!.phase).toBe("none");
  });
});

describe("deleteMealIn", () => {
  it("removes all logs belonging to the group and leaves others untouched", () => {
    const logs = [
      log({ id: "a", group_id: "g1" }),
      log({ id: "b", group_id: "g1" }),
      log({ id: "c", group_id: "g2" }),
    ];
    const out = deleteMealIn(logs, "g1");
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("c");
  });

  it("removes a legacy ungrouped log whose id matches groupId", () => {
    const logs = [
      log({ id: "legacy1" }),
      log({ id: "legacy2" }),
    ];
    const out = deleteMealIn(logs, "legacy1");
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("legacy2");
  });
});

