import React, { useState, useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppContext } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import MciIcon from "@/components/MciIcon";
import { todayKey, isOnLocalDay } from "@/lib/dates";
import { confirmDestructive } from "@/lib/dialogs";
import TimestampPicker from "@/components/TimestampPicker";
import { CatalogItem, activeItems } from "@/constants/catalog";
import CatalogManagerModal from "@/components/CatalogManagerModal";
import type { ActivityLog } from "@/constants/types";

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

export default function ActivityLogger() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { activities, activityLogs, addActivityLog, deleteActivityLog, selectedDate } = useAppContext();

  const [dateStr, setDateStr] = useState(selectedDate);
  React.useEffect(() => { setDateStr(selectedDate); }, [selectedDate]);
  const [managerOpen, setManagerOpen] = useState(false);

  // For logging

  const getDefaultTime = React.useCallback(() => {
    if (selectedDate === todayKey()) return new Date();
    const d = new Date();
    const [y, m, day] = selectedDate.split('-');
    d.setFullYear(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(day, 10));
    return d;
  }, [selectedDate]);

  const [time, setTime] = useState<Date>(getDefaultTime());
  
  React.useEffect(() => {
    setTime(getDefaultTime());
  }, [getDefaultTime]);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [intensity, setIntensity] = useState<"light" | "moderate" | "vigorous">("moderate");

  const todayLogs = useMemo(() => {
    return activityLogs.filter(l => isOnLocalDay(l.timestamp, dateStr))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [activityLogs, dateStr]);

  const allActive = useMemo(() => activeItems(activities), [activities]);

  const handleLog = async () => {
    if (selectedItemIds.length === 0) return;
    await addActivityLogs(selectedItemIds, intensity, {
      timestamp: time.toISOString(),
    });
    setSelectedItemIds([]);
    setTime(getDefaultTime());
    setIntensity("moderate");
  };

  const handleRemoveLog = async (logId: string) => {
    if (await confirmDestructive("Remove log?", "This will delete the log.", "Remove")) {
      await deleteActivityLog(logId);
    }
  };

  return (
    <View style={styles.container}>
      {/* Pick Activity */}
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Log Activity</Text>
          <TouchableOpacity onPress={() => setManagerOpen(true)}>
            <Text style={{ color: colors.primary, fontSize: 14 }}>Manage Activities</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.chipRow}>
          {allActive.map(item => {
            const isSel = selectedItemIds.includes(item.id);
            return (
              <TouchableOpacity
                key={item.id}
                style={[styles.chip, { backgroundColor: isSel ? colors.primary : colors.background, borderColor: colors.border }]}
                onPress={() => setSelectedItemIds(prev => isSel ? prev.filter(x => x !== item.id) : [...prev, item.id])}
              >
                <Text style={{ color: isSel ? "#fff" : colors.foreground }}>{item.name}</Text>
              </TouchableOpacity>
            );
          })}
          {allActive.length === 0 && (
            <Text style={{ color: colors.mutedForeground }}>No activities yet. Tap Manage to add.</Text>
          )}
        </View>

        {selectedItemIds.length > 0 && (
          <View style={styles.logForm}>
            <View style={styles.formRow}>
              <Text style={{ color: colors.foreground }}>Intensity:</Text>
              <View style={styles.intensityRow}>
                {(["light", "moderate", "vigorous"] as const).map(i => (
                  <TouchableOpacity
                    key={i}
                    style={[styles.chip, { backgroundColor: intensity === i ? colors.primary : colors.background, borderColor: colors.border }]}
                    onPress={() => setIntensity(i)}
                  >
                    <Text style={{ color: intensity === i ? "#fff" : colors.foreground, textTransform: 'capitalize' }}>{i}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={[styles.formRow, { marginTop: 12 }]}>
              <Text style={{ color: colors.foreground }}>Time:</Text>
              <TimestampPicker
                value={time.toISOString()}
                onChange={(iso) => setTime(new Date(iso))}
              />
            </View>

            <TouchableOpacity style={[styles.logButton, { backgroundColor: colors.primary }]} onPress={handleLog}>
              <Text style={{ color: "#fff", fontWeight: "600" }}>Log Activity(s)</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Recent Logs */}
      <View style={[styles.section, { flex: 1, backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 12 }]}>Today's Activities</Text>
        {todayLogs.length === 0 ? (
          <Text style={{ color: colors.mutedForeground }}>No activities logged for {dateStr}.</Text>
        ) : (
          <FlatList
            data={todayLogs}
            keyExtractor={l => l.id}
            renderItem={({ item }) => {
              const cat = activities.find(a => a.id === item.item_id);
              return (
                <View style={[styles.logItem, { borderColor: colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: '500' }}>{cat?.name ?? "Unknown"}</Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                      {formatTime(item.timestamp)} • {item.intensity}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => handleRemoveLog(item.id)} style={{ padding: 8 }}>
                    <MciIcon name="trash-can-outline" size={20} color={colors.destructive} />
                  </TouchableOpacity>
                </View>
              );
            }}
          />
        )}
      </View>

      <CatalogManagerModal
        visible={managerOpen}
        onClose={() => setManagerOpen(false)}
        kind="activity"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 16 },
  section: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  logForm: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: '#ccc',
  },
  formRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  intensityRow: {
    flexDirection: 'row',
    gap: 6,
  },
  logButton: {
    marginTop: 16,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  logItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  }
});
