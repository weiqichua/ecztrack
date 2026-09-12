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
  const { selectedDate, setSelectedDate } = useAppContext();
  const [activeTab, setActiveTab] = useState<"food" | "supplements" | "activities">("food");

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: "Logbook" }} />

      <View style={[styles.header, { paddingTop: insets.top, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Logbook</Text>
        
        <View style={{ marginBottom: 16, marginHorizontal: -16 }}>
          <WeekStrip selectedDate={selectedDate} onSelect={setSelectedDate} />
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
