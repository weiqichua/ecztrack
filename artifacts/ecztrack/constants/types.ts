/**
 * The phase a given day belongs to.
 *
 * `"none"` is a real, defined state: the day is blank because no phase was
 * running. It is deliberately a string rather than a nullable `Phase` — a day
 * with no phase is a fact the ledger records, not a value it is missing, and
 * making it nullable pushed that distinction into every reader.
 */
export type Phase = "none" | "elimination" | "challenge";

/**
 * One run of a phase.
 *
 * A discriminated union rather than one shape with optional fields: a challenge
 * without its label is the record the analysis cannot use, so it is a compile
 * error rather than a blank chip.
 */
export type PhaseSpan =
  | { id: string; kind: "elimination"; startDate: string; what: string; plannedDays: number; endedOn: string | null }
  | { id: string; kind: "challenge";   startDate: string; what: string;        endedOn: string | null };

/**
 * Every phase ever run.
 *
 * This replaced a `Record<dateKey, Phase>` plus a single elimination record.
 * The map could not hold a challenge's label, and once challenges became a list
 * the two were duplicate representations of one history that had to agree.
 */
export interface PhaseLedger {
  /** In start order. An open span has `endedOn: null`. */
  spans: PhaseSpan[];
}

/** One food consumption event — core unit for ML feature engineering. */
/**
 * How much of the food was eaten.
 *
 * Coarse on purpose: three taps' worth of precision is what gets recorded
 * consistently, and grams that go unlogged are worth less than a rough size
 * that does. Reactions are usually dose-dependent, so without this a trace of
 * dairy in coffee and a bowl of ice cream are the same row — and the many small
 * exposures dilute the few large ones until nothing shows.
 */
export type Portion = "small" | "medium" | "large";

export interface ConsumptionLog {
  id: string;
  /** Full ISO-8601 timestamp, e.g. "2026-04-05T14:32:00.000Z" */
  timestamp: string;
  /** `FoodItem.id` of the food eaten — never its name, so a rename keeps history intact. */
  item_id: string;
  phase: Phase;
  /** True if the food was eaten accidentally (e.g. unintended trigger exposure) */
  is_accident: boolean;
  /**
   * How much was eaten, when the user said. Absent means unrecorded — never
   * defaulted to "medium", because a default would be confidently wrong on most
   * rows and an analysis could not tell a real medium from a guess.
   */
  portion?: Portion;
  /**
   * The save this log came in with. Every food selected in one Save shares
   * one id, and that id — not a shared timestamp — is what makes them one
   * meal: two saves a few seconds apart are two meals, not one.
   *
   * Absent on every log written before meals existed. Such a log stands alone,
   * which is exactly how it was displayed at the time.
   */
  group_id?: string;
  /**
   * What the meal is called. Defaults to "Meal" at save time and is renamable
   * afterwards. Stored on each log of the group rather than in a side table:
   * one string per row keeps every log self-describing and removes a second
   * representation that deletes, sync and the backup merge would all have to
   * keep in step.
   */
  meal?: string;
}

export interface SupplementLog {
  id: string;
  /** Full ISO-8601 timestamp */
  timestamp: string;
  /** `CatalogItem.id` of the supplement taken */
  item_id: string;
  phase: Phase;
}

export type ActivityIntensity = "light" | "moderate" | "vigorous";

export interface ActivityLog {
  id: string;
  /** Full ISO-8601 timestamp */
  timestamp: string;
  /** `CatalogItem.id` of the activity */
  item_id: string;
  phase: Phase;
  intensity?: ActivityIntensity;
}


export type PresetGroupType = "food" | "supplement";

export interface PresetGroup {
  id: string;
  name: string;
  type: PresetGroupType;
  /** `FoodItem.id` or `CatalogItem.id` (supplement) */
  item_ids: string[];
  isArchived?: boolean;
}

export interface DailyNote {
  id: string;
  date: string;
  text: string;
}

/** One check-in per day. */
export interface SymptomLog {
  id: string;
  /** YYYY-MM-DD date key in the user's local calendar */
  date: string;
  phase?: Phase;
  /**
   * Score per symptom, keyed by `CatalogItem.id`. 1–5, HIGH = severe:
   * 1 means no symptoms, 5 means as bad as it gets. See lib/scoreScale.ts.
   * `null` means the user was shown the box and left it unselected —
   * distinct from a key being absent, which means this log never offered
   * that symptom (e.g. it postdates the log, or was archived since).
   */
  scores: Record<string, number | null>;
}

/**
 * Folds a check-in's new scores onto the ones already stored.
 *
 * Saving a check-in overwrites the day's log in place, and the check-in UI
 * can only offer the symptoms currently in the catalog. Assigning the new
 * map straight over the old one would therefore delete the score for every
 * symptom the user has since archived — quietly, and again on each re-save.
 *
 * A key present in `incoming` always wins, including an explicit `null`
 * (the user un-selected that box just now). A key `incoming` omits keeps
 * whatever `existing` had — that is how an archived symptom's score
 * survives a re-save it was never shown in.
 *
 * Tolerates a missing or malformed stored map: a screen must not go down
 * because of what is on disk.
 */
export function mergeScores(
  existing: Record<string, number | null> | undefined,
  incoming: Record<string, number | null>,
): Record<string, number | null> {
  const base = existing && typeof existing === "object" ? existing : {};
  return { ...base, ...incoming };
}

/** One scratch / habit-reversal event. */
export interface ScratchLog {
  id: string;
  /** Full ISO-8601 timestamp */
  timestamp: string;
  phase: Phase;
  /** `CatalogItem.id`, not the display name — a rename must not orphan history. */
  location: string;
  /** `CatalogItem.id`, not the display name. */
  cue: string;
  /** `RoutineItem.id`, or null when no competing routine was used. */
  routine_id: string | null;
  /** 1 = scratched, 2 = partial, 3 = mostly resisted, 4 = fully resisted */
  success: 1 | 2 | 3 | 4;
  /** True if the scratch event was an unintended/involuntary accident */
  is_accident: boolean;
}

export const SUCCESS_LABELS: Record<number, string> = {
  1: "Scratched anyway",
  2: "Partially resisted",
  3: "Mostly resisted",
  4: "Fully resisted",
};

/** A user-defined daily habit to track */
export interface HabitDefinition {
  id: string;
  name: string;
  /** MaterialCommunityIcons icon name */
  icon: string;
  /** check = binary done/not-done; count = numeric how-many-times */
  unit: "check" | "count";
  /** Target count per day — only meaningful when unit === "count" */
  goal?: number;
  /** Display order index */
  order: number;
  /**
   * Reserved, and never true: no path writes it, because deleting a habit
   * deletes its logs with it and so strands no history to hide. The habits
   * screen does read it — it filters through `activeItems` — so a value
   * arriving from elsewhere would hide the habit, which is why the field is
   * kept rather than removed: habit definitions travel to the backup and
   * back, and a field already on disk in users' backups should not vanish
   * under them. Do not read it as evidence that anything archives a habit.
   */
  isArchived: boolean;
  /** ISO timestamp of last local edit — used for last-write-wins sync */
  updated_at?: string;
}

/** One day's record for a single habit */
export interface HabitLog {
  id: string;
  habitId: string;
  /** YYYY-MM-DD date key in the user's local calendar */
  date: string;
  /** 1 for check type; actual count for count type */
  value: number;
}

/** Curated icon set for habit definitions */
export const HABIT_ICONS: string[] = [
  "book-open-variant",
  "dumbbell",
  "run",
  "meditation",
  "water",
  "pill",
  "weather-night",
  "pencil",
  "music-note",
  "food-apple",
  "walk",
  "bicycle",
  "heart-pulse",
  "brain",
  "leaf",
  "coffee-off",
  "phone-off",
  "shower",
  "weather-sunny",
  "star",
  "yoga",
  "hand-heart",
  "flask-outline",
  "sleep",
];

export { formatShortDate } from "@/lib/dates";

/**
 * One photograph of skin, filed against a local day.
 *
 * The image itself is a file on this device; this is only the record that
 * describes it. Neither is in the Firebase backup — see the design doc. A
 * photo exists on exactly one phone until it is exported.
 */
export interface SkinPhoto {
  id: string;
  /**
   * The local day the photo belongs to, `YYYY-MM-DD`.
   *
   * Stored rather than derived from `takenAt` for the reason the consumption
   * CSV carries its own `date`: the instant belongs to a UTC day, the app
   * files by local day, and the two disagree for part of every 24 hours.
   */
  date: string;
  /**
   * The file's NAME inside the skin directory — never a full path.
   *
   * On iOS the documents directory contains a UUID that is regenerated when
   * the app is reinstalled or restored, so a stored absolute path points at
   * nothing afterwards and the entire library breaks at once.
   */
  file: string;
  /** ISO timestamp the photo was taken or imported. */
  takenAt: string;
  /**
   * `CatalogItem.id` from the body-locations catalog. Absent means untagged,
   * which is always allowed — the field is for following one area over time,
   * not for making tagging a chore.
   */
  location?: string;
}
