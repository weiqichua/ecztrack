/**
 * Ids for locally created records.
 *
 * Lives here rather than in AppContext so that the pure list-building helpers
 * the context calls can mint their own ids and still be unit-tested.
 */
export function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}
