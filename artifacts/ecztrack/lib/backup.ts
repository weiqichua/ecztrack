import {
  ConsumptionLog, SymptomLog, ScratchLog, DailyNote,
  HabitDefinition, HabitLog, PhaseLedger, mergeScores,
  SupplementLog, ActivityLog,
  PresetGroup,
} from "@/constants/types";
import { FoodItem } from "@/constants/foods";
import { mergeByRecency } from "./recency";
import { reindex, type CatalogItem, type RoutineItem } from "@/constants/catalog";
import { CURRENT_SCHEMA_VERSION } from "./migrations";
// Type-only, so this stays a compile-time dependency: the value side of the
// converters is still imported lazily alongside Firestore itself.
import type { Converter } from "./repo/converters";

/**
 * Off-device backup.
 *
 * The app is local-first: AsyncStorage is the source of truth. Firebase holds
 * a mirror so data survives a lost phone, and so a second device can pick it
 * up occasionally.
 *
 * The merge is deliberately UNION-ONLY: restoring can add entries but can
 * never remove one. Deletions therefore do not propagate between devices —
 * a delete on the phone leaves the entry in the backup, and restoring brings
 * it back. That is the accepted cost of never being able to lose data to a
 * merge, which is what the previous sync layer did repeatedly.
 *
 * That rule reaches inside a record too, not just the list of them. Clearing
 * one symptom's score is a deletion of exactly this kind: `mergeSymptomLogs`
 * keeps the surviving number rather than the cleared blank, so an un-scored
 * box does not propagate between devices either. Same trade, one level down.
 */

/**
 * The storage schema a backup belongs to — the same number the local
 * migration stamps, so there is only ever one idea of "current".
 */
export const SNAPSHOT_SCHEMA_VERSION = CURRENT_SCHEMA_VERSION;

export const OUTDATED_BACKUP_MESSAGE =
  "This backup was made before the app moved to your own food, symptom and " +
  "urge lists. Its entries point at items that no longer exist, so restoring " +
  "it would bring back the history you chose to discard. Back up from this " +
  "device to replace it.";

export const NEWER_BACKUP_MESSAGE =
  "This backup was made by a newer version of the app than the one on this " +
  "device, so this device cannot read all of it. Update the app here, then " +
  "restore. Do not back up from this device first — that would overwrite the " +
  "newer backup with what this version can see.";

/**
 * Whether a pulled backup predates the current schema and must not be merged.
 *
 * An unstamped backup is pre-v4 by definition: the version has been written on
 * every push since it was introduced. This is a refusal rather than a
 * migration because there is no mapping from the old seeded ids to
 * user-created ones — that is exactly why the local migration wipes instead of
 * converting.
 */
export function isOutdatedSnapshot(version: number | null): boolean {
  return version === null || version < SNAPSHOT_SCHEMA_VERSION;
}

/**
 * Whether a pulled backup comes from a later schema than this build.
 *
 * Refused for the opposite reason to an outdated one, and it is the more
 * destructive direction: this build's converters read only the fields they know
 * about, so merging would quietly drop everything the newer version added, and
 * the next push would write that loss back over the cloud copy — the only other
 * one. Hence a distinct message: the fix is to update this device, not to
 * replace the backup.
 */
export function isFutureSnapshot(version: number | null): boolean {
  return version !== null && version > SNAPSHOT_SCHEMA_VERSION;
}

/**
 * Whether a snapshot holds nothing at all.
 *
 * Reads every field rather than a named list, so a collection added later is
 * counted without anyone remembering to come back here. Used to tell a
 * brand-new account apart from a pre-v4 backup: neither carries a schema
 * version, but an empty one has nothing to refuse.
 */
export function isEmptySnapshot(snap: Snapshot): boolean {
  return Object.values(snap).every(v => (Array.isArray(v) ? v.length === 0 : !v));
}

export interface Snapshot {
  consumptionLogs: ConsumptionLog[];
  symptomLogs: SymptomLog[];
  scratchLogs: ScratchLog[];
  supplementLogs: SupplementLog[];
  activityLogs: ActivityLog[];
  customFoods: FoodItem[];
  habitDefinitions: HabitDefinition[];
  habitLogs: HabitLog[];
  // The user-created catalogs. These have to travel with the logs: a restored
  // urge log holds a body location id, and a device that never received the
  // location itself renders that raw id and cannot offer it in any picker.
  bodyLocations: CatalogItem[];
  cues: CatalogItem[];
  routines: RoutineItem[];
  symptoms: CatalogItem[];
  // A food's category and its "contains" tags are catalogs too, and they travel
  // for the same reason: a restored food holds the id of a category and of each
  // tag, and a device without those items shows a raw id and cannot offer them
  // in the editor.
  foodCategories: CatalogItem[];
  foodTags: CatalogItem[];
  supplements: CatalogItem[];
  activities: CatalogItem[];
  presetGroups: PresetGroup[];
  dailyNotes: DailyNote[];
  /**
   * The phase ledger. One document, not a collection of them — see
   * `collectionSpecs` below, which this deliberately sits outside of.
   */
  ledger: PhaseLedger | null;
}

/**
 * Whether a ledger records no phase at all — a device the user has never
 * started a phase on. Such a ledger is safe to replace on restore.
 *
 * A ledger is a list of spans now, so this is just "no spans". The earlier
 * version asked about a single `elimination` record and a stamped `days` map,
 * which meant a user who had only ever run a Challenge — no `elimination`, no
 * days map entry either — had their entire phase history invisible to it, and
 * a restore would silently replace it with the remote's.
 */
export function isEmptyLedger(l: PhaseLedger | null): boolean {
  if (!l) return true;
  return l.spans.length === 0;
}

/**
 * Folds two versions of one day's score map together, key by key.
 *
 * A whole-record "local wins" would delete data: two devices that scored
 * different symptoms on the same day would keep only one map, and a device
 * that cleared a box would erase the other device's number. Neither is
 * allowed by the union-only invariant above, hence a per-key fold.
 *
 * The rules, in order:
 *  - A key only one side holds survives untouched. This is the common case:
 *    each device offered whatever symptoms its catalog held at the time.
 *  - Where both hold it and one value is `null` — the box shown and left
 *    blank — the non-null value wins. A merge must never remove a score.
 *  - Where both hold two different non-null values, local wins. A SymptomLog
 *    carries no `updated_at`, so there is nothing better to decide it with;
 *    this matches every other non-editable collection here.
 *
 * Tolerates a missing or malformed map on either side, the same way
 * `mergeScores` does — what is on disk must not be able to break a restore.
 */
function mergeScoreMaps(
  local: Record<string, number | null> | undefined,
  remote: Record<string, number | null> | undefined,
): Record<string, number | null> {
  const l = mergeScores(local, {});
  const merged = mergeScores(remote, {});
  for (const [key, value] of Object.entries(l)) {
    const other = merged[key];
    // `undefined` is the key being absent remotely, which is not a rival
    // value — local's, null included, is then the only one there is.
    merged[key] = value === null && other !== null && other !== undefined ? other : value;
  }
  return merged;
}

/**
 * Unions the two devices' check-ins, one record per date.
 *
 * Keyed by date rather than by id on purpose: the same check-in saved on two
 * devices has two different generated ids, so keying by id would leave two
 * records for one day — a shape every reader of a day's log resolves
 * differently. Local's id is kept where both sides have one, so the merged
 * record has the identity this device's other readers already hold.
 */
export function mergeSymptomLogs(local: SymptomLog[], remote: SymptomLog[]): SymptomLog[] {
  const byDate = new Map<string, SymptomLog>();
  for (const r of remote) byDate.set(r.date, r);
  for (const l of local) {
    const r = byDate.get(l.date);
    byDate.set(
      l.date,
      r ? { ...r, ...l, scores: mergeScoreMaps(l.scores, r.scores) } : l,
    );
  }
  return [...byDate.values()];
}

/** Union two lists by a key, preferring the local entry on collision. */
function unionBy<T>(local: T[], remote: T[], key: (x: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const r of remote) seen.set(key(r), r);
  for (const l of local) seen.set(key(l), l); // local wins
  return [...seen.values()];
}

/**
 * Merges a remote snapshot into the local one.
 *
 * Local wins every collision except the editable records — habit definitions,
 * custom foods and the catalogs — which carry `updated_at` and so resolve
 * by recency. See `lib/recency.ts` for why that distinction matters.
 *
 * Symptom logs are the one collection resolved below the record: a day's two
 * versions are folded score by score, because "local wins" over the whole
 * record throws away scores only the other device has. See mergeSymptomLogs.
 */
export function mergeSnapshots(local: Snapshot, remote: Snapshot): Snapshot {
  return {
    consumptionLogs: unionBy(local.consumptionLogs, remote.consumptionLogs, l => l.id),
    scratchLogs:     unionBy(local.scratchLogs, remote.scratchLogs, l => l.id),
    supplementLogs:  unionBy(local.supplementLogs, remote.supplementLogs, l => l.id),
    activityLogs:    unionBy(local.activityLogs, remote.activityLogs, l => l.id),
    customFoods:     mergeByRecency(local.customFoods, remote.customFoods),
    // Merged per score, not per record — see mergeSymptomLogs. A whole-record
    // "local wins" here deleted a score the other device had.
    symptomLogs:     mergeSymptomLogs(local.symptomLogs, remote.symptomLogs),
    habitLogs:       unionBy(local.habitLogs, remote.habitLogs, l => `${l.habitId}_${l.date}`),
    habitDefinitions: reindex(mergeByRecency(local.habitDefinitions, remote.habitDefinitions)),
    // Same treatment: editable, so recency, then a dense renumber because two
    // devices each appended at what they thought was the next free slot.
    bodyLocations:   reindex(mergeByRecency(local.bodyLocations, remote.bodyLocations)),
    cues:            reindex(mergeByRecency(local.cues, remote.cues)),
    routines:        reindex(mergeByRecency(local.routines, remote.routines)),
    symptoms:        reindex(mergeByRecency(local.symptoms, remote.symptoms)),
    foodCategories:  reindex(mergeByRecency(local.foodCategories, remote.foodCategories)),
    foodTags:        reindex(mergeByRecency(local.foodTags, remote.foodTags)),
    supplements:     reindex(mergeByRecency(local.supplements, remote.supplements)),
    activities:      reindex(mergeByRecency(local.activities, remote.activities)),
    presetGroups:    unionBy(local.presetGroups, remote.presetGroups, g => g.id),
    dailyNotes:      unionBy(local.dailyNotes, remote.dailyNotes, n => n.id),
    // The ledger is a single record with no merge story, so local wins.
    // "This device has none" must be tested with isEmptyLedger rather than a
    // null check: AppContext initialises the field to a default and never
    // leaves it null, so `local ?? remote` made the remote branch unreachable
    // and a new phone silently kept its own blank phase.
    ledger: isEmptyLedger(local.ledger) ? remote.ledger : local.ledger,
  };
}

// ── Firestore transport ─────────────────────────────────────────────────────
// Imported lazily inside the functions so this module stays importable (and
// its merge logic testable) with no Firebase config present.

/** The empty snapshot, used when no backup exists yet. */
export function emptySnapshot(): Snapshot {
  return {
    consumptionLogs: [], supplementLogs: [], activityLogs: [], symptomLogs: [], scratchLogs: [],
    customFoods: [], habitDefinitions: [], habitLogs: [],
    bodyLocations: [], cues: [], routines: [], symptoms: [],
    foodCategories: [], foodTags: [], supplements: [], activities: [], presetGroups: [], dailyNotes: [],
    ledger: null,
  };
}

/**
 * The snapshot fields that are Firestore collections.
 *
 * `ledger` is a single document, so it is not one of these and is handled on
 * its own below.
 */
type CollectionKey = Exclude<keyof Snapshot, "ledger">;

interface CollectionSpec<T extends { id: string }> {
  converter: Converter<T>;
  /**
   * The document id. Usually the entity's own, but the two per-day logs use a
   * deterministic id so a re-push overwrites in place rather than duplicating.
   */
  docId: (entity: T) => string;
}

/**
 * The one table push and pull both drive from.
 *
 * A mapped type over `CollectionKey`, so adding a collection to `Snapshot`
 * fails to compile until it has an entry here — which is the point. The
 * hand-written loops this replaces let a new field compile fine while never
 * being uploaded, so a restore on a new phone would silently come back without
 * it.
 *
 * Takes the lazily imported modules as arguments because this module must stay
 * importable with no Firebase config present.
 */
type CollectionSpecs = { [K in CollectionKey]: CollectionSpec<Snapshot[K][number]> };

/**
 * The same table with its per-key element types erased, which is the only shape
 * a loop over the keys can use.
 *
 * The pairing of key to converter is checked where `collectionSpecs` is
 * written; nothing a loop can say re-expresses that link, so both readers erase
 * it once here rather than casting at each use.
 */
type ErasedSpecs = Record<CollectionKey, CollectionSpec<{ id: string }>>;

function erase(specs: CollectionSpecs): ErasedSpecs {
  return specs as unknown as ErasedSpecs;
}

function collectionSpecs(
  c: typeof import("./repo/converters"),
  ids: typeof import("./repo/paths"),
): CollectionSpecs {
  const own = <T extends { id: string }>(entity: T) => entity.id;
  return {
    consumptionLogs:  { converter: c.consumptionLogConverter,  docId: own },
    scratchLogs:      { converter: c.scratchLogConverter,      docId: own },
    customFoods:      { converter: c.customFoodConverter,      docId: own },
    habitDefinitions: { converter: c.habitDefinitionConverter, docId: own },
    bodyLocations:    { converter: c.catalogItemConverter,     docId: own },
    cues:             { converter: c.catalogItemConverter,     docId: own },
    routines:         { converter: c.routineConverter,         docId: own },
    symptoms:         { converter: c.catalogItemConverter,     docId: own },
    foodCategories:   { converter: c.catalogItemConverter,     docId: own },
    foodTags:         { converter: c.catalogItemConverter,     docId: own },
    supplements:      { converter: c.catalogItemConverter,     docId: own },
    activities:       { converter: c.catalogItemConverter,     docId: own },
    symptomLogs:      { converter: c.symptomLogConverter,      docId: l => ids.symptomLogId(l.date) },
    habitLogs:        { converter: c.habitLogConverter,        docId: l => ids.habitLogId(l.habitId, l.date) },
    supplementLogs:   { converter: c.supplementLogConverter,   docId: own },
    activityLogs:     { converter: c.activityLogConverter,     docId: own },
    presetGroups:     { converter: c.presetGroupConverter,     docId: own },
    dailyNotes:       { converter: c.dailyNoteConverter,       docId: own },
  };
}

/**
 * Writes the whole local snapshot to Firestore.
 *
 * Uses batched writes chunked under Firestore's 500-operation limit. Existing
 * documents are overwritten by id; nothing is deleted, matching the union-only
 * merge contract above.
 */
export async function pushSnapshot(uid: string, snap: Snapshot): Promise<void> {
  const { getDb } = await import("./firebase");
  const { writeBatch, doc, setDoc } = await import("firebase/firestore");
  const paths = await import("./repo/paths");
  const c = await import("./repo/converters");

  const db = getDb();
  const specs = erase(collectionSpecs(c, paths));
  const ops: { path: string; id: string; data: Record<string, unknown> }[] = [];

  for (const key of Object.keys(specs) as CollectionKey[]) {
    const spec = specs[key];
    for (const entity of snap[key] as { id: string }[]) {
      ops.push({ path: paths.collectionPath(uid, key), id: spec.docId(entity), data: spec.converter.toDoc(entity) });
    }
  }

  const LIMIT = 500;
  for (let i = 0; i < ops.length; i += LIMIT) {
    const batch = writeBatch(db);
    for (const op of ops.slice(i, i + LIMIT)) batch.set(doc(db, op.path, op.id), op.data);
    await batch.commit();
  }

  // Written under `ledger`, not the `config` field the old phase model used, so
  // a backup made by an earlier build of this schema version reads back as "no
  // ledger" rather than being misparsed as one.
  //
  // An empty ledger is not written at all: it says nothing, and uploading it
  // would make a brand-new account's backup look non-empty to pullSnapshot,
  // which uses that to tell a new account from a pre-v4 one.
  if (!isEmptyLedger(snap.ledger)) {
    await setDoc(doc(db, paths.phaseDocPath(uid)), {
      ledger: JSON.parse(JSON.stringify(snap.ledger)),
      updatedAt: new Date().toISOString(),
    });
  }

  // Stamped LAST, deliberately. If the push dies partway the backup keeps
  // whatever version it had, so a half-overwritten pre-v4 backup still reads
  // as pre-v4 and pullSnapshot still refuses it.
  await setDoc(doc(db, paths.schemaDocPath(uid)), {
    version: SNAPSHOT_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
  });
}

/** Reads the whole backup back out of Firestore. */
export async function pullSnapshot(uid: string): Promise<Snapshot> {
  const { getDb } = await import("./firebase");
  const { collection, getDocs, doc, getDoc } = await import("firebase/firestore");
  const paths = await import("./repo/paths");
  const c = await import("./repo/converters");

  const db = getDb();
  const specs = erase(collectionSpecs(c, paths));
  const keys = Object.keys(specs) as CollectionKey[];

  const readAll = async (key: CollectionKey) => {
    const { converter } = specs[key];
    const snap = await getDocs(collection(db, paths.collectionPath(uid, key)));
    return snap.docs.map(d => converter.fromDoc(d.id, d.data()));
  };

  const [collections, phaseDoc, schemaDoc] = await Promise.all([
    Promise.all(keys.map(readAll)),
    getDoc(doc(db, paths.phaseDocPath(uid))),
    getDoc(doc(db, paths.schemaDocPath(uid))),
  ]);

  const pulled: Snapshot = {
    // Keyed off the same table the push drives, so the two can never disagree
    // about which collections exist.
    ...(Object.fromEntries(keys.map((k, i) => [k, collections[i]])) as Pick<Snapshot, CollectionKey>),
    ledger: phaseDoc.exists() ? ((phaseDoc.data() as any).ledger ?? null) : null,
  };

  // Refused here rather than in the caller, so no code path can reach
  // mergeSnapshots with a backup this build cannot read faithfully. The reads
  // above are wasted in that case; one extra round trip to check the version
  // first is not worth saving them — and the emptiness test below needs them.
  if (!isEmptySnapshot(pulled)) {
    const stamped = schemaDoc.exists() ? (schemaDoc.data() as any).version : null;
    const version = typeof stamped === "number" ? stamped : null;
    if (isOutdatedSnapshot(version)) throw new Error(OUTDATED_BACKUP_MESSAGE);
    if (isFutureSnapshot(version)) throw new Error(NEWER_BACKUP_MESSAGE);
  }

  return pulled;
}
