/**
 * A day's symptom scores, reduced to one number.
 *
 * Extracted from the CSV exporter so the calendar shows the same figure the
 * export does. Two implementations of one average disagree eventually, and the
 * disagreement is invisible until someone compares a screen against a file.
 */

/**
 * The mean of the symptoms a day actually scored, or null if it scored none.
 *
 * Scores read 1 = no symptoms and 5 = severe, so a rising average is a
 * worsening trend. `null` means the box was shown and left unselected, and it
 * is skipped rather than counted: as a zero it would sit below the scale
 * entirely and manufacture an improvement.
 */
export function averageScore(scores: Record<string, number | null> | undefined): number | null {
  const values = Object.values(scores ?? {}).filter((v): v is number => v != null);
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
