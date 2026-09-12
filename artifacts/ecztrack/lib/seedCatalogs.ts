import type { CatalogItem } from "@/constants/catalog";

/**
 * What a catalog should hold at startup, given its raw AsyncStorage value.
 *
 * `null` means the key has never been written, which is the only case that
 * seeds. A stored `"[]"` is a user who deleted everything, and must stay empty
 * — this is why the check is not `!stored.length`.
 *
 * Deliberately NOT driven by the schema version: `runSchemaMigration` wipes the
 * user's logs and custom foods when the version rises, so triggering seeding
 * that way would trade a seeded list for deleted history.
 */
export function seedIfUnwritten(raw: string | null, seed: CatalogItem[]): CatalogItem[] {
  if (raw === null) return seed;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : seed;
  } catch {
    return seed;
  }
}
