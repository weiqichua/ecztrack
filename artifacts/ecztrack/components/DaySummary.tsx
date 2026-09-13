import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, TextInput } from "react-native";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAppContext } from "@/context/AppContext";
import { isOnLocalDay, todayKey } from "@/lib/dates";
import { groupLogsByMeal } from "@/lib/mealGroups";
import { activeItems, itemName } from "@/constants/catalog";
import { photosOnDate, photoUri } from "@/lib/skinPhotos";
import { photosSupported, PhotoSource } from "@/lib/photoCapture";
import * as FileSystem from "expo-file-system/legacy";
import MciIcon from "@/components/MciIcon";
import ScoreBoxInput from "@/components/ScoreBoxInput";

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

interface DaySummaryProps {
  date: string;
  onManageSymptoms?: () => void;
  onAddPhoto?: (source: PhotoSource, date: string) => void;
  onViewPhoto?: (id: string) => void;
}

export default function DaySummary({ date, onManageSymptoms, onAddPhoto, onViewPhoto }: DaySummaryProps) {
  const colors = useColors();
  const router = useRouter();
  const {
    consumptionLogs,
    symptomLogs,
    supplementLogs,
    activityLogs,
    allFoods,
    supplements,
    activities,
    symptoms,
    addSymptomLog,
    skinPhotos,
    dailyNotes,
    setDailyNote,
  } = useAppContext();

  const [activeLogTab, setActiveLogTab] = useState<"food" | "supplements" | "activities">("food");

  const todayStr = todayKey();
  const isToday = date === todayStr;

  // -- SYMPTOMS --
  const selectedSymptomLogs = symptomLogs.filter(l => l.date === date);
  const selectedSymptomLog = selectedSymptomLogs[0]; 
  const activeSymptomsList = activeItems(symptoms);
  const selectedScores = selectedSymptomLog?.scores ?? {};

  const dDate = new Date(date + "T12:00:00");
  dDate.setDate(dDate.getDate() - 1);
  const yesterdayDateStr = dDate.toISOString().split("T")[0];
  dDate.setDate(dDate.getDate() + 2);
  const tomorrowDateStr = dDate.toISOString().split("T")[0];

  function getAveragesFor(dateStr: string) {
    const log = symptomLogs.find(l => l.date === dateStr);
    if (!log) return null;
    const values = Object.values(log.scores).filter(v => v !== null && v !== undefined) as number[];
    if (values.length === 0) return null;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    return avg.toFixed(1);
  }

  const overallAvgYesterday = getAveragesFor(yesterdayDateStr) ?? "-";
  const overallAvgToday = getAveragesFor(date) ?? "-";
  const overallAvgTomorrow = getAveragesFor(tomorrowDateStr) ?? "-";

  function getSymptomScore(dateStr: string, symptomId: string) {
    const log = symptomLogs.find(l => l.date === dateStr);
    if (!log || log.scores[symptomId] == null) return "-";
    return String(log.scores[symptomId]);
  }

  // -- LOGS --
  const selectedFoodLogs = consumptionLogs.filter(l => isOnLocalDay(l.timestamp, date));
  const selectedMeals = groupLogsByMeal(selectedFoodLogs);
  const shownMeals = selectedMeals.slice(0, 4);

  const selectedSupplementLogs = supplementLogs.filter(l => isOnLocalDay(l.timestamp, date));
  const selectedActivityLogs = activityLogs.filter(l => isOnLocalDay(l.timestamp, date));

  // -- SKIN --
  const selectedPhotos = photosOnDate(skinPhotos, date);
  const canCapture = photosSupported();

  // -- NOTES --
  const noteForDay = dailyNotes.find(n => n.date === date)?.text ?? "";

  return (
    <View style={styles.container}>
      {/* SYMPTOMS */}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Symptoms</Text>
        {onManageSymptoms && (
          <TouchableOpacity onPress={onManageSymptoms}>
            <Text style={[styles.seeAll, { color: colors.primary }]}>Manage</Text>
          </TouchableOpacity>
        )}
      </View>
      {activeSymptomsList.length === 0 ? (
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
          {activeSymptomsList.map(symptom => (
            <View key={symptom.id} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, paddingHorizontal: 4 }}>
                <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: colors.foreground }}>{symptom.name}</Text>
                <View style={{ flexDirection: 'row', gap: 16 }}>
                  <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, width: 30, textAlign: 'center' }}>{getSymptomScore(yesterdayDateStr, symptom.id)}</Text>
                  <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, width: 30, textAlign: 'center' }}>{getSymptomScore(date, symptom.id)}</Text>
                  <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, width: 30, textAlign: 'center' }}>{getSymptomScore(tomorrowDateStr, symptom.id)}</Text>
                </View>
              </View>
              <ScoreBoxInput
                label=""
                value={selectedScores[symptom.id] ?? null}
                onChange={value => {
                  addSymptomLog({ date, scores: { [symptom.id]: value } });
                }}
              />
            </View>
          ))}
        </View>
      )}

      {/* LOGS */}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Logs</Text>
        <TouchableOpacity onPress={() => router.push("/(tabs)/logbook" as any)}>
          <Text style={[styles.seeAll, { color: colors.primary }]}>Logbook</Text>
        </TouchableOpacity>
      </View>
      
      <View style={[styles.recentFoods, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.segmentedControl, { backgroundColor: colors.background, borderColor: colors.border }]}>
          {(["food", "supplements", "activities"] as const).map(tab => {
            const isActive = activeLogTab === tab;
            return (
              <TouchableOpacity
                key={tab}
                style={[styles.segmentButton, isActive && { backgroundColor: colors.primary }]}
                onPress={() => setActiveLogTab(tab)}
              >
                <Text style={{ color: isActive ? "#fff" : colors.mutedForeground, fontWeight: isActive ? "600" : "400", textTransform: "capitalize", fontSize: 12 }}>
                  {tab === "food" ? "Foods" : tab}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {activeLogTab === "food" && (
          shownMeals.length === 0 ? (
            <View style={styles.emptyCardInner}>
              <MciIcon name="food-off" size={28} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                {isToday ? "No foods logged today" : "No foods logged this day"}
              </Text>
            </View>
          ) : (
            <View>
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
          )
        )}

        {activeLogTab === "supplements" && (
          selectedSupplementLogs.length === 0 ? (
            <View style={styles.emptyCardInner}>
              <MciIcon name="pill" size={28} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No supplements</Text>
            </View>
          ) : (
            <View>
              {selectedSupplementLogs.map((log, idx) => {
                const supp = supplements.find(s => s.id === log.item_id);
                return (
                  <View key={log.id}>
                    {idx > 0 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
                    <View style={styles.mealBlock}>
                      <View style={styles.mealItemRow}>
                        <MciIcon name="pill" size={16} color={colors.primary} />
                        <Text style={[styles.foodName, { color: colors.foreground }]}>{supp?.name ?? "Unknown"}</Text>
                        <Text style={[styles.mealTime, { color: colors.mutedForeground }]}>{formatTime(log.timestamp)}</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )
        )}

        {activeLogTab === "activities" && (
          selectedActivityLogs.length === 0 ? (
            <View style={styles.emptyCardInner}>
              <MciIcon name="run" size={28} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No activities</Text>
            </View>
          ) : (
            <View>
              {selectedActivityLogs.map((log, idx) => {
                const act = activities.find(a => a.id === log.item_id);
                return (
                  <View key={log.id}>
                    {idx > 0 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
                    <View style={styles.mealBlock}>
                      <View style={styles.mealItemRow}>
                        <MciIcon name="run" size={16} color={colors.primary} />
                        <Text style={[styles.foodName, { color: colors.foreground }]}>{act?.name ?? "Unknown"}</Text>
                        <Text style={[styles.mealTime, { color: colors.mutedForeground }]}>{formatTime(log.timestamp)}</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )
        )}
      </View>

      {/* SKIN */}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Skin</Text>
        {canCapture && onAddPhoto && (
          <View style={styles.skinHeaderActions}>
            <TouchableOpacity onPress={() => onAddPhoto("camera", date)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <MciIcon name="camera-outline" size={20} color={colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onAddPhoto("library", date)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <MciIcon name="image-outline" size={20} color={colors.primary} />
            </TouchableOpacity>
          </View>
        )}
      </View>
      {selectedPhotos.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <MciIcon name="image-off-outline" size={28} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            {canCapture ? (isToday ? "No photos today" : "No photos this day") : "Photos are available on the phone app."}
          </Text>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.skinStrip} contentContainerStyle={styles.skinStripContent}>
          {selectedPhotos.slice().reverse().map(photo => {
            const uri = photoUri(FileSystem.documentDirectory, photo.file);
            return (
              <TouchableOpacity key={photo.id} style={styles.skinThumbContainer} onPress={() => onViewPhoto?.(photo.id)} activeOpacity={0.8}>
                <View style={[styles.skinThumb, { borderColor: colors.border }]}>
                  {uri && <Image source={{ uri }} style={styles.skinThumbImage} />}
                </View>
                <View style={[styles.skinTimeBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.skinTimeText, { color: colors.mutedForeground }]}>{formatTime(photo.takenAt)}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* DAILY NOTES */}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Daily Notes</Text>
      </View>
      <TextInput
        style={[styles.notesInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
        placeholder="Jot down anything about today..."
        placeholderTextColor={colors.mutedForeground}
        multiline
        value={noteForDay}
        onChangeText={(txt) => setDailyNote(date, txt)}
        textAlignVertical="top"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 20,
  },
  sectionHeader: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", marginBottom: 10, marginTop: 10,
  },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  seeAll: { fontSize: 14, fontFamily: "Inter_500Medium" },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, paddingBottom: 0, marginBottom: 10 },
  recentFoods: { borderRadius: 16, borderWidth: 1, overflow: "hidden", marginBottom: 10 },
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
    gap: 10, padding: 20, borderRadius: 16, borderWidth: 1, marginBottom: 10,
  },
  emptyCardInner: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, padding: 20,
  },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  skinHeaderActions: { flexDirection: "row", alignItems: "center", gap: 16 },
  skinStrip: { marginBottom: 10 },
  skinStripContent: { gap: 10 },
  skinThumbContainer: { gap: 6, alignItems: "center" },
  skinThumb: { width: 88, height: 88, borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  skinThumbImage: { width: "100%", height: "100%" },
  skinTimeBox: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  skinTimeText: { fontSize: 10, fontFamily: "Inter_500Medium" },
  notesInput: {
    minHeight: 100, padding: 16, borderRadius: 16, borderWidth: 1,
    marginBottom: 10, fontSize: 15, fontFamily: "Inter_400Regular",
  },
  segmentedControl: {
    flexDirection: "row", margin: 12, borderRadius: 8, borderWidth: 1, overflow: "hidden",
  },
  segmentButton: {
    flex: 1, paddingVertical: 6, alignItems: "center",
  },
});
