import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import FoodLoggerScreen from "./food-logger";
import SupplementLogger from "@/components/SupplementLogger";
import ActivityLogger from "@/components/ActivityLogger";
import { Stack } from "expo-router";
import WeekStrip from "@/components/WeekStrip";
import { useAppContext } from "@/context/AppContext";

export default function LogbookHubScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { selectedDate, setSelectedDate, symptomLogs } = useAppContext();
  const [activeTab, setActiveTab] = useState<"food" | "supplements" | "activities">("food");

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

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: "Logbook" }} />

      <View style={[styles.header, { paddingTop: insets.top, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Logbook</Text>
        
        <View style={{ marginBottom: 16, marginHorizontal: -16 }}>
          <WeekStrip selectedDate={selectedDate} onSelect={setSelectedDate} />
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.background, borderRadius: 12, borderWidth: 1, borderColor: colors.border }}>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: colors.mutedForeground, marginBottom: 4 }}>Yesterday</Text>
            <Text style={{ fontSize: 16, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>{overallAvgYesterday}</Text>
          </View>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: colors.mutedForeground, marginBottom: 4 }}>Today</Text>
            <Text style={{ fontSize: 16, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>{overallAvgToday}</Text>
          </View>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: colors.mutedForeground, marginBottom: 4 }}>Tomorrow</Text>
            <Text style={{ fontSize: 16, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>{overallAvgTomorrow}</Text>
          </View>
        </View>
        
        {/* Segmented Control */}
        <View style={[styles.segmentedControl, { backgroundColor: colors.background, borderColor: colors.border }]}>
          {(["food", "supplements", "activities"] as const).map(tab => {
            const isActive = activeTab === tab;
            return (
              <TouchableOpacity
                key={tab}
                style={[
                  styles.segmentButton,
                  isActive && { backgroundColor: colors.primary }
                ]}
                onPress={() => setActiveTab(tab)}
              >
                <Text style={{ 
                  color: isActive ? "#fff" : colors.mutedForeground,
                  fontWeight: isActive ? "600" : "400",
                  textTransform: "capitalize"
                }}>
                  {tab}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.content}>
        {activeTab === "food" && <FoodLoggerScreen isEmbedded />}
        {activeTab === "supplements" && <SupplementLogger />}
        {activeTab === "activities" && <ActivityLogger />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 16,
  },
  segmentedControl: {
    flexDirection: "row",
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
  },
  content: {
    flex: 1,
  }
});
