import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "./mciPaths";
import { SEED_FOOD_TAGS } from "@/constants/foods";
import { HABIT_ICONS } from "@/constants/types";

/**
 * MciIcon renders null for an unknown name, so a typo is invisible at runtime
 * outside __DEV__. These tests are the net: every name the app asks for must
 * exist in PATHS.
 */
describe("MciIcon PATHS coverage", () => {
  it("has a path for every icon the seeded food tags use", () => {
    // The tags are a user-owned catalog now, so this covers only what ships as
    // the starting set. An icon the user picks is covered by the picker's own
    // list being drawn from PATHS rather than by this test.
    const missing = SEED_FOOD_TAGS
      .map((t) => t.icon)
      .filter((icon): icon is string => !!icon && !PATHS[icon]);
    expect(missing).toEqual([]);
  });

  it("has a path for every habit icon the user can pick", () => {
    const missing = HABIT_ICONS.filter((n) => !PATHS[n]);
    expect(missing).toEqual([]);
  });

  it("has a path for every icon name used in app/ and components/", () => {
    const roots = ["app", "components"].map((d) => join(__dirname, "..", d));
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) files.push(p);
      }
    };
    roots.forEach(walk);

    // Matches literal names on an MciIcon element, including the ternary form
    // `name={cond ? "a" : "b"}`. Route names on <Tabs.Screen> are excluded by
    // requiring the MciIcon tag within the preceding characters.
    const missing = new Set<string>();
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/<MciIcon\b[^>]*?>/gs)) {
        for (const n of m[0].matchAll(/"([a-z0-9-]+)"/g)) {
          if (!PATHS[n[1]]) missing.add(`${n[1]} (${f.split("/").pop()})`);
        }
      }
    }
    expect([...missing]).toEqual([]);
  });
});
