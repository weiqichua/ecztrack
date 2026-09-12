/**
 * One-time storage migrations, gated by a stamped schema version.
 *
 * The app moved from seeded catalogs to fully user-created ones. A device
 * that already has check-in, food and urge history recorded against the old
 * seeded ids has no way to reconcile that history with the new model, and the
 * user explicitly chose to discard it rather than migrate it. This runs once
 * per device to make that discard happen, and never again.
 *
 * Habit definitions and habit logs are never touched here — they were already
 * user-created and nobody asked to reset them.
 */

/** The slice of AsyncStorage this needs — kept minimal so it is testable without mocking the module. */
export interface MigrationStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const SCHEMA_VERSION_KEY = "@health_tracker_schema_version";
/**
 * Exported so the backup layer stamps the same number into the cloud copy.
 * One numbering for local storage and for the backup — a second one would let
 * the two disagree about what "current" means.
 */
export const CURRENT_SCHEMA_VERSION = 4;

/**
 * Wipes `keysToWipe` if the stored version is absent or below 4, then stamps
 * the version so this never runs again on the same device.
 *
 * Idempotent by construction: the version check short-circuits a second run,
 * so calling this on every launch is safe and is how it is meant to be used.
 */
export async function runSchemaMigration(store: MigrationStore, keysToWipe: string[]): Promise<void> {
  const stored = await store.getItem(SCHEMA_VERSION_KEY);
  const version = stored ? Number(stored) : 0;
  if (version >= CURRENT_SCHEMA_VERSION) return;

  await Promise.all(keysToWipe.map(key => store.removeItem(key)));
  await store.setItem(SCHEMA_VERSION_KEY, String(CURRENT_SCHEMA_VERSION));
}
