import { describe, it, expect } from "vitest";
import { intensityOf, gradedIntensity, DEFAULT_INTENSITY, INTENSITY_LABELS, carriedIntensities } from "@/lib/tagIntensity";
import type { FoodItem } from "@/constants/foods";

const food = (over: Partial<FoodItem>): FoodItem => ({
  id: "f", name: "Coffee", category: "Beverages", tags: { caffeine: 1 },
  is_elimination_safe: false, ...over,
});

describe("intensityOf", () => {
  it("returns the stored grade", () => {
    expect(intensityOf(food({ tag_intensity: { caffeine: 3 } }), "caffeine")).toBe(3);
  });

  it("returns Average for an ungraded tag", () => {
    expect(intensityOf(food({}), "caffeine")).toBe(DEFAULT_INTENSITY);
    expect(DEFAULT_INTENSITY).toBe(2);
  });

  it("returns Average for a food with no map at all", () => {
    // Every food written before grading existed.
    expect(intensityOf(food({ tag_intensity: undefined }), "caffeine")).toBe(2);
  });

  it("ignores a stored value outside 1-3", () => {
    // Nothing in the app writes one, but a synced document from a future
    // version might, and a 7 would silently multiply every dose by 7.
    const bad = food({ tag_intensity: { caffeine: 7 as 1 } });
    expect(intensityOf(bad, "caffeine")).toBe(2);
  });
});

describe("gradedIntensity", () => {
  it("is null when the tag was never graded", () => {
    // This is the whole point of storing absence: the export must be able to
    // say which foods the user actually graded.
    expect(gradedIntensity(food({}), "caffeine")).toBeNull();
  });

  it("is the grade when it was", () => {
    expect(gradedIntensity(food({ tag_intensity: { caffeine: 1 } }), "caffeine")).toBe(1);
  });
});

describe("carriedIntensities", () => {
  it("keeps the grade for a tag the food carries", () => {
    const f = food({ tags: { caffeine: 1 }, tag_intensity: { caffeine: 3 } });
    expect(carriedIntensities(f)).toEqual({ caffeine: 3 });
  });

  it("drops a grade for a tag the food does not carry", () => {
    // The stale-grade case. A food that says caffeine: 0 must not ship a
    // caffeine grade to anyone reading the JSON export.
    const f = food({ tags: { caffeine: 0 }, tag_intensity: { caffeine: 3 } });
    expect(carriedIntensities(f)).toBeUndefined();
  });

  it("drops a grade for a tag missing from the map entirely", () => {
    const f = food({ tags: {}, tag_intensity: { caffeine: 3 } });
    expect(carriedIntensities(f)).toBeUndefined();
  });

  it("is undefined, not an empty object, when nothing survives", () => {
    // `{}` would export as "graded nothing", which is a different claim from
    // "never graded" and the one thing the absent-means-ungraded design exists
    // to keep apart.
    expect(carriedIntensities(food({ tag_intensity: {} }))).toBeUndefined();
  });

  it("keeps the carried grades and drops the rest in one food", () => {
    const f = food({
      tags: { caffeine: 1, dairy: 0 },
      tag_intensity: { caffeine: 1, dairy: 3 },
    });
    expect(carriedIntensities(f)).toEqual({ caffeine: 1 });
  });

  it("drops a grade for a tag whose stored value is truthy but not 1", () => {
    // Pins the `=== 1` rule specifically: a truthy-but-not-1 value (e.g. a
    // corrupt or future-version 2) must still be treated as not-carried.
    const f = food({ tags: { caffeine: 2 as 1 }, tag_intensity: { caffeine: 3 } });
    expect(carriedIntensities(f)).toBeUndefined();
  });
});

describe("INTENSITY_LABELS", () => {
  it("names all three levels", () => {
    expect(INTENSITY_LABELS).toEqual({ 1: "Low", 2: "Average", 3: "High" });
  });
});
