import { useState, useEffect, useMemo } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Modal, ScrollView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MciIcon from "@/components/MciIcon";
import TimestampPicker from "@/components/TimestampPicker";
import { useColors } from "@/hooks/useColors";
import { useAppContext } from "@/context/AppContext";
import { confirmDestructive } from "@/lib/dialogs";
import { localDateKey, todayKey } from "@/lib/dates";
import type { MealGroup } from "@/lib/mealGroups";

interface Props {
  group: MealGroup | null;
  onClose: () => void;
}

export default function MealEditModal({ group, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { allFoods, consumptionLogs, updateMeal, deleteMeal, deleteConsumptionLog } = useAppContext();
  const [label, setLabel] = useState("");
  const [iso, setIso] = useState("");
  const [saving, setSaving] = useState(false);

  // Read current entries dynamically from context so deletes reflect immediately.
  const currentEntries = useMemo(() => {
    if (!group) return [];
    return consumptionLogs.filter(l => (l.group_id ?? l.id) === group.groupId);
  }, [consumptionLogs, group]);

  // Re-seeded whenever a different meal is opened. The modal is mounted once
  // and reused, so state left from the last meal would leak into this one.
  useEffect(() => {
    if (!group) return;
    setLabel(group.label);
    setIso(group.timestamp);
  }, [group]);

  // If all food items in this meal were deleted, close the modal.
  useEffect(() => {
    if (group && currentEntries.length === 0) {
      onClose();
    }
  }, [group, currentEntries.length, onClose]);

  async function handleSave() {
    if (!group || saving) return;
    if (localDateKey(iso) !== todayKey()) {
      const ok = await confirmDestructive(
        "Move this meal to another day?",
        "It will leave Today's Log, and past days cannot be edited from here.",
        "Move",
      );
      if (!ok) return;
    }
    setSaving(true);
    try {
      await updateMeal(group.groupId, label, iso);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteFood(logId: string, foodName: string) {
    const isLast = currentEntries.length === 1;
    const ok = await confirmDestructive(
      `Remove "${foodName}"?`,
      isLast
        ? "This is the only food in this meal, so the entire meal will be removed."
        : "This food will be removed from this meal.",
      "Remove",
    );
    if (!ok) return;
    await deleteConsumptionLog(logId);
    if (isLast) {
      onClose();
    }
  }

  async function handleDeleteEntireMeal() {
    if (!group) return;
    const ok = await confirmDestructive(
      "Delete this entire meal?",
      "All foods in this meal will be removed permanently.",
      "Delete Meal",
    );
    if (!ok) return;
    await deleteMeal(group.groupId);
    onClose();
  }

  return (
    <Modal visible={!!group} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.modal, { backgroundColor: colors.background }]}>
        <View style={[
          styles.header,
          { borderBottomColor: colors.border, paddingTop: Platform.OS === "web" ? 20 : insets.top + 8 },
        ]}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MciIcon name="close" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground }]}>Edit Meal</Text>
          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }]}
            onPress={handleSave}
            disabled={saving}
          >
            <Text style={[styles.saveText, { color: colors.primaryForeground }]}>
              {saving ? "Saving…" : "Save"}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: (Platform.OS === "web" ? 40 : insets.bottom + 20) }]}>
          {/* Meal Name Input */}
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Meal Name</Text>
            <TextInput
              style={[styles.input, { color: colors.foreground }]}
              value={label}
              onChangeText={setLabel}
              placeholder="Meal"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="sentences"
            />
          </View>

          {/* Timestamp Picker */}
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <TimestampPicker value={iso} onChange={setIso} label="Eaten at" />
          </View>

          {/* Foods list in this meal */}
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              Foods in this Meal ({currentEntries.length})
            </Text>
            <View style={styles.foodList}>
              {currentEntries.map((entry, idx) => {
                const food = allFoods.find(f => f.id === entry.item_id);
                const unsafe = !food || food.is_elimination_safe === false;
                const name = food?.name ?? entry.item_id ?? "Unknown food";
                return (
                  <View key={entry.id}>
                    {idx > 0 && <View style={[styles.foodDivider, { backgroundColor: colors.border }]} />}
                    <View style={styles.foodRow}>
                      <View style={[styles.foodDot, { backgroundColor: unsafe ? colors.destructive : colors.success }]} />
                      <View style={styles.foodInfo}>
                        <View style={styles.foodNameRow}>
                          <Text style={[styles.foodName, { color: colors.foreground }]} numberOfLines={1}>
                            {name}
                          </Text>
                          {entry.portion && (
                            <View style={[styles.portionBadge, { backgroundColor: colors.card, borderColor: colors.border }]}>
                              <Text style={[styles.portionBadgeText, { color: colors.mutedForeground }]}>
                                {entry.portion}
                              </Text>
                            </View>
                          )}
                        </View>
                        {entry.is_accident && (
                          <Text style={[styles.accidentTag, { color: colors.destructive }]}>
                            ⚠ Accidental exposure
                          </Text>
                        )}
                      </View>
                      <TouchableOpacity
                        style={[styles.deleteItemBtn, { backgroundColor: colors.destructive + "18" }]}
                        onPress={() => handleDeleteFood(entry.id, name)}
                        activeOpacity={0.7}
                        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                      >
                        <MciIcon name="trash-can-outline" size={16} color={colors.destructive} />
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Delete Entire Meal Button */}
          <TouchableOpacity
            style={[styles.deleteMealBtn, { borderColor: colors.destructive + "55" }]}
            onPress={handleDeleteEntireMeal}
            activeOpacity={0.7}
          >
            <MciIcon name="trash-can-outline" size={18} color={colors.destructive} />
            <Text style={[styles.deleteMealText, { color: colors.destructive }]}>Delete Entire Meal</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1,
  },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  saveBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10 },
  saveText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  content: { padding: 16, gap: 14 },
  section: { borderRadius: 14, borderWidth: 1, padding: 14 },
  sectionLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginBottom: 8 },
  input: { fontSize: 16, fontFamily: "Inter_400Regular", paddingVertical: 6 },
  foodList: { gap: 0 },
  foodRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, gap: 10 },
  foodDivider: { height: 1 },
  foodDot: { width: 8, height: 8, borderRadius: 4 },
  foodInfo: { flex: 1, gap: 2 },
  foodNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  foodName: { fontSize: 14, fontFamily: "Inter_500Medium" },
  portionBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, borderWidth: 1 },
  portionBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
  accidentTag: { fontSize: 11, fontFamily: "Inter_400Regular" },
  deleteItemBtn: {
    width: 32, height: 32, borderRadius: 8,
    alignItems: "center", justifyContent: "center",
  },
  deleteMealBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 14, borderRadius: 14, borderWidth: 1, marginTop: 4,
  },
  deleteMealText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});

