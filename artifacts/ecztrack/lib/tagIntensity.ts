/**
 * How much of a tag a food carries.
 *
 * `tags` says whether coffee contains caffeine. This says how much, so that a
 * dose can be computed as intensity × the log's portion — without it, coffee
 * and tea are the same row and a real difference in exposure is invisible to
 * any per-tag analysis.
 *
 * Ungraded is absent, never a stored 2. A stored default would be
 * indistinguishable from a deliberate "Average" forever after, and the export
 * could not tell the reader which foods carry a real judgement.
 */
import type { FoodItem } from "@/constants/foods";

export type TagIntensity = 1 | 2 | 3;

/** What an ungraded tag counts as. */
export const DEFAULT_INTENSITY: TagIntensity = 2;

export const INTENSITY_LABELS: Record<TagIntensity, string> = {
  1: "Low", 2: "Average", 3: "High",
};

function valid(v: unknown): v is TagIntensity {
  return v === 1 || v === 2 || v === 3;
}

/**
 * The grade the user actually gave, or null.
 *
 * The distinction this preserves is the reason the field is optional: an
 * analysis needs to know which foods were graded before it trusts a dose.
 */
export function gradedIntensity(food: FoodItem, tagId: string): TagIntensity | null {
  const v = food.tag_intensity?.[tagId];
  return valid(v) ? v : null;
}

/**
 * The grade to compute with: the stored one, or Average.
 *
 * Validates rather than trusting the stored value. Nothing in this app writes
 * anything but 1-3, but a document synced from another version might, and an
 * out-of-range number would multiply straight into a dose without complaint.
 */
export function intensityOf(food: FoodItem, tagId: string): TagIntensity {
  return gradedIntensity(food, tagId) ?? DEFAULT_INTENSITY;
}

/**
 * The grades for the tags this food actually carries.
 *
 * The editor clears a grade when its tag is switched off, so in practice a
 * stale entry should not exist. This is the second line: a food restored from
 * a backup, synced from another device, or written by a version that did not
 * clear could still hold one, and an export is where a stale grade does real
 * damage — a reader that takes `food.tag_intensity["caffeine"]` without first
 * checking `tags["caffeine"]` would see a caffeine grade on a food declared
 * caffeine-free, and no amount of care in the analysis notebook can recover
 * from a file that already says the wrong thing.
 *
 * Returns undefined rather than `{}` when nothing survives, so the caller can
 * leave the key off entirely instead of exporting an empty object that reads
 * as "graded nothing" rather than "never graded".
 */
export function carriedIntensities(food: FoodItem): Record<string, TagIntensity> | undefined {
  const out: Record<string, TagIntensity> = {};
  for (const tagId of Object.keys(food.tag_intensity ?? {})) {
    // `=== 1`, never a truthiness test: a stored 0 means "explicitly not this
    // tag", and treating it as carried is the same inversion that would make
    // every tag undeletable in `isItemReferenced`.
    if (food.tags?.[tagId] !== 1) continue;
    const g = gradedIntensity(food, tagId);
    if (g !== null) out[tagId] = g;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
