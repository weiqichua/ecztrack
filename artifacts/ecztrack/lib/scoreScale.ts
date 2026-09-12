/**
 * How to read a symptom score.
 *
 * **1 is best, 5 is worst.** A high number means the symptom was severe; a low
 * one means it was mild or absent. The app originally ran the other way round —
 * `1 = severe` — and every colour, bar and average was built on that, so this
 * module exists to state the direction once and let the views agree by
 * construction rather than by each remembering.
 *
 * Only the LEVEL lives here, not the colour: the check-in boxes use fixed hex
 * values and the calendar's bars use theme tokens, and unifying those is a
 * palette decision this does not need to make. What matters is that both ask
 * the same question and get the same answer.
 */
export type ScoreLevel = "good" | "warn" | "bad";

export function scoreLevel(value: number): ScoreLevel {
  if (value <= 2) return "good";
  if (value === 3) return "warn";
  return "bad";
}

/**
 * How far along the severity scale a score sits, 0 to 1.
 *
 * 1 scores 0 and 5 scores 1, so a fuller bar is a worse day. The calendar drew
 * this as a *health* fraction before the flip, which is why the reading is
 * spelled out: the number and the bar must not tell opposite stories.
 */
export function severityFraction(value: number): number {
  return (value - 1) / 4;
}
