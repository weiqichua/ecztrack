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
import PresetGroupManagerModal from "@/components/PresetGroupManagerModal";
import type { SupplementLog } from "@/constants/types";

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

export default function SupplementLogger() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { supplements, supplementLogs, addSupplementLog, deleteSupplementLog, presetGroups, selectedDate } = useAppContext();

  const [dateStr, setDateStr] = useState(selectedDate);
  React.useEffect(() => { setDateStr(selectedDate); }, [selectedDate]);
  const [managerOpen, setManagerOpen] = useState(false);

  // For logging
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [groupManagerOpen, setGroupManagerOpen] = useState(false);
  const activeSuppGroups = useMemo(() => presetGroups.filter(g => g.type === "supplement" && !g.isArchived), [presetGroups]);
  
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

  const todayLogs = useMemo(() => {
    return supplementLogs.filter(l => isOnLocalDay(l.timestamp, dateStr))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [supplementLogs, dateStr]);

  const allActive = useMemo(() => activeItems(supplements), [supplements]);

  const handleLog = async () => {
    if (selectedItemIds.length === 0) return;
    await addSupplementLogs(selectedItemIds, {
      timestamp: time.toISOString(),
    });
    setSelectedItemIds([]);
    setTime(getDefaultTime());
  };

  const handleRemoveLog = async (logId: string) => {
    if (await confirmDestructive("Remove log?", "This will delete the log.", "Remove")) {
      await deleteSupplementLog(logId);
    }
  };

  return (
    <View style={styles.container}>
      {/* Pick Supplement */}
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Log Supplement</Text>
          <View style={{ flexDirection: "row", gap: 16 }}>
            <TouchableOpacity onPress={() => setGroupManagerOpen(true)}>
              <Text style={{ color: colors.primary, fontSize: 14 }}>Manage Groups</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setManagerOpen(true)}>
              <Text style={{ color: colors.primary, fontSize: 14 }}>Manage Items</Text>
            </TouchableOpacity>
          </View>
        </View>

        {activeSuppGroups.length > 0 && (
          <View style={[styles.chipRow, { paddingBottom: 0 }]}>
            {activeSuppGroups.map(group => (
              <TouchableOpacity
                key={group.id}
                style={[styles.chip, { backgroundColor: colors.card, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 6 }]}
                onPress={() => setSelectedItemIds(prev => [...new Set([...prev, ...group.item_ids])])}
              >
                <MciIcon name="format-list-bulleted" size={14} color={colors.foreground} />
                <Text style={{ color: colors.foreground }}>{group.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

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
            <Text style={{ color: colors.mutedForeground }}>No supplements yet. Tap Manage to add.</Text>
          )}
        </View>

        {selectedItemIds.length > 0 && (
          <View style={styles.logForm}>
            <View style={styles.formRow}>
              <Text style={{ color: colors.foreground }}>Time:</Text>
              <TimestampPicker
                value={time.toISOString()}
                onChange={(iso) => setTime(new Date(iso))}
              />
            </View>

            <TouchableOpacity style={[styles.logButton, { backgroundColor: colors.primary }]} onPress={handleLog}>
              <Text style={{ color: "#fff", fontWeight: "600" }}>Log Supplement(s)</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Recent Logs */}
      <View style={[styles.section, { flex: 1, backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 12 }]}>Today's Supplements</Text>
        {todayLogs.length === 0 ? (
          <Text style={{ color: colors.mutedForeground }}>No supplements logged for {dateStr}.</Text>
        ) : (
          <FlatList
            data={todayLogs}
            keyExtractor={l => l.id}
            renderItem={({ item }) => {
              const cat = supplements.find(a => a.id === item.item_id);
              return (
                <View style={[styles.logItem, { borderColor: colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: '500' }}>{cat?.name ?? "Unknown"}</Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                      {formatTime(item.timestamp)}
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

      <PresetGroupManagerModal
        visible={groupManagerOpen}
        type="supplement"
        onClose={() => setGroupManagerOpen(false)}
      />
      <CatalogManagerModal
        visible={managerOpen}
        onClose={() => setManagerOpen(false)}
        kind="supplement"
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
