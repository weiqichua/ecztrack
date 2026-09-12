/**
 * Last-write-wins for editable records.
 *
 * Logs are append-only with unique ids, so a given id always has the same
 * content and there is nothing to resolve. **Editable** records — foods, habit
 * definitions, catalog items — are different: the same id holds different
 * content on two devices, and without a timestamp the merge cannot tell which
 * one is newer. It then falls back to local-wins, and whichever phone happens
 * to be in your hand imposes its version on the other.
 *
 * That is a real data-loss path, not a theoretical one: edit a food on the
 * second phone, press Upload on the main phone, and the newer edit is gone for
 * good, because the cloud is the only other copy. Restoring first does not
 * rescue it, because local also wins on the way down.
 *
 * The two halves must be used together. `stamp` on every write; `mergeByRecency`
 * on every restore. A record written without a timestamp is the bug this exists
 * to fix, so a missing stamp is a defect rather than a default.
 */

/** Marks a record as edited now. Call this from every create and every edit. */
export function stamp<T extends { updated_at?: string }>(item: T): T {
  return { ...item, updated_at: new Date().toISOString() };
}

/**
 * Unions two lists of editable records by id, newest wins.
 *
 * Remote wins ONLY when both sides carry a timestamp and remote's is strictly
 * newer. Comparing `(r.updated_at ?? "") > (l.updated_at ?? "")` looks
 * equivalent and is not: "" sorts before every real timestamp, so a local
 * record predating the field lost to any remote copy that had one, including a
 * much older edit. When the two cannot be compared, the device in hand wins.
 *
 * Union-only, like the rest of the backup merge: restoring can add a record but
 * can never remove one.
 */
export function mergeByRecency<T extends { id: string; updated_at?: string }>(
  local: T[],
  remote: T[],
): T[] {
  const byId = new Map<string, T>();
  for (const r of remote) byId.set(r.id, r);
  for (const l of local) {
    const r = byId.get(l.id);
    const comparable = r?.updated_at && l.updated_at;
    byId.set(l.id, comparable && r!.updated_at! > l.updated_at! ? r! : l);
  }
  return [...byId.values()];
}
