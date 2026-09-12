import { describe, it, expect } from "vitest";
import { scoreLevel, severityFraction } from "./scoreScale";

describe("scoreLevel", () => {
  // The scale reads HIGH = severe: 1 is "no symptoms", 5 is "worst it gets".
  // This is the opposite of what the app shipped with, so these cases are the
  // record of which way round it goes.
  it("calls the low end good", () => {
    expect(scoreLevel(1)).toBe("good");
    expect(scoreLevel(2)).toBe("good");
  });

  it("calls the middle a warning", () => {
    expect(scoreLevel(3)).toBe("warn");
  });

  it("calls the high end bad, because a high score means severe", () => {
    expect(scoreLevel(4)).toBe("bad");
    expect(scoreLevel(5)).toBe("bad");
  });

  it("has no gap and no overlap across the whole scale", () => {
    // Pins every value at once: a boundary moved in either direction changes
    // one of these, which a per-value test above might not catch on its own.
    expect([1, 2, 3, 4, 5].map(scoreLevel)).toEqual(["good", "good", "warn", "bad", "bad"]);
  });
});

describe("severityFraction", () => {
  it("puts the best score at empty and the worst at full", () => {
    expect(severityFraction(1)).toBe(0);
    expect(severityFraction(5)).toBe(1);
  });

  it("rises with the score, so a fuller bar is a worse day", () => {
    // Pins the DIRECTION, which is the thing the flip changed. Before, this
    // sequence descended.
    const fractions = [1, 2, 3, 4, 5].map(severityFraction);
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
    expect(severityFraction(4)).toBeGreaterThan(severityFraction(2));
  });
});
