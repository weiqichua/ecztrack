import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { confirmDestructive } from "@/lib/dialogs";
import MciIcon from "@/components/MciIcon";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAppContext } from "@/context/AppContext";
import { HabitDefinition, HABIT_ICONS } from "@/constants/types";

interface Props {
  visible: boolean;
  habit: HabitDefinition | null;
  onClose: () => void;
}

export default function HabitEditModal({ visible, habit, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { addHabitDefinition, updateHabitDefinition, deleteHabitDefinition } = useAppContext();

  const isNew = habit === null;

  const [name, setName] = useState("");
  const [icon, setIcon] = useState(HABIT_ICONS[0]);
  const [unit, setUnit] = useState<"check" | "count">("check");
  const [goal, setGoal] = useState("1");
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState(false);

  useEffect(() => {
    if (visible) {
      setNameError(false);
      if (habit) {
        setName(habit.name);
        setIcon(habit.icon);
        setUnit(habit.unit);
        setGoal(habit.goal != null ? String(habit.goal) : "1");
      } else {
        setName("");
        setIcon(HABIT_ICONS[0]);
        setUnit("check");
        setGoal("1");
      }
    }
  }, [visible, habit]);

  async function handleSave() {
    if (!name.trim()) {
      setNameError(true);
      return;
    }
    setNameError(false);
    setSaving(true);
    try {
      const goalNum = unit === "count" ? Math.max(1, parseInt(goal) || 1) : undefined;
      if (isNew) {
        await addHabitDefinition({ name: name.trim(), icon, unit, goal: goalNum });
      } else {
        await updateHabitDefinition({ ...habit!, name: name.trim(), icon, unit, goal: goalNum });
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!habit) return;
    const ok = await confirmDestructive(
      `Delete "${habit.name}"?`,
      "This habit and its entire tracked history will be removed permanently. This cannot be undone.",
    );
    if (!ok) return;
    await deleteHabitDefinition(habit.id);
    onClose();
  }

  const bottomPad = Platform.OS === "web" ? 84 : insets.bottom + 50;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: colors.background }]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={[styles.header, { borderBottomColor: colors.border, paddingTop: Platform.OS === "web" ? 20 : insets.top + 8 }]}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MciIcon name="close" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            {isNew ? "New Habit" : "Edit Habit"}
          </Text>
          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }]}
            onPress={handleSave}
            disabled={saving}
          >
            <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>
              {saving ? "Saving…" : "Save"}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Name */}
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Habit Name</Text>
            <TextInput
              style={[
                styles.nameInput,
                {
                  color: colors.foreground,
                  borderColor: nameError ? colors.destructive : "transparent",
                  borderWidth: 1,
                },
              ]}
              value={name}
              onChangeText={v => { setName(v); if (v.trim()) setNameError(false); }}
              placeholder="e.g. Read for 20 mins"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="sentences"
              returnKeyType="done"
            />
            {nameError && (
              <Text style={[styles.errorText, { color: colors.destructive }]}>
                Habit name is required
              </Text>
            )}
          </View>

          {/* Icon picker */}
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Icon</Text>
            <View style={styles.iconGrid}>
              {HABIT_ICONS.map(ic => (
                <TouchableOpacity
                  key={ic}
                  style={[
                    styles.iconCell,
                    {
                      backgroundColor: icon === ic ? colors.primary + "22" : colors.card,
                      borderColor: icon === ic ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setIcon(ic)}
                  activeOpacity={0.7}
                >
                  <MciIcon
                    name={ic as any}
                    size={22}
                    color={icon === ic ? colors.primary : colors.mutedForeground}
                  />
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Unit type */}
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Tracking Type</Text>
            <View style={styles.unitRow}>
              {(["check", "count"] as const).map(u => (
                <TouchableOpacity
                  key={u}
                  style={[
                    styles.unitBtn,
                    {
                      flex: 1,
                      backgroundColor: unit === u ? colors.primary : colors.card,
                      borderColor: unit === u ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setUnit(u)}
                  activeOpacity={0.8}
                >
                  <MciIcon
                    name={u === "check" ? "check-circle-outline" : "counter"}
                    size={18}
                    color={unit === u ? colors.primaryForeground : colors.mutedForeground}
                  />
                  <Text style={[
                    styles.unitBtnText,
                    { color: unit === u ? colors.primaryForeground : colors.foreground },
                  ]}>
                    {u === "check" ? "Done / Not Done" : "Count"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.unitHint, { color: colors.mutedForeground }]}>
              {unit === "check"
                ? "Tap once to mark done, tap again to unmark."
                : "Use + / − buttons to count how many times you completed this."}
            </Text>
          </View>

          {/* Daily goal — count type only */}
          {unit === "count" && (
            <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Daily Goal</Text>
              <View style={styles.goalRow}>
                <TouchableOpacity
                  style={[styles.goalBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={() => setGoal(String(Math.max(1, (parseInt(goal) || 1) - 1)))}
                >
                  <MciIcon name="minus" size={20} color={colors.foreground} />
                </TouchableOpacity>
                <TextInput
                  style={[styles.goalInput, { color: colors.foreground, borderColor: colors.border }]}
                  value={goal}
                  onChangeText={v => setGoal(v.replace(/[^0-9]/g, ""))}
                  keyboardType="number-pad"
                  returnKeyType="done"
                  textAlign="center"
                />
                <TouchableOpacity
                  style={[styles.goalBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={() => setGoal(String((parseInt(goal) || 0) + 1))}
                >
                  <MciIcon name="plus" size={20} color={colors.foreground} />
                </TouchableOpacity>
              </View>
              <Text style={[styles.unitHint, { color: colors.mutedForeground }]}>
                A progress bar will fill as you count toward this goal each day.
              </Text>
            </View>
          )}

          {/* Delete (edit mode only) */}
          {!isNew && (
            <TouchableOpacity
              style={[styles.deleteBtn, { borderColor: colors.destructive + "55" }]}
              onPress={handleDelete}
              activeOpacity={0.7}
            >
              <MciIcon name="trash-can-outline" size={18} color={colors.destructive} />
              <Text style={[styles.deleteBtnText, { color: colors.destructive }]}>Delete Habit</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  saveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    minHeight: 36,
    justifyContent: "center",
  },
  saveBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  content: { padding: 16, gap: 14 },
  section: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  nameInput: {
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
    minHeight: 44,
  },
  errorText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  iconGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  iconCell: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  unitRow: { flexDirection: "row", gap: 10 },
  unitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 48,
  },
  unitBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  unitHint: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  goalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    justifyContent: "center",
  },
  goalBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  goalInput: {
    width: 70,
    height: 44,
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    borderWidth: 1,
    borderRadius: 10,
    textAlign: "center",
  },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    minHeight: 48,
    marginTop: 8,
  },
  deleteBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
