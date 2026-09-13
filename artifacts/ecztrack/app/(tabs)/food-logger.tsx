import React, { useState, useMemo, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  Switch,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { todayKey, isOnLocalDay } from "@/lib/dates";
import { confirmDestructive, notify } from "@/lib/dialogs";
import { recentlyLoggedIds } from "@/lib/foodLog";
import { groupLogsByMeal, type MealGroup } from "@/lib/mealGroups";
import { archivedByName, restoreItem } from "@/lib/catalogEditing";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MciIcon from "@/components/MciIcon";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useAppContext } from "@/context/AppContext";
import { FoodItem } from "@/constants/foods";
import { activeItems } from "@/constants/catalog";
import type { ConsumptionLog, Portion } from "@/constants/types";
import FoodCard from "@/components/FoodCard";
import FoodEditModal from "@/components/FoodEditModal";
import MealEditModal from "@/components/MealEditModal";
import TimestampPicker from "@/components/TimestampPicker";
import PresetGroupManagerModal from "@/components/PresetGroupManagerModal";

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

export default function FoodLoggerScreen({ isEmbedded }: { isEmbedded?: boolean }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    addConsumptionLogs,
    deleteConsumptionLog,
    consumptionLogs,
    isLoaded,
    allFoods,
    customFoods,
    saveFood,
    foodCategories,
    foodTags,
    presetGroups,
    selectedDate,
  } = useAppContext();

  // "All" first, then the user's own list. It carries an id because the chips
  // filter on `food.category`, which holds a catalog id — matching on the label
  // instead would miss every category the user created, whose id is generated
  // rather than being its name.
  const categoryChips = useMemo(
    () => [{ id: "All", name: "All" }, ...activeItems(foodCategories)],
    [foodCategories],
  );

  const [showGroupManager, setShowGroupManager] = useState(false);
  const activeFoodGroups = useMemo(() => presetGroups.filter(g => g.type === "food" && !g.isArchived), [presetGroups]);
  const [draftMealName, setDraftMealName] = useState("");

  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [safeOnly, setSafeOnly] = useState(false);
  const [editingFood, setEditingFood] = useState<FoodItem | null | undefined>(undefined);
  const [logExpanded, setLogExpanded] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const [editingMeal, setEditingMeal] = useState<MealGroup | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Portion per selected food id. A food absent from this map was given no size.
  const [portions, setPortions] = useState<Record<string, Portion>>({});
  const [saving, setSaving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const getDefaultTimestamp = useCallback(() => {
    if (selectedDate === todayKey()) {
      return new Date().toISOString();
    }
    const d = new Date();
    const [y, m, day] = selectedDate.split('-');
    d.setFullYear(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(day, 10));
    return d.toISOString();
  }, [selectedDate]);

  // Tabs stay mounted, so a timestamp frozen at mount would stamp every entry
  // with the moment the tab first opened — hours stale, and on the wrong day
  // (and therefore the wrong phase) if the app was left open overnight. The
  // picker's value is only authoritative once the user has actually set it.
  const [logTimestamp, setLogTimestamp] = useState(() => new Date().toISOString());
  const timestampOverridden = useRef(false);

  function handleTimestampChange(value: string) {
    timestampOverridden.current = true;
    setLogTimestamp(value);
  }

  // Keep the displayed "now" fresh whenever the tab regains focus.
  useFocusEffect(
    useCallback(() => {
      if (!timestampOverridden.current) setLogTimestamp(getDefaultTimestamp());
    }, [getDefaultTimestamp]),
  );

  React.useEffect(() => {
    timestampOverridden.current = false;
    setLogTimestamp(getDefaultTimestamp());
  }, [selectedDate, getDefaultTimestamp]);



  const todayLogs = useMemo(
    () => consumptionLogs.filter(l => isOnLocalDay(l.timestamp, selectedDate)),
    [consumptionLogs, selectedDate],
  );

  const mealGroups = useMemo(() => groupLogsByMeal(todayLogs), [todayLogs]);

  // Distinct from the pending selection: this marks what is already on the
  // log, so a food eaten twice in a morning is obvious before it is saved
  // again. Recomputed as logs change, which is when it can actually differ.
  const recentIds = useMemo(
    () => recentlyLoggedIds(consumptionLogs, Date.now()),
    [consumptionLogs],
  );

  const filtered = useMemo(() => {
    return allFoods.filter(item => {
      // An archived food is one the user deleted while history still named
      // it. It stays in allFoods so that history renders, but it must never
      // be offered again.
      if (item.isArchived) return false;
      const matchSearch = item.name.toLowerCase().includes(search.toLowerCase());
      const matchCat = selectedCategory === "All" || item.category === selectedCategory;
      const matchSafe = !safeOnly || item.is_elimination_safe;
      return matchSearch && matchCat && matchSafe;
    });
  }, [allFoods, search, selectedCategory, safeOnly]);

  // Deleting a food that history still names archives it instead, which takes
  // it out of the picker above. Without this list that food appears nowhere at
  // all: it cannot be seen, renamed, restored or finally deleted. Same
  // recovery affordance the catalog manager gives its own archived items, and
  // deliberately subordinate to the library — it is not a second food list.
  const archived = useMemo(() => archivedByName(customFoods), [customFoods]);

  async function handleRestoreFood(food: FoodItem) {
    // The same rule the catalogs use: an archived name is reusable, so an
    // active food may have taken it, and two identically named foods in the
    // picker would be unpickable. Say which row to rename first.
    const result = restoreItem(food, customFoods);
    if (!result.ok) {
      notify(`Cannot restore "${food.name}"`, result.error);
      return;
    }
    await saveFood(result.item);
  }

  function foodName(itemId: string): string {
    return allFoods.find(f => f.id === itemId)?.name ?? itemId;
  }

  function toggleSelected(item: FoodItem) {
    Haptics.selectionAsync().catch(() => {});
    setSelectedIds(prev =>
      prev.includes(item.id) ? prev.filter(id => id !== item.id) : [...prev, item.id],
    );
    // Deselecting drops any portion with it, so re-selecting starts unsized
    // rather than silently reusing a size chosen for a different meal.
    setPortions(prev => {
      if (!(item.id in prev)) return prev;
      const { [item.id]: _dropped, ...rest } = prev;
      return rest;
    });
  }

  function setPortion(itemId: string, portion: Portion | undefined) {
    setPortions(prev => {
      if (!portion) {
        const { [itemId]: _cleared, ...rest } = prev;
        return rest;
      }
      return { ...prev, [itemId]: portion };
    });
  }

  async function handleSave() {
    if (selectedIds.length === 0 || saving) return;
    setSaving(true);
    try {
      // One timestamp for the whole selection: the point of select-then-save
      // is that a meal is a single event.
      const timestamp = timestampOverridden.current ? logTimestamp : getDefaultTimestamp();
      // One call for the whole selection: a per-food loop would have each
      // write overwrite the last, saving only the food tapped most recently.
      await addConsumptionLogs(selectedIds, { timestamp, portions, label: draftMealName || undefined });
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setSelectedIds([]);
      setPortions({});
      setDraftMealName("");
      // Release the override so the next entry defaults to "now" again.
      timestampOverridden.current = false;
      setLogTimestamp(getDefaultTimestamp());
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteEntry(logId: string) {
    const ok = await confirmDestructive(
      "Delete this entry?",
      "This food log will be removed permanently.",
    );
    if (!ok) return;
    await deleteConsumptionLog(logId);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }

  function toggleGroup(itemId: string) {
    setExpandedGroups(prev =>
      prev.includes(itemId) ? prev.filter(id => id !== itemId) : [...prev, itemId],
    );
  }

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  if (!isLoaded) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  function renderEntry(entry: ConsumptionLog) {
    const food = allFoods.find(f => f.id === entry.item_id);
    const unsafe = !food || food.is_elimination_safe === false;
    const name = food?.name ?? entry.item_id ?? "Unknown food";
    return (
      <View key={entry.id}>
        <View style={[styles.logDivider, { backgroundColor: colors.border }]} />
        <View style={[styles.logRow, styles.entryRow]}>
          <View style={[styles.foodDot, { backgroundColor: unsafe ? colors.destructive : colors.success }]} />
          <View style={styles.entryInfo}>
            <View style={styles.entryNameRow}>
              <Text style={[styles.entryName, { color: colors.foreground }]} numberOfLines={1}>
                {name}
              </Text>
              {entry.portion && (
                <View style={[styles.portionBadge, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={[styles.portionBadgeText, { color: colors.mutedForeground }]}>
                    {entry.portion}
                  </Text>
                </View>
              )}
            </View>
            <Text style={[styles.logMeta, { color: colors.mutedForeground }]}>
              {formatTime(entry.timestamp)}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.deleteBtn, { backgroundColor: colors.destructive + "18" }]}
            onPress={() => handleDeleteEntry(entry.id)}
            activeOpacity={0.7}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          >
            <MciIcon name="trash-can-outline" size={16} color={colors.destructive} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Everything above the food list rides inside the FlatList's header so the
  // whole page scrolls as one. Wrapping the list in a ScrollView instead would
  // hand it an unbounded height and disable virtualization.
  const listHeader = (
    <>
      {/* Header */}
      {/* Header */}
      <View style={[styles.header, { paddingTop: isEmbedded ? 8 : (topPad + 8), backgroundColor: colors.background }]}>
        {!isEmbedded && <Text style={[styles.title, { color: colors.foreground }]}>Food Log</Text>}
        {isEmbedded && <View style={{ flex: 1 }} />}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TouchableOpacity
            style={[styles.editLibraryBtn, { backgroundColor: colors.primary + "22", borderColor: colors.primary + "44" }]}
            onPress={() => setShowGroupManager(true)}
          >
            <MciIcon name="folder-edit" size={16} color={colors.primary} />
            <Text style={[styles.editLibraryText, { color: colors.primary }]}>Groups</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.editLibraryBtn, { backgroundColor: colors.primary + "22", borderColor: colors.primary + "44" }]}
            onPress={() => setEditingFood(null)}
          >
            <MciIcon name="plus" size={16} color={colors.primary} />
            <Text style={[styles.editLibraryText, { color: colors.primary }]}>Food</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Retrospective */}
      <View style={[styles.logOptionsBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <TimestampPicker value={logTimestamp} onChange={handleTimestampChange} label="Log for" />
      </View>

      {/* Today's log (collapsible), one row per meal */}
      {mealGroups.length > 0 && (
        <View style={[styles.todaySection, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity
            style={styles.todayHeader}
            onPress={() => setLogExpanded(e => !e)}
            activeOpacity={0.7}
          >
            <Text style={[styles.todayTitle, { color: colors.foreground }]}>
              Today's Log
            </Text>
            <View style={styles.todayMeta}>
              <Text style={[styles.todayCount, { color: colors.mutedForeground }]}>
                {todayLogs.length} item{todayLogs.length !== 1 ? "s" : ""}
              </Text>
              <MciIcon
                name={logExpanded ? "chevron-up" : "chevron-down"}
                size={18}
                color={colors.mutedForeground}
              />
            </View>
          </TouchableOpacity>

          {logExpanded && mealGroups.map((group, idx) => {
            const expanded = expandedGroups.includes(group.groupId);
            const names = group.entries.map(e => foodName(e.item_id)).join(", ");
            const anyUnsafe = group.entries.some(e => {
              const f = allFoods.find(fd => fd.id === e.item_id);
              // A food the catalog cannot resolve is indeterminate, and the
              // dot has two states — indeterminate must not borrow the
              // reassuring one.
              return !f || f.is_elimination_safe === false;
            });
            return (
              <View key={group.groupId}>
                {idx > 0 && <View style={[styles.logDivider, { backgroundColor: colors.border }]} />}
                <TouchableOpacity
                  style={styles.logRow}
                  onPress={() => toggleGroup(group.groupId)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.logDot, { backgroundColor: anyUnsafe ? colors.destructive : colors.success }]} />
                  <View style={styles.logInfo}>
                    <Text style={[styles.logName, { color: colors.foreground }]} numberOfLines={1}>
                      {group.label}
                    </Text>
                    <Text style={[styles.logMeta, { color: colors.mutedForeground }]} numberOfLines={2}>
                      {formatTime(group.timestamp)} · {names}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => setEditingMeal(group)}
                    activeOpacity={0.7}
                    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                  >
                    <MciIcon name="pencil-outline" size={16} color={colors.mutedForeground} />
                  </TouchableOpacity>
                  <MciIcon
                    name={expanded ? "chevron-up" : "chevron-down"}
                    size={18}
                    color={colors.mutedForeground}
                  />
                </TouchableOpacity>

                {expanded && group.entries.map(entry => renderEntry(entry))}
              </View>
            );
          })}
        </View>
      )}

      {/* Search bar */}
      <View style={[styles.searchContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <MciIcon name="magnify" size={18} color={colors.mutedForeground} />
        <TextInput
          style={[styles.searchInput, { color: colors.foreground }]}
          placeholder="Search foods…"
          placeholderTextColor={colors.mutedForeground}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch("")} hitSlop={10}>
            <MciIcon name="close-circle" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        )}
      </View>

      {/* Preset Groups */}
      {activeFoodGroups.length > 0 && (
        <View style={[styles.filterRow, { marginBottom: 10 }]}>
          <FlatList
            data={activeFoodGroups}
            horizontal
            keyExtractor={g => g.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
            renderItem={({ item: group }) => (
              <TouchableOpacity
                style={[
                  styles.catChip,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                  },
                ]}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setSelectedIds([...new Set([...selectedIds, ...group.item_ids])]);
                  setDraftMealName(group.name);
                }}
              >
                <MciIcon name="format-list-bulleted" size={14} color={colors.foreground} />
                <Text style={[styles.catChipText, { color: colors.foreground }]}>
                  {group.name}
                </Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      {/* Category + Safe filter row */}
      <View style={styles.filterRow}>
        <FlatList
          data={categoryChips}
          horizontal
          keyExtractor={c => c.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
          renderItem={({ item: cat }) => (
            <TouchableOpacity
              style={[
                styles.catChip,
                {
                  backgroundColor: cat.id === selectedCategory ? colors.primary : colors.card,
                  borderColor: cat.id === selectedCategory ? colors.primary : colors.border,
                },
              ]}
              onPress={() => setSelectedCategory(cat.id)}
            >
              <Text style={[
                styles.catChipText,
                { color: cat.id === selectedCategory ? colors.primaryForeground : colors.foreground },
              ]}>
                {cat.name}
              </Text>
            </TouchableOpacity>
          )}
        />
      </View>

      <View style={[styles.safeRow, { paddingHorizontal: 16, marginBottom: 10 }]}>
        <TouchableOpacity
          style={[
            styles.safeToggle,
            {
              backgroundColor: safeOnly ? colors.success + "22" : colors.card,
              borderColor: safeOnly ? colors.success + "55" : colors.border,
            },
          ]}
          onPress={() => setSafeOnly(s => !s)}
          activeOpacity={0.7}
        >
          <MciIcon
            name={safeOnly ? "shield-check" : "shield-outline"}
            size={15}
            color={safeOnly ? colors.success : colors.mutedForeground}
          />
          <Text style={[styles.safeToggleText, { color: safeOnly ? colors.success : colors.mutedForeground }]}>
            Elimination-safe only
          </Text>
        </TouchableOpacity>
      </View>
    </>
  );

  // Recovery only, so collapsed and quiet — and below the library, not in it.
  const listFooter = archived.length === 0 ? null : (
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
            Hidden from this list because entries you already logged still name them.
            Restore one to log it again.
          </Text>
          {archived.map(food => (
            <View key={food.id} style={[styles.archivedRow, { borderColor: colors.border }]}>
              <Text
                style={[styles.archivedName, { color: colors.mutedForeground }]}
                numberOfLines={1}
              >
                {food.name}
              </Text>
              <TouchableOpacity
                style={[styles.textBtn, { borderColor: colors.border }]}
                onPress={() => handleRestoreFood(food)}
                activeOpacity={0.7}
              >
                <Text style={[styles.textBtnLabel, { color: colors.primary }]}>Restore</Text>
              </TouchableOpacity>
            </View>
          ))}
        </>
      )}
    </View>
  );

  const canSave = selectedIds.length > 0 && !saving;

  // Every food is user-created, so an empty library is the normal first run,
  // not a failed search. Archived foods stay in allFoods to title old logs but
  // are never offered, so they do not make the library non-empty.
  const libraryEmpty = !allFoods.some(f => !f.isArchived);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        ListHeaderComponent={listHeader}
        ListFooterComponent={listFooter}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 16 }}
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: 16 }}>
            <FoodCard
              item={item}
              tagCatalog={foodTags}
              categoryCatalog={foodCategories}
              isSelected={selectedIds.includes(item.id)}
              isRecentlyLogged={recentIds.has(item.id)}
              portion={portions[item.id]}
              onPortion={p => setPortion(item.id, p)}
              onSelect={() => toggleSelected(item)}
              onEdit={() => setEditingFood(item)}
            />
          </View>
        )}
        ListEmptyComponent={
          <View style={{ alignItems: "center", marginTop: 40, gap: 8, paddingHorizontal: 32 }}>
            <MciIcon
              name={libraryEmpty ? "food-apple" : "food-off"}
              size={40}
              color={colors.mutedForeground}
            />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              {libraryEmpty ? "Your food library is empty" : "No foods match your filters"}
            </Text>
            <Text style={[styles.emptyHint, { color: colors.mutedForeground }]}>
              {libraryEmpty
                ? "Tap Add above to create the first food you want to track."
                : "Try a different search, category or the safe-only toggle."}
            </Text>
          </View>
        }
      />

      <View
        style={[
          styles.footer,
          {
            backgroundColor: colors.background,
            paddingBottom: (Platform.OS === "web" ? 58 : insets.bottom + 50) + 12,
            borderTopColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: canSave ? 1 : 0.4 }]}
          onPress={handleSave}
          disabled={!canSave}
          activeOpacity={0.8}
        >
          <MciIcon name="content-save" size={20} color={colors.primaryForeground} />
          <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>
            {selectedIds.length > 0
              ? `Save ${selectedIds.length} Item${selectedIds.length !== 1 ? "s" : ""}`
              : "Select Foods to Log"}
          </Text>
        </TouchableOpacity>
      </View>

      {editingFood !== undefined && (
        <FoodEditModal
          visible={editingFood !== undefined}
          food={editingFood}
          onClose={() => setEditingFood(undefined)}
        />
      )}

      <MealEditModal group={editingMeal} onClose={() => setEditingMeal(null)} />
      <PresetGroupManagerModal
        visible={showGroupManager}
        type="food"
        onClose={() => setShowGroupManager(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 12,
  },
  title: { fontSize: 28, fontFamily: "Inter_700Bold" },
  editLibraryBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 12, borderWidth: 1,
  },
  editLibraryText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  logOptionsBar: {
    marginHorizontal: 16, marginBottom: 10,
    padding: 14, borderRadius: 14, borderWidth: 1,
  },
  todaySection: {
    marginHorizontal: 16, marginBottom: 12,
    borderRadius: 14, borderWidth: 1, overflow: "hidden",
  },
  todayHeader: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14, paddingVertical: 12,
  },
  todayTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  todayMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
  todayCount: { fontSize: 12, fontFamily: "Inter_400Regular" },
  logRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 10, gap: 10,
  },
  entryRow: { paddingLeft: 28, paddingVertical: 8 },
  logDivider: { height: 1, marginHorizontal: 14 },
  logDot: { width: 8, height: 8, borderRadius: 4 },
  foodDot: { width: 8, height: 8, borderRadius: 4 },
  entryInfo: { flex: 1, gap: 2 },
  entryNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  entryName: { fontSize: 13, fontFamily: "Inter_500Medium" },
  portionBadge: {
    paddingHorizontal: 6, paddingVertical: 1,
    borderRadius: 6, borderWidth: 1,
  },
  portionBadgeText: {
    fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "capitalize",
  },
  logInfo: { flex: 1 },
  logName: { fontSize: 14, fontFamily: "Inter_500Medium" },
  logMeta: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  countBadge: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20,
  },
  countBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  deleteBtn: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
  },
  searchContainer: {
    flexDirection: "row", alignItems: "center",
    marginHorizontal: 16, marginBottom: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 14, borderWidth: 1, gap: 10,
  },
  searchInput: {
    flex: 1, fontSize: 15, fontFamily: "Inter_400Regular",
    minHeight: 40, paddingVertical: 0,
  },
  filterRow: { marginBottom: 10 },
  catChip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1, minHeight: 36, justifyContent: "center",
  },
  catChipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  safeRow: {},
  safeToggle: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 14, borderWidth: 1, alignSelf: "flex-start",
  },
  safeToggleText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  saveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 16, borderRadius: 16, minHeight: 54,
  },
  saveBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  archivedSection: { paddingHorizontal: 16, marginTop: 8, gap: 6 },
  archivedToggle: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6 },
  archivedToggleText: {
    fontSize: 11, fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase", letterSpacing: 0.8,
  },
  archivedNote: { fontSize: 12, fontFamily: "Inter_400Regular", paddingBottom: 2 },
  archivedRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingVertical: 8, paddingHorizontal: 12,
    borderRadius: 12, borderWidth: 1, borderStyle: "dashed",
  },
  archivedName: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  textBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1, minHeight: 36, justifyContent: "center",
  },
  textBtnLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  emptyText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  emptyHint: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 18 },
});
