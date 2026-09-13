import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ConsumptionLog, Phase, PhaseLedger, Portion, SupplementLog, ActivityLog, ActivityIntensity,
  ScratchLog, SymptomLog,
  HabitDefinition, HabitLog,
  SkinPhoto,
  mergeScores,
  PresetGroup, PresetGroupType,
} from "@/constants/types";
import {
  EMPTY_LEDGER, phaseOnDate,
  scheduleElimination as scheduleEliminationIn,
  endEliminationEarly as endEliminationEarlyIn,
  startChallenge as startChallengeIn,
  endChallenge as endChallengeIn,
  updatePhase as updatePhaseIn,
} from "@/lib/phases";
import { FoodItem, SEED_FOOD_CATEGORIES, SEED_FOOD_TAGS } from "@/constants/foods";
import {
  todayKey,
  localDateKey,
  msUntilNextLocalMidnight,
} from "@/lib/dates";
import { isAuthAvailable, watchAuth, signIn as fbSignIn, signOut as fbSignOut, type AuthUser } from "@/lib/auth";
import { mergeSnapshots, pushSnapshot, pullSnapshot, type Snapshot } from "@/lib/backup";
import { notify } from "@/lib/dialogs";
import { stamp } from "@/lib/recency";
import {
  cleanItemName, deleteOrArchive, isItemReferenced, reindex, reorderByIds,
  type CatalogItem, type CatalogKind, type DeleteOutcome, type RoutineItem,
} from "@/constants/catalog";
import type { DailyNote } from "@/constants/types";
import { runSchemaMigration } from "@/lib/migrations";
import { STORAGE_KEYS, WIPE_STORAGE_KEYS } from "@/lib/storageKeys";
import { createLoadGate } from "@/lib/loadGate";
import { seedIfUnwritten } from "@/lib/seedCatalogs";
import { generateId } from "@/lib/ids";
import { prependConsumptionLogs } from "@/lib/foodLog";
import { renameMealIn, retimeMealIn, deleteMealIn, DEFAULT_MEAL_LABEL } from "@/lib/mealGroups";
import { applyCheckin } from "@/lib/symptomLogs";
import { createLogCell, type LogCell } from "@/lib/logCell";
import { applyHabitLog, type HabitValue } from "@/lib/habitLogs";
import { addPhoto, removePhoto, setLocation, setPhotoTime as setPhotoTimeIn, reconcile } from "@/lib/skinPhotos";
import { capturePhoto, deletePhotoFile, listPhotoFiles, type PhotoSource } from "@/lib/photoCapture";


/**
 * Writes one collection to disk. Resolves true if the write actually landed.
 *
 * Every mutator sets state optimistically and then persists, ignoring the
 * return value: they have no recovery path, and rethrowing would only turn
 * a failure into an unhandled rejection inside an onPress handler. So for
 * them a silent failure is reported via `notify` rather than surfaced to the
 * caller. On web AsyncStorage is `localStorage` — a ~5 MB quota that this
 * app's log history can genuinely reach, and `setItem` throws
 * `QuotaExceededError` when it does.
 *
 * Backup and restore are the exception: they have dedicated status fields
 * whose whole job is to report whether the operation actually happened, so
 * they read the boolean instead of letting it go unused.
 */
let storageWarned = false;
// Module-level: one app instance, one load attempt to guard. See lib/loadGate.ts.
const loadGate = createLoadGate();
async function persist(key: string, value: unknown): Promise<boolean> {
  if (!loadGate.canWrite()) {
    // The initial load never succeeded, so every state array is still at its
    // empty default. Writing now would stamp that emptiness over whatever is
    // actually on disk — refuse instead. The user was already notified when
    // the load itself failed.
    console.warn("[storage] write blocked: initial load did not complete", key);
    return false;
  }
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
    storageWarned = false;
    return true;
  } catch (e) {
    console.warn("[storage] write failed", key, e);
    // One warning per run of failures; a burst of taps must not stack dialogs.
    if (!storageWarned) {
      storageWarned = true;
      notify(
        "Could not save",
        "This device is out of storage for the app, so your last change is only " +
          "on screen and will be lost when you reopen it. Export or back up your " +
          "data, then free up space.",
      );
    }
    return false;
  }
}

/**
 * Which key each catalog persists under.
 *
 * Every catalog behaves identically, so they share one set of mutators rather
 * than a near-copy each. Only the storage key and the state slot differ, and
 * both are selected by kind. The food category and tag lists join that set
 * rather than bringing their own, so the two cannot drift apart.
 */
const CATALOG_KEYS: Record<CatalogKind, string> = {
  bodyLocation: STORAGE_KEYS.BODY_LOCATIONS,
  cue: STORAGE_KEYS.CUES,
  routine: STORAGE_KEYS.ROUTINES,
  symptom: STORAGE_KEYS.SYMPTOMS,
  foodCategory: STORAGE_KEYS.FOOD_CATEGORIES,
  foodTag: STORAGE_KEYS.FOOD_TAGS,
  supplement: STORAGE_KEYS.SUPPLEMENTS,
  activity: STORAGE_KEYS.ACTIVITIES,
};

function todayStr(): string {
  return todayKey();
}

export type BackupStatus = "idle" | "working" | "success" | "error";

interface AppContextValue {
  consumptionLogs: ConsumptionLog[];
  supplementLogs: SupplementLog[];
  activityLogs: ActivityLog[];
  // ── User-created catalogs ──
  // Empty until the user adds items; there is no seed data by design. Every
  // consumer must render an empty list rather than assume a first element.
  // These hold archived items too, so a log can still be titled by name;
  // pickers must go through activeItems().
  bodyLocations: CatalogItem[];
  cues: CatalogItem[];
  routines: RoutineItem[];
  symptoms: CatalogItem[];
  supplements: CatalogItem[];
  activities: CatalogItem[];
  presetGroups: PresetGroup[];
  dailyNotes: DailyNote[];
  /**
   * The two exceptions to "nothing is seeded": a first launch plants the
   * categories and tags the app used to hardcode, because the user asked to
   * keep those entries and prune them by hand. A list the user has emptied
   * stays empty — see lib/seedCatalogs.ts.
   */
  foodCategories: CatalogItem[];
  foodTags: CatalogItem[];
  symptomLogs: SymptomLog[];
  scratchLogs: ScratchLog[];
  customFoods: FoodItem[];
  allFoods: FoodItem[];
  habitDefinitions: HabitDefinition[];
  habitLogs: HabitLog[];
  /**
   * Every skin photo on this device. Not in the backup — see the design doc.
   */
  skinPhotos: SkinPhoto[];
  ledger: PhaseLedger;
  activePhase: Phase;
  currentPhase: Phase;
  selectedDate: string;
  /** Today's local date key, refreshed at midnight and on app foreground. */
  todayDateKey: string;
  isLoaded: boolean;

  // ── Optional off-device backup ──
  /** False when no Firebase config is present; the whole feature hides. */
  backupAvailable: boolean;
  backupUser: AuthUser | null;
  backupStatus: BackupStatus;
  backupError: string | null;
  lastBackupAt: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  backupNow: () => Promise<void>;
  restoreFromBackup: () => Promise<void>;
  setSelectedDate: (date: string) => void;
  addConsumptionLog: (itemId: string, opts?: { isAccident?: boolean; timestamp?: string }) => Promise<void>;
  /**
   * Logs a whole selection as one event: one state update, one write.
   * Callers with more than one food MUST use this rather than awaiting
   * addConsumptionLog in a loop — see prependConsumptionLogs.
   */
  addConsumptionLogs: (itemIds: string[], opts?: {
    isAccident?: boolean; timestamp?: string;
    /** Portion per food id. A food left out of the map was given no size. */
    portions?: Record<string, Portion>;
    label?: string;
  }) => Promise<void>;
  addSupplementLog: (itemId: string, opts?: { timestamp?: string }) => Promise<void>;
  deleteSupplementLog: (id: string) => Promise<void>;
  addActivityLog: (itemId: string, intensity: ActivityIntensity, opts?: { timestamp?: string }) => Promise<void>;
  deleteActivityLog: (id: string) => Promise<void>;
  deleteConsumptionLog: (id: string) => Promise<void>;
  /**
   * Renames and/or re-times one meal in a single write.
   *
   * One mutator on purpose: rename and retime as two callbacks cannot be
   * called together from one handler — each closes over the consumptionLogs
   * of the render that created it, so the second call derives from an array
   * that predates the first and silently overwrites it. Deriving both changes
   * from one snapshot is the same rule prependConsumptionLogs exists for.
   * The phase is re-derived from the ledger for the new date; carrying the
   * old one over would make the export disagree with the calendar. Retiming
   * is gated on the time actually changing, so a pure rename never
   * restamps the phase.
   */
  updateMeal: (groupId: string, label: string, iso: string) => Promise<void>;
  deleteMeal: (groupId: string) => Promise<void>;
  addSymptomLog: (log: Omit<SymptomLog, "id">) => Promise<void>;
  deleteSymptomLog: (id: string) => Promise<void>;
  addScratchLog: (log: Omit<ScratchLog, "id" | "phase" | "is_accident"> & { is_accident?: boolean; timestamp?: string }) => Promise<void>;
  /**
   * Rewrites one urge log in place, keeping its id. `phase` is re-derived from
   * the ledger rather than carried over, so moving a log to another day stamps
   * the phase that day was actually on.
   */
  updateScratchLog: (id: string, log: Omit<ScratchLog, "id" | "phase">) => Promise<void>;
  deleteScratchLog: (id: string) => Promise<void>;
  /** Throws while a phase is already running or scheduled — see rule 4. */
  scheduleElimination: (startDateKey: string, plannedDays: number, what: string) => Promise<void>;
  endEliminationEarly: () => Promise<void>;
  /**
   * Starts a challenge today, labelled with what is being challenged.
   * Throws while another phase is open, and on a blank label.
   */
  startChallenge: (what: string) => Promise<void>;
  endChallenge: () => Promise<void>;
  updatePhase: (phaseId: string, what: string, plannedDays?: number) => Promise<void>;
  getRecentConsumptionLogs: (days?: number) => ConsumptionLog[];
  addCustomFood: (food: Omit<FoodItem, "id" | "is_custom">) => Promise<void>;
  saveFood: (food: FoodItem) => Promise<void>;
  /** Archives instead when a check-in log still names the food. */
  deleteCustomFood: (id: string) => Promise<DeleteOutcome>;
  /** Trims the name; a blank one writes nothing. */
  addCatalogItem: (kind: CatalogKind, name: string, extra?: { description?: string; icon?: string }) => Promise<void>;
  /** Trims the name; a blank one leaves the item untouched. */
  updateCatalogItem: (kind: CatalogKind, item: RoutineItem) => Promise<void>;
  /** Archives instead when a log still references the item. */
  deleteCatalogItem: (kind: CatalogKind, id: string) => Promise<DeleteOutcome>;
  /** `ids` is the new sequence of the items the caller showed. */
  reorderCatalogItems: (kind: CatalogKind, ids: string[]) => Promise<void>;
  addHabitDefinition: (def: Omit<HabitDefinition, "id" | "order" | "isArchived">) => Promise<void>;
  addPresetGroup: (name: string, type: PresetGroupType, item_ids: string[]) => Promise<void>;
  updatePresetGroup: (group: PresetGroup) => Promise<void>;
  deletePresetGroup: (id: string) => Promise<void>;
  setDailyNote: (date: string, text: string) => Promise<void>;
  updateHabitDefinition: (def: HabitDefinition) => Promise<void>;
  deleteHabitDefinition: (id: string) => Promise<void>;
  /**
   * Sets one habit's value for a day. Pass a function to derive it from what
   * is stored — the tiles save per tap, and a screen's own reading of the
   * current value is a render out of date.
   */
  setHabitLog: (habitId: string, date: string, value: HabitValue) => Promise<void>;
  getHabitLogsForDate: (date: string) => HabitLog[];
  /**
   * Takes or picks a photo and files it against `dateKey`. Returns false when
   * the user backed out or the platform cannot store photos. Rejects with a
   * message meant to be shown to the user when camera/library permission is
   * denied — the caller must catch it and display it.
   */
  addSkinPhoto: (source: PhotoSource, dateKey: string) => Promise<boolean>;
  deleteSkinPhoto: (id: string) => Promise<void>;
  /** Sets or clears a photo's body location. */
  setPhotoLocation: (id: string, location: string | undefined) => Promise<void>;
  /** Edits the time a photo was taken, moving it to a new day if the time crossed midnight. */
  setPhotoTime: (id: string, takenAt: string) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

/**
 * A ledger from before spans — `{ days, elimination, materialisedThrough }` —
 * cannot be read as spans, so it is discarded rather than migrated. There is no
 * data to lose; this exists so a stale value on disk cannot crash the load.
 *
 * Deliberately NOT a schema-version bump: raising CURRENT_SCHEMA_VERSION
 * re-fires the wipe of consumption, symptom, scratch and custom-food storage.
 */
function readLedger(raw: unknown): PhaseLedger {
  if (raw && typeof raw === "object" && Array.isArray((raw as PhaseLedger).spans)) {
    return raw as PhaseLedger;
  }
  return EMPTY_LEDGER;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [consumptionLogs, setConsumptionLogs] = useState<ConsumptionLog[]>([]);
  const [supplementLogs, setSupplementLogs] = useState<SupplementLog[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [symptomLogs, setSymptomLogs] = useState<SymptomLog[]>([]);
  /**
   * The one way symptom logs are published, and the only synchronous read of
   * them — see lib/symptomLogs.ts. Every `setSymptomLogs` goes through
   * `symptomLogCell.set`; setting state without the cell leaves it stale and
   * the next check-in rebuilds from a superseded array.
   */
  // A ref, not a useMemo: React is free to discard a memo's cache while the
  // useState beside it survives, and this cell seeds at `[]`. A discarded memo
  // would hand the next check-in an empty array to fold onto and persist a
  // one-element collection over the whole history — the same silent wipe the
  // cell was introduced to prevent. Ref contents are never discarded.
  const cellRef = useRef<LogCell<SymptomLog> | null>(null);
  if (cellRef.current === null) cellRef.current = createLogCell<SymptomLog>([], setSymptomLogs);
  const symptomLogCell = cellRef.current;
  const [scratchLogs, setScratchLogs] = useState<ScratchLog[]>([]);
  const [customFoods, setCustomFoods] = useState<FoodItem[]>([]);
  const [habitDefinitions, setHabitDefinitions] = useState<HabitDefinition[]>([]);
  const [habitLogs, setHabitLogs] = useState<HabitLog[]>([]);
  const [skinPhotos, setSkinPhotos] = useState<SkinPhoto[]>([]);
  /**
   * The one way habit logs are published — the same cell the symptom logs use,
   * for the same reason. The habit tiles save on every tap (see
   * scratch-tracker.tsx), so three tiles ticked inside one render read the same
   * pre-tap array from a closure and only the last tick reached disk, and the
   * screen with it. Every `setHabitLogs` goes through `habitLogCell.set`: a
   * site that sets state without it leaves the cell stale, and the next tap
   * rebuilds from a superseded array and resurrects deleted logs.
   *
   * A ref rather than a useMemo, for the reason spelled out above the symptom
   * cell: a discarded memo would reseed this at `[]`.
   */
  const habitCellRef = useRef<LogCell<HabitLog> | null>(null);
  if (habitCellRef.current === null) habitCellRef.current = createLogCell<HabitLog>([], setHabitLogs);
  const habitLogCell = habitCellRef.current;
  const [bodyLocations, setBodyLocations] = useState<CatalogItem[]>([]);
  const [cues, setCues] = useState<CatalogItem[]>([]);
  const [routines, setRoutines] = useState<RoutineItem[]>([]);
  const [symptoms, setSymptoms] = useState<CatalogItem[]>([]);
  const [supplements, setSupplements] = useState<CatalogItem[]>([]);
  const [activities, setActivities] = useState<CatalogItem[]>([]);
  const [presetGroups, setPresetGroups] = useState<PresetGroup[]>([]);
  const [dailyNotes, setDailyNotes] = useState<DailyNote[]>([]);
  const [foodCategories, setFoodCategories] = useState<CatalogItem[]>([]);
  const [foodTags, setFoodTags] = useState<CatalogItem[]>([]);
  const [ledger, setLedgerState] = useState<PhaseLedger>(EMPTY_LEDGER);
  const [selectedDate, setSelectedDateState] = useState<string>(todayStr());
  const [isLoaded, setIsLoaded] = useState(false);

  // Today's local date key, kept fresh. Expo Router mounts every tab once and
  // never unmounts it, so anything derived from "now" at mount time silently
  // goes stale: leave the app open overnight and the phase card, the day
  // counter and — worst — the date that habit ticks were written under all
  // still said yesterday.
  const [todayDateKey, setTodayDateKey] = useState<string>(todayStr());

  // ── Optional off-device backup ──
  const [backupUser, setBackupUser] = useState<AuthUser | null>(null);
  const [backupStatus, setBackupStatus] = useState<BackupStatus>("idle");
  const [backupError, setBackupError] = useState<string | null>(null);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const backupAvailable = isAuthAvailable();

  // ── Day rollover ──────────────────────────────────────────────────────────
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    function schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(tick, msUntilNextLocalMidnight());
    }

    function tick() {
      setTodayDateKey(prev => {
        const fresh = todayStr();
        // Follow the user forward only if they were sitting on "today".
        // Someone reviewing an earlier date keeps the date they chose.
        if (fresh !== prev) setSelectedDateState(cur => (cur === prev ? fresh : cur));
        return fresh;
      });
      schedule();
    }

    schedule();
    const sub = AppState.addEventListener("change", state => {
      // Timers do not fire reliably while backgrounded, so re-check on return.
      if (state === "active") tick();
    });
    return () => {
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, []);

  const activePhase = useMemo(
    () => phaseOnDate(ledger, todayDateKey, todayDateKey),
    [ledger, todayDateKey],
  );
  const currentPhase = activePhase;

  // There is no seeded library any more: every food is user-created, so the
  // "all foods" the pickers show is just the custom list.
  const allFoods = customFoods;

  // ── Load data from AsyncStorage on mount ──────────────────────────────────
  useEffect(() => {
    async function loadData() {
      try {
        // One-time discard of stale history from the seeded-catalog era. Runs
        // before the reads below so they see the post-wipe state; it is itself
        // a no-op past the first launch on schema 4, so this cost is paid once.
        await runSchemaMigration(
          {
            getItem: (key) => AsyncStorage.getItem(key),
            setItem: (key, value) => AsyncStorage.setItem(key, value),
            removeItem: (key) => AsyncStorage.removeItem(key),
          },
          WIPE_STORAGE_KEYS,
        );

        const [
          cLogs, sLogs, scrLogs, pLedger, cFoods, hDefs, hLogs,
          bLocs, cueItems, rtns, symps, fCats, fTags,
          rawPhotos, photoFiles,
          supLogs, actLogs, sups, acts, pGroups, dNotes,
        ] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.CONSUMPTION_LOGS),
          AsyncStorage.getItem(STORAGE_KEYS.SYMPTOM_LOGS),
          AsyncStorage.getItem(STORAGE_KEYS.SCRATCH_LOGS),
          AsyncStorage.getItem(STORAGE_KEYS.PHASE_LEDGER),
          AsyncStorage.getItem(STORAGE_KEYS.CUSTOM_FOODS),
          AsyncStorage.getItem(STORAGE_KEYS.HABIT_DEFINITIONS),
          AsyncStorage.getItem(STORAGE_KEYS.HABIT_LOGS),
          AsyncStorage.getItem(STORAGE_KEYS.BODY_LOCATIONS),
          AsyncStorage.getItem(STORAGE_KEYS.CUES),
          AsyncStorage.getItem(STORAGE_KEYS.ROUTINES),
          AsyncStorage.getItem(STORAGE_KEYS.SYMPTOMS),
          AsyncStorage.getItem(STORAGE_KEYS.FOOD_CATEGORIES),
          AsyncStorage.getItem(STORAGE_KEYS.FOOD_TAGS),
          AsyncStorage.getItem(STORAGE_KEYS.SKIN_PHOTOS),
          listPhotoFiles(),
          AsyncStorage.getItem(STORAGE_KEYS.SUPPLEMENT_LOGS),
          AsyncStorage.getItem(STORAGE_KEYS.ACTIVITY_LOGS),
          AsyncStorage.getItem(STORAGE_KEYS.SUPPLEMENTS),
          AsyncStorage.getItem(STORAGE_KEYS.ACTIVITIES),
          AsyncStorage.getItem(STORAGE_KEYS.PRESET_GROUPS),
          AsyncStorage.getItem(STORAGE_KEYS.DAILY_NOTES),
        ]);

        // Load core data
        const loadedCLogs: ConsumptionLog[] = cLogs ? JSON.parse(cLogs) : [];
        // `scores` is normalised on the way in so no screen has to defend
        // against a log whose map is missing or is not an object.
        const loadedSLogs: SymptomLog[] = (sLogs ? JSON.parse(sLogs) : [])
          .map((l: SymptomLog) => ({ ...l, scores: mergeScores(l.scores, {}) }));
        const loadedScrLogs: ScratchLog[] = scrLogs ? JSON.parse(scrLogs) : [];
        const loadedLedger: PhaseLedger = pLedger ? readLedger(JSON.parse(pLedger)) : EMPTY_LEDGER;
        const loadedCFoods: FoodItem[] = cFoods ? JSON.parse(cFoods) : [];
        const loadedHDefs: HabitDefinition[] = hDefs ? JSON.parse(hDefs) : [];
        const loadedHLogs: HabitLog[] = hLogs ? JSON.parse(hLogs) : [];
        // No defaults to fall back on: an empty catalog is the correct state
        // for a user who has not added anything yet.
        const loadedBLocs: CatalogItem[] = bLocs ? JSON.parse(bLocs) : [];
        const loadedCues: CatalogItem[] = cueItems ? JSON.parse(cueItems) : [];
        const loadedRtns: RoutineItem[] = rtns ? JSON.parse(rtns) : [];
        const loadedSymps: CatalogItem[] = symps ? JSON.parse(symps) : [];
        // The one pair that does have defaults, and only until the key has
        // been written once. Nothing is persisted here: seeding is a read-time
        // decision, so a user who empties either list gets a stored "[]" from
        // the delete itself and is never refilled.
        const loadedFCats = seedIfUnwritten(fCats, SEED_FOOD_CATEGORIES);
        const loadedFTags = seedIfUnwritten(fTags, SEED_FOOD_TAGS);
        const storedPhotos: SkinPhoto[] = rawPhotos ? JSON.parse(rawPhotos) : [];
        const loadedSupLogs: SupplementLog[] = supLogs ? JSON.parse(supLogs) : [];
        const loadedActLogs: ActivityLog[] = actLogs ? JSON.parse(actLogs) : [];
        const loadedSups: CatalogItem[] = sups ? JSON.parse(sups) : [];
        const loadedActs: CatalogItem[] = acts ? JSON.parse(acts) : [];
        const loadedPGroups: PresetGroup[] = pGroups ? JSON.parse(pGroups) : [];
        const loadedNotes: DailyNote[] = dNotes ? JSON.parse(dNotes) : [];
        // Reconciled against what is actually on disk. `listPhotoFiles` returns
        // null when it could not read the directory, and reconcile then changes
        // nothing — an unreadable directory must never be mistaken for an empty
        // one, or the whole library goes.
        const reconciledPhotos = reconcile(storedPhotos, photoFiles);

        // Apply local data to state immediately so the UI renders
        setConsumptionLogs(loadedCLogs);
        symptomLogCell.set(loadedSLogs);
        setScratchLogs(loadedScrLogs);
        setLedgerState(loadedLedger);
        setCustomFoods(loadedCFoods);
        setHabitDefinitions(loadedHDefs);
        habitLogCell.set(loadedHLogs);
        setBodyLocations(loadedBLocs);
        setCues(loadedCues);
        setRoutines(loadedRtns);
        setSymptoms(loadedSymps);
        setFoodCategories(loadedFCats);
        setFoodTags(loadedFTags);
        setSkinPhotos(reconciledPhotos);
        setSupplementLogs(loadedSupLogs);
        setActivityLogs(loadedActLogs);
        setSupplements(loadedSups);
        setActivities(loadedActs);
        // Only a load that actually completed opens the gate mutators write
        // through — see lib/loadGate.ts.
        loadGate.succeed();
        setIsLoaded(true);
        // Persisted only when reconcile actually dropped something; it returns
        // the same array otherwise, so this is a cheap identity check. Done
        // after the gate opens above — persist() refuses writes until then.
        if (reconciledPhotos !== storedPhotos) {
          await persist(STORAGE_KEYS.SKIN_PHOTOS, reconciledPhotos);
        }

      } catch (e) {
        console.warn("Failed to load data", e);
        // The gate stays closed: state is still at its empty defaults, and a
        // mutator persisting from here would overwrite whatever is actually
        // on disk. isLoaded still flips so the UI renders instead of hanging
        // on a spinner forever.
        notify(
          "Couldn't load your data",
          "Something went wrong loading your saved data. To avoid overwriting " +
            "it, changes won't be saved until you restart the app.",
        );
        setIsLoaded(true);
      }
    }
    loadData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setSelectedDate = useCallback((date: string) => {
    setSelectedDateState(date);
  }, []);

  // ── Phase helpers ─────────────────────────────────────────────────────────
  // The ledger is only ever written by the pure functions in lib/phases.ts, and
  // only from a user action. Nothing writes it on a clock: a day's phase is
  // found by asking which span contains it, so the passage of time changes the
  // answer without changing what is stored.
  async function persistLedger(next: PhaseLedger) {
    setLedgerState(next);
    await persist(STORAGE_KEYS.PHASE_LEDGER, next);
  }

  const scheduleElimination = useCallback(async (startDateKey: string, plannedDays: number, what: string) => {
    // Throws while one is already running or scheduled. Left to propagate: the
    // caller is acting on a decision the user made and must not report success.
    await persistLedger(
      scheduleEliminationIn(ledger, startDateKey, plannedDays, todayDateKey, what, generateId),
    );
  }, [ledger, todayDateKey]);

  const endEliminationEarly = useCallback(async () => {
    const next = endEliminationEarlyIn(ledger, todayDateKey);
    if (next === ledger) return;
    await persistLedger(next);
  }, [ledger, todayDateKey]);

  const startChallenge = useCallback(async (what: string) => {
    // Throws while another phase owns today, and on a blank label. Left to
    // propagate for the same reason as scheduling an elimination.
    await persistLedger(startChallengeIn(ledger, todayDateKey, what, generateId));
  }, [ledger, todayDateKey]);

  const endChallenge = useCallback(async () => {
    const next = endChallengeIn(ledger, todayDateKey);
    if (next === ledger) return;
    await persistLedger(next);
  }, [ledger, todayDateKey]);

  const updatePhase = useCallback(async (phaseId: string, what: string, plannedDays?: number) => {
    await persistLedger(updatePhaseIn(ledger, phaseId, what, plannedDays));
  }, [ledger]);

  // ── Pending delete helper ─────────────────────────────────────────────────

  // ── Consumption logs ──────────────────────────────────────────────────────
  // One state update and one write for the whole selection. Awaiting the
  // single-item mutator once per food cannot work: this callback is closed
  // over `consumptionLogs`, so every iteration would spread the same pre-loop
  // array and the last food would be the only one to reach disk.
  const addConsumptionLogs = useCallback(async (
    itemIds: string[],
    opts: {
      isAccident?: boolean; timestamp?: string;
      portions?: Record<string, Portion>;
      label?: string;
    } = {}
  ) => {
    if (itemIds.length === 0) return;
    const ts = opts.timestamp ?? new Date().toISOString();
    const updated = prependConsumptionLogs(consumptionLogs, itemIds, {
      timestamp: ts,
      phase: phaseOnDate(ledger, localDateKey(ts), todayDateKey),
      isAccident: opts.isAccident,
      portions: opts.portions,
      // One id per call, so one Save is one meal. Minted here rather than by
      // the caller so every entry point gets grouping without opting in.
      groupId: generateId(),
      meal: opts.label ?? DEFAULT_MEAL_LABEL,
    });
    setConsumptionLogs(updated);
    await persist(STORAGE_KEYS.CONSUMPTION_LOGS, updated);
  }, [consumptionLogs, ledger, todayDateKey]);

  const addConsumptionLog = useCallback(async (
    itemId: string,
    opts: { isAccident?: boolean; timestamp?: string } = {}
  ) => {
    await addConsumptionLogs([itemId], opts);
  }, [addConsumptionLogs]);


  const addSupplementLog = useCallback(async (itemId: string, opts?: { timestamp?: string }) => {
    const timestamp = opts?.timestamp || new Date().toISOString();
    const phase = phaseOnDate(ledger, localDateKey(timestamp), todayDateKey);
    const newLog: SupplementLog = { id: generateId(), timestamp, item_id: itemId, phase };
    const next = [...supplementLogs, newLog].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    setSupplementLogs(next);
    await persist(STORAGE_KEYS.SUPPLEMENT_LOGS, next);
  }, [ledger, todayDateKey, supplementLogs]);

  const deleteSupplementLog = useCallback(async (id: string) => {
    const next = supplementLogs.filter(l => l.id !== id);
    setSupplementLogs(next);
    await persist(STORAGE_KEYS.SUPPLEMENT_LOGS, next);
  }, [supplementLogs]);

  const addActivityLog = useCallback(async (itemId: string, intensity: ActivityIntensity, opts?: { timestamp?: string }) => {
    const timestamp = opts?.timestamp || new Date().toISOString();
    const phase = phaseOnDate(ledger, localDateKey(timestamp), todayDateKey);
    const newLog: ActivityLog = { id: generateId(), timestamp, item_id: itemId, phase, intensity };
    const next = [...activityLogs, newLog].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    setActivityLogs(next);
    await persist(STORAGE_KEYS.ACTIVITY_LOGS, next);
  }, [ledger, todayDateKey, activityLogs]);

  const deleteActivityLog = useCallback(async (id: string) => {
    const next = activityLogs.filter(l => l.id !== id);
    setActivityLogs(next);
    await persist(STORAGE_KEYS.ACTIVITY_LOGS, next);
  }, [activityLogs]);

  const deleteConsumptionLog = useCallback(async (id: string) => {
    const updated = consumptionLogs.filter(l => l.id !== id);
    setConsumptionLogs(updated);
    await persist(STORAGE_KEYS.CONSUMPTION_LOGS, updated);
  }, [consumptionLogs]);

  const updateMeal = useCallback(async (groupId: string, label: string, iso: string) => {
    const renamed = renameMealIn(consumptionLogs, groupId, label);
    // Retime only when the time actually changed: restamping the phase on a
    // pure rename would silently rewrite history the ledger has since moved
    // under, on an action the user understands as "fix the name".
    const timeChanged = consumptionLogs.some(
      l => (l.group_id ?? l.id) === groupId && l.timestamp !== iso,
    );
    const updated = timeChanged
      ? retimeMealIn(renamed, groupId, iso, phaseOnDate(ledger, localDateKey(iso), todayDateKey))
      : renamed;
    setConsumptionLogs(updated);
    await persist(STORAGE_KEYS.CONSUMPTION_LOGS, updated);
  }, [consumptionLogs, ledger, todayDateKey]);

  const deleteMeal = useCallback(async (groupId: string) => {
    const updated = deleteMealIn(consumptionLogs, groupId);
    setConsumptionLogs(updated);
    await persist(STORAGE_KEYS.CONSUMPTION_LOGS, updated);
  }, [consumptionLogs]);

  // ── Symptom logs ──────────────────────────────────────────────────────────
  const addSymptomLog = useCallback(async (log: Omit<SymptomLog, "id">) => {
    const logPhase = phaseOnDate(ledger, log.date, todayDateKey);
    // Read the cell, not state: the home page saves on every box tap, so two
    // taps can land inside one render. The cell is correct synchronously, which
    // is what makes the second tap fold onto the first's result and what gives
    // persist() a real array rather than an empty one.
    const updated = applyCheckin(symptomLogCell, log, logPhase, generateId);
    await persist(STORAGE_KEYS.SYMPTOM_LOGS, updated);
  }, [ledger, todayDateKey]);

  const deleteSymptomLog = useCallback(async (id: string) => {
    // Filtered from the cell, which is never behind state, so a delete landing
    // in the same render as a check-in cannot resurrect what the tap wrote.
    const updated = symptomLogCell.get().filter(l => l.id !== id);
    symptomLogCell.set(updated);
    await persist(STORAGE_KEYS.SYMPTOM_LOGS, updated);
  }, []);

  // ── Scratch logs ──────────────────────────────────────────────────────────
  const addScratchLog = useCallback(async (log: Omit<ScratchLog, "id" | "phase" | "is_accident"> & { is_accident?: boolean; timestamp?: string }) => {
    const ts = log.timestamp ?? new Date().toISOString();
    const logPhase = phaseOnDate(ledger, localDateKey(ts), todayDateKey);
    const newLog: ScratchLog = {
      id: generateId(), phase: logPhase, is_accident: log.is_accident ?? false,
      timestamp: ts, location: log.location, cue: log.cue,
      routine_id: log.routine_id, success: log.success,
    };
    const updated = [newLog, ...scratchLogs];
    setScratchLogs(updated);
    await persist(STORAGE_KEYS.SCRATCH_LOGS, updated);
  }, [scratchLogs, ledger, todayDateKey]);

  const updateScratchLog = useCallback(async (id: string, log: Omit<ScratchLog, "id" | "phase">) => {
    if (!scratchLogs.some(l => l.id === id)) return;
    const updated = scratchLogs.map(l => (
      l.id === id
        ? { ...log, id, phase: phaseOnDate(ledger, localDateKey(log.timestamp), todayDateKey) }
        : l
    ));
    setScratchLogs(updated);
    await persist(STORAGE_KEYS.SCRATCH_LOGS, updated);
  }, [scratchLogs, ledger, todayDateKey]);

  const deleteScratchLog = useCallback(async (id: string) => {
    const updated = scratchLogs.filter(l => l.id !== id);
    setScratchLogs(updated);
    await persist(STORAGE_KEYS.SCRATCH_LOGS, updated);
  }, [scratchLogs]);

  // ── Custom foods ──────────────────────────────────────────────────────────
  const addCustomFood = useCallback(async (food: Omit<FoodItem, "id" | "is_custom">) => {
    // Stamped on create, not just on edit: an unstamped record loses to any
    // remote copy that has a timestamp. See lib/recency.ts.
    const newFood: FoodItem = stamp({ ...food, id: "custom_" + generateId(), is_custom: true });
    const updated = [...customFoods, newFood];
    setCustomFoods(updated);
    await persist(STORAGE_KEYS.CUSTOM_FOODS, updated);
  }, [customFoods]);

  const saveFood = useCallback(async (food: FoodItem) => {
    const edited = stamp(food);
    const exists = customFoods.find(f => f.id === food.id);
    const updated = exists ? customFoods.map(f => f.id === food.id ? edited : f) : [...customFoods, edited];
    setCustomFoods(updated);
    await persist(STORAGE_KEYS.CUSTOM_FOODS, updated);
  }, [customFoods]);

  const deleteCustomFood = useCallback(async (id: string): Promise<DeleteOutcome> => {
    // Same referential guard as the catalogs, spelled out here rather than
    // reusing deleteOrArchive: a FoodItem carries no `order`, so there is no
    // sequence to renumber behind a removal.
    const referenced = isItemReferenced("food", id, {
      consumptionLogs, symptomLogs, scratchLogs, foods: customFoods, skinPhotos, supplementLogs, activityLogs,
    });
    const updated = referenced
      ? customFoods.map(f => (f.id === id ? stamp({ ...f, isArchived: true }) : f))
      : customFoods.filter(f => f.id !== id);
    setCustomFoods(updated);
    await persist(STORAGE_KEYS.CUSTOM_FOODS, updated);
    return referenced ? "archived" : "deleted";
  }, [customFoods, consumptionLogs, symptomLogs, scratchLogs]);

  // ── Catalogs ──────────────────────────────────────────────────────────────
  // One set of mutators over every kind, dispatching on kind. The archive-vs-
  // delete decision itself lives in constants/catalog.ts, where a test can
  // reach it — this module cannot be imported by one.
  function catalogItems(kind: CatalogKind): CatalogItem[] {
    switch (kind) {
      case "bodyLocation": return bodyLocations;
      case "cue": return cues;
      case "routine": return routines;
      case "symptom": return symptoms;
      case "foodCategory": return foodCategories;
      case "foodTag": return foodTags;
      case "supplement": return supplements;
      case "activity": return activities;
    }
  }

  async function writeCatalog(kind: CatalogKind, items: CatalogItem[]) {
    switch (kind) {
      case "bodyLocation": setBodyLocations(items); break;
      case "cue": setCues(items); break;
      // A routine's `description` rides along untouched: this path only ever
      // spreads whole items, so the field survives a signature that has
      // forgotten about it.
      case "routine": setRoutines(items); break;
      case "symptom": setSymptoms(items); break;
      // A tag's `icon` rides along the same way a routine's description does:
      // whole items are spread through this path, so the field survives.
      case "foodCategory": setFoodCategories(items); break;
      case "foodTag": setFoodTags(items); break;
      case "supplement": setSupplements(items); break;
      case "activity": setActivities(items); break;
    }
    await persist(CATALOG_KEYS[kind], items);
  }

  const addCatalogItem = useCallback(async (
    kind: CatalogKind, name: string, extra?: { description?: string; icon?: string },
  ) => {
    // A blank name is refused outright rather than stored: the item would be
    // unpickable. Uniqueness is the add screen's job — see cleanItemName.
    const cleaned = cleanItemName(name);
    if (!cleaned) return;
    const items = catalogItems(kind);
    // `items.length` is the next free slot because archived items keep theirs
    // and a hard delete renumbers densely — so no two items share an order.
    const newItem = stamp<RoutineItem>({
      ...extra, id: generateId(), name: cleaned, order: items.length, isArchived: false,
    });
    await writeCatalog(kind, [...items, newItem]);
  }, [bodyLocations, cues, routines, symptoms, foodCategories, foodTags, supplements, activities]);

  const updateCatalogItem = useCallback(async (kind: CatalogKind, item: RoutineItem) => {
    // Same rule as the add path: a rename to blank leaves the item untouched.
    const cleaned = cleanItemName(item.name);
    if (!cleaned) return;
    const renamed = stamp({ ...item, name: cleaned });
    await writeCatalog(kind, catalogItems(kind).map(i => (i.id === item.id ? renamed : i)));
  }, [bodyLocations, cues, routines, symptoms, foodCategories, foodTags, supplements, activities]);

  const deleteCatalogItem = useCallback(async (kind: CatalogKind, id: string): Promise<DeleteOutcome> => {
    const { items, outcome } = deleteOrArchive(
      catalogItems(kind),
      id,
      isItemReferenced(kind, id, {
        consumptionLogs, symptomLogs, scratchLogs, foods: customFoods, skinPhotos, supplementLogs, activityLogs,
      }),
    );
    await writeCatalog(kind, items);
    return outcome;
  }, [
    bodyLocations, cues, routines, symptoms, foodCategories, foodTags, supplements, activities,
    consumptionLogs, symptomLogs, scratchLogs, customFoods, skinPhotos,
  ]);

  const reorderCatalogItems = useCallback(async (kind: CatalogKind, ids: string[]) => {
    await writeCatalog(kind, reorderByIds(catalogItems(kind), ids));
  }, [bodyLocations, cues, routines, symptoms, foodCategories, foodTags, supplements, activities]);

  // ── Habit definitions ─────────────────────────────────────────────────────
  const addPresetGroup = useCallback(async (name: string, type: PresetGroupType, item_ids: string[]) => {
    const group: PresetGroup = {
      id: "preset_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      name,
      type,
      item_ids,
      isArchived: false,
    };
    const updated = [...presetGroups, group];
    setPresetGroups(updated);
    await persist(STORAGE_KEYS.PRESET_GROUPS, updated);
  }, [presetGroups]);

  const updatePresetGroup = useCallback(async (group: PresetGroup) => {
    const updated = presetGroups.map(g => g.id === group.id ? group : g);
    setPresetGroups(updated);
    await persist(STORAGE_KEYS.PRESET_GROUPS, updated);
  }, [presetGroups]);

  const deletePresetGroup = useCallback(async (id: string) => {
    const updated = presetGroups.map(g => g.id === id ? { ...g, isArchived: true } : g);
    setPresetGroups(updated);
    await persist(STORAGE_KEYS.PRESET_GROUPS, updated);
  }, [presetGroups]);

const setDailyNote = useCallback(async (date: string, text: string) => {
    let updated: DailyNote[];
    if (!text.trim()) {
      updated = dailyNotes.filter(n => n.date !== date);
    } else {
      const exists = dailyNotes.find(n => n.date === date);
      if (exists) updated = dailyNotes.map(n => n.date === date ? { ...n, text } : n);
      else updated = [...dailyNotes, { id: date, date, text }];
    }
    setDailyNotes(updated);
    await persist(STORAGE_KEYS.DAILY_NOTES, updated);
  }, [dailyNotes]);

  const addHabitDefinition = useCallback(async (def: Omit<HabitDefinition, "id" | "order" | "isArchived">) => {
    const newDef: HabitDefinition = stamp({
      ...def, id: generateId(), order: habitDefinitions.length, isArchived: false,
    });
    const updated = [...habitDefinitions, newDef];
    setHabitDefinitions(updated);
    await persist(STORAGE_KEYS.HABIT_DEFINITIONS, updated);
  }, [habitDefinitions]);

  const updateHabitDefinition = useCallback(async (def: HabitDefinition) => {
    const updated = habitDefinitions.map(d => (d.id === def.id ? stamp(def) : d));
    setHabitDefinitions(updated);
    await persist(STORAGE_KEYS.HABIT_DEFINITIONS, updated);
  }, [habitDefinitions]);

  const deleteHabitDefinition = useCallback(async (id: string) => {
    const reindexed = reindex(habitDefinitions.filter(d => d.id !== id));
    setHabitDefinitions(reindexed);
    await persist(STORAGE_KEYS.HABIT_DEFINITIONS, reindexed);
    // Filtered from the cell, not from state, so a tile tap landing in the
    // same render as the delete cannot bring its habit's logs back.
    const prunedLogs = habitLogCell.get().filter(l => l.habitId !== id);
    habitLogCell.set(prunedLogs);
    await persist(STORAGE_KEYS.HABIT_LOGS, prunedLogs);
  }, [habitDefinitions]);

  // ── Habit logs ────────────────────────────────────────────────────────────
  const setHabitLog = useCallback(async (habitId: string, date: string, value: HabitValue) => {
    // Read the cell, not state: the habit tiles save on every tap, so three
    // ticks can land inside one render. The cell is correct synchronously,
    // which is what makes each tap fold onto the last one's result and what
    // gives persist() the whole array rather than one tap's view of it.
    const updated = applyHabitLog(habitLogCell, habitId, date, value, generateId);
    await persist(STORAGE_KEYS.HABIT_LOGS, updated);
  }, []);

  const getHabitLogsForDate = useCallback((date: string): HabitLog[] => {
    return habitLogs.filter(l => l.date === date);
  }, [habitLogs]);

  // ── Skin photos ───────────────────────────────────────────────────────────
  const addSkinPhoto = useCallback(async (source: PhotoSource, dateKey: string) => {
    const id = generateId();
    const takenAt = new Date().toISOString();
    const saved = await capturePhoto(source, takenAt, id);
    // Cancelled, or a platform with nowhere to put it. Neither is an error.
    if (!saved) return false;
    const updated = addPhoto(skinPhotos, { id, date: dateKey, file: saved.file, takenAt });
    setSkinPhotos(updated);
    await persist(STORAGE_KEYS.SKIN_PHOTOS, updated);
    return true;
  }, [skinPhotos]);

  const deleteSkinPhoto = useCallback(async (id: string) => {
    const { photos, removedFile } = removePhoto(skinPhotos, id);
    setSkinPhotos(photos);
    await persist(STORAGE_KEYS.SKIN_PHOTOS, photos);
    // After the record, deliberately. A file deleted with the record left
    // behind is a permanently broken tile — unrecoverable. A record dropped
    // with the file left behind just orphans the file on disk: harmless,
    // and nothing here claims it gets cleaned up later.
    if (removedFile) await deletePhotoFile(removedFile);
  }, [skinPhotos]);

  const setPhotoLocation = useCallback(async (id: string, location: string | undefined) => {
    const updated = setLocation(skinPhotos, id, location);
    if (updated === skinPhotos) return;
    setSkinPhotos(updated);
    await persist(STORAGE_KEYS.SKIN_PHOTOS, updated);
  }, [skinPhotos]);

  const setPhotoTime = useCallback(async (id: string, takenAt: string) => {
    const dateKey = localDateKey(takenAt);
    const updated = setPhotoTimeIn(skinPhotos, id, takenAt, dateKey);
    if (updated === skinPhotos) return;
    setSkinPhotos(updated);
    await persist(STORAGE_KEYS.SKIN_PHOTOS, updated);
  }, [skinPhotos]);

  const getRecentConsumptionLogs = useCallback((days = 7) => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return consumptionLogs.filter(l => new Date(l.timestamp) >= cutoff);
  }, [consumptionLogs]);


  // ── Backup ────────────────────────────────────────────────────────────────
  useEffect(() => {
    // Stored via persist(), which JSON.stringifies — but a device may still
    // carry an older raw ISO string written before this went through the
    // gate, so tolerate both shapes rather than breaking existing installs.
    AsyncStorage.getItem(STORAGE_KEYS.LAST_BACKUP_AT).then(v => {
      if (!v) { setLastBackupAt(null); return; }
      try { setLastBackupAt(JSON.parse(v)); } catch { setLastBackupAt(v); }
    }).catch(() => {});
    return watchAuth(setBackupUser);
  }, []);

  // Read straight from state; this is only ever called from a user action, so
  // the closure is current by construction.
  const snapshot = useCallback((): Snapshot => ({
    consumptionLogs, supplementLogs, activityLogs, symptomLogs, scratchLogs, customFoods,
    habitDefinitions, habitLogs,
    bodyLocations, cues, routines, symptoms,
    foodCategories, foodTags, supplements, activities, presetGroups, dailyNotes,
    ledger,
  }), [
    consumptionLogs, supplementLogs, activityLogs, symptomLogs, scratchLogs, customFoods, habitDefinitions, habitLogs,
    bodyLocations, cues, routines, symptoms, foodCategories, foodTags, supplements, activities, presetGroups, dailyNotes, ledger,
  ]);

  const signIn = useCallback(async (email: string, password: string) => {
    setBackupError(null);
    setBackupStatus("working");
    try {
      const user = await fbSignIn(email, password);
      setBackupUser(user);
      setBackupStatus("idle");
    } catch (e: any) {
      setBackupError(e?.message ?? String(e));
      setBackupStatus("error");
      throw e;
    }
  }, []);

  const signOut = useCallback(async () => {
    // Signing out locally must succeed even if the network call fails, or the
    // UI is stuck showing an account the user asked to leave.
    try { await fbSignOut(); } catch { /* ignore */ }
    setBackupUser(null);
    setBackupStatus("idle");
    setBackupError(null);
  }, []);

  const backupNow = useCallback(async () => {
    if (!backupUser) return;
    setBackupError(null);
    setBackupStatus("working");
    try {
      await pushSnapshot(backupUser.uid, snapshot());
      const at = new Date().toISOString();
      setLastBackupAt(at);
      const saved = await persist(STORAGE_KEYS.LAST_BACKUP_AT, at);
      if (!saved) {
        // The backup itself already landed on the server; only the local
        // "last backup at" timestamp failed to write. Say exactly that,
        // rather than implying the backup failed.
        setBackupError(
          "Backed up successfully, but this device could not record when — " +
            "it's likely low on storage. Free up space; the backup itself is fine.",
        );
        setBackupStatus("error");
        return;
      }
      setBackupStatus("success");
    } catch (e: any) {
      setBackupError(e?.message ?? String(e));
      setBackupStatus("error");
    }
  }, [backupUser, snapshot]);

  const restoreFromBackup = useCallback(async () => {
    if (!backupUser) return;
    if (!loadGate.canWrite()) {
      // The initial load never succeeded, so `snapshot()` here would be built
      // entirely from empty defaults. Merging that with the remote copy and
      // writing the result — or even just setting it into React state, with
      // the disk write silently dropped by persist() — would show data on
      // screen that vanishes on the next launch. Refuse outright instead.
      const message =
        "Your data could not be loaded when the app started, so restoring now " +
        "would overwrite it with a merge built on empty local data. Restart " +
        "the app and try again.";
      setBackupError(message);
      setBackupStatus("error");
      notify("Restore blocked", message);
      return;
    }
    setBackupError(null);
    setBackupStatus("working");
    try {
      const remote = await pullSnapshot(backupUser.uid);
      const merged = mergeSnapshots(snapshot(), remote);
      setConsumptionLogs(merged.consumptionLogs);
      symptomLogCell.set(merged.symptomLogs);
      setScratchLogs(merged.scratchLogs);
      setCustomFoods(merged.customFoods);
      setHabitDefinitions(merged.habitDefinitions);
      habitLogCell.set(merged.habitLogs);
      setBodyLocations(merged.bodyLocations);
      setCues(merged.cues);
      setRoutines(merged.routines);
      setSymptoms(merged.symptoms);
      setFoodCategories(merged.foodCategories);
      setFoodTags(merged.foodTags);
      // Through readLedger like the disk path, not straight in: the cloud copy
      // can be older than this device's code. A backup taken before spans holds
      // `{ days, elimination, materialisedThrough }`, and restoring that
      // unchecked puts a ledger with no `spans` array into state, where the
      // next span lookup throws on `.find`.
      if (merged.ledger) setLedgerState(readLedger(merged.ledger));

      // Named so a partial failure can say which collections did not
      // persist, not just that something did not.
      const writes: [string, Promise<boolean>][] = [
        ["food log", persist(STORAGE_KEYS.CONSUMPTION_LOGS, merged.consumptionLogs)],
        ["symptom log", persist(STORAGE_KEYS.SYMPTOM_LOGS, merged.symptomLogs)],
        ["scratch log", persist(STORAGE_KEYS.SCRATCH_LOGS, merged.scratchLogs)],
        ["custom foods", persist(STORAGE_KEYS.CUSTOM_FOODS, merged.customFoods)],
        ["habits", persist(STORAGE_KEYS.HABIT_DEFINITIONS, merged.habitDefinitions)],
        ["habit logs", persist(STORAGE_KEYS.HABIT_LOGS, merged.habitLogs)],
        ["body locations", persist(STORAGE_KEYS.BODY_LOCATIONS, merged.bodyLocations)],
        ["urge cues", persist(STORAGE_KEYS.CUES, merged.cues)],
        ["competing routines", persist(STORAGE_KEYS.ROUTINES, merged.routines)],
        ["symptoms", persist(STORAGE_KEYS.SYMPTOMS, merged.symptoms)],
        ["food categories", persist(STORAGE_KEYS.FOOD_CATEGORIES, merged.foodCategories)],
        ["food tags", persist(STORAGE_KEYS.FOOD_TAGS, merged.foodTags)],
        ...(merged.ledger
          ? ([["phase ledger", persist(STORAGE_KEYS.PHASE_LEDGER, merged.ledger)]] as [string, Promise<boolean>][])
          : []),
      ];
      const results = await Promise.all(writes.map(([, p]) => p));
      const failed = writes.filter((_, i) => !results[i]).map(([label]) => label);
      if (failed.length > 0) {
        // State above is already the merged data — it is genuinely on
        // screen. Only the disk copy is short some collections, so say
        // that, not that the restore failed outright.
        setBackupError(
          `Restored data is on screen, but ${failed.join(", ")} did not save to this ` +
            "device — it's likely low on storage. Free up space and restore again.",
        );
        setBackupStatus("error");
        return;
      }
      setBackupStatus("success");
    } catch (e: any) {
      setBackupError(e?.message ?? String(e));
      setBackupStatus("error");
    }
  }, [backupUser, snapshot]);

  return (
    <AppContext.Provider value={{
      consumptionLogs, supplementLogs, activityLogs, supplements, activities, presetGroups, symptomLogs, scratchLogs, customFoods, allFoods,
      habitDefinitions, habitLogs, skinPhotos, dailyNotes,
      bodyLocations, cues, routines, symptoms, foodCategories, foodTags,
      ledger, activePhase, currentPhase, selectedDate, todayDateKey, isLoaded,
      setSelectedDate,
      addConsumptionLog, addConsumptionLogs, deleteConsumptionLog, addSupplementLog, deleteSupplementLog, addActivityLog, deleteActivityLog,
      updateMeal, deleteMeal,
      addSymptomLog, deleteSymptomLog,
      addScratchLog, updateScratchLog, deleteScratchLog,
      scheduleElimination, endEliminationEarly, startChallenge, endChallenge, updatePhase,
      getRecentConsumptionLogs,
      addCustomFood, saveFood, deleteCustomFood,
      addCatalogItem, updateCatalogItem, deleteCatalogItem, reorderCatalogItems,
      addHabitDefinition, updateHabitDefinition, deleteHabitDefinition,
      addPresetGroup, updatePresetGroup, deletePresetGroup,
      setDailyNote,
      setHabitLog, getHabitLogsForDate,
      addSkinPhoto, deleteSkinPhoto, setPhotoLocation, setPhotoTime,
      backupAvailable, backupUser, backupStatus, backupError, lastBackupAt,
      signIn, signOut, backupNow, restoreFromBackup,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used inside AppProvider");
  return ctx;
}
