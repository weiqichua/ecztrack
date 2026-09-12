import { describe, it, expect } from "vitest";
import { averageScore } from "@/lib/symptomStats";

describe("averageScore", () => {
  it("averages the symptoms that were scored", () => {
    expect(averageScore({ a: 2, b: 4 })).toBe(3);
  });

  it("ignores a null rather than counting it as zero", () => {
    // null means the box was shown and left unselected. Counted as a zero it
    // would drag every average down and invent an improvement that never
    // happened — and 0 is not even on the 1-5 scale.
    expect(averageScore({ a: 4, b: null })).toBe(4);
  });

  it("is null when nothing was scored", () => {
    expect(averageScore({ a: null })).toBeNull();
    expect(averageScore({})).toBeNull();
    expect(averageScore(undefined)).toBeNull();
  });
});
