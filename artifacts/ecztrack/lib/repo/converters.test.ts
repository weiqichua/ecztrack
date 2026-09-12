import { describe, it, expect } from "vitest";
import {
  consumptionLogConverter, habitDefinitionConverter, habitLogConverter, customFoodConverter,
  symptomLogConverter, scratchLogConverter, catalogItemConverter, routineConverter,
} from "./converters";
import type { CatalogItem, RoutineItem } from "@/constants/catalog";
import type { ConsumptionLog, HabitDefinition, HabitLog, ScratchLog, SymptomLog } from "@/constants/types";
import type { FoodItem } from "@/constants/foods";

describe("consumptionLogConverter", () => {
  const log: ConsumptionLog = {
    id: "c1", timestamp: "2026-08-17T10:00:00.000Z", item_id: "EGG",
    phase: "elimination", is_accident: true,
  };

  it("omits the id from the document body", () => {
    expect(consumptionLogConverter.toDoc(log)).not.toHaveProperty("id");
  });

  it("round-trips without losing fields", () => {
    const doc = consumptionLogConverter.toDoc(log);
    expect(consumptionLogConverter.fromDoc("c1", doc)).toEqual(log);
  });
});

describe("habitDefinitionConverter", () => {
  it("round-trips an optional goal that is absent", () => {
    const def: HabitDefinition = {
      id: "h1", name: "Water", icon: "water", unit: "check",
      order: 0, isArchived: false, updated_at: "2026-08-17T10:00:00.000Z",
    };
    const doc = habitDefinitionConverter.toDoc(def);
    expect(habitDefinitionConverter.fromDoc("h1", doc)).toEqual(def);
  });

  it("never writes undefined, which firestore rejects", () => {
    const def: HabitDefinition = {
      id: "h1", name: "Water", icon: "water", unit: "check",
      order: 0, isArchived: false,
    };
    const doc = habitDefinitionConverter.toDoc(def);
    expect(Object.values(doc).every((v) => v !== undefined)).toBe(true);
  });
});

describe("habitLogConverter", () => {
  it("round-trips", () => {
    const log: HabitLog = { id: "h1_2026-08-17", habitId: "h1", date: "2026-08-17", value: 3 };
    const doc = habitLogConverter.toDoc(log);
    expect(habitLogConverter.fromDoc("h1_2026-08-17", doc)).toEqual(log);
  });
});

describe("customFoodConverter", () => {
  const food: FoodItem = {
    id: "f1", name: "Ramen", category: "Noodles",
    tags: {
      caffeine: 0, dairy: 0, soy: 1, oat: 0,
      high_sugar: 0, palm_oil: 0, gluten: 1,
      egg: 0, fried: 0, high_sodium: 1,
      high_fat: 0, spicy: 1, lye: 1,
    },
    is_elimination_safe: false,
    is_custom: true,
  };

  it("round-trips without losing fields", () => {
    const doc = customFoodConverter.toDoc(food);
    expect(customFoodConverter.fromDoc("f1", doc)).toEqual(food);
  });

  it("keeps an archived food archived through the round trip", () => {
    // Dropping the flag here silently returns a retired food to every picker
    // on the next restore.
    const archived: FoodItem = { ...food, isArchived: true };
    expect(customFoodConverter.fromDoc("f1", customFoodConverter.toDoc(archived)).isArchived).toBe(true);
  });

  it("does not let a stray id field in the document override the real document id", () => {
    const doc = customFoodConverter.toDoc(food);
    const tampered = { ...doc, id: "wrong-id" };
    expect(customFoodConverter.fromDoc("f1", tampered).id).toBe("f1");
  });

  it("carries a tag the app never shipped with", () => {
    const doc = { name: "Kimchi", category: "Vegetables", tags: { nightshade: 1 }, is_elimination_safe: false };
    expect(customFoodConverter.fromDoc("f1", doc).tags).toEqual({ nightshade: 1 });
  });
});

describe("symptomLogConverter", () => {
  const log: SymptomLog = {
    id: "s1", date: "2026-08-17", phase: "elimination",
    scores: { sym_itch: 4, sym_reflux: 2 },
  };

  it("round-trips the whole score map, whatever symptoms it holds", () => {
    // The map is keyed by user-created symptom ids, so the converter must not
    // name any of them — it did, back when the five were fixed fields.
    const doc = symptomLogConverter.toDoc(log);
    expect(symptomLogConverter.fromDoc("s1", doc)).toEqual(log);
  });

  it("reads a document with no scores as an empty map, not undefined", () => {
    expect(symptomLogConverter.fromDoc("s1", { date: "2026-08-17" }).scores).toEqual({});
  });
});

describe("scratchLogConverter", () => {
  const log: ScratchLog = {
    id: "u1", timestamp: "2026-08-17T10:00:00.000Z", phase: "elimination",
    location: "loc_1", cue: "cue_1", routine_id: "r_1", success: 3, is_accident: false,
  };

  it("round-trips", () => {
    expect(scratchLogConverter.fromDoc("u1", scratchLogConverter.toDoc(log))).toEqual(log);
  });

  it("round-trips a log with no competing routine", () => {
    // The routine is optional, and null must survive the trip as null rather
    // than becoming the string "null" or vanishing into undefined.
    const none: ScratchLog = { ...log, routine_id: null };
    expect(scratchLogConverter.fromDoc("u1", scratchLogConverter.toDoc(none))).toEqual(none);
  });

  it("reads a document missing routine_id as null", () => {
    const doc = { ...scratchLogConverter.toDoc(log) };
    delete doc.routine_id;
    expect(scratchLogConverter.fromDoc("u1", doc).routine_id).toBeNull();
  });
});

describe("catalogItemConverter", () => {
  const item: CatalogItem = { id: "loc_1", name: "Left elbow", order: 3, isArchived: false };

  it("omits the id from the document body", () => {
    expect(catalogItemConverter.toDoc(item)).not.toHaveProperty("id");
  });

  it("round-trips without losing fields", () => {
    const doc = catalogItemConverter.toDoc(item);
    expect(catalogItemConverter.fromDoc("loc_1", doc)).toEqual(item);
  });

  it("round-trips an edit timestamp, without which the recency merge cannot resolve", () => {
    const stamped: CatalogItem = { ...item, updated_at: "2026-08-17T10:00:00.000Z" };
    expect(catalogItemConverter.fromDoc("loc_1", catalogItemConverter.toDoc(stamped))).toEqual(stamped);
  });

  it("keeps an archived item archived through the round trip", () => {
    const archived: CatalogItem = { ...item, isArchived: true };
    expect(catalogItemConverter.fromDoc("loc_1", catalogItemConverter.toDoc(archived)).isArchived).toBe(true);
  });
});

describe("routineConverter", () => {
  const routine: RoutineItem = {
    id: "r_1", name: "Cold pack", order: 0, isArchived: false,
    description: "Hold against the itch for a minute",
  };

  it("round-trips the description", () => {
    expect(routineConverter.fromDoc("r_1", routineConverter.toDoc(routine))).toEqual(routine);
  });

  it("round-trips a routine with no description, leaving the key absent", () => {
    const bare: RoutineItem = { id: "r_1", name: "Cold pack", order: 0, isArchived: false };
    expect(routineConverter.fromDoc("r_1", routineConverter.toDoc(bare))).toEqual(bare);
  });
});
