import type {
  ConsumptionLog, SymptomLog, ScratchLog, DailyNote,
  HabitDefinition, HabitLog, Phase,
  SupplementLog, ActivityLog, ActivityIntensity,
  PresetGroup, PresetGroupType,
} from "@/constants/types";
import type { FoodItem, FoodTagMap } from "@/constants/foods";
import type { CatalogItem, RoutineItem } from "@/constants/catalog";

export interface Converter<T extends { id: string }> {
  toDoc(entity: T): Record<string, unknown>;
  fromDoc(id: string, data: Record<string, unknown>): T;
}

/** Firestore rejects `undefined` values outright — drop those keys. */
function defined(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

export const consumptionLogConverter: Converter<ConsumptionLog> = {
  toDoc: ({ id, ...rest }) => defined({ ...rest }),
  fromDoc: (id, d) => ({
    id,
    timestamp: d.timestamp as string,
    item_id: d.item_id as string,
    phase: d.phase as Phase,
    is_accident: Boolean(d.is_accident),
    // Not Boolean()-ed or defaulted: an absent portion must stay absent, or a
    // log written before portions existed would come back claiming a size.
    portion: d.portion as ConsumptionLog["portion"],
    // Absent stays absent, exactly like portion: a log written before meals
    // existed must not come back claiming a group.
    group_id: d.group_id as string | undefined,
    meal: d.meal as string | undefined,
  }),
};

export const symptomLogConverter: Converter<SymptomLog> = {
  toDoc: ({ id, ...rest }) => defined({ ...rest }),
  fromDoc: (id, d) => ({
    id,
    date: d.date as string,
    phase: d.phase as Phase | undefined,
    // The keys are user-created symptom ids, so nothing here may name them.
    // A document written before the user had any symptoms has no map at all.
    scores: (d.scores as Record<string, number | null> | undefined) ?? {},
  }),
};

export const supplementLogConverter: Converter<SupplementLog> = {
  toDoc: ({ id, ...rest }) => defined({ ...rest }),
  fromDoc: (id, d) => ({
    id,
    timestamp: d.timestamp as string,
    item_id: d.item_id as string,
    phase: d.phase as Phase,
  }),
};

export const activityLogConverter: Converter<ActivityLog> = {
  toDoc: ({ id, ...rest }) => defined({ ...rest }),
  fromDoc: (id, d) => ({
    id,
    timestamp: d.timestamp as string,
    item_id: d.item_id as string,
    phase: d.phase as Phase,
    intensity: d.intensity as ActivityIntensity,
  }),
};

export const scratchLogConverter: Converter<ScratchLog> = {
  toDoc: ({ id, ...rest }) => defined({ ...rest }),
  fromDoc: (id, d) => ({
    id,
    timestamp: d.timestamp as string,
    phase: d.phase as Phase,
    location: d.location as string,
    cue: d.cue as string,
    // `defined()` strips undefined but keeps null, so an explicit "no routine"
    // survives the round trip. The coalesce covers a document that is missing
    // the key altogether — a half-written push, not a shape we produce.
    routine_id: (d.routine_id as string | null) ?? null,
    success: d.success as 1 | 2 | 3 | 4,
    is_accident: Boolean(d.is_accident),
  }),
};

export const habitDefinitionConverter: Converter<HabitDefinition> = {
  toDoc: ({ id, ...rest }) => defined({ ...rest }),
  fromDoc: (id, d) => {
    const def: HabitDefinition = {
      id,
      name: d.name as string,
      icon: d.icon as string,
      unit: d.unit as "check" | "count",
      order: (d.order as number) ?? 0,
      isArchived: Boolean(d.isArchived),
    };
    if (d.goal !== undefined) def.goal = d.goal as number;
    if (d.updated_at !== undefined) def.updated_at = d.updated_at as string;
    return def;
  },
};

export const habitLogConverter: Converter<HabitLog> = {
  toDoc: ({ id, ...rest }) => defined({ ...rest }),
  fromDoc: (id, d) => ({
    id,
    habitId: d.habitId as string,
    date: d.date as string,
    value: d.value as number,
  }),
};

export const customFoodConverter: Converter<FoodItem> = {
  toDoc: ({ id, ...rest }) => defined({ ...rest }),
  fromDoc: (id, d) => {
    const item: FoodItem = {
      id,
      name: d.name as string,
      category: d.category as string,
      // The keys are catalog-defined tag ids, so nothing here may name them.
      // A document written before the user had any tags has no map at all.
      tags: (d.tags as FoodTagMap | undefined) ?? {},
      is_elimination_safe: Boolean(d.is_elimination_safe),
    };
    if (d.is_custom !== undefined) item.is_custom = Boolean(d.is_custom);
    // Only when present: absent means active, and writing `false` here would
    // be indistinguishable from a deliberate un-archive on the other device.
    if (d.isArchived !== undefined) item.isArchived = Boolean(d.isArchived);
    if (d.updated_at !== undefined) item.updated_at = d.updated_at as string;
    if (d.tag_intensity !== undefined) {
      item.tag_intensity = d.tag_intensity as FoodItem["tag_intensity"];
    }
    return item;
  },
};

/**
 * The catalogs that need nothing beyond a name, an order and a flag.
 *
 * `isArchived` is required on a `CatalogItem`, so it is always written and
 * always read back — unlike a food's, which predates the field.
 */
export const catalogItemConverter: Converter<CatalogItem> = {
  toDoc: ({ id, ...rest }) => defined({ ...rest }),
  fromDoc: (id, d) => {
    const item: CatalogItem = {
      id,
      name: d.name as string,
      order: (d.order as number) ?? 0,
      isArchived: Boolean(d.isArchived),
    };
    if (d.updated_at !== undefined) item.updated_at = d.updated_at as string;
    // Only `foodTag` carries one, and only sometimes: read it back when it is
    // there rather than defaulting, so a restored tag keeps the chip icon the
    // user picked and a tag without one stays without one.
    if (d.icon !== undefined) item.icon = d.icon as string;
    return item;
  },
};

/** Competing routines — a catalog item plus the optional description. */
export const routineConverter: Converter<RoutineItem> = {
  toDoc: ({ id, ...rest }) => defined({ ...rest }),
  fromDoc: (id, d) => {
    const item: RoutineItem = catalogItemConverter.fromDoc(id, d);
    if (d.description !== undefined) item.description = d.description as string;
    return item;
  },
};

export const presetGroupConverter: Converter<PresetGroup> = {
  toDoc: ({ id, ...rest }) => defined({ ...rest }),
  fromDoc: (id, d) => ({
    id,
    name: d.name as string,
    type: d.type as PresetGroupType,
    item_ids: (d.item_ids as string[]) || [],
    isArchived: !!d.isArchived,
  }),
};

export const dailyNoteConverter: Converter<DailyNote> = {
  toDoc: ({ id, ...rest }) => defined({ ...rest }),
  fromDoc: (id, d) => ({
    id,
    date: d.date as string,
    text: d.text as string,
  }),
};
