import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Platform,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { localDateKey, isOnLocalDay } from "@/lib/dates";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MciIcon from "@/components/MciIcon";
import * as FileSystem from "expo-file-system/legacy";
import { useColors } from "@/hooks/useColors";
import { useAppContext } from "@/context/AppContext";
import { Phase, SymptomLog, SUCCESS_LABELS } from "@/constants/types";
import { phaseOfRecord } from "@/lib/phases";
import { itemName } from "@/constants/catalog";
import { ON_ACCENT } from "@/constants/colors";
import { dayStyle, hasCheckinOn, isRecordedCheckin, loggedPhases, PHASE_COLORS, ACTIVITY_COLORS } from "@/lib/dayStyle";
import { scoreLevel, severityFraction } from "@/lib/scoreScale";
import { monthRows } from "@/lib/monthRows";
import { photoUri } from "@/lib/skinPhotos";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function toDateStr(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function formatDetailDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${d}, ${y}`;
}

export default function CalendarScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    symptomLogs, consumptionLogs, scratchLogs, skinPhotos,
    allFoods, selectedDate, setSelectedDate, ledger, todayDateKey,
    bodyLocations, routines, symptoms,
  } = useAppContext();

  const today = new Date();
  const todayStr = localDateKey(today);

  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [modalDate, setModalDate] = useState<string | null>(null);
  const [view, setView] = useState<"quick" | "detailed">("quick");

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 58 : insets.bottom + 50;

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  const calendarData = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const cells: Array<{ day: number | null; dateStr: string | null }> = [];
    for (let i = 0; i < firstDay; i++) cells.push({ day: null, dateStr: null });
    for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, dateStr: toDateStr(viewYear, viewMonth, d) });
    while (cells.length % 7 !== 0) cells.push({ day: null, dateStr: null });
    return cells;
  }, [viewYear, viewMonth]);

  // Derived per render, not memoised on a stale clock: this tab mounts once
  // and never unmounts, so todayDateKey (from context) is what stays correct
  // after midnight rather than a value captured at mount.
  const rows = monthRows(viewYear, viewMonth, symptomLogs, skinPhotos, todayDateKey);

  const logsByDate = useMemo(() => {
    const map: Record<string, SymptomLog[]> = {};
    for (const log of symptomLogs) {
      if (!map[log.date]) map[log.date] = [];
      map[log.date].push(log);
    }
    return map;
  }, [symptomLogs]);

  const foodDateSet = useMemo(() => {
    const s = new Set<string>();
    consumptionLogs.forEach(l => s.add(localDateKey(l.timestamp)));
    return s;
  }, [consumptionLogs]);

  const urgeByDate = useMemo(() => {
    const s = new Set<string>();
    scratchLogs.forEach(l => s.add(localDateKey(l.timestamp)));
    return s;
  }, [scratchLogs]);

  function handleDayPress(dateStr: string) {
    setSelectedDate(dateStr);
    setModalDate(dateStr);
  }

  /**
   * The phase to show for a day: the ledger's, falling back to a log's stamped
   * copy only where the ledger has nothing. "none" is a real answer — no phase
   * was running — and shows no pill and no phase colour.
   */
  function dayPhase(dateStr: string) {
    return phaseOfRecord(ledger, dateStr, todayStr, loggedPhases(dateStr, symptomLogs, consumptionLogs));
  }

  function getDayStyle(dateStr: string) {
    return dayStyle({
      dateKey: dateStr,
      todayKey: todayStr,
      phase: dayPhase(dateStr),
      hasFood: foodDateSet.has(dateStr),
      hasUrge: urgeByDate.has(dateStr),
      hasCheckin: hasCheckinOn(symptomLogs, dateStr),
    }, colors.primary);
  }

  const styles = makeStyles(colors);

  function ScoreRow({ label, value }: { label: string; value: number }) {
    // 1 = no symptoms, 5 = severe. The bar fills with SEVERITY, so a longer red
    // bar is a worse day — see lib/scoreScale.ts, which owns that reading.
    const pct = severityFraction(value) * 100;
    const level = scoreLevel(value);
    const barColor = level === "bad" ? colors.destructive : level === "warn" ? colors.warning : colors.success;
    return (
      <View style={styles.scoreRow}>
        <Text style={styles.scoreLabel}>{label}</Text>
        <View style={styles.scoreBarBg}>
          <View style={[styles.scoreBarFill, { width: `${pct}%` as any, backgroundColor: barColor }]} />
        </View>
        <Text style={styles.scoreValue}>{value}/5</Text>
      </View>
    );
  }

  function CheckinBlock({ log, label }: { log: SymptomLog; label: string }) {
    // Read from the log, not from the catalog: a log keeps the symptoms it was
    // saved with, including ones the user has since renamed or retired. The
    // average covers exactly those, so a symptom added later is absent rather
    // than counted as a zero.
    // `?? {}` because a stored log is only as well-formed as what is on disk,
    // and a malformed one must not take the whole screen down.
    const scored = Object.entries(log.scores ?? {}).filter(
      (entry): entry is [string, number] => entry[1] != null,
    );
    const avg = scored.length
      ? (scored.reduce((sum, [, v]) => sum + v, 0) / scored.length).toFixed(1)
      : "—";
    return (
      <View style={styles.checkinBlock}>
        <Text style={styles.checkinBlockTitle}>{label} · avg {avg}</Text>
        {scored.map(([id, value]) => (
          <ScoreRow key={id} label={itemName(symptoms, id)} value={value} />
        ))}
      </View>
    );
  }

  const modalDayLogs = modalDate ? (logsByDate[modalDate] ?? []) : [];
  // At most one log per day by construction, and only counted if something was
  // actually scored — an emptied check-in must render as "no check-ins", not as
  // a block with no rows in it.
  const modalSymptomLog = modalDayLogs.find(isRecordedCheckin);
  const modalPhase = modalDate ? dayPhase(modalDate) : null;
  const modalFoods = modalDate
    ? consumptionLogs
        .filter(l => isOnLocalDay(l.timestamp, modalDate))
        .map(l => ({ log: l, food: allFoods.find(f => f.id === l.item_id) }))
    : [];
  const modalUrges = modalDate
    ? scratchLogs.filter(l => isOnLocalDay(l.timestamp, modalDate))
    : [];

  const isNextMonthDisabled =
    viewYear > today.getFullYear() ||
    (viewYear === today.getFullYear() && viewMonth >= today.getMonth());

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <Text style={styles.screenTitle}>Calendar</Text>

      <View style={styles.monthNav}>
        <TouchableOpacity onPress={prevMonth} style={styles.navBtn} hitSlop={12}>
          <MciIcon name="chevron-left" size={28} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.monthLabel}>{MONTH_NAMES[viewMonth]} {viewYear}</Text>
        <TouchableOpacity onPress={nextMonth} style={styles.navBtn} hitSlop={12} disabled={isNextMonthDisabled}>
          <MciIcon
            name="chevron-right" size={28}
            color={isNextMonthDisabled ? colors.mutedForeground : colors.primary}
          />
        </TouchableOpacity>
      </View>

      <View style={styles.viewSwitchRow}>
        <TouchableOpacity
          style={[
            styles.viewChip,
            { backgroundColor: view === "quick" ? colors.primary : colors.card, borderColor: view === "quick" ? colors.primary : colors.border },
          ]}
          onPress={() => setView("quick")}
        >
          <Text style={[styles.viewChipText, { color: view === "quick" ? colors.primaryForeground : colors.foreground }]}>
            Quick
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.viewChip,
            { backgroundColor: view === "detailed" ? colors.primary : colors.card, borderColor: view === "detailed" ? colors.primary : colors.border },
          ]}
          onPress={() => setView("detailed")}
        >
          <Text style={[styles.viewChipText, { color: view === "detailed" ? colors.primaryForeground : colors.foreground }]}>
            Detailed
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomPad + 16 }]}
        showsVerticalScrollIndicator={false}
      >
        {view === "quick" && (
          <>
            <View style={styles.weekdayRow}>
              {WEEKDAYS.map(d => (
                <Text key={d} style={styles.weekdayLabel}>{d}</Text>
              ))}
            </View>
            <View style={styles.grid}>
              {calendarData.map((cell, idx) => {
                if (!cell.day || !cell.dateStr) return <View key={`e-${idx}`} style={styles.dayCell} />;
                const { fill, isToday, isFuture, dots } = getDayStyle(cell.dateStr);
                const isSelected = cell.dateStr === selectedDate;

                return (
                  <TouchableOpacity
                    key={cell.dateStr}
                    style={styles.dayCell}
                    onPress={() => !isFuture && handleDayPress(cell.dateStr!)}
                    activeOpacity={isFuture ? 1 : 0.7}
                  >
                    <View style={[
                      styles.dayCircle,
                      fill ? { backgroundColor: fill } : styles.dayCircleEmpty,
                      isToday && styles.dayCircleToday,
                      isFuture && styles.dayCircleFuture,
                      isSelected && !fill && { borderWidth: 2, borderColor: colors.primary },
                    ]}>
                      <Text style={[
                        styles.dayNumber,
                        fill ? styles.dayNumberFilled : styles.dayNumberEmpty,
                        isFuture && styles.dayNumberFuture,
                      ]}>
                        {cell.day}
                      </Text>
                    </View>
                    <View style={styles.dotRow}>
                      {dots.map(d => (
                        <View key={d.kind} style={[styles.dot, d.color ? { backgroundColor: d.color } : null]} />
                      ))}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.legend}>
              <Text style={styles.legendTitle}>Circle color = phase when logged</Text>
              <View style={styles.legendItems}>
                {(Object.keys(PHASE_COLORS) as Phase[]).filter(p => p !== "none").map(p => (
                  <View key={p} style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: PHASE_COLORS[p] }]} />
                    <Text style={styles.legendLabel}>{p.charAt(0).toUpperCase() + p.slice(1)}</Text>
                  </View>
                ))}
              </View>
              <Text style={[styles.legendTitle, { marginTop: 8 }]}>Dots below = activity type</Text>
              <View style={styles.legendItems}>
                <View style={styles.legendItem}>
                  <View style={[styles.dot, { backgroundColor: ACTIVITY_COLORS.food }]} />
                  <Text style={styles.legendLabel}>Food logged</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.dot, { backgroundColor: ACTIVITY_COLORS.urge }]} />
                  <Text style={styles.legendLabel}>Urge tracked</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.dot, { backgroundColor: ACTIVITY_COLORS.checkin }]} />
                  <Text style={styles.legendLabel}>Check-in done</Text>
                </View>
              </View>
            </View>
          </>
        )}

        {view === "detailed" && (
          <View style={styles.detailedList}>
            {rows.map(row => {
              const uri = row.photo ? photoUri(FileSystem.documentDirectory, row.photo.file) : null;
              const level = row.average != null ? scoreLevel(row.average) : null;
              const avgColor = level === "bad" ? colors.destructive : level === "warn" ? colors.warning : level === "good" ? colors.success : colors.mutedForeground;
              return (
                <TouchableOpacity
                  key={row.dateKey}
                  style={[styles.detailRow, row.isFuture && styles.detailRowFuture]}
                  disabled={row.isFuture}
                  activeOpacity={0.7}
                  onPress={() => {
                    setSelectedDate(row.dateKey);
                    router.push("/(tabs)");
                  }}
                >
                  <Text style={[styles.detailWeekday, row.isFuture && styles.detailFutureText]}>
                    {WEEKDAYS[row.weekday]}
                  </Text>
                  <Text style={[styles.detailDay, row.isFuture && styles.detailFutureText]}>
                    {row.day}
                  </Text>
                  <Text style={[styles.detailAverage, { color: row.isFuture ? colors.mutedForeground : avgColor }]}>
                    {row.average != null ? row.average.toFixed(1) : "—"}
                  </Text>
                  <View style={styles.detailThumb}>
                    {uri && <Image source={{ uri }} style={styles.detailThumbImage} />}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>

      <Modal
        visible={!!modalDate}
        animationType="slide"
        transparent
        onRequestClose={() => setModalDate(null)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setModalDate(null)}
        />
        {modalDate && (
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalDate}>{formatDetailDate(modalDate)}</Text>
                {modalPhase && modalPhase !== "none" && (
                  <View style={[styles.phasePill, { backgroundColor: PHASE_COLORS[modalPhase] + "33" }]}>
                    <View style={[styles.phaseDot, { backgroundColor: PHASE_COLORS[modalPhase] }]} />
                    <Text style={[styles.phaseText, { color: PHASE_COLORS[modalPhase] }]}>
                      {modalPhase.charAt(0).toUpperCase() + modalPhase.slice(1)} Phase
                    </Text>
                  </View>
                )}
              </View>
              <TouchableOpacity onPress={() => setModalDate(null)} hitSlop={12}>
                <MciIcon name="close" size={22} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={styles.modalScroll}>

              {/* Check-ins */}
              <Text style={styles.modalSectionLabel}>Check-ins</Text>
              {!modalSymptomLog ? (
                <View style={styles.emptySection}>
                  <MciIcon name="calendar-remove" size={22} color={colors.mutedForeground} />
                  <Text style={styles.emptyText}>No check-ins recorded</Text>
                </View>
              ) : (
                <>
                  {modalSymptomLog && <CheckinBlock log={modalSymptomLog} label="Check-in" />}
                </>
              )}

              {/* Food log */}
              <Text style={[styles.modalSectionLabel, { marginTop: 12 }]}>Food Log</Text>
              {modalFoods.length === 0 ? (
                <View style={styles.emptySection}>
                  <MciIcon name="food-off" size={22} color={colors.mutedForeground} />
                  <Text style={styles.emptyText}>No foods logged</Text>
                </View>
              ) : (
                <View style={styles.listCard}>
                  {modalFoods.map(({ log, food }, idx) => {
                    const isSafe = food?.is_elimination_safe ?? true;
                    const dotColor = isSafe ? colors.success : colors.destructive;
                    return (
                      <View key={log.id}>
                        {idx > 0 && <View style={[styles.innerDivider, { backgroundColor: colors.border }]} />}
                        <View style={styles.listRow}>
                          <View style={[styles.rowDot, { backgroundColor: dotColor }]} />
                          <Text style={[styles.rowName, { color: colors.foreground }]} numberOfLines={1}>
                            {food?.name ?? "Unknown"}
                          </Text>
                          {!isSafe && (
                            <View style={[styles.pill, { backgroundColor: colors.destructive + "22", borderColor: colors.destructive + "55" }]}>
                              <Text style={[styles.pillText, { color: colors.destructive }]}>Trigger</Text>
                            </View>
                          )}
                          {isSafe && (
                            <View style={[styles.pill, { backgroundColor: colors.success + "22", borderColor: colors.success + "55" }]}>
                              <Text style={[styles.pillText, { color: colors.success }]}>Safe</Text>
                            </View>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Urge log */}
              <Text style={[styles.modalSectionLabel, { marginTop: 12 }]}>Urge / Habit Log</Text>
              {modalUrges.length === 0 ? (
                <View style={styles.emptySection}>
                  <MciIcon name="hand-peace" size={22} color={colors.mutedForeground} />
                  <Text style={styles.emptyText}>No urges tracked</Text>
                </View>
              ) : (
                <View style={styles.listCard}>
                  {modalUrges.map((log, idx) => {
                    const routineName = itemName(routines, log.routine_id);
                    const successColors: Record<number, string> = { 1: colors.destructive, 2: colors.warning, 3: colors.accent, 4: colors.success };
                    const sColor = successColors[log.success] ?? colors.mutedForeground;
                    return (
                      <View key={log.id}>
                        {idx > 0 && <View style={[styles.innerDivider, { backgroundColor: colors.border }]} />}
                        <View style={styles.listRow}>
                          <View style={[styles.rowDot, { backgroundColor: sColor }]} />
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.rowName, { color: colors.foreground }]}>{itemName(bodyLocations, log.location)}</Text>
                            {routineName !== "" && (
                              <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>{routineName}</Text>
                            )}
                          </View>
                          <View style={[styles.pill, { backgroundColor: sColor + "22", borderColor: sColor + "55" }]}>
                            <Text style={[styles.pillText, { color: sColor }]}>{SUCCESS_LABELS[log.success]}</Text>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}

              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        )}
      </Modal>
    </View>
  );
}

type ColorsType = ReturnType<typeof import("@/hooks/useColors").useColors>;

function makeStyles(colors: ColorsType) {
  const CELL_SIZE = 40;
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    screenTitle: {
      fontSize: 22, fontFamily: "Inter_700Bold",
      color: colors.foreground, marginHorizontal: 20, marginBottom: 12,
    },
    monthNav: {
      flexDirection: "row", alignItems: "center",
      justifyContent: "space-between", marginHorizontal: 16, marginBottom: 12,
    },
    navBtn: { padding: 4 },
    monthLabel: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: colors.foreground },
    weekdayRow: { flexDirection: "row", marginHorizontal: 8, marginBottom: 4 },
    weekdayLabel: {
      flex: 1, textAlign: "center", fontSize: 11, fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 0.5,
    },
    viewSwitchRow: { flexDirection: "row", gap: 8, marginHorizontal: 16, marginBottom: 12 },
    viewChip: {
      paddingHorizontal: 14, paddingVertical: 8,
      borderRadius: 20, borderWidth: 1, minHeight: 36, justifyContent: "center",
    },
    viewChipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
    scroll: { paddingHorizontal: 8 },
    detailedList: { marginHorizontal: 4, gap: 8 },
    detailRow: {
      flexDirection: "row", alignItems: "center", gap: 12,
      backgroundColor: colors.surface, borderRadius: 12,
      paddingHorizontal: 14, paddingVertical: 10,
    },
    detailRowFuture: { opacity: 0.4 },
    detailWeekday: {
      width: 34, fontSize: 12, fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground, textTransform: "uppercase",
    },
    detailDay: { width: 24, fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.foreground },
    detailAverage: { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold" },
    detailFutureText: { color: colors.mutedForeground },
    detailThumb: {
      width: 36, height: 36, borderRadius: 8, overflow: "hidden",
      backgroundColor: colors.background,
    },
    detailThumbImage: { width: "100%", height: "100%" },
    grid: { flexDirection: "row", flexWrap: "wrap" },
    dayCell: { width: `${100 / 7}%` as any, alignItems: "center", paddingVertical: 4 },
    dayCircle: {
      width: CELL_SIZE, height: CELL_SIZE, borderRadius: CELL_SIZE / 2,
      alignItems: "center", justifyContent: "center",
    },
    dayCircleEmpty: { backgroundColor: "transparent" },
    // Muted, not primary: selection uses a primary ring, so sharing the colour
    // made today and the selected day indistinguishable whenever they differed.
    dayCircleToday: { borderWidth: 2, borderColor: colors.mutedForeground },
    dayCircleFuture: { opacity: 0.25 },
    dayNumber: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
    dayNumberFilled: { color: ON_ACCENT },
    dayNumberEmpty: { color: colors.foreground },
    dayNumberFuture: { color: colors.mutedForeground },
    dotRow: { flexDirection: "row", gap: 3, marginTop: 3, height: 5 },
    dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: "transparent" },
    legend: {
      marginTop: 20, marginHorizontal: 4, backgroundColor: colors.surface,
      borderRadius: 14, padding: 16, gap: 8,
    },
    legendTitle: {
      fontSize: 11, fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 0.5,
    },
    legendItems: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
    legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
    legendDot: { width: 14, height: 14, borderRadius: 7 },
    legendLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.foreground },
    modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
    modalSheet: {
      backgroundColor: colors.surface, borderTopLeftRadius: 24,
      borderTopRightRadius: 24, padding: 20, maxHeight: "88%",
    },
    modalHandle: {
      width: 36, height: 4, borderRadius: 2,
      backgroundColor: colors.border, alignSelf: "center", marginBottom: 16,
    },
    modalHeader: {
      flexDirection: "row", justifyContent: "space-between",
      alignItems: "flex-start", marginBottom: 16,
    },
    modalDate: { fontSize: 18, fontFamily: "Inter_700Bold", color: colors.foreground, marginBottom: 6 },
    phasePill: {
      flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start",
      paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
    },
    phaseDot: { width: 8, height: 8, borderRadius: 4 },
    phaseText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
    modalScroll: { flex: 1 },
    modalSectionLabel: {
      fontSize: 11, fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground, textTransform: "uppercase",
      letterSpacing: 0.8, marginBottom: 8,
    },
    checkinBlock: {
      marginBottom: 10, padding: 14,
      backgroundColor: colors.background, borderRadius: 12, gap: 8,
    },
    checkinBlockTitle: { fontSize: 14, fontFamily: "Inter_700Bold", color: colors.foreground, marginBottom: 4 },
    scoreRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    scoreLabel: { width: 52, fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground },
    scoreBarBg: { flex: 1, height: 6, backgroundColor: colors.border, borderRadius: 3, overflow: "hidden" },
    scoreBarFill: { height: "100%", borderRadius: 3 },
    scoreValue: { width: 28, fontSize: 12, fontFamily: "Inter_500Medium", color: colors.foreground, textAlign: "right" },
    emptySection: {
      flexDirection: "row", alignItems: "center", gap: 8,
      paddingVertical: 12, paddingHorizontal: 14, marginBottom: 4,
      backgroundColor: colors.background, borderRadius: 12,
    },
    emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground },
    listCard: {
      backgroundColor: colors.background, borderRadius: 12,
      overflow: "hidden", marginBottom: 4,
    },
    listRow: {
      flexDirection: "row", alignItems: "center",
      paddingHorizontal: 14, paddingVertical: 12, gap: 10,
    },
    rowDot: { width: 8, height: 8, borderRadius: 4 },
    rowName: { fontSize: 14, fontFamily: "Inter_500Medium", flex: 1 },
    rowSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
    innerDivider: { height: 1, marginHorizontal: 14 },
    pill: {
      paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1,
    },
    pillText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  });
}
