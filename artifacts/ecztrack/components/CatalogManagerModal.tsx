import React, { useEffect, useMemo, useState } from "react";
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
import { confirmDestructive, notify } from "@/lib/dialogs";
import MciIcon from "@/components/MciIcon";
import IconPicker from "@/components/IconPicker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAppContext } from "@/context/AppContext";
import { activeItems, CatalogKind, RoutineItem } from "@/constants/catalog";
import { archivedItems, checkCatalogName, moveInList, restoreItem } from "@/lib/catalogEditing";

interface Props {
  visible: boolean;
  kind: CatalogKind;
  onClose: () => void;
}

/** Per-kind wording. One place to look when a seventh screen adopts this. */
const COPY: Record<CatalogKind, { title: string; empty: string; placeholder: string }> = {
  bodyLocation: {
    title: "Body Locations",
    empty: "No body locations yet — add one above.",
    placeholder: "e.g. Left elbow",
  },
  cue: {
    title: "Triggers / Cues",
    empty: "No triggers yet — add one above.",
    placeholder: "e.g. Stressed at work",
  },
  routine: {
    title: "Competing Routines",
    empty: "No competing routines yet — add one above.",
    placeholder: "e.g. Clench fists for 30s",
  },
  symptom: {
    title: "Check-in Items",
    empty: "No check-in items yet — add one above.",
    placeholder: "e.g. Itch severity",
  },
  foodCategory: {
    title: "Food Categories",
    empty: "No food categories yet — add one above.",
    placeholder: "e.g. Drinks",
  },
  foodTag: {
    title: "Contains Tags",
    empty: "No contains tags yet — add one above.",
    placeholder: "e.g. Shellfish",
  },
  supplement: {
    title: "Supplements",
    empty: "No supplements yet — add one above.",
    placeholder: "e.g. Vitamin D",
  },
  activity: {
    title: "Activities",
    empty: "No activities yet — add one above.",
    placeholder: "e.g. Running",
  },
};

/**
 * Add, rename, reorder and delete for one user-created catalog.
 *
 * Generic over `CatalogKind` because all six lists are the same shape and the
 * same five actions; only the wording, the routine's optional description and
 * the food tag's optional icon differ. Reads its items straight from context by
 * kind so a caller only has to name the kind.
 *
 * The main list is active items only. That matches `reorderCatalogItems`, which
 * renumbers around the ids it is given and leaves unlisted (archived) items
 * behind them — and an archived item has no place in a list whose whole purpose
 * is choosing what the pickers offer.
 *
 * Archived items get a collapsed section of their own underneath, and it is the
 * only read of them outside `itemName`. It has to exist: deleting an item that
 * history references archives it, so without a way back the user's ordinary
 * delete leads somewhere they can never return from. It stays visually
 * subordinate — a recovery affordance, not a second list.
 */
export default function CatalogManagerModal({ visible, kind, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    bodyLocations, cues, routines, symptoms, foodCategories, foodTags, supplements, activities,
    addCatalogItem, updateCatalogItem, deleteCatalogItem, reorderCatalogItems,
  } = useAppContext();

  // A `Record<CatalogKind, …>` rather than a ternary chain on purpose. The
  // chain this replaced ended in a bare `: symptoms`, so the two food kinds —
  // added long after it was written — silently read and wrote the symptom
  // catalog. A total record makes the next kind a compile error instead.
  const catalog: RoutineItem[] = {
    bodyLocation: bodyLocations,
    cue: cues,
    routine: routines,
    symptom: symptoms,
    foodCategory: foodCategories,
    foodTag: foodTags,
    supplement: supplements,
    activity: activities,
  }[kind];

  const items = useMemo(() => activeItems(catalog), [catalog]);
  const archived = useMemo(() => archivedItems(catalog), [catalog]);
  const copy = COPY[kind];
  const showDescription = kind === "routine";
  const showIcon = kind === "foodTag";

  const [draft, setDraft] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [draftIcon, setDraftIcon] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editIcon, setEditIcon] = useState<string | undefined>(undefined);
  const [editError, setEditError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  // A reopen has to start clean: a rejected name or a half-finished rename left
  // over from last time reads as an error against whatever the user types now.
  //
  // `kind` is a dep as well as `visible`, because a caller may swap the kind on
  // an already-open manager. Every one of these is per-catalog, so leaving any
  // behind carries a name typed for one list into another — and validates it
  // against the wrong list while it sits there.
  useEffect(() => {
    setDraft("");
    setDraftDesc("");
    setDraftIcon(undefined);
    setError(null);
    setEditingId(null);
    setEditName("");
    setEditDesc("");
    setEditIcon(undefined);
    setEditError(null);
    setShowArchived(false);
  }, [visible, kind]);

  async function handleAdd() {
    const check = checkCatalogName(draft, items);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setError(null);
    await addCatalogItem(kind, check.name, {
      ...(showDescription && draftDesc.trim() ? { description: draftDesc.trim() } : null),
      ...(showIcon && draftIcon ? { icon: draftIcon } : null),
    });
    setDraft("");
    setDraftDesc("");
    setDraftIcon(undefined);
  }

  function startEdit(item: RoutineItem) {
    setEditingId(item.id);
    setEditName(item.name);
    setEditDesc(item.description ?? "");
    setEditIcon(item.icon);
    setEditError(null);
  }

  async function handleRename(item: RoutineItem) {
    const check = checkCatalogName(editName, items, item.id);
    if (!check.ok) {
      setEditError(check.error);
      return;
    }
    setEditError(null);
    await updateCatalogItem(kind, {
      ...item,
      name: check.name,
      ...(showDescription ? { description: editDesc.trim() || undefined } : null),
      ...(showIcon ? { icon: editIcon } : null),
    });
    setEditingId(null);
  }

  async function handleMove(index: number, delta: number) {
    const ids = items.map(i => i.id);
    const next = moveInList(ids, index, delta);
    if (next === ids) return;
    await reorderCatalogItems(kind, next);
  }

  async function handleDelete(item: RoutineItem) {
    const ok = await confirmDestructive(
      `Delete "${item.name}"?`,
      "If past entries still use it, it will be hidden from the pickers instead of removed.",
    );
    if (!ok) return;
    const outcome = await deleteCatalogItem(kind, item.id);
    // The mutator archives rather than deletes whenever history points at the
    // item. Saying "deleted" either way would be a lie the user can catch:
    // their old entries still show the name.
    if (outcome === "archived") {
      notify(
        `"${item.name}" is still in use`,
        "Past entries reference it, so it has been hidden from the pickers rather than deleted. They keep showing its name.",
      );
    }
    if (editingId === item.id) setEditingId(null);
  }

  async function handleRestore(item: RoutineItem) {
    const result = restoreItem(item, catalog);
    if (!result.ok) {
      notify(`Cannot restore "${item.name}"`, result.error);
      return;
    }
    // `updateCatalogItem` writes the whole item through by id and re-stamps it,
    // so clearing the flag and the order here is the entire restore.
    await updateCatalogItem(kind, result.item);
  }

  const bottomPad = Platform.OS === "web" ? 84 : insets.bottom + 50;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: colors.background }]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MciIcon name="close" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>{copy.title}</Text>
          <TouchableOpacity
            style={[styles.doneBtn, { backgroundColor: colors.primary }]}
            onPress={onClose}
          >
            <Text style={[styles.doneBtnText, { color: colors.primaryForeground }]}>Done</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Add */}
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Add New</Text>
            <View style={styles.addRow}>
              <TextInput
                style={[
                  styles.input,
                  {
                    flex: 1,
                    color: colors.foreground,
                    borderColor: error ? colors.destructive : colors.border,
                  },
                ]}
                value={draft}
                onChangeText={v => { setDraft(v); if (error) setError(null); }}
                placeholder={copy.placeholder}
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="sentences"
                returnKeyType="done"
                onSubmitEditing={handleAdd}
              />
              <TouchableOpacity
                style={[styles.addBtn, { backgroundColor: colors.primary }]}
                onPress={handleAdd}
                activeOpacity={0.8}
              >
                <MciIcon name="plus" size={20} color={colors.primaryForeground} />
              </TouchableOpacity>
            </View>
            {showDescription && (
              <TextInput
                style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
                value={draftDesc}
                onChangeText={setDraftDesc}
                placeholder="Optional description"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="sentences"
                returnKeyType="done"
              />
            )}
            {showIcon && <IconPicker value={draftIcon} onChange={setDraftIcon} />}
            {error && <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>}
          </View>

          {/* Existing items */}
          {items.length === 0 ? (
            <View style={[styles.empty, { borderColor: colors.border }]}>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>{copy.empty}</Text>
            </View>
          ) : (
            items.map((item, index) => {
              const isEditing = editingId === item.id;
              return (
                <View
                  key={item.id}
                  style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  {isEditing ? (
                    <View style={styles.rowEdit}>
                      <TextInput
                        style={[
                          styles.input,
                          {
                            color: colors.foreground,
                            borderColor: editError ? colors.destructive : colors.border,
                          },
                        ]}
                        value={editName}
                        onChangeText={v => { setEditName(v); if (editError) setEditError(null); }}
                        placeholder={copy.placeholder}
                        placeholderTextColor={colors.mutedForeground}
                        autoCapitalize="sentences"
                        returnKeyType="done"
                        onSubmitEditing={() => handleRename(item)}
                        autoFocus
                      />
                      {showDescription && (
                        <TextInput
                          style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
                          value={editDesc}
                          onChangeText={setEditDesc}
                          placeholder="Optional description"
                          placeholderTextColor={colors.mutedForeground}
                          autoCapitalize="sentences"
                          returnKeyType="done"
                        />
                      )}
                      {showIcon && <IconPicker value={editIcon} onChange={setEditIcon} />}
                      {editError && (
                        <Text style={[styles.errorText, { color: colors.destructive }]}>{editError}</Text>
                      )}
                      <View style={styles.editActions}>
                        <TouchableOpacity
                          style={[styles.textBtn, { borderColor: colors.border }]}
                          onPress={() => setEditingId(null)}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.textBtnLabel, { color: colors.mutedForeground }]}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.textBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}
                          onPress={() => handleRename(item)}
                          activeOpacity={0.8}
                        >
                          <Text style={[styles.textBtnLabel, { color: colors.primaryForeground }]}>Save</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <>
                      {showIcon && (
                        <View style={styles.rowIcon}>
                          {item.icon ? (
                            <MciIcon name={item.icon} size={20} color={colors.mutedForeground} />
                          ) : null}
                        </View>
                      )}
                      <View style={styles.rowInfo}>
                        <Text style={[styles.rowName, { color: colors.foreground }]}>{item.name}</Text>
                        {item.description ? (
                          <Text style={[styles.rowDesc, { color: colors.mutedForeground }]}>
                            {item.description}
                          </Text>
                        ) : null}
                      </View>
                      <TouchableOpacity
                        style={styles.iconBtn}
                        onPress={() => handleMove(index, -1)}
                        disabled={index === 0}
                        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                      >
                        <MciIcon
                          name="chevron-up"
                          size={22}
                          color={index === 0 ? colors.border : colors.mutedForeground}
                        />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.iconBtn}
                        onPress={() => handleMove(index, 1)}
                        disabled={index === items.length - 1}
                        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                      >
                        <MciIcon
                          name="chevron-down"
                          size={22}
                          color={index === items.length - 1 ? colors.border : colors.mutedForeground}
                        />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.iconBtn}
                        onPress={() => startEdit(item)}
                        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                      >
                        <MciIcon name="pencil-outline" size={18} color={colors.mutedForeground} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.iconBtn}
                        onPress={() => handleDelete(item)}
                        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                      >
                        <MciIcon name="trash-can-outline" size={18} color={colors.destructive} />
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              );
            })
          )}

          {/* Archived — recovery only, so collapsed and quiet */}
          {archived.length > 0 && (
            <View style={styles.archivedSection}>
              <TouchableOpacity
                style={styles.archivedToggle}
                onPress={() => setShowArchived(v => !v)}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MciIcon
                  name={showArchived ? "chevron-down" : "chevron-right"}
                  size={18}
                  color={colors.mutedForeground}
                />
                <Text style={[styles.archivedToggleText, { color: colors.mutedForeground }]}>
                  Hidden ({archived.length})
                </Text>
              </TouchableOpacity>
              {showArchived && (
                <>
                  <Text style={[styles.archivedNote, { color: colors.mutedForeground }]}>
                    Hidden from the pickers because past entries still use them. Restore one to
                    offer it again.
                  </Text>
                  {archived.map(item => (
                    <View key={item.id} style={[styles.archivedRow, { borderColor: colors.border }]}>
                      <Text
                        style={[styles.archivedName, { color: colors.mutedForeground }]}
                        numberOfLines={1}
                      >
                        {item.name}
                      </Text>
                      <TouchableOpacity
                        style={[styles.textBtn, { borderColor: colors.border }]}
                        onPress={() => handleRestore(item)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.textBtnLabel, { color: colors.primary }]}>Restore</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </>
              )}
            </View>
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
    paddingTop: 20,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  doneBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    minHeight: 36,
    justifyContent: "center",
  },
  doneBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  content: { padding: 16, gap: 10 },
  section: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 10 },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  addRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  input: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 44,
  },
  addBtn: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  errorText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  empty: {
    paddingVertical: 24,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
  },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  rowEdit: { flex: 1, gap: 10 },
  rowIcon: { width: 26, alignItems: "center" },
  rowInfo: { flex: 1, paddingRight: 4 },
  rowName: { fontSize: 15, fontFamily: "Inter_500Medium" },
  rowDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  iconBtn: { width: 32, height: 36, alignItems: "center", justifyContent: "center" },
  editActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  textBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    minHeight: 36,
    justifyContent: "center",
  },
  textBtnLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  archivedSection: { marginTop: 8, gap: 6 },
  archivedToggle: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6 },
  archivedToggleText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  archivedNote: { fontSize: 12, fontFamily: "Inter_400Regular", paddingBottom: 2 },
  archivedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  archivedName: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
});
