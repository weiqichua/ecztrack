import { describe, it, expect } from "vitest";
import { localDateKey } from "@/lib/dates";
import { EMPTY_LEDGER } from "@/lib/phases";
import {
  buildConsumptionCSV,
  buildHabitsCSV,
  buildJSON,
  buildSymptomCSV,
  buildUrgeCSV,
  escapeCSV,
  nominalCheckinTimestamp,
  row,
} from "@/lib/exportCsv";
import type { CatalogItem } from "@/constants/catalog";
import type { ConsumptionLog, ScratchLog, SymptomLog } from "@/constants/types";
import { SEED_FOOD_TAGS, type FoodItem } from "@/constants/foods";
import { CURRENT_SCHEMA_VERSION } from "@/lib/migrations";

/** The user-created catalogs, as buildJSON now takes them. */
const CATALOGS = {
  symptoms: [{ id: "s1", name: "Itch", order: 0, isArchived: false }],
  bodyLocations: [{ id: "b1", name: "Left arm", order: 0, isArchived: false }],
  cues: [{ id: "c1", name: "Stress", order: 0, isArchived: false }],
  routines: [{ id: "r1", name: "Cold press", order: 0, isArchived: false }],
  foodCategories: [{ id: "Grains", name: "Grains", order: 0, isArchived: false }],
  foodTags: [{ id: "caffeine", name: "Caffeine", order: 0, isArchived: false, icon: "coffee" }],
  supplements: [],
  activities: [],
};

/**
 * The export screen's builders, tested through the pure module they live in —
 * `app/(tabs)/export.tsx` itself cannot be imported here (react-native-svg
 * under a node environment), and a test file under `app/` gets bundled by
 * expo-router and breaks the web build.
 */

const SYMPTOMS: CatalogItem[] = [
  { id: "s_itch", name: "Itch", order: 0, isArchived: false },
  { id: "s_heat", name: "Heat", order: 1, isArchived: false },
];

const TAGS: CatalogItem[] = [
  { id: "caffeine", name: "Caffeine", order: 0, isArchived: false, icon: "coffee" },
];

const FOOD_COFFEE: FoodItem = {
  id: "coffee", name: "Coffee", category: "Beverages",
  tags: { caffeine: 1 }, is_elimination_safe: false,
};

// Named `logWith`, not `log`: the `buildConsumptionCSV` describe block below
// already binds `log` to a fixed ConsumptionLog value, and the buildJSON
// tests each declare their own block-scoped `log` too. Renaming this helper
// avoids colliding with either.
const logWith = (over: Partial<ConsumptionLog>): ConsumptionLog => ({
  id: "l1", timestamp: "2026-08-30T12:00:00.000Z", item_id: "coffee",
  phase: "none", is_accident: false, ...over,
});

function cells(line: string): string[] {
  return line.split(",");
}

describe("escapeCSV", () => {
  it("leaves a plain value alone and blanks a missing one", () => {
    expect(escapeCSV("itch")).toBe("itch");
    expect(escapeCSV(0)).toBe("0");
    expect(escapeCSV(null)).toBe("");
    expect(escapeCSV(undefined)).toBe("");
  });

  it("quotes and doubles up anything that would break a column", () => {
    expect(escapeCSV("a,b")).toBe('"a,b"');
    expect(escapeCSV('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCSV("two\nlines")).toBe('"two\nlines"');
  });

  it("joins a row on commas", () => {
    expect(row("a", 1, null, true)).toBe("a,1,,true");
  });
});

describe("symptom CSV timestamp", () => {
  const dates = ["2026-01-01", "2026-03-08", "2026-06-15", "2026-08-17", "2026-11-01", "2026-12-31"];

  it.each(dates)("stays on the same local day as its date column (%s)", (date) => {
    expect(localDateKey(nominalCheckinTimestamp(date))).toBe(date);
  });

  it("is anchored at local noon, the only hour no offset can push onto the next day", () => {
    // Midnight is one timezone offset away from crossing a day boundary; noon
    // is twelve hours from either edge. This is what stops the nominal
    // timestamp from disagreeing with the `date` column beside it.
    for (const date of dates) {
      expect(new Date(nominalCheckinTimestamp(date)).getHours()).toBe(12);
    }
  });

  it("puts that timestamp in the row it built", () => {
    const logs: SymptomLog[] = [{ id: "s1", date: "2026-08-17", scores: { s_itch: 4 } }];
    const [, line] = buildSymptomCSV(logs, SYMPTOMS).split("\n");
    const [, date, ts] = cells(line);
    expect(date).toBe("2026-08-17");
    expect(new Date(ts).getHours()).toBe(12);
    expect(localDateKey(ts)).toBe(date);
  });
});

describe("buildSymptomCSV", () => {
  it("heads one column per symptom seen, in first-seen order, named where it can be", () => {
    const logs: SymptomLog[] = [
      { id: "s1", date: "2026-08-17", phase: "elimination", scores: { s_itch: 4 } },
      { id: "s2", date: "2026-08-18", phase: "challenge", scores: { s_heat: 2, s_gone: 1 } },
    ];
    const [header] = buildSymptomCSV(logs, SYMPTOMS).split("\n");
    expect(header).toBe(
      "log_id,date,timestamp_iso,phase,Itch,Heat,s_gone,symptom_avg",
    );
  });

  it("averages only the scores the log actually holds", () => {
    const logs: SymptomLog[] = [{ id: "s1", date: "2026-08-17", scores: { s_itch: 4, s_heat: 1 } }];
    const [, line] = buildSymptomCSV(logs, SYMPTOMS).split("\n");
    expect(cells(line).at(-1)).toBe("2.500");
  });

  it("keeps an explicit null out of the average instead of counting it as a zero", () => {
    // `!= null` and not `!== undefined`: a box shown and left unselected is
    // stored as null, and treating it as a number would drag every average of
    // an incomplete check-in toward zero.
    const logs: SymptomLog[] = [{ id: "s1", date: "2026-08-17", scores: { s_itch: 4, s_heat: null } }];
    const [, line] = buildSymptomCSV(logs, SYMPTOMS).split("\n");
    const c = cells(line);
    expect(c.at(-1)).toBe("4.000");
    // …and the null renders as an empty cell, not as a 0.
    expect(c.at(-2)).toBe("");
  });

  it("emits no row for a day whose every score was cleared", () => {
    // Tapping a box and tapping it off again leaves a log with nothing in it.
    // A row for that day is a phantom check-in in the export.
    const logs: SymptomLog[] = [
      { id: "s1", date: "2026-08-17", scores: { s_itch: null } },
      { id: "s2", date: "2026-08-18", scores: { s_itch: 3 } },
    ];
    const lines = buildSymptomCSV(logs, SYMPTOMS).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1].startsWith("s2,2026-08-18,")).toBe(true);
  });

  it("emits a header and nothing else when no day recorded anything", () => {
    const logs: SymptomLog[] = [{ id: "s1", date: "2026-08-17", scores: {} }];
    expect(buildSymptomCSV(logs, SYMPTOMS).split("\n")).toHaveLength(1);
  });

  it("blanks a missing phase rather than writing undefined", () => {
    const logs: SymptomLog[] = [{ id: "s1", date: "2026-08-17", scores: { s_itch: 1 } }];
    expect(cells(buildSymptomCSV(logs, SYMPTOMS).split("\n")[1])[3]).toBe("");
  });

  it("tolerates a stored log whose score map is malformed", () => {
    const logs = [{ id: "s1", date: "2026-08-17" }] as unknown as SymptomLog[];
    expect(() => buildSymptomCSV(logs, SYMPTOMS)).not.toThrow();
  });

  it("heads each symptom column with its name, not its id", () => {
    const symptoms = [{ id: "1787915098118", name: "Itching", order: 0, isArchived: false }];
    const logs = [{ id: "l1", date: "2026-08-30", scores: { "1787915098118": 3 } }];
    const [header] = buildSymptomCSV(logs, symptoms).split("\n");
    expect(header).toContain("Itching");
    expect(header).not.toContain("1787915098118");
  });

  it("falls back to the raw id when the symptom is not in the catalog", () => {
    // An archived-then-purged symptom still has scores on old logs. A blank
    // column heading would make the sheet unreadable and could collide with
    // another blank.
    const logs = [{ id: "l1", date: "2026-08-30", scores: { gone: 3 } }];
    const [header] = buildSymptomCSV(logs, []).split("\n");
    expect(header.split(",")).toContain("gone");
  });
});

describe("buildConsumptionCSV", () => {
  const food: FoodItem = {
    id: "F1", name: "Ramen, spicy", category: "Noodles", is_elimination_safe: false,
    tags: {
      caffeine: 0, dairy: 0, soy: 1, oat: 0, high_sugar: 0, palm_oil: 1, gluten: 1,
      egg: 0, fried: 1, high_sodium: 1, high_fat: 1, spicy: 1, lye: 1,
    },
  };
  const log: ConsumptionLog = {
    id: "c1", item_id: "F1", timestamp: "2026-08-17T09:30:00.000Z",
    phase: "elimination", is_accident: true,
  };

  it("resolves the food's name, category and tags", () => {
    const [, line] = buildConsumptionCSV([log], [food], SEED_FOOD_TAGS).split("\n");
    const c = cells(line);
    expect(c[0]).toBe("c1");
    expect(c[3]).toBe(localDateKey(log.timestamp));
    // The name holds a comma, so it must arrive quoted and unsplit.
    expect(line).toContain('"Ramen, spicy"');
    expect(c.at(-2)).toBe("1"); // tag_lye
    expect(c.at(-1)).toBe(""); // tag_lye_intensity, ungraded
  });

  it("says UNKNOWN and zeroes the tags for a food that is gone", () => {
    const [, line] = buildConsumptionCSV([log], [], SEED_FOOD_TAGS).split("\n");
    expect(line).toContain("UNKNOWN");
    expect(cells(line).slice(-26).join("")).toBe("0".repeat(13));
  });

  it("emits one tag column per catalog tag, in catalog order", () => {
    const tags: CatalogItem[] = [
      { id: "dairy", name: "Dairy", order: 0, isArchived: false },
      { id: "nightshade", name: "Nightshade", order: 1, isArchived: false },
    ];
    const header = buildConsumptionCSV([], [], tags).split("\n")[0];
    expect(header).toContain("tag_dairy,tag_dairy_intensity,tag_nightshade,tag_nightshade_intensity");
  });

  it("writes 1 only for the tags a food carries", () => {
    const tags: CatalogItem[] = [
      { id: "dairy", name: "Dairy", order: 0, isArchived: false },
      { id: "nightshade", name: "Nightshade", order: 1, isArchived: false },
    ];
    const food = { id: "f1", name: "Milk", category: "Dairy", tags: { dairy: 1 }, is_elimination_safe: false } as FoodItem;
    const log = { id: "c1", item_id: "f1", timestamp: "2026-03-01T12:00:00", phase: "none", is_accident: false } as ConsumptionLog;
    const row = buildConsumptionCSV([log], [food], tags).split("\n")[1];
    expect(row).toContain(",1,,0,");
  });

  it("carries the meal id and name on every row of a save", () => {
    const [header, ...rows] = buildConsumptionCSV(
      [logWith({ id: "a", item_id: "coffee", group_id: "g1", meal: "Dinner" })],
      [FOOD_COFFEE], TAGS,
    ).split("\n");
    expect(header.split(",")).toContain("meal_id");
    expect(header.split(",")).toContain("meal_name");
    expect(rows[0]).toContain("Dinner");
  });

  it("leaves the meal columns blank for a log written before meals existed", () => {
    const [, line] = buildConsumptionCSV(
      [logWith({ id: "a", item_id: "coffee" })], [FOOD_COFFEE], TAGS,
    ).split("\n");
    const c = cells(line);
    expect(c[c.length - 1]).not.toBe("undefined");
  });

  it("emits an intensity column beside each tag column", () => {
    const [header] = buildConsumptionCSV([], [], TAGS).split("\n");
    const cols = header.split(",");
    expect(cols).toContain("tag_caffeine");
    expect(cols).toContain("tag_caffeine_intensity");
  });

  it("writes the graded intensity and blanks an ungraded one", () => {
    const graded = { ...FOOD_COFFEE, tags: { caffeine: 1 as const }, tag_intensity: { caffeine: 3 as const } };
    const ungraded = { ...FOOD_COFFEE, id: "tea", tags: { caffeine: 1 as const } };
    const out = buildConsumptionCSV(
      [logWith({ id: "a", item_id: "coffee" }), logWith({ id: "b", item_id: "tea" })],
      [graded, ungraded], TAGS,
    ).split("\n");
    const header = out[0].split(",");
    const col = header.indexOf("tag_caffeine_intensity");
    expect(cells(out[1])[col]).toBe("3");
    // Blank, not "2". A default written into the file is a judgement the user
    // never made, and no reader could tell it apart from a real Average.
    expect(cells(out[2])[col]).toBe("");
  });

  it("blanks the intensity for a tag the food does not carry", () => {
    const f = { ...FOOD_COFFEE, tags: { caffeine: 0 as const }, tag_intensity: { caffeine: 3 as const } };
    const out = buildConsumptionCSV([logWith({ id: "a", item_id: "coffee" })], [f], TAGS).split("\n");
    const col = out[0].split(",").indexOf("tag_caffeine_intensity");
    expect(cells(out[1])[col]).toBe("");
  });
});

describe("buildUrgeCSV", () => {
  const log: ScratchLog = {
    id: "u1", timestamp: "2026-08-17T09:30:00.000Z", phase: "challenge",
    location: "b_arm", cue: "c_stress", routine_id: null, success: 4, is_accident: false,
  };

  it("names every referenced catalog item beside its id", () => {
    const [, line] = buildUrgeCSV(
      [log],
      [{ id: "b_arm", name: "Arm", order: 0, isArchived: false }],
      [{ id: "c_stress", name: "Stress", order: 0, isArchived: false }],
      [],
    ).split("\n");
    const c = cells(line);
    expect(c[6]).toBe("b_arm");
    expect(c[7]).toBe("Arm");
    expect(c[9]).toBe("Stress");
    expect(c[10]).toBe(""); // no competing routine on this log
    expect(c[12]).toBe("4");
  });
});

describe("buildHabitsCSV", () => {
  it("meets a count goal at the goal and misses it below", () => {
    const defs = [{ id: "h1", name: "Water", icon: "cup-water", unit: "count" as const, goal: 3, order: 0, isArchived: false }];
    const out = buildHabitsCSV(
      [{ id: "l1", habitId: "h1", date: "2026-08-17", value: 3 },
       { id: "l2", habitId: "h1", date: "2026-08-18", value: 2 }],
      defs,
    ).split("\n");
    expect(cells(out[1]).at(-1)).toBe("true");
    expect(cells(out[2]).at(-1)).toBe("false");
  });

  it("treats a check habit as met by any value at all", () => {
    const defs = [{ id: "h1", name: "Sleep", icon: "sleep", unit: "check" as const, goal: 8, order: 0, isArchived: false }];
    const out = buildHabitsCSV([{ id: "l1", habitId: "h1", date: "2026-08-17", value: 1 }], defs).split("\n");
    expect(cells(out[1]).at(-1)).toBe("true");
  });

  it("says UNKNOWN for a habit whose definition is gone", () => {
    const out = buildHabitsCSV([{ id: "l1", habitId: "h9", date: "2026-08-17", value: 1 }], []).split("\n");
    expect(out[1]).toContain("UNKNOWN");
  });
});

describe("buildJSON", () => {
  it("carries the phase ledger, without which no log's phase is reproducible", () => {
    const ledger = { days: {}, entries: [] } as any;
    const parsed = JSON.parse(buildJSON([], [], [], [], [], [], [], [], ledger, CATALOGS));
    expect(parsed.phase_ledger).toEqual(ledger);
  });

  it("stamps the same schema number storage and the backup use", () => {
    // It said "3.1" while storage was at 4 and the Export screen's own subtitle
    // said 3.0 — three numbers for one file. One source or none.
    const parsed = JSON.parse(buildJSON([], [], [], [], [], [], [], [], EMPTY_LEDGER, CATALOGS));
    expect(parsed.schema_version).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("states which end of the symptom scale is severe", () => {
    // Without this, an export from before the 2026-08-24 flip and one from
    // after are byte-identical in shape but mean opposite things, and no
    // analysis can tell them apart. Self-describing beats a version number
    // nobody has the changelog for.
    const parsed = JSON.parse(buildJSON([], [], [], [], [], [], [], [], EMPTY_LEDGER, CATALOGS));
    expect(parsed.symptom_scale).toEqual({ min: 1, max: 5, direction: "higher_is_worse" });
  });

  it("carries the catalogs, so a log's ids can be read as names", () => {
    // scores/locations/cues/routines are keyed by id. Without the catalogs in
    // the file there is no name anywhere in it, and the export is unreadable
    // on its own.
    const parsed = JSON.parse(buildJSON([], [], [], [], [], [], [], [], EMPTY_LEDGER, CATALOGS));
    expect(parsed.symptoms).toEqual(CATALOGS.symptoms);
    expect(parsed.body_locations).toEqual(CATALOGS.bodyLocations);
    expect(parsed.cues).toEqual(CATALOGS.cues);
    expect(parsed.routines).toEqual(CATALOGS.routines);
    // The food vocabulary is the same problem one level down: a food names its
    // category and tags by id, so without these the exported foods are
    // unreadable even though the logs around them are not.
    expect(parsed.food_categories).toEqual(CATALOGS.foodCategories);
    expect(parsed.food_tags).toEqual(CATALOGS.foodTags);
  });

  it("gives every event the local day it was filed under", () => {
    // The logs carry only an instant. Reading the day off timestamp[:10] gives
    // the UTC day, which disagrees with how the app files it for part of every
    // 24 hours — at UTC+8 that misfiles everything before 08:00.
    const log: ConsumptionLog = {
      id: "c1", item_id: "F1", timestamp: "2026-08-17T02:00:00.000Z",
      phase: "none", is_accident: false,
    };
    const parsed = JSON.parse(buildJSON([log], [], [], [], [], [], [], [], EMPTY_LEDGER, CATALOGS));
    expect(parsed.consumption_logs[0].date).toBe(localDateKey(log.timestamp));
  });

  it("nests each consumption log's food, or null where it is gone", () => {
    const log: ConsumptionLog = {
      id: "c1", item_id: "F1", timestamp: "2026-08-17T09:30:00.000Z",
      phase: "none", is_accident: false,
    };
    const parsed = JSON.parse(buildJSON([log], [], [], [], [], [], [], [], EMPTY_LEDGER, CATALOGS));
    expect(parsed.consumption_logs[0].food).toBeNull();
  });

  it("carries meals and tag intensity through the JSON export", () => {
    const graded: FoodItem = { ...FOOD_COFFEE, tag_intensity: { caffeine: 3 } };
    const parsed = JSON.parse(buildJSON(
      [logWith({ group_id: "g1", meal: "Dinner" })],
      [], [], [], [], [graded], [], [], EMPTY_LEDGER, CATALOGS,
    ));
    expect(parsed.consumption_logs[0].meal).toBe("Dinner");
    expect(parsed.consumption_logs[0].group_id).toBe("g1");
    expect(parsed.consumption_logs[0].food.tag_intensity).toEqual({ caffeine: 3 });
  });

  it("does not ship a grade for a tag the food no longer carries", () => {
    // A food restored from a backup written before the editor cleared grades on
    // toggle-off. The JSON must not hand a reader a caffeine grade for a food
    // that says caffeine: 0.
    const stale: FoodItem = { ...FOOD_COFFEE, tags: { caffeine: 0 }, tag_intensity: { caffeine: 3 } };
    const parsed = JSON.parse(buildJSON(
      [logWith({})], [], [], [], [], [stale], [], [], EMPTY_LEDGER, CATALOGS,
    ));
    expect(parsed.consumption_logs[0].food.tag_intensity).toBeUndefined();
  });
});
