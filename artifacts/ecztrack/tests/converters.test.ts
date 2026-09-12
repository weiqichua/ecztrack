import { describe, it, expect } from "vitest";
import { consumptionLogConverter, customFoodConverter } from "@/lib/repo/converters";
import type { FoodItem } from "@/constants/foods";

describe("customFoodConverter", () => {
  it("round-trips tag_intensity", () => {
    const food: FoodItem = {
      id: "f1", name: "Coffee", category: "Beverages",
      tags: { caffeine: 1 }, tag_intensity: { caffeine: 3 },
      is_elimination_safe: true,
    };
    const back = customFoodConverter.fromDoc("f1", customFoodConverter.toDoc(food));
    expect(back.tag_intensity).toEqual({ caffeine: 3 });
  });

  it("leaves tag_intensity absent when the food was never graded", () => {
    const food: FoodItem = {
      id: "f1", name: "Coffee", category: "Beverages",
      tags: { caffeine: 1 }, is_elimination_safe: true,
    };
    const back = customFoodConverter.fromDoc("f1", customFoodConverter.toDoc(food));
    expect(back.tag_intensity).toBeUndefined();
  });
});

describe("consumptionLogConverter", () => {
  it("round-trips a meal's group id and label", () => {
    const log = {
      id: "l1", timestamp: "2026-08-30T12:00:00.000Z", item_id: "f", phase: "none" as const,
      is_accident: false, group_id: "g1", meal: "Dinner",
    };
    const back = consumptionLogConverter.fromDoc("l1", consumptionLogConverter.toDoc(log));
    expect(back.group_id).toBe("g1");
    expect(back.meal).toBe("Dinner");
  });

  it("leaves group id and meal absent when the log never had them", () => {
    const log = {
      id: "l1", timestamp: "2026-08-30T12:00:00.000Z", item_id: "f", phase: "none" as const,
      is_accident: false,
    };
    const back = consumptionLogConverter.fromDoc("l1", consumptionLogConverter.toDoc(log));
    expect(back.group_id).toBeUndefined();
    expect(back.meal).toBeUndefined();
  });
});
