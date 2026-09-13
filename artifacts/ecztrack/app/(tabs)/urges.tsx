import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ScrollView,
  Platform,
  Modal,
  Switch,
} from "react-native";
import { confirmDestructive, notify } from "@/lib/dialogs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MciIcon from "@/components/MciIcon";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useAppContext } from "@/context/AppContext";
import ScratchLogCard from "@/components/ScratchLogCard";
import HabitEditModal from "@/components/HabitEditModal";
import WeekStrip from "@/components/WeekStrip";
import TimestampPicker from "@/components/TimestampPicker";
import CatalogManagerModal from "@/components/CatalogManagerModal";
import PickerHeader from "@/components/PickerHeader";
import ScratchLogEditModal from "@/components/ScratchLogEditModal";
import { ScratchLog, SUCCESS_LABELS, HabitDefinition } from "@/constants/types";
import { activeItems, CatalogKind } from "@/constants/catalog";
import { TIME_RANGES, filterByRecency, type TimeRangeKey } from "@/lib/timeRange";

type Colors = ReturnType<typeof useColors>;

// Shown instead of a blank row. Every catalog starts empty, so for a new user
// this is the first thing the log form shows — it has to say what to do.
function PickerEmpty(
  { text, colors, onManage }: { text: string; colors: Colors; onManage: () => void },
) {
  return (
export default function UrgesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    scratchLogs, addScratchLog, deleteScratchLog,
    bodyLocations, cues, routines,
  } = useAppContext();

  // The catalogs start empty and stay empty until the user adds items, so none
  // of these may assume a first element exists.
  const activeLocations = useMemo(() => activeItems(bodyLocations), [bodyLocations]);
  const activeCues = useMemo(() => activeItems(cues), [cues]);
  const activeRoutines = useMemo(() => activeItems(routines), [routines]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  // ── Scratch Urge state ────────────────────────────────────────────────────
  const [showScratchModal, setShowScratchModal] = useState(false);
  // The log being edited, held as the object itself so the sheet can render it
  // directly — the same shape the home page's list uses.
  const [editingScratch, setEditingScratch] = useState<ScratchLog | null>(null);
  const savingScratch = useRef(false);
  // Catalog item ids, not display names. Null means nothing is chosen — the
  // only possible state while the catalogs are empty.
  const [location, setLocation] = useState<string | null>(null);
  const [cue, setCue] = useState<string | null>(null);
  const [routineId, setRoutineId] = useState<string | null>(null);
  const [success, setSuccess] = useState<1 | 2 | 3 | 4>(3);
  const [isAccident, setIsAccident] = useState(false);
  const [logTimestamp, setLogTimestamp] = useState(new Date().toISOString());
  // Which catalog the manager modal is editing, or null when it is closed.
  const [managing, setManaging] = useState<CatalogKind | null>(null);
  // The kind stays put while the modal slides away. Reading `managing` directly
  // meant a close fell back to "bodyLocation" on the frame the dismissal began,
  // so the routine manager retitled itself and dropped its description field
  // mid-animation.
  const [managedKind, setManagedKind] = useState<CatalogKind>("bodyLocation");
  // Default to "month" — long enough to see a pattern, short enough that the
  // list stays scrollable.
  const [range, setRange] = useState<TimeRangeKey>("month");

  function openManager(kind: CatalogKind) {
    setManagedKind(kind);
    setManaging(kind);
  }

  // Managing a catalog can retire the very item that is selected here. Left
  // alone, Save would write a dangling id into a log that then renders the raw
  // id forever, so a selection that is no longer offerable is dropped.
  useEffect(() => {
    const dropped: string[] = [];
    if (location && !activeLocations.some(l => l.id === location)) {
      setLocation(null);
      dropped.push("body location");
    }
    if (cue && !activeCues.some(c => c.id === cue)) {
      setCue(null);
      dropped.push("trigger");
    }
    if (routineId && !activeRoutines.some(r => r.id === routineId)) {
      setRoutineId(null);
      dropped.push("competing routine");
    }
    // Said here rather than left for Save to discover: a chip that quietly
    // empties itself and a "Choose a body location" error several taps later
    // are the same event, and nothing on screen connects them.
    if (dropped.length > 0) {
      notify(
        "Selection cleared",
        `The ${dropped.join(" and ")} you had chosen ${dropped.length > 1 ? "are" : "is"} no longer on the list. Pick again before saving.`,
      );
    }
  }, [activeLocations, activeCues, activeRoutines, location, cue, routineId]);

  function openScratchModal() {
    setLogTimestamp(new Date().toISOString());
    setIsAccident(false);
    setShowScratchModal(true);
  }

  async function handleSaveScratch() {
    // The awaits below yield, so a second tap could re-enter and write a
    // duplicate entry. A ref guards synchronously; state would update too late.
    if (savingScratch.current) return;
    // A log has to name where and why; the routine is genuinely optional. With
    // empty catalogs there is nothing to pick, so this is the normal state
    // until the user creates their first location and cue.
    if (!location || !cue) {
      // A silent return here is indistinguishable from a broken Save button,
      // and with empty catalogs it is the state every new user starts in.
      notify(
        "Missing details",
        !location
          ? "Choose a body location — use + Add above if the list is empty."
          : "Choose a trigger — use + Add above if the list is empty.",
      );
      return;
    }
    savingScratch.current = true;
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await addScratchLog({
        timestamp: logTimestamp,
        location,
        cue,
        routine_id: routineId,
        success,
        is_accident: isAccident,
      });
      setShowScratchModal(false);
    } finally {
      savingScratch.current = false;
    }
  }

  async function handleDeleteScratch(id: string) {
    const ok = await confirmDestructive(
      "Delete this entry?",
      "This urge log will be removed permanently.",
    );
    if (!ok) return;
    deleteScratchLog(id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }

  const totalLogs = scratchLogs.length;
  const resistedCount = scratchLogs.filter(l => l.success >= 3).length;
  const resistRate = totalLogs > 0 ? Math.round((resistedCount / totalLogs) * 100) : 0;

  // Derived per render, not in a useMemo keyed on mount — this tab is mounted
  // once and never unmounts, so Date.now() must be read on each render or the
  // window freezes at whenever the app was opened.
  const visibleLogs = filterByRecency(scratchLogs, range, Date.now());

  // ── List header — contains the Urges header and stats ────────────────
  function ListHeader() {
    return (
      <View style={styles.listHeader}>
        {/* ── Habit Reversal header ─────────────────────────────────── */}
        <View style={[styles.sectionHeader, { marginTop: 4 }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Urges Tracked</Text>
          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: colors.primary }]}
            onPress={openScratchModal}
            activeOpacity={0.8}
          >
            <MciIcon name="plus" size={20} color={colors.primaryForeground} />
          </TouchableOpacity>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 12 }}
        >
          {TIME_RANGES.map(r => (
            <TouchableOpacity
              key={r.key}
              onPress={() => setRange(r.key)}
              activeOpacity={0.7}
              style={{
                paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
                backgroundColor: range === r.key ? colors.primary : colors.card,
                borderWidth: 1, borderColor: colors.border,
              }}
            >
              <Text style={{
                fontSize: 13, fontFamily: "Inter_600SemiBold",
                color: range === r.key ? colors.primaryForeground : colors.mutedForeground,
              }}>
                {r.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {range !== "all" && (
          <Text style={{ paddingHorizontal: 16, marginBottom: 10, fontSize: 12, color: colors.mutedForeground }}>
            Showing {visibleLogs.length} of {scratchLogs.length} entries · stats above cover all time
          </Text>
        )}

        {totalLogs > 0 && (
          <View style={[styles.statsRow, { gap: 10, paddingHorizontal: 16, marginBottom: 14 }]}>
            <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.statNumber, { color: colors.foreground }]}>{totalLogs}</Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Total</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.statNumber, { color: colors.success }]}>{resistRate}%</Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Resisted</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.statNumber, { color: colors.primary }]}>{resistedCount}</Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Successes</Text>
            </View>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* Screen-level header with safe-area padding */}
      <View style={[styles.screenHeader, { paddingTop: topPad + 28, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}>
        <Text style={[styles.screenTitle, { color: colors.foreground }]}>Urges</Text>
      </View>
      <FlatList
        data={visibleLogs}
        keyExtractor={item => item.id}
        ListHeaderComponent={<ListHeader />}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: Platform.OS === "web" ? 74 : insets.bottom + 72 },
        ]}
        renderItem={({ item }) => (
          <ScratchLogCard
            log={item}
            onEdit={setEditingScratch}
            onDelete={handleDeleteScratch}
          />
        )}
        ListEmptyComponent={
          scratchLogs.length > 0 ? (
            <View style={styles.emptyScratch}>
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Nothing in this range</Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                Pick a longer range to see older entries.
              </Text>
            </View>
          ) : (
            <View style={styles.emptyScratch}>
              <MciIcon name="hand-peace" size={40} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No urge events yet</Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                Track scratch urges and log your habit reversal attempts
              </Text>
              <TouchableOpacity
                style={[styles.emptyBtn, { backgroundColor: colors.primary }]}
                onPress={openScratchModal}
              >
                <Text style={[styles.emptyBtnText, { color: colors.primaryForeground }]}>Log First Entry</Text>
              </TouchableOpacity>
            </View>
          )
        }
        scrollEnabled
      />

      {/* Hoisted to a sibling of the list, not nested in it — a Modal inside
          scrolling content misbehaves on web. */}
      <ScratchLogEditModal
        visible={editingScratch !== null}
        log={editingScratch}
        onClose={() => setEditingScratch(null)}
      />

      {/* ── Scratch Urge Log Modal ────────────────────────────────────── */}
      <Modal
        visible={showScratchModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowScratchModal(false)}
      >
        <View style={[styles.modal, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => setShowScratchModal(false)}>
              <MciIcon name="close" size={24} color={colors.foreground} />
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Log Scratch Urge</Text>
            <TouchableOpacity
              onPress={handleSaveScratch}
              style={[styles.saveModalBtn, { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.saveModalText, { color: colors.primaryForeground }]}>Save</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.modalContent}>
            <View style={[styles.metaCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <TimestampPicker value={logTimestamp} onChange={setLogTimestamp} label="Log for" />
              <View style={styles.accidentRow}>
                <MciIcon
                  name="alert-circle-outline"
                  size={14}
                  color={isAccident ? colors.destructive : colors.mutedForeground}
                />
                <Text style={[styles.accidentLabel, {
                  color: isAccident ? colors.destructive : colors.mutedForeground,
                }]}>
                  Involuntary / accidental scratch
                </Text>
                <Switch
                  value={isAccident}
                  onValueChange={setIsAccident}
                  trackColor={{ false: colors.border, true: colors.destructive + "88" }}
                  thumbColor={isAccident ? colors.destructive : colors.mutedForeground}
                />
              </View>
            </View>

            <PickerHeader label="Body Location" colors={colors} onManage={() => openManager("bodyLocation")} />
            {activeLocations.length === 0 ? (
              <PickerEmpty
                text="No body locations yet — add one"
                colors={colors}
                onManage={() => openManager("bodyLocation")}
              />
            ) : (
            <View style={styles.chipGrid}>
              {activeLocations.map(loc => (
                <TouchableOpacity
                  key={loc.id}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: location === loc.id ? colors.primary : colors.card,
                      borderColor: location === loc.id ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setLocation(loc.id)}
                  onLongPress={() => openManager("bodyLocation")}
                >
                  <Text style={[styles.chipText, {
                    color: location === loc.id ? colors.primaryForeground : colors.foreground,
                  }]}>
                    {loc.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            )}

            <PickerHeader label="Trigger / Cue" colors={colors} onManage={() => openManager("cue")} />
            {activeCues.length === 0 ? (
              <PickerEmpty
                text="No triggers yet — add one"
                colors={colors}
                onManage={() => openManager("cue")}
              />
            ) : (
            <View style={styles.chipGrid}>
              {activeCues.map(c => (
                <TouchableOpacity
                  key={c.id}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: cue === c.id ? colors.accent : colors.card,
                      borderColor: cue === c.id ? colors.accent : colors.border,
                    },
                  ]}
                  onPress={() => setCue(c.id)}
                  onLongPress={() => openManager("cue")}
                >
                  <Text style={[styles.chipText, {
                    color: cue === c.id ? colors.accentForeground : colors.foreground,
                  }]}>
                    {c.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            )}

            <PickerHeader label="Competing Routine Used" colors={colors} onManage={() => openManager("routine")} />
            {activeRoutines.length === 0 ? (
              <PickerEmpty
                text="No competing routines yet — add one"
                colors={colors}
                onManage={() => openManager("routine")}
              />
            ) : (
            <>
            <Text style={[styles.pickerHint, { color: colors.mutedForeground }]}>
              Optional — tap the selected routine again to clear it.
            </Text>
            {activeRoutines.map(routine => (
              <TouchableOpacity
                key={routine.id}
                style={[
                  styles.routineRow,
                  {
                    backgroundColor: routineId === routine.id ? colors.primary + "22" : colors.card,
                    borderColor: routineId === routine.id ? colors.primary : colors.border,
                  },
                ]}
                // Tapping the chosen routine clears it: the field is optional, so
                // a first tap must be undoable without closing the form.
                onPress={() => setRoutineId(routineId === routine.id ? null : routine.id)}
                onLongPress={() => openManager("routine")}
              >
                <View style={[styles.routineRadio, {
                  borderColor: routineId === routine.id ? colors.primary : colors.border,
                }]}>
                  {routineId === routine.id && (
                    <View style={[styles.routineRadioFill, { backgroundColor: colors.primary }]} />
                  )}
                </View>
                <View style={styles.routineInfo}>
                  <Text style={[styles.routineName, { color: colors.foreground }]}>{routine.name}</Text>
                  {routine.description ? (
                    <Text style={[styles.routineDesc, { color: colors.mutedForeground }]}>{routine.description}</Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            ))}
            </>
            )}

            <Text style={[styles.modalSectionLabel, { color: colors.mutedForeground }]}>Outcome</Text>
            <View style={styles.outcomeRow}>
              {([1, 2, 3, 4] as const).map(val => (
                <TouchableOpacity
                  key={val}
                  style={[
                    styles.outcomeBtn,
                    {
                      backgroundColor: success === val
                        ? (val <= 1 ? colors.destructive : val === 2 ? colors.warning : val === 3 ? colors.primary : colors.success)
                        : colors.card,
                      borderColor: success === val ? "transparent" : colors.border,
                    },
                  ]}
                  onPress={() => setSuccess(val)}
                >
                  <Text style={[
                    styles.outcomeBtnText,
                    { color: success === val ? "#FFF" : colors.foreground },
                  ]}>
                    {SUCCESS_LABELS[val]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          {/* Nested inside this sheet on purpose — it is only ever opened from
              the pickers above, and a sibling Modal would not layer over it. */}
          <CatalogManagerModal
            visible={managing !== null}
            kind={managedKind}
            onClose={() => setManaging(null)}
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  screenHeader: {
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  screenTitle: { fontSize: 28, fontFamily: "Inter_700Bold" },

  // Section headers
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
  },
  sectionTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  addBtn: {
    width: 38, height: 38, borderRadius: 12,
    justifyContent: "center", alignItems: "center",
  },

  // Week strip
  weekStripWrap: {
    marginHorizontal: 16,
    marginBottom: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },

  // Daily Habits
  emptyHabits: {
    marginHorizontal: 16,
    marginBottom: 12,
    paddingVertical: 28,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
    gap: 8,
  },
  emptyHabitsText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", paddingHorizontal: 16 },

  habitsCard: { marginHorizontal: 16, gap: 8, marginBottom: 12 },
  habitsSummaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 4,
  },
  habitsSummaryText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  progressBarBg: {
    flex: 1, height: 4, borderRadius: 2, overflow: "hidden",
  },
  progressBarFill: { height: "100%", borderRadius: 2 },

  habitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  habitIcon: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  habitMid: { flex: 1, gap: 4 },
  habitName: { fontSize: 15, fontFamily: "Inter_500Medium" },
  countProgressRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  countProgressBg: { flex: 1, height: 4, borderRadius: 2, overflow: "hidden" },
  countProgressFill: { height: "100%", borderRadius: 2 },
  countGoalText: { fontSize: 11, fontFamily: "Inter_500Medium", minWidth: 28, textAlign: "right" },

  countControls: { flexDirection: "row", alignItems: "center", gap: 8 },
  countBtn: {
    width: 32, height: 32, borderRadius: 8, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  countValue: { fontSize: 16, fontFamily: "Inter_700Bold", minWidth: 24, textAlign: "center" },

  manageRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
  },
  manageText: { fontSize: 11, fontFamily: "Inter_400Regular" },

  // Divider
  divider: { marginHorizontal: 16, borderTopWidth: 1, marginBottom: 4 },

  // Scratch stats
  statsRow: { flexDirection: "row" },
  statCard: {
    flex: 1, alignItems: "center", paddingVertical: 12,
    borderRadius: 14, borderWidth: 1,
  },
  statNumber: { fontSize: 22, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },

  // Scratch list
  list: { paddingHorizontal: 16, paddingTop: 4 },
  emptyScratch: { alignItems: "center", paddingHorizontal: 32, gap: 8, paddingVertical: 20 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginTop: 4 },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  emptyBtn: {
    marginTop: 12, paddingHorizontal: 24, paddingVertical: 14,
    borderRadius: 14, minHeight: 48,
  },
  emptyBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },

  // Scratch modal
  modal: { flex: 1 },
  modalHeader: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 16, paddingTop: 20, borderBottomWidth: 1,
  },
  modalTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  saveModalBtn: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10,
    minHeight: 36, justifyContent: "center",
  },
  saveModalText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  modalContent: { padding: 20, gap: 12, paddingBottom: 60 },
  metaCard: { padding: 14, borderRadius: 14, borderWidth: 1, gap: 10 },
  accidentRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  accidentLabel: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  modalSectionLabel: {
    fontSize: 12, fontFamily: "Inter_500Medium",
    letterSpacing: 0.8, textTransform: "uppercase", marginTop: 8, marginBottom: 6,
  },
  pickerEmpty: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 18, paddingHorizontal: 14,
    borderRadius: 14, borderWidth: 1, borderStyle: "dashed", marginBottom: 4,
  },
  pickerEmptyText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  pickerHint: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 8 },
  chipGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  chip: {
    paddingHorizontal: 13, paddingVertical: 8, borderRadius: 20, borderWidth: 1,
    minHeight: 36, justifyContent: "center",
  },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  routineRow: {
    flexDirection: "row", alignItems: "center",
    padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 8, gap: 12,
  },
  routineRadio: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 2,
    justifyContent: "center", alignItems: "center",
  },
  routineRadioFill: { width: 10, height: 10, borderRadius: 5 },
  routineInfo: { flex: 1 },
  routineName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  routineDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  outcomeRow: { gap: 8 },
  outcomeBtn: {
    paddingVertical: 14, borderRadius: 14, borderWidth: 1,
    alignItems: "center", minHeight: 48, justifyContent: "center",
  },
  outcomeBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
