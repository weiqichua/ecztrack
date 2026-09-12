import React, { useState, useMemo } from "react";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAppContext } from "@/context/AppContext";
import MciIcon from "@/components/MciIcon";
import { PresetGroup, PresetGroupType } from "@/constants/types";
import { confirmDestructive, notify } from "@/lib/dialogs";

interface Props {
  visible: boolean;
  type: PresetGroupType;
  onClose: () => void;
}

export default function PresetGroupManagerModal({ visible, type, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { presetGroups, allFoods, supplements, addPresetGroup, updatePresetGroup, deletePresetGroup } = useAppContext();

  const activeGroups = useMemo(() => presetGroups.filter(g => g.type === type && !g.isArchived), [presetGroups, type]);

  const [editingGroupId, setEditingGroupId] = useState<string | "NEW" | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftItemIds, setDraftItemIds] = useState<string[]>([]);

  const openEditor = (group: PresetGroup | null) => {
    if (group) {
      setEditingGroupId(group.id);
      setDraftName(group.name);
      setDraftItemIds([...group.item_ids]);
    } else {
      setEditingGroupId("NEW");
      setDraftName("");
      setDraftItemIds([]);
    }
  };

  const closeEditor = () => {
    setEditingGroupId(null);
    setDraftName("");
    setDraftItemIds([]);
  };

  const handleSave = async () => {
    const trimmed = draftName.trim();
    if (!trimmed) {
      notify("Name cannot be empty.");
      return;
    }
    if (draftItemIds.length === 0) {
      notify("Please select at least one item.");
      return;
    }

    if (editingGroupId === "NEW") {
      await addPresetGroup(trimmed, type, draftItemIds);
    } else if (editingGroupId) {
      const group = presetGroups.find(g => g.id === editingGroupId);
      if (group) {
        await updatePresetGroup({ ...group, name: trimmed, item_ids: draftItemIds });
      }
    }
    closeEditor();
  };

  const handleDelete = async (id: string) => {
    const ok = await confirmDestructive("Delete Group", "Are you sure you want to delete this group?");
    if (ok) {
      await deletePresetGroup(id);
    }
  };

  const toggleItem = (id: string) => {
    if (draftItemIds.includes(id)) {
      setDraftItemIds(draftItemIds.filter(x => x !== id));
    } else {
      setDraftItemIds([...draftItemIds, id]);
    }
  };

  const availableItems = useMemo(() => {
    if (type === "food") {
      return allFoods.filter(f => !f.isArchived).map(f => ({ id: f.id, name: f.name }));
    } else {
      return supplements.filter(s => !s.isArchived).map(s => ({ id: s.id, name: s.name }));
    }
  }, [type, allFoods, supplements]);

  const styles = StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: "bold",
      color: colors.foreground,
    },
    closeBtn: {
      padding: 8,
    },
    listContent: {
      padding: 16,
    },
    groupRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    groupName: {
      fontSize: 16,
      fontWeight: "500",
      color: colors.foreground,
    },
    groupItems: {
      fontSize: 14,
      color: colors.mutedForeground,
      marginTop: 2,
    },
    rowActions: {
      flexDirection: "row",
    },
    iconBtn: {
      padding: 8,
      marginLeft: 8,
    },
    addBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.primary,
      padding: 12,
      borderRadius: 8,
      margin: 16,
    },
    addBtnText: {
      color: colors.primaryForeground,
      fontWeight: "bold",
      marginLeft: 8,
    },
    editorContainer: {
      flex: 1,
      padding: 16,
    },
    label: {
      fontSize: 16,
      fontWeight: "bold",
      color: colors.foreground,
      marginBottom: 8,
      marginTop: 16,
    },
    input: {
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 8,
      padding: 12,
      color: colors.foreground,
      fontSize: 16,
    },
    chipsContainer: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 16,
      borderWidth: 1,
    },
    chipText: {
      fontSize: 14,
      fontWeight: "500",
    },
    saveBtn: {
      backgroundColor: colors.primary,
      padding: 16,
      borderRadius: 8,
      alignItems: "center",
      marginTop: 24,
    },
    saveBtnText: {
      color: colors.primaryForeground,
      fontWeight: "bold",
      fontSize: 16,
    },
    cancelBtn: {
      padding: 16,
      alignItems: "center",
    },
    cancelBtnText: {
      color: colors.mutedForeground,
      fontSize: 16,
    },
  });

  return (
    <Modal visible={visible} transparent={false} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[styles.overlay, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>
              {editingGroupId ? (editingGroupId === "NEW" ? "New Group" : "Edit Group") : (type === "food" ? "Food Groups" : "Supplement Groups")}
            </Text>
            {!editingGroupId && (
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <MciIcon name="close" size={24} color={colors.foreground} />
              </TouchableOpacity>
            )}
          </View>

          {editingGroupId ? (
            <ScrollView style={styles.editorContainer}>
              <Text style={[styles.label, { marginTop: 0 }]}>Group Name</Text>
              <TextInput
                style={styles.input}
                value={draftName}
                onChangeText={setDraftName}
                placeholder="e.g. Breakfast Set"
                placeholderTextColor={colors.mutedForeground}
                autoFocus
              />

              <Text style={styles.label}>Select Items</Text>
              <View style={styles.chipsContainer}>
                {availableItems.map(item => {
                  const selected = draftItemIds.includes(item.id);
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: selected ? colors.primary : colors.card,
                          borderColor: selected ? colors.primary : colors.border,
                        }
                      ]}
                      onPress={() => toggleItem(item.id)}
                    >
                      <Text style={[styles.chipText, { color: selected ? colors.primaryForeground : colors.foreground }]}>
                        {item.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
                <Text style={styles.saveBtnText}>Save Group</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancelBtn} onPress={closeEditor}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          ) : (
            <>
              <ScrollView style={styles.listContent}>
                {activeGroups.map(group => {
                  const itemsCount = group.item_ids.length;
                  return (
                    <View key={group.id} style={styles.groupRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.groupName}>{group.name}</Text>
                        <Text style={styles.groupItems}>{itemsCount} item{itemsCount !== 1 ? 's' : ''}</Text>
                      </View>
                      <View style={styles.rowActions}>
                        <TouchableOpacity style={styles.iconBtn} onPress={() => openEditor(group)}>
                          <MciIcon name="pencil" size={20} color={colors.mutedForeground} />
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.iconBtn} onPress={() => handleDelete(group.id)}>
                          <MciIcon name="delete" size={20} color={colors.destructive} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
              <TouchableOpacity style={styles.addBtn} onPress={() => openEditor(null)}>
                <MciIcon name="plus" size={20} color={colors.primaryForeground} />
                <Text style={styles.addBtnText}>Create Group</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
