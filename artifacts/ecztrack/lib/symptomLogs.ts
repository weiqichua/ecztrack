import { mergeScores, Phase, SymptomLog } from "@/constants/types";
import type { LogCell } from "./logCell";

/**
 * Folds one check-in onto the day's existing log, or creates it.
 *
 * Pure and total: it takes the logs it should build on as an argument rather
 * than closing over them, which is what lets the mutator call it from inside
 * a setState updater and stay correct when two taps land in one render.
 */
export function upsertSymptomLog(
  logs: SymptomLog[],
  log: Omit<SymptomLog, "id">,
  phase: Phase,
  newId: () => string,
): SymptomLog[] {
  // A symptom log is keyed by date alone — at most one per day.
  const existing = logs.find(l => l.date === log.date);
  const newLog: SymptomLog = {
    id: existing?.id ?? newId(), ...log, phase,
    // Merged, not replaced — see mergeScores. The screen only knows about
    // the symptoms it can show, so a plain overwrite loses the rest.
    scores: mergeScores(existing?.scores, log.scores),
  };
  return existing
    ? logs.map(l => (l.id === existing.id ? newLog : l))
    : [newLog, ...logs];
}

/**
 * The symptom-log cell — see lib/logCell.ts for why it exists and why the
 * provider must hold it in a ref. Re-exported here so a caller reaching for
 * symptom-log plumbing finds it in one place.
 */
export type { LogCell } from "./logCell";
export { createLogCell } from "./logCell";

/**
 * One check-in save, minus storage: folds the check-in onto the newest array,
 * publishes it, and returns the value the caller must persist.
 *
 * Returning it rather than letting the caller re-read state is the point — the
 * caller's `persist` needs a value that is correct *now*, not after the next
 * render.
 */
export function applyCheckin(
  cell: LogCell<SymptomLog>,
  log: Omit<SymptomLog, "id">,
  phase: Phase,
  newId: () => string,
): SymptomLog[] {
  const updated = upsertSymptomLog(cell.get(), log, phase, newId);
  cell.set(updated);
  return updated;
}
