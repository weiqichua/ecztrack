import React, { useState, useEffect, useMemo } from "react";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAppContext } from "@/context/AppContext";
import { FoodItem, FoodTagMap } from "@/constants/foods";
import { activeItems, type CatalogKind } from "@/constants/catalog";
import { DEFAULT_INTENSITY, INTENSITY_LABELS, type TagIntensity } from "@/lib/tagIntensity";
import CatalogManagerModal from "@/components/CatalogManagerModal";
import PickerHeader from "@/components/PickerHeader";

interface Props {
  visible: boolean;
  food: FoodItem | null;
  onClose: () => void;
}

export default function FoodEditModal({ visible, food, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    addCustomFood, saveFood, deleteCustomFood, foodCategories, foodTags,
  } = useAppContext();

  // Through activeItems, never an inline filter: an archived item offered here
  // would be picked, and picking it writes a food pointing at something the
  // user retired.
  const categories = useMemo(() => activeItems(foodCategories), [foodCategories]);
  const tagOptions = useMemo(() => activeItems(foodTags), [foodTags]);

  const isNew = food === null;

  const [name, setName] = useState("");
  // Both hold catalog ids, not labels — a rename must retitle every food that
  // was already filed here rather than orphan it.
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState<FoodTagMap>({});
  const [tagIntensity, setTagIntensity] = useState<Record<string, TagIntensity>>({});
  const [isSafe, setIsSafe] = useState(true);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState(false);

  const [managing, setManaging] = useState<CatalogKind | null>(null);
  // Held apart from `managing` so the manager's title and list do not change
  // as its sheet slides away.
  const [managedKind, setManagedKind] = useState<CatalogKind>("foodCategory");

  function openManager(kind: CatalogKind) {
    setManagedKind(kind);
    setManaging(kind);
  }

  useEffect(() => {
    if (visible) {
      setNameError(false);
      if (food) {
        setName(food.name);
        // Kept as stored even when the category has since been archived: this
        // is the food's own filing, and silently re-filing it on open would
        // rewrite it the next time Save is pressed.
        setCategory(food.category);
        setTags({ ...food.tags });
        setTagIntensity({ ...(food.tag_intensity ?? {}) });
        setIsSafe(food.is_elimination_safe);
      } else {
        setName("");
        // "" when the user has emptied the category catalog — the food saves
        // uncategorised rather than the form refusing to open.
        setCategory(categories[0]?.id ?? "");
        setTags({});
        setTagIntensity({});
        setIsSafe(true);
      }
    }
    // `categories` is deliberately out of the deps: it only seeds a new food's
    // default, and re-running on every catalog edit would throw away a choice
    // the user had already made in the open form.
  }, [visible, food]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleTag(id: string) {
    const wasOn = tags[id] === 1;
    setTags(prev => ({ ...prev, [id]: prev[id] === 1 ? 0 : 1 }));
    // Turning a tag off drops its grade — a grade for a tag the food no
    // longer carries is ghost data the export would have to decide what to
    // do with. Turning it on leaves tagIntensity untouched.
    if (wasOn) {
      setTagIntensity(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }

  async function handleSave() {
    if (!name.trim()) {
      setNameError(true);
      return;
    }
    setNameError(false);
    setSaving(true);
    try {
      const foodData = {
        name: name.trim(),
        category,
        tags,
        // Omitted entirely when nothing was graded, so an untouched food
        // stores no field — an empty object would be a written record of a
        // decision the user never made.
        ...(Object.keys(tagIntensity).length > 0 ? { tag_intensity: tagIntensity } : {}),
        is_elimination_safe: isSafe,
      };
      if (isNew) {
        await addCustomFood(foodData);
      } else {
        await saveFood({ ...food!, ...foodData, is_custom: true });
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!food) return;
    const ok = await confirmDestructive(
      `Delete "${food.name}"?`,
      "It will be removed from your food list. Entries already logged are kept.",
    );
    if (!ok) return;
    // The mutator archives instead of deleting when a log still names this
    // food, so that history keeps rendering a name. Say which happened —
    // otherwise the food reappearing in an old entry looks like a failed
    // delete.
    const outcome = await deleteCustomFood(food.id);
    if (outcome === "archived") {
      notify(
        `"${food.name}" was archived`,
        "Past entries still refer to it, so it was hidden from the food list rather " +
          "than deleted. It is under Hidden at the bottom of the food list if you want it back.",
      );
    }
    onClose();
  }

  const styles = makeStyles(colors);
  const bottomPad = Platform.OS === "web" ? 84 : insets.bottom + 50;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: colors.background }]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={[styles.header, { paddingTop: Platform.OS === "web" ? 20 : insets.top + 8 }]}>
          <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.headerBtn}>
            <MciIcon name="close" size={22} color={colors.mutedForeground} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            {isNew ? "Add Food" : "Edit Food"}
          </Text>
          <TouchableOpacity onPress={handleSave} hitSlop={12} style={styles.headerBtn} disabled={saving}>
            <Text style={[styles.saveText, { color: colors.primary }]}>
              {saving ? "Saving…" : "Save"}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: bottomPad + 20 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Food Name</Text>
            <TextInput
              style={[styles.nameInput, {
                color: colors.foreground,
                borderColor: nameError ? colors.destructive : "transparent",
                borderWidth: 1,
              }]}
              value={name}
              onChangeText={v => { setName(v); if (v.trim()) setNameError(false); }}
              placeholder="e.g. Oat Milk Latte"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="words"
              returnKeyType="done"
            />
            {nameError && (
              <Text style={{ color: colors.destructive, fontSize: 12, marginTop: 4 }}>
                Food name is required
              </Text>
            )}
          </View>

          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <PickerHeader
              label="Category" colors={colors} onManage={() => openManager("foodCategory")}
              style={styles.pickerHeader} labelStyle={styles.pickerHeaderLabel}
            />
            <View style={styles.categoryGrid}>
              {categories.map(cat => (
                <TouchableOpacity
                  key={cat.id}
                  style={[
                    styles.categoryChip,
                    {
                      backgroundColor: category === cat.id ? colors.primary : colors.background,
                      borderColor: category === cat.id ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setCategory(cat.id)}
                >
                  <Text style={[
                    styles.categoryChipText,
                    { color: category === cat.id ? colors.primaryForeground : colors.foreground },
                  ]}>
                    {cat.name}
                  </Text>
                </TouchableOpacity>
              ))}
              {categories.length === 0 && (
                <Text style={[styles.emptyHint, { color: colors.mutedForeground }]}>
                  No categories yet — add one above.
                </Text>
              )}
            </View>
          </View>

          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <PickerHeader
              label="Contains" colors={colors} onManage={() => openManager("foodTag")}
              style={styles.pickerHeader} labelStyle={styles.pickerHeaderLabel}
            />
            {tagOptions.map(tag => (
              <React.Fragment key={tag.id}>
              <TouchableOpacity
                style={styles.tagRow}
                onPress={() => toggleTag(tag.id)}
                activeOpacity={0.7}
              >
                <View style={styles.tagLeft}>
                  {/* A tag need not carry an icon. The blank keeps the labels
                      on one left edge instead of letting them jump per row. */}
                  {tag.icon ? (
                    <MciIcon
                      name={tag.icon as any}
                      size={18}
                      color={tags[tag.id] ? colors.primary : colors.mutedForeground}
                    />
                  ) : (
                    <View style={styles.iconSpacer} />
                  )}
                  <Text style={[styles.tagLabel, { color: colors.foreground }]}>{tag.name}</Text>
                </View>
                <View style={[
                  styles.toggle,
                  {
                    backgroundColor: tags[tag.id] ? colors.primary : colors.border,
                  },
                ]}>
                  <View style={[
                    styles.toggleThumb,
                    {
                      backgroundColor: "#fff",
                      transform: [{ translateX: tags[tag.id] ? 18 : 2 }],
                    },
                  ]} />
                </View>
              </TouchableOpacity>
                {tags[tag.id] === 1 && (
                  <View style={{ flexDirection: "row", gap: 6, paddingLeft: 30, paddingBottom: 10 }}>
                    {([1, 2, 3] as TagIntensity[]).map(level => {
                      const selected = (tagIntensity[tag.id] ?? DEFAULT_INTENSITY) === level;
                      const graded = tagIntensity[tag.id] !== undefined;
                      return (
                        <TouchableOpacity
                          key={level}
                          onPress={() => setTagIntensity(prev => ({ ...prev, [tag.id]: level }))}
                          activeOpacity={0.7}
                          style={{
                            paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
                            borderWidth: 1,
                            borderColor: selected ? colors.primary : colors.border,
                            backgroundColor: selected ? colors.primary + "22" : "transparent",
                          }}
                        >
                          <Text style={{
                            fontSize: 12, fontFamily: "Inter_600SemiBold",
                            // An ungraded tag shows Average selected but dimmed, so the user
                            // can see it is a fallback rather than something they chose.
                            color: selected ? (graded ? colors.primary : colors.mutedForeground) : colors.mutedForeground,
                          }}>
                            {INTENSITY_LABELS[level]}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </React.Fragment>
            ))}
            {tagOptions.length === 0 && (
              <Text style={[styles.emptyHint, { color: colors.mutedForeground }]}>
                No tags yet — add one above.
              </Text>
            )}
          </View>

          <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Elimination Phase</Text>
            <TouchableOpacity
              style={styles.tagRow}
              onPress={() => setIsSafe(!isSafe)}
              activeOpacity={0.7}
            >
              <View style={styles.tagLeft}>
                <MciIcon
                  name={isSafe ? "check-circle" : "alert-circle"}
                  size={18}
                  color={isSafe ? colors.success : colors.destructive}
                />
                <Text style={[styles.tagLabel, { color: colors.foreground }]}>
                  {isSafe ? "Safe to eat" : "Avoid / Warning"}
                </Text>
              </View>
              <View style={[
                styles.toggle,
                { backgroundColor: isSafe ? colors.success : colors.destructive },
              ]}>
                <View style={[
                  styles.toggleThumb,
                  {
                    backgroundColor: "#fff",
                    transform: [{ translateX: isSafe ? 18 : 2 }],
                  },
                ]} />
              </View>
            </TouchableOpacity>
          </View>

          {!isNew && (
            <TouchableOpacity
              style={[styles.deleteBtn, { borderColor: colors.destructive + "55" }]}
              onPress={handleDelete}
              activeOpacity={0.7}
            >
              <MciIcon name="trash-can-outline" size={18} color={colors.destructive} />
              <Text style={[styles.deleteBtnText, { color: colors.destructive }]}>
                Delete Food
              </Text>
            </TouchableOpacity>
          )}
        </ScrollView>

        {/* Nested inside this sheet on purpose — it is only ever opened from
            the two pickers above, and a sibling Modal would not layer over
            them. */}
        <CatalogManagerModal
          visible={managing !== null}
          kind={managedKind}
          onClose={() => setManaging(null)}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(colors: ReturnType<typeof import("@/hooks/useColors").useColors>) {
  return StyleSheet.create({
    container: {
      flex: 1,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingBottom: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerBtn: {
      minWidth: 48,
    },
    headerTitle: {
      fontSize: 17,
      fontFamily: "Inter_600SemiBold",
    },
    saveText: {
      fontSize: 16,
      fontFamily: "Inter_600SemiBold",
      textAlign: "right",
    },
    scroll: {
      padding: 16,
      gap: 12,
    },
    section: {
      borderRadius: 16,
      borderWidth: 1,
      padding: 16,
      marginBottom: 12,
    },
    sectionLabel: {
      fontSize: 11,
      fontFamily: "Inter_600SemiBold",
      textTransform: "uppercase",
      letterSpacing: 0.8,
      marginBottom: 12,
    },
    nameInput: {
      fontSize: 17,
      fontFamily: "Inter_400Regular",
      paddingVertical: 4,
    },
    // PickerHeader carries its own row spacing; these put its label back on
    // the section-label type and close the gap it leaves above.
    pickerHeader: {
      marginTop: 0,
      marginBottom: 12,
    },
    pickerHeaderLabel: {
      fontSize: 11,
      fontFamily: "Inter_600SemiBold",
    },
    emptyHint: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
    },
    iconSpacer: {
      width: 18,
    },
    categoryGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    categoryChip: {
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 20,
      borderWidth: 1,
    },
    categoryChipText: {
      fontSize: 13,
      fontFamily: "Inter_500Medium",
    },
    tagRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border + "55",
    },
    tagLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      flex: 1,
    },
    tagLabel: {
      fontSize: 15,
      fontFamily: "Inter_400Regular",
    },
    toggle: {
      width: 42,
      height: 24,
      borderRadius: 12,
      justifyContent: "center",
    },
    toggleThumb: {
      width: 20,
      height: 20,
      borderRadius: 10,
      position: "absolute",
    },
    deleteBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingVertical: 16,
      borderRadius: 14,
      borderWidth: 1,
      marginTop: 4,
    },
    deleteBtnText: {
      fontSize: 15,
      fontFamily: "Inter_500Medium",
    },
  });
}
