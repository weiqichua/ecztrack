/**
 * A month, one row per day.
 *
 * Pure and clock-injected, like lib/phases.ts: the caller passes today, so the
 * answer for a given month cannot change depending on when it is asked.
 *
 * Every day appears, including days with nothing on them. A run of blanks is
 * itself a finding — it says the check-ins stopped — and a list that omits
 * them makes three skipped days indistinguishable from three consecutive ones.
 */
import type { SkinPhoto, SymptomLog } from "@/constants/types";
import { averageScore } from "./symptomStats";
import { latestPhotoOnDate } from "./skinPhotos";

export interface MonthDayRow {
  /** `YYYY-MM-DD`. */
  dateKey: string;
  /** Day of the month, 1-based. */
  day: number;
  /** 0 = Sunday, matching the calendar grid's week order. */
  weekday: number;
  /** The day's mean symptom score, or null if it recorded none. */
  average: number | null;
  /** The day's most recent photo, or null. */
  photo: SkinPhoto | null;
  isFuture: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * `month` is 0-based, matching `Date.getMonth()` and the calendar screen.
 *
 * Day count comes from `new Date(year, month + 1, 0).getDate()`, which is the
 * last day of the month and therefore correct for February in a leap year
 * without anyone hard-coding the rule.
 */
export function monthRows(
  year: number,
  month: number,
  symptomLogs: SymptomLog[],
  photos: SkinPhoto[],
  todayKey: string,
): MonthDayRow[] {
  const days = new Date(year, month + 1, 0).getDate();
  const rows: MonthDayRow[] = [];
  for (let day = 1; day <= days; day++) {
    const dateKey = `${year}-${pad(month + 1)}-${pad(day)}`;
    const log = symptomLogs.find(l => l.date === dateKey);
    rows.push({
      dateKey,
      day,
      weekday: new Date(year, month, day).getDay(),
      // averageScore already returns null when every score is null, which is
      // what an emptied check-in leaves behind.
      average: averageScore(log?.scores),
      photo: latestPhotoOnDate(photos, dateKey),
      // Date keys are YYYY-MM-DD, so a string comparison is a date comparison.
      isFuture: dateKey > todayKey,
    });
  }
  return rows;
}
