/**
 * The export screen's CSV and JSON builders.
 *
 * Pure and free of react-native, so they can be tested: they used to sit inside
 * `app/(tabs)/export.tsx`, which pulls in react-native-svg and cannot be loaded
 * under vitest's node environment — and a test file under `app/` is not an
 * option either, since expo-router bundles every file there and pulling vitest
 * into the web bundle breaks the build.
 */
import { localDateKey, startOfLocalDay } from "@/lib/dates";
import { activeItems, itemName, type CatalogItem, type RoutineItem } from "@/constants/catalog";
import { isRecordedCheckin } from "@/lib/dayStyle";
import { CURRENT_SCHEMA_VERSION } from "@/lib/migrations";
import { averageScore } from "@/lib/symptomStats";
import {
  SUCCESS_LABELS,
  type ConsumptionLog,
  type HabitDefinition,
  type HabitLog,
  type PhaseLedger,
  type ScratchLog,
  type SymptomLog,
  type SupplementLog,
  type ActivityLog,
} from "@/constants/types";
import type { FoodItem } from "@/constants/foods";
import { carriedIntensities, gradedIntensity } from "@/lib/tagIntensity";

// ── CSV helpers ─────────────────────────────────────────────────────────────

export function escapeCSV(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function row(...cells: (string | number | boolean | null | undefined)[]): string {
  return cells.map(escapeCSV).join(",");
}

/**
 * A nominal instant for a check-in, which stores only a local date.
 *
 * Anchored at LOCAL NOON: the timestamp has to agree with the `date` column
 * beside it, and noon is the only hour no timezone offset can push onto the
 * adjacent local day. Midnight is one offset away from crossing.
 */
export function nominalCheckinTimestamp(date: string): string {
  const at = startOfLocalDay(date);
  at.setHours(12, 0, 0, 0);
  return at.toISOString();
}

// ── Build CSV strings ────────────────────────────────────────────────────────

export function buildConsumptionCSV(
  consumptionLogs: ConsumptionLog[],
  allFoods: FoodItem[],
  foodTags: CatalogItem[],
): string {
  // Resolved ONCE, and both the header and every row are built from this one
  // array. Two lists would drift the moment the user adds a tag, and the
  // failure is silent: every column shifts by one and each value lands under
  // the wrong heading.
  //
  // Archived tags are left out for the same reason the pickers leave them out:
  // a retired tag is not part of the vocabulary any more, and a column of
  // zeroes for it is noise in the sheet.
  const tagColumns = activeItems(foodTags);
  const header = row(
    "log_id", "timestamp_iso", "timestamp_unix_ms", "date", "time_local",
    "phase", "food_id", "food_name", "category",
    "is_elimination_safe", "is_accident", "portion", "meal_id", "meal_name",
    ...tagColumns.flatMap(t => [`tag_${t.id}`, `tag_${t.id}_intensity`]),
  );
  const lines = consumptionLogs.map(l => {
    const d = new Date(l.timestamp);
    const food = allFoods.find(f => f.id === l.item_id);
    const tags = food?.tags;
    return row(
      l.id, l.timestamp, d.getTime(),
      localDateKey(l.timestamp),
      d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }),
      l.phase,
      l.item_id,
      food?.name ?? "UNKNOWN",
      food?.category ?? "",
      food?.is_elimination_safe ?? "",
      l.is_accident,
      // Empty for a log with no portion recorded — distinct from any size.
      l.portion ?? "",
      // Blank for a log written before meals existed. One row per food either
      // way — grouping is a display fact, and nothing about the analysis
      // changes because two rows share an id.
      l.group_id ?? "",
      l.meal ?? "",
      // The binary flag, then the grade — 1-3 where the user set one, blank
      // where they did not and blank where the food does not carry the tag at
      // all. Deliberately NOT the default 2: a written default is a judgement
      // the user never made, and the reader could never tell the two apart.
      // Anything consuming this should read `dose = (intensity or 2) × portion`
      // and check how much of the column is filled before trusting it.
      ...tagColumns.flatMap(t => {
        const carried = tags?.[t.id] ?? 0;
        const graded = food && carried === 1 ? gradedIntensity(food, t.id) : null;
        return [carried, graded ?? ""];
      }),
    );
  });
  return [header, ...lines].join("\n");
}

export function buildSymptomCSV(
  symptomLogs: SymptomLog[],
  symptoms: CatalogItem[],
): string {
  // A day whose every score is null holds no check-in — the user tapped a box
  // and tapped it off again. Emitting a row for it would be a phantom day of
  // data in the export.
  const recorded = symptomLogs.filter(isRecordedCheckin);
  // One column per symptom actually present in the data, in first-seen order.
  // Symptoms are user-created, so any fixed header would silently drop the ones
  // this user added. `?? {}` guards a log whose stored map is malformed.
  const symptomIds: string[] = [];
  for (const l of recorded) {
    for (const id of Object.keys(l.scores ?? {})) if (!symptomIds.includes(id)) symptomIds.push(id);
  }
  // Headed by name, for a human opening the sheet. `itemName` returns the id
  // unchanged when the symptom is gone from the catalog, which is the right
  // fallback: an unreadable heading beats a blank one, and two purged symptoms
  // would otherwise produce two identical empty columns.
  //
  // The id is not lost — the JSON export carries the whole `symptoms` catalog,
  // and that is the file an analysis actually loads. This one is for reading.
  const symptomColumns = symptomIds.map(id => itemName(symptoms, id));
  const header = row(
    "log_id", "date", "timestamp_iso",
    "phase",
    ...symptomColumns, "symptom_avg",
  );
  const lines = recorded.map(l => {
    // Averaged over the symptoms this log actually scored — neither a symptom
    // predating this log nor one shown and left unrecorded drags it down.
    // Scores read 1 = no symptoms, 5 = severe, so a RISING average is a
    // worsening trend, not an improving one. `averageScore` is the one
    // definition of this average, shared with the calendar.
    const scores = l.scores ?? {};
    const avg = averageScore(scores);
    const avgCell = avg === null ? "" : avg.toFixed(3);
    return row(
      l.id, l.date, nominalCheckinTimestamp(l.date),
      l.phase ?? "",
      ...symptomIds.map(id => scores[id] ?? ""), avgCell,
    );
  });
  return [header, ...lines].join("\n");
}

export function buildUrgeCSV(
  scratchLogs: ScratchLog[],
  bodyLocations: CatalogItem[],
  cues: CatalogItem[],
  routines: RoutineItem[],
): string {
  const header = row(
    "log_id", "timestamp_iso", "timestamp_unix_ms", "date", "time_local",
    "phase", "location_id", "location_name", "cue_id", "cue_name",
    "routine_id", "routine_name",
    "success_score", "success_label",
    "is_accident",
  );
  const lines = scratchLogs.map(l => {
    const d = new Date(l.timestamp);

    return row(
      l.id, l.timestamp, d.getTime(),
      localDateKey(l.timestamp),
      d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }),
      l.phase ?? "",
      l.location, itemName(bodyLocations, l.location),
      l.cue, itemName(cues, l.cue),
      l.routine_id ?? "", itemName(routines, l.routine_id),
      l.success, SUCCESS_LABELS[l.success] ?? "",
      l.is_accident,
    );
  });
  return [header, ...lines].join("\n");
}

export function buildSupplementCSV(
  supplementLogs: SupplementLog[],
  supplements: CatalogItem[],
): string {
  const header = row(
    "log_id", "timestamp_iso", "timestamp_unix_ms", "date", "time_local",
    "phase", "supplement_id", "supplement_name"
  );
  const lines = supplementLogs.map(l => {
    const d = new Date(l.timestamp);
    return row(
      l.id, l.timestamp, d.getTime(),
      localDateKey(l.timestamp),
      d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }),
      l.phase,
      l.item_id, itemName(supplements, l.item_id),
    );
  });
  return [header, ...lines].join("\n");
}

export function buildActivityCSV(
  activityLogs: ActivityLog[],
  activities: CatalogItem[],
): string {
  const header = row(
    "log_id", "timestamp_iso", "timestamp_unix_ms", "date", "time_local",
    "phase", "activity_id", "activity_name", "intensity"
  );
  const lines = activityLogs.map(l => {
    const d = new Date(l.timestamp);
    return row(
      l.id, l.timestamp, d.getTime(),
      localDateKey(l.timestamp),
      d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }),
      l.phase,
      l.item_id, itemName(activities, l.item_id),
      l.intensity
    );
  });
  return [header, ...lines].join("\n");
}

export function buildHabitsCSV(
  habitLogs: HabitLog[],
  habitDefinitions: HabitDefinition[],
): string {
  const header = row(
    "log_id", "date",
    "habit_id", "habit_name", "habit_unit", "habit_goal",
    "value", "goal_met",
  );
  const lines = habitLogs.map(l => {
    const def = habitDefinitions.find(d => d.id === l.habitId);
    const goal = def?.goal ?? 1;
    const goalMet = def?.unit === "count" ? l.value >= goal : l.value > 0;
    return row(
      l.id, l.date,
      l.habitId, def?.name ?? "UNKNOWN",
      def?.unit ?? "", goal,
      l.value, goalMet,
    );
  });
  return [header, ...lines].join("\n");
}

/** The user-created catalogs a log's ids are resolved against. */
export interface ExportCatalogs {
  symptoms: CatalogItem[];
  bodyLocations: CatalogItem[];
  cues: CatalogItem[];
  routines: RoutineItem[];
  /**
   * The two the foods themselves reference. A food carries a category id and
   * a map keyed by tag id, so without these the file describes every food by
   * ids it never defines.
   */
  foodCategories: CatalogItem[];
  foodTags: CatalogItem[];
  supplements: CatalogItem[];
  activities: CatalogItem[];
}

export function buildJSON(
  consumptionLogs: ConsumptionLog[],
  supplementLogs: SupplementLog[],
  activityLogs: ActivityLog[],
  symptomLogs: SymptomLog[],
  scratchLogs: ScratchLog[],
  allFoods: FoodItem[],
  habitLogs: HabitLog[],
  habitDefinitions: HabitDefinition[],
  ledger: PhaseLedger,
  catalogs: ExportCatalogs,
) {
  // The logs carry only an instant, and the app files them by LOCAL day. A
  // reader taking `timestamp.slice(0, 10)` gets the UTC day, which disagrees
  // for part of every 24 hours — at UTC+8 everything before 08:00 lands on the
  // wrong day. Stating the filed day removes the guess.
  const withLocalDay = <T extends { timestamp: string }>(l: T) => ({
    ...l, date: localDateKey(l.timestamp),
  });

  return JSON.stringify({
    exported_at: new Date().toISOString(),
    // One number for storage, the backup and this file. It previously said
    // "3.1" while storage was at 4 and the Export screen claimed 3.0.
    schema_version: CURRENT_SCHEMA_VERSION,
    /**
     * Which end of the symptom scale is bad.
     *
     * The scale was inverted on 2026-08-24 — it used to read 1 = severe. Two
     * exports either side of that are identical in shape and opposite in
     * meaning, so the file has to say which it is. Self-describing rather than
     * implied by the version, because whoever reads this in a year will not
     * have the changelog.
     */
    symptom_scale: { min: 1, max: 5, direction: "higher_is_worse" },
    // Included since 3.1: this file is the offline disaster-recovery copy, and
    // without the phase ledger every log's `phase` field is unreproducible.
    phase_ledger: ledger,
    // Every log references catalog items by id. Without these the file holds
    // no names at all and cannot be read on its own.
    symptoms: catalogs.symptoms,
    body_locations: catalogs.bodyLocations,
    cues: catalogs.cues,
    routines: catalogs.routines,
    food_categories: catalogs.foodCategories,
    food_tags: catalogs.foodTags,
    supplements: catalogs.supplements,
    activities: catalogs.activities,
    consumption_logs: consumptionLogs.map(l => {
      const food = allFoods.find(f => f.id === l.item_id) ?? null;
      return {
        ...withLocalDay(l),
        // Grades are pruned to the tags the food actually carries. Not
        // cosmetic: a stale grade in this file is wrong in a way no care in
        // the analysis can undo, because the file already says it.
        food: food ? { ...food, tag_intensity: carriedIntensities(food) } : null,
      };
    }),
    supplement_logs: supplementLogs.map(withLocalDay),
    activity_logs: activityLogs.map(withLocalDay),
    symptom_logs: symptomLogs,
    urge_logs: scratchLogs.map(withLocalDay),
    habit_definitions: habitDefinitions,
    habit_logs: habitLogs,
  }, null, 2);
}
