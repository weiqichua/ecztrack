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
    <TouchableOpacity
      style={[styles.pickerEmpty, { borderColor: colors.border }]}
      onPress={onManage}
      activeOpacity={0.7}
    >
      <MciIcon name="plus" size={16} color={colors.mutedForeground} />
      <Text style={[styles.pickerEmptyText, { color: colors.mutedForeground }]}>{text}</Text>
    </TouchableOpacity>
  );
}

export default function ScratchTrackerScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    scratchLogs, addScratchLog, deleteScratchLog,
    habitDefinitions, setHabitLog, getHabitLogsForDate,
    selectedDate, setSelectedDate,
    bodyLocations, cues, routines,
  } = useAppContext();

  const activeLocations = useMemo(() => activeItems(bodyLocations), [bodyLocations]);
  const activeCues = useMemo(() => activeItems(cues), [cues]);
  const activeRoutines = useMemo(() => activeItems(routines), [routines]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  // ── Daily Habits state ────────────────────────────────────────────────────
  const [habitModal, setHabitModal] = useState<{ visible: boolean; habit: HabitDefinition | null }>({
    visible: false,
    habit: null,
  });
  const activeHabits = useMemo(() => activeItems(habitDefinitions), [habitDefinitions]);
  const logsForDate = useMemo(() => getHabitLogsForDate(selectedDate), [selectedDate, getHabitLogsForDate]);

  function getHabitValue(habitId: string): number {
    return logsForDate.find(l => l.habitId === habitId)?.value ?? 0;
  }

  // The next value is derived inside the mutator, not here. `getHabitValue`
  // reads React state, which is a render out of date the moment a tap lands, so
  // two quick taps on one tile both computed from the same pre-tap number and
  // the second wrote what the first already had — +1 for two taps. Handing over
  // the arithmetic lets it resolve against the newest array.
  // Haptics stay fire-and-forget: awaiting them yields, which is what made the
  // stale read easy to hit in the first place.
  async function handleCheckToggle(habitId: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    await setHabitLog(habitId, selectedDate, current => (current > 0 ? 0 : 1));
  }

  async function handleCountChange(habitId: string, delta: number) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    await setHabitLog(habitId, selectedDate, current => Math.max(0, current + delta));
  }

  const completedCount = activeHabits.filter(h => getHabitValue(h.id) > 0).length;

  const completedCount = activeHabits.filter(h => getHabitValue(h.id) > 0).length;

  // ── List header — contains the entire Daily Habits section ────────────────
  function ListHeader() {
    return (
      <View>
        {/* ── Daily Habits ─────────────────────────────────────────── */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Daily Habits</Text>
          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: colors.primary }]}
            onPress={() => setHabitModal({ visible: true, habit: null })}
            activeOpacity={0.8}
            hitSlop={{ top: 3, bottom: 3, left: 3, right: 3 }}
          >
            <MciIcon name="plus" size={20} color={colors.primaryForeground} />
          </TouchableOpacity>
        </View>

        <View style={[styles.weekStripWrap, { borderBottomColor: colors.border }]}>
          <WeekStrip selectedDate={selectedDate} onSelect={setSelectedDate} />
        </View>

        {activeHabits.length === 0 ? (
          <View style={[styles.emptyHabits, { borderColor: colors.border }]}>
            <MciIcon name="checkbox-marked-outline" size={36} color={colors.mutedForeground} />
            <Text style={[styles.emptyHabitsText, { color: colors.mutedForeground }]}>
              No habits yet — tap + to add your first
            </Text>
          </View>
        ) : (
          <View style={styles.habitsCard}>
            {activeHabits.length > 0 && (
              <View style={styles.habitsSummaryRow}>
                <Text style={[styles.habitsSummaryText, { color: colors.mutedForeground }]}>
                  {completedCount} / {activeHabits.length} completed
                </Text>
                <View style={[styles.progressBarBg, { backgroundColor: colors.border }]}>
                  <View
                    style={[
                      styles.progressBarFill,
                      {
                        backgroundColor: completedCount === activeHabits.length ? colors.success : colors.primary,
                        width: `${activeHabits.length > 0 ? (completedCount / activeHabits.length) * 100 : 0}%`,
                      },
                    ]}
                  />
                </View>
              </View>
            )}

            {activeHabits.map(habit => {
              const value = getHabitValue(habit.id);
              const isDone = value > 0;
              const goal = habit.goal ?? 1;
              const progress = habit.unit === "count" ? Math.min(1, value / goal) : isDone ? 1 : 0;

              return (
                <TouchableOpacity
                  key={habit.id}
                  style={[
                    styles.habitRow,
                    {
                      backgroundColor: colors.card,
                      borderColor: isDone ? colors.primary + "55" : colors.border,
                    },
                  ]}
                  onPress={() => habit.unit === "check" && handleCheckToggle(habit.id)}
                  onLongPress={() => setHabitModal({ visible: true, habit })}
                  activeOpacity={habit.unit === "check" ? 0.7 : 1}
                >
                  {/* Icon */}
                  <View style={[
                    styles.habitIcon,
                    { backgroundColor: isDone ? colors.primary + "22" : colors.muted },
                  ]}>
                    <MciIcon
                      name={habit.icon as any}
                      size={20}
                      color={isDone ? colors.primary : colors.mutedForeground}
                    />
                  </View>

                  {/* Name + count progress */}
                  <View style={styles.habitMid}>
                    <Text style={[styles.habitName, { color: colors.foreground }]}>{habit.name}</Text>
                    {habit.unit === "count" && (
                      <View style={styles.countProgressRow}>
                        <View style={[styles.countProgressBg, { backgroundColor: colors.border }]}>
                          <View style={[
                            styles.countProgressFill,
                            {
                              width: `${progress * 100}%`,
                              backgroundColor: progress >= 1 ? colors.success : colors.primary,
                            },
                          ]} />
                        </View>
                        <Text style={[styles.countGoalText, { color: colors.mutedForeground }]}>
                          {value}/{goal}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Right control */}
                  {habit.unit === "check" ? (
                    <MciIcon
                      name={isDone ? "check-circle" : "checkbox-blank-circle-outline"}
                      size={26}
                      color={isDone ? colors.success : colors.border}
                    />
                  ) : (
                    <View style={styles.countControls}>
                      <TouchableOpacity
                        style={[styles.countBtn, { borderColor: colors.border }]}
                        onPress={() => handleCountChange(habit.id, -1)}
                        activeOpacity={0.7}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      >
                        <MciIcon name="minus" size={16} color={colors.foreground} />
                      </TouchableOpacity>
                      <Text style={[styles.countValue, { color: colors.foreground }]}>{value}</Text>
                      <TouchableOpacity
                        style={[styles.countBtn, { borderColor: colors.border, backgroundColor: colors.primary + "22" }]}
                        onPress={() => handleCountChange(habit.id, 1)}
                        activeOpacity={0.7}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      >
                        <MciIcon name="plus" size={16} color={colors.primary} />
                      </TouchableOpacity>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}

            <TouchableOpacity
              style={styles.manageRow}
              onPress={() => setHabitModal({ visible: true, habit: null })}
              activeOpacity={0.7}
            >
              <MciIcon name="pencil-outline" size={14} color={colors.mutedForeground} />
              <Text style={[styles.manageText, { color: colors.mutedForeground }]}>
                Long-press any habit to edit · tap + to add new
              </Text>
            </TouchableOpacity>
          </View>
        )}

        )}
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* Screen-level header with safe-area padding */}
      <View style={[styles.screenHeader, { paddingTop: topPad + 28, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}>
        <Text style={[styles.screenTitle, { color: colors.foreground }]}>Habits</Text>
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.list,
          { paddingBottom: Platform.OS === "web" ? 74 : insets.bottom + 72 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <ListHeader />
      </ScrollView>

      {/* ── Habit Edit Modal ───────────────────────────────────────────── */}
      <HabitEditModal
        visible={habitModal.visible}
        habit={habitModal.habit}
        onClose={() => setHabitModal({ visible: false, habit: null })}
      />


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
