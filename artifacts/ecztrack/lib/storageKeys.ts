/**
 * The AsyncStorage keys the app reads and writes, and the subset of them the
 * schema-4 migration is allowed to wipe.
 *
 * Kept in one module, separate from AppContext, so both the app and its
 * tests import the same values — a test that re-typed these as string
 * literals would prove nothing about what the app actually passes to the
 * migration.
 */
export const STORAGE_KEYS = {
  CONSUMPTION_LOGS: "@health_tracker_consumption_logs",
  SYMPTOM_LOGS: "@health_tracker_symptom_logs",
  SCRATCH_LOGS: "@health_tracker_scratch_logs",
  PHASE_LEDGER: "@health_tracker_phase_ledger",
  /**
   * The computed phase model the ledger replaced. Never read — it is here only
   * so the one-time wipe below can clear it, since a PhaseConfig parsed as a
   * PhaseLedger is garbage.
   */
  PHASE_CONFIG: "@health_tracker_phase_config",
  CUSTOM_FOODS: "@health_tracker_custom_foods",
  BODY_LOCATIONS: "@health_tracker_body_locations",
  CUES: "@health_tracker_cues",
  ROUTINES: "@health_tracker_routines",
  SYMPTOMS: "@health_tracker_symptoms",
  HABIT_DEFINITIONS: "@health_tracker_habit_definitions",
  HABIT_LOGS: "@health_tracker_habit_logs",
  LAST_BACKUP_AT: "@health_tracker_last_backup_at",
  FOOD_CATEGORIES: "@health_tracker_food_categories",
  FOOD_TAGS: "@health_tracker_food_tags",
  SKIN_PHOTOS: "@health_tracker_skin_photos",
  SUPPLEMENT_LOGS: "@health_tracker_supplement_logs",
  ACTIVITY_LOGS: "@health_tracker_activity_logs",
  SUPPLEMENTS: "@health_tracker_supplements",
  ACTIVITIES: "@health_tracker_activities",
  PRESET_GROUPS: "@health_tracker_preset_groups",
  DAILY_NOTES: "@health_tracker_daily_notes",
} as const;

/**
 * Stale history from the seeded-catalog era. Habit definitions and habit
 * logs are deliberately absent — they were already user-created and nobody
 * asked to reset them. The four catalog keys are absent for a different
 * reason: they are new, so no device has ever written seeded data under them.
 */
export const WIPE_STORAGE_KEYS: string[] = [
  STORAGE_KEYS.CONSUMPTION_LOGS,
  STORAGE_KEYS.SYMPTOM_LOGS,
  STORAGE_KEYS.SCRATCH_LOGS,
  STORAGE_KEYS.CUSTOM_FOODS,
  STORAGE_KEYS.PHASE_CONFIG,
];
