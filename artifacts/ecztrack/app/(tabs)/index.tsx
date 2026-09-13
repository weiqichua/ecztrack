import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Platform,
  TextInput,
} from "react-native";
import { todayKey, isOnLocalDay } from "@/lib/dates";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as FileSystem from "expo-file-system/legacy";
import MciIcon from "@/components/MciIcon";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAppContext } from "@/context/AppContext";
import { SUCCESS_LABELS, ScratchLog, Phase } from "@/constants/types";
import { phaseOnDate, spanOnDate } from "@/lib/phases";
import { groupLogsByMeal } from "@/lib/mealGroups";
import { activeItems, itemName } from "@/constants/catalog";
import { PHASE_COLORS } from "@/lib/dayStyle";
import { photosOnDate, photoUri } from "@/lib/skinPhotos";
import { photosSupported, PhotoSource } from "@/lib/photoCapture";
import { notify } from "@/lib/dialogs";
import PhaseStatusCard from "@/components/PhaseStatusCard";
import PhaseStartModal from "@/components/PhaseStartModal";
import PhaseEditModal from "@/components/PhaseEditModal";
import WeekStrip from "@/components/WeekStrip";
import ScratchLogEditModal from "@/components/ScratchLogEditModal";
import SkinPhotoViewer from "@/components/SkinPhotoViewer";
import ScoreBoxInput from "@/components/ScoreBoxInput";
import CatalogManagerModal from "@/components/CatalogManagerModal";

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatHeaderDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const day = DAY_SHORT[d.getDay()];
  const date = d.getDate();
  const month = MONTH_SHORT[d.getMonth()];
  return `${day}, ${String(date).padStart(2, "0")} ${month}`;
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    consumptionLogs,
    symptomLogs,
    scratchLogs,
    supplementLogs,
    activityLogs,
    ledger,
    allFoods,
    selectedDate,
    setSelectedDate,
    bodyLocations,
    symptoms,
    addSymptomLog,
    skinPhotos,
    addSkinPhoto,
    dailyNotes,
    setDailyNote,
  } = useAppContext();

  const [showStartModal, setShowStartModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  // The log being edited, held as the object itself rather than just an id so
  // the modal can render it directly. onClose sets this back to null in the
  // same commit that closes the sheet — nothing is kept around afterward.
  const [editingScratch, setEditingScratch] = useState<ScratchLog | null>(null);
  const [managingSymptoms, setManagingSymptoms] = useState(false);
  // Held as an id, not the photo object, so the viewer's body-location picker
  // stays in sync with itself: setPhotoLocation updates `skinPhotos`, and a
  // stale object captured at open time would never show that highlight move.
  const [viewingPhotoId, setViewingPhotoId] = useState<string | null>(null);

  const todayStr = todayKey();
  const isToday = selectedDate === todayStr;

  const selectedFoodLogs = consumptionLogs.filter(l => isOnLocalDay(l.timestamp, selectedDate));
  // Grouped, not flattened: a save is one meal, and listing its foods as
  // separate rows here contradicted the Food Log, which names them. The cap
  // counts meals rather than foods so one large meal cannot fill the card.
  const selectedMeals = groupLogsByMeal(selectedFoodLogs);
  const shownMeals = selectedMeals.slice(0, 4);

  const selectedSymptomLogs = symptomLogs.filter(l => l.date === selectedDate);
  const selectedSymptomLog = selectedSymptomLogs[0]; // at most one, by construction
  const activeSymptoms = activeItems(symptoms);
  const selectedScores = selectedSymptomLog?.scores ?? {};
  const recordedCount = activeSymptoms.filter(s => selectedScores[s.id] != null).length;

  const selectedScratch = scratchLogs.filter(l => isOnLocalDay(l.timestamp, selectedDate));
  const recentResistSuccess = selectedScratch.filter(l => l.success >= 3).length;

  const selectedPhotos = photosOnDate(skinPhotos, selectedDate);
  const canCapture = photosSupported();
  const viewingPhoto = skinPhotos.find(p => p.id === viewingPhotoId) ?? null;

  const noteForDay = dailyNotes.find(n => n.date === selectedDate)?.text ?? "";

  async function handleAdd(source: PhotoSource) {
    try {
      await addSkinPhoto(source, selectedDate);
    } catch (e) {
      // notify, not Alert.alert — Alert is a no-op on react-native-web.
      notify("Cannot add photo", e instanceof Error ? e.message : String(e));
    }
  }

  const totalLogs7d = consumptionLogs.filter(l => {
    const d = new Date(l.timestamp);
    return (Date.now() - d.getTime()) < 7 * 24 * 60 * 60 * 1000;
  }).length;

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 74 : insets.bottom + 72;

  // Phase for the currently selected date, read straight off the ledger.
  const selectedDateSpan = spanOnDate(ledger, selectedDate, todayStr);
  const selectedDatePhase = (selectedDateSpan?.kind ?? "none") as Phase;
  const phaseColor = PHASE_COLORS[selectedDatePhase];
  
  let phaseLabelText = "No Phase";
  if (selectedDateSpan) {
    phaseLabelText = selectedDateSpan.kind === "challenge" 
      ? `Challenge: ${selectedDateSpan.what}` 
      : `Elimination: ${selectedDateSpan.what}`;
  }

  function getAveragesFor(dateStr: string) {
    const log = symptomLogs.find(l => l.date === dateStr);
    if (!log) return null;
    const values = Object.values(log.scores).filter(v => v !== null && v !== undefined) as number[];
    if (values.length === 0) return null;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    return avg.toFixed(1);
  }

  const dDate = new Date(selectedDate + "T12:00:00");
  dDate.setDate(dDate.getDate() - 1);
  const yesterdayDateStr = dDate.toISOString().split("T")[0];
  dDate.setDate(dDate.getDate() + 2);
  const tomorrowDateStr = dDate.toISOString().split("T")[0];

  const overallAvgYesterday = getAveragesFor(yesterdayDateStr) ?? "-";
  const overallAvgToday = getAveragesFor(selectedDate) ?? "-";
  const overallAvgTomorrow = getAveragesFor(tomorrowDateStr) ?? "-";

  function getSymptomScore(dateStr: string, symptomId: string) {
    const log = symptomLogs.find(l => l.date === dateStr);
    if (!log || log.scores[symptomId] == null) return "-";
    return String(log.scores[symptomId]);
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.stickyTop, { backgroundColor: colors.background, paddingTop: topPad + 8 }]}>
          <View style={styles.titleRow}>
            <TouchableOpacity
              style={styles.calendarIconBtn}
              onPress={() => router.push("/(tabs)/calendar")}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <MciIcon name="calendar-month" size={22} color={colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.dateLabelRow} activeOpacity={0.7} onPress={() => router.push("/(tabs)/calendar")}>
              <Text style={[styles.dateLabel, { color: colors.foreground }]}>
                {formatHeaderDate(selectedDate)}
              </Text>
              <MciIcon name="chevron-down" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
            <View style={styles.rightGroup}>
              <View style={[styles.phaseBadge, { backgroundColor: phaseColor + "22", borderColor: phaseColor + "44" }]}>
                <View style={[styles.phaseDot, { backgroundColor: phaseColor }]} />
                <Text style={[styles.phaseLabel, { color: phaseColor }]}>
                  {phaseLabelText}
                </Text>
              </View>
            </View>
          </View>
          <WeekStrip selectedDate={selectedDate} onSelect={setSelectedDate} />
        </View>

      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
      >

        <View style={styles.statsGrid}>
          <View style={[styles.statTile, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <MciIcon name="food-apple" size={22} color={colors.primary} />
            <Text style={[styles.statNum, { color: colors.foreground }]}>{selectedFoodLogs.length + supplementLogs.filter(l => isOnLocalDay(l.timestamp, selectedDate)).length + activityLogs.filter(l => isOnLocalDay(l.timestamp, selectedDate)).length}</Text>
            <Text style={[styles.statTxt, { color: colors.mutedForeground }]}>Logbook entries</Text>
          </View>
          <View style={[styles.statTile, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <MciIcon
              name="clipboard-pulse"
              size={22}
              color={activeSymptoms.length > 0 && recordedCount === activeSymptoms.length ? colors.success : colors.warning}
            />
            <Text style={[styles.statNum, { color: colors.foreground }]}>
              {recordedCount}/{activeSymptoms.length}
            </Text>
            <Text style={[styles.statTxt, { color: colors.mutedForeground }]}>Check-in</Text>
          </View>
          <View style={[styles.statTile, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <MciIcon name="hand-back-right-off" size={22} color={recentResistSuccess > 0 ? colors.success : colors.mutedForeground} />
            <Text style={[styles.statNum, { color: colors.foreground }]}>{selectedScratch.length}</Text>
            <Text style={[styles.statTxt, { color: colors.mutedForeground }]}>Urges tracked</Text>
          </View>
          <View style={[styles.statTile, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <MciIcon name="calendar-week" size={22} color={colors.accent} />
            <Text style={[styles.statNum, { color: colors.foreground }]}>{totalLogs7d}</Text>
            <Text style={[styles.statTxt, { color: colors.mutedForeground }]}>7-day logs</Text>
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Symptoms</Text>
          <TouchableOpacity onPress={() => setManagingSymptoms(true)}>
            <Text style={[styles.seeAll, { color: colors.primary }]}>Manage</Text>
          </TouchableOpacity>
        </View>
        {activeSymptoms.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              No check-in items yet — tap Manage to add one
            </Text>
          </View>
        ) : (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 12, paddingRight: 4, gap: 16 }}>
              <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: colors.mutedForeground, width: 30, textAlign: 'center' }}>Yest</Text>
              <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: colors.mutedForeground, width: 30, textAlign: 'center' }}>Today</Text>
              <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: colors.mutedForeground, width: 30, textAlign: 'center' }}>Tmw</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingHorizontal: 4 }}>
              <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>Overall Average</Text>
              <View style={{ flexDirection: 'row', gap: 16 }}>
                <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.foreground, width: 30, textAlign: 'center' }}>{overallAvgYesterday}</Text>
                <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.foreground, width: 30, textAlign: 'center' }}>{overallAvgToday}</Text>
                <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.foreground, width: 30, textAlign: 'center' }}>{overallAvgTomorrow}</Text>
              </View>
            </View>
            {activeSymptoms.map(symptom => (
              <View key={symptom.id} style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, paddingHorizontal: 4 }}>
                  <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: colors.foreground }}>{symptom.name}</Text>
                  <View style={{ flexDirection: 'row', gap: 16 }}>
                    <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, width: 30, textAlign: 'center' }}>{getSymptomScore(yesterdayDateStr, symptom.id)}</Text>
                    <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, width: 30, textAlign: 'center' }}>{getSymptomScore(selectedDate, symptom.id)}</Text>
                    <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, width: 30, textAlign: 'center' }}>{getSymptomScore(tomorrowDateStr, symptom.id)}</Text>
                  </View>
                </View>
                <ScoreBoxInput
                  label=""
                  value={selectedScores[symptom.id] ?? null}
                  onChange={value => {
                  // Any day the strip can reach is editable, today or past.
                  // Remembering to record a symptom a day or two later is the
                  // normal case for this app, not an exception, so a past day
                  // is a day you can still fill in. Future days are unreachable
                  // — the strip disables them — so there is no guard here.
                  addSymptomLog({
                    date: selectedDate,
                    // Only this one box's value. addSymptomLog merges it over
                    // whatever that day's log already holds, so every other
                    // box's score (and any archived symptom's) survives
                    // untouched. The phase is re-derived from the ledger for
                    // `date`, so a past day is stamped with the phase it was
                    // actually on rather than today's.
                    scores: { [symptom.id]: value },
                  });
                }}
              />
              </View>
            ))}
          </View>
        )}

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Foods</Text>
          <TouchableOpacity onPress={() => router.push("/(tabs)/logbook" as any)}>
            <Text style={[styles.seeAll, { color: colors.primary }]}>Logbook</Text>
          </TouchableOpacity>
        </View>
        {shownMeals.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <MciIcon name="food-off" size={28} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              {isToday ? "No foods logged today" : "No foods logged this day"}
            </Text>
          </View>
        ) : (
          <View style={[styles.recentFoods, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {shownMeals.map((meal, idx) => (
              <View key={meal.groupId}>
                {idx > 0 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
                <View style={styles.mealBlock}>
                  <Text style={[styles.mealTitle, { color: colors.foreground }]} numberOfLines={1}>
                    {meal.label}
                    <Text style={[styles.mealTime, { color: colors.mutedForeground }]}>
                      {"  "}{formatTime(meal.timestamp)}
                    </Text>
                  </Text>
                  {meal.entries.map(entry => {
                    const food = allFoods.find(f => f.id === entry.item_id);
                    // An unresolvable food is indeterminate, and the dot has two
                    // states — it must not borrow the reassuring one.
                    const unsafe = !food || food.is_elimination_safe === false;
                    return (
                      <View key={entry.id} style={styles.mealItemRow}>
                        <View style={[styles.foodDot, { backgroundColor: unsafe ? colors.destructive : colors.success }]} />
                        <Text style={[styles.foodName, { color: colors.foreground }]} numberOfLines={1}>
                          {food?.name ?? "Unknown food"}
                        </Text>
                        {unsafe && <MciIcon name="alert-circle" size={14} color={colors.destructive} />}
                      </View>
                    );
                  })}
                </View>
              </View>
            ))}
            {selectedMeals.length > 4 && (
              <Text style={[styles.moreText, { color: colors.mutedForeground }]}>
                +{selectedMeals.length - 4} more
              </Text>
            )}
          </View>
        )}

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Skin</Text>
          {canCapture && (
            <View style={styles.skinHeaderActions}>
              <TouchableOpacity onPress={() => handleAdd("camera")} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <MciIcon name="camera-outline" size={20} color={colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleAdd("library")} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <MciIcon name="image-outline" size={20} color={colors.primary} />
              </TouchableOpacity>
            </View>
          )}
        </View>
        {selectedPhotos.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <MciIcon name="image-off-outline" size={28} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              {canCapture
                ? (isToday ? "No photos today" : "No photos this day")
                : "Photos are available on the phone app."}
            </Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.skinStrip}
            contentContainerStyle={styles.skinStripContent}
          >
            {selectedPhotos.slice().reverse().map(photo => {
              const uri = photoUri(FileSystem.documentDirectory, photo.file);
              return (
                <TouchableOpacity
                  key={photo.id}
                  style={styles.skinThumbContainer}
                  onPress={() => setViewingPhotoId(photo.id)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.skinThumb, { borderColor: colors.border }]}>
                    {uri && <Image source={{ uri }} style={styles.skinThumbImage} />}
                  </View>
                  <View style={[styles.skinTimeBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={[styles.skinTimeText, { color: colors.mutedForeground }]}>
                      {formatTime(photo.takenAt)}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Daily Notes</Text>
        </View>
        <TextInput
          style={[styles.notesInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
          placeholder="Jot down anything about today..."
          placeholderTextColor={colors.mutedForeground}
          multiline
          value={noteForDay}
          onChangeText={(txt) => setDailyNote(selectedDate, txt)}
          textAlignVertical="top"
        />

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Phase</Text>
        </View>
        {isToday ? (
          <PhaseStatusCard
            onEdit={() => setShowEditModal(true)}
            onChangePhase={() => setShowStartModal(true)}
          />
        ) : (
          <View style={[styles.historicalPhaseRow, { backgroundColor: phaseColor + "12", borderColor: phaseColor + "33" }]}>
            <View style={[styles.historicalPhaseDot, { backgroundColor: phaseColor }]} />
            <Text style={[styles.historicalPhaseText, { color: phaseColor }]}>
              {selectedDatePhase.charAt(0).toUpperCase() + selectedDatePhase.slice(1)} Phase
            </Text>
            <Text style={[styles.historicalPhaseNote, { color: colors.mutedForeground }]}>
              active on this day
            </Text>
          </View>
        )}

        {selectedScratch.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Urges</Text>
              <TouchableOpacity onPress={() => router.push("/(tabs)/scratch-tracker")}>
                <Text style={[styles.seeAll, { color: colors.primary }]}>See All</Text>
              </TouchableOpacity>
            </View>
            <View style={[styles.recentFoods, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {selectedScratch.slice(0, 3).map((log, idx) => {
                const successColor = log.success >= 3 ? colors.success : log.success === 2 ? colors.warning : colors.destructive;
                return (
                  <View key={log.id}>
                    {idx > 0 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
                    <TouchableOpacity
                      style={styles.foodRow}
                      onPress={() => setEditingScratch(log)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.foodDot, { backgroundColor: successColor }]} />
                      {/* The log stores a catalog id, so it has to be resolved
                          — and via itemName, which still names an item the
                          user has since archived. */}
                      <Text style={[styles.foodName, { color: colors.foreground }]}>
                        {itemName(bodyLocations, log.location)}
                      </Text>
                      <Text style={[styles.scratchSuccess, { color: successColor }]}>
                        {SUCCESS_LABELS[log.success]}
                      </Text>
                      <MciIcon name="pencil-outline" size={14} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>

      {!isToday && (
        <TouchableOpacity
          style={[styles.backToToday, { backgroundColor: colors.primary }]}
          onPress={() => setSelectedDate(todayStr)}
          activeOpacity={0.85}
        >
          <MciIcon name="calendar-today" size={16} color={colors.primaryForeground} />
          <Text style={[styles.backToTodayText, { color: colors.primaryForeground }]}>Back to Today</Text>
        </TouchableOpacity>
      )}

      <ScratchLogEditModal
        visible={editingScratch !== null}
        log={editingScratch}
        onClose={() => setEditingScratch(null)}
      />
      <SkinPhotoViewer
        photo={viewingPhoto}
        onClose={() => setViewingPhotoId(null)}
      />
      <CatalogManagerModal
        visible={managingSymptoms}
        kind="symptom"
        onClose={() => setManagingSymptoms(false)}
      />
      <PhaseStartModal visible={showStartModal} onClose={() => setShowStartModal(false)} />
      <PhaseEditModal visible={showEditModal} onClose={() => setShowEditModal(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scrollContainer: { flex: 1 },
  content: { paddingHorizontal: 16 },
  stickyTop: {
    marginHorizontal: 0,
    paddingHorizontal: 16,
    paddingBottom: 8,
    zIndex: 10,
    elevation: 10,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  rightGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  calendarIconBtn: {
    padding: 4,
  },
  dateLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flex: 1,
    paddingHorizontal: 10,
  },
  dateLabel: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  phaseBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1,
    flexShrink: 1,
    maxWidth: '50%',
  },
  phaseDot: { width: 8, height: 8, borderRadius: 4 },
  phaseLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 22, marginTop: 10 },
  statTile: {
    width: "47%", padding: 16, borderRadius: 16,
    borderWidth: 1, alignItems: "flex-start", gap: 6,
  },
  statNum: { fontSize: 24, fontFamily: "Inter_700Bold" },
  statTxt: { fontSize: 12, fontFamily: "Inter_400Regular" },
  sectionHeader: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", marginBottom: 10,
  },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  seeAll: { fontSize: 14, fontFamily: "Inter_500Medium" },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, paddingBottom: 0, marginBottom: 22 },
  recentFoods: { borderRadius: 16, borderWidth: 1, overflow: "hidden", marginBottom: 22 },
  foodRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 13, gap: 10,
  },
  foodDot: { width: 8, height: 8, borderRadius: 4 },
  mealBlock: { paddingHorizontal: 16, paddingVertical: 13, gap: 8 },
  mealTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  mealTime: { fontSize: 12, fontFamily: "Inter_400Regular" },
  mealItemRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 4 },
  foodName: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
  divider: { height: 1, marginHorizontal: 16 },
  moreText: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", paddingVertical: 10 },
  emptyCard: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, padding: 20, borderRadius: 16, borderWidth: 1, marginBottom: 22,
  },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  scratchSuccess: { fontSize: 11, fontFamily: "Inter_500Medium" },
  skinHeaderActions: { flexDirection: "row", alignItems: "center", gap: 16 },
  skinStrip: { marginBottom: 22 },
  skinStripContent: { gap: 10 },
  skinThumbContainer: { gap: 6, alignItems: "center" },
  skinThumb: {
    width: 88, height: 88, borderRadius: 12, borderWidth: 1, overflow: "hidden",
  },
  skinThumbImage: { width: "100%", height: "100%" },
  skinTimeBox: {
    paddingHorizontal: 6, paddingVertical: 3,
    borderRadius: 6, borderWidth: 1,
  },
  skinTimeText: { fontSize: 10, fontFamily: "Inter_500Medium" },
  notesInput: {
    minHeight: 100,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 22,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  historicalPhaseRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 22,
  },
  historicalPhaseDot: { width: 10, height: 10, borderRadius: 5 },
  historicalPhaseText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  historicalPhaseNote: { fontSize: 12, fontFamily: "Inter_400Regular" },
  backToToday: {
    position: "absolute",
    bottom: Platform.OS === "web" ? 100 : 80,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  backToTodayText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
});
