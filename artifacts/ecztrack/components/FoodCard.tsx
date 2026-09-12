import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import MciIcon from "@/components/MciIcon";
import { useColors } from "@/hooks/useColors";
import { FoodItem } from "@/constants/foods";
import { itemName, type CatalogItem } from "@/constants/catalog";
import type { Portion } from "@/constants/types";

interface FoodCardProps {
  item: FoodItem;
  /**
   * The tag catalog, for turning the ids on `item.tags` into chips. Passed in
   * rather than read from context so this stays a presentational component —
   * its one consumer already holds both lists.
   */
  tagCatalog: CatalogItem[];
  /** The category catalog. `item.category` is an id, not a label. */
  categoryCatalog: CatalogItem[];
  /** Toggles this food in the pending selection; Save writes the log. */
  onSelect: (item: FoodItem) => void;
  onEdit: (item: FoodItem) => void;
  /** Queued for the next Save — shown by the filled action button. */
  isSelected?: boolean;
  /** Already on the log within the last few hours — shown by the border. */
  isRecentlyLogged?: boolean;
  /** How much, once this food is selected. Undefined means not said. */
  portion?: Portion;
  /** Only rendered while selected — there is nothing to size until then. */
  onPortion?: (portion: Portion | undefined) => void;
}

export default function FoodCard({
  item, tagCatalog, categoryCatalog, onSelect, onEdit,
  isSelected = false, isRecentlyLogged = false,
  portion, onPortion,
}: FoodCardProps) {
  const colors = useColors();

  // Read off the food's own map rather than by walking the catalog, so a tag
  // the user has since archived or deleted still shows on the foods that carry
  // it. `=== 1` and not truthiness: a stored 0 is "explicitly not this tag".
  // itemName falls back to the id, which beats the chip vanishing.
  const activeTags = Object.keys(item.tags)
    .filter(id => item.tags[id] === 1)
    .map(id => ({
      id,
      name: itemName(tagCatalog, id),
      icon: tagCatalog.find(t => t.id === id)?.icon,
    }));

  // Two independent cues that have to be readable together: the action button
  // fills to say "queued for Save", the border says "you logged this a couple
  // of hours ago". The recent border wins over the unsafe-food one, which
  // still has its own Warning badge to carry it.
  const borderColor = isRecentlyLogged
    ? colors.accent
    : item.is_elimination_safe ? colors.border : colors.destructive + "44";
  const borderWidth = isRecentlyLogged ? 2 : item.is_elimination_safe ? 1 : 1.5;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor, borderWidth },
      ]}
    >
      <View style={styles.content}>
        <View style={styles.nameRow}>
          <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
            {item.name}
          </Text>
          {!item.is_elimination_safe && (
            <View style={[styles.warningBadge, { backgroundColor: colors.destructive + "22", borderColor: colors.destructive + "55" }]}>
              <MciIcon name="alert-circle" size={12} color={colors.destructive} />
              <Text style={[styles.badgeText, { color: colors.destructive }]}>Warning</Text>
            </View>
          )}
          {item.is_elimination_safe && (
            <View style={[styles.safeBadge, { backgroundColor: colors.success + "22", borderColor: colors.success + "55" }]}>
              <MciIcon name="check-circle" size={12} color={colors.success} />
              <Text style={[styles.badgeText, { color: colors.success }]}>Safe</Text>
            </View>
          )}
        </View>
        <Text style={[styles.category, { color: colors.mutedForeground }]}>{itemName(categoryCatalog, item.category)}</Text>
        {/* Only once selected: there is nothing to size until the food is going
            on the log, and showing three buttons on every row would bury the
            list. No option is preselected — a default would be confidently
            wrong on most rows, and tapping the chosen one again clears it. */}
        {isSelected && onPortion && (
          <View style={styles.portions}>
            {PORTIONS.map(p => {
              const active = portion === p;
              return (
                <TouchableOpacity
                  key={p}
                  style={[styles.portionBtn, {
                    borderColor: active ? colors.primary : colors.border,
                    backgroundColor: active ? colors.primary + "22" : "transparent",
                  }]}
                  onPress={() => onPortion(active ? undefined : p)}
                  hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                >
                  <Text style={[styles.portionText, {
                    color: active ? colors.primary : colors.mutedForeground,
                  }]}>
                    {PORTION_LABELS[p]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
        {activeTags.length > 0 && (
          <View style={styles.tags}>
            {activeTags.map(tag => (
              <View key={tag.id} style={[styles.tag, { backgroundColor: colors.muted }]}>
                {/* Optional: a user-made tag need not have picked an icon, and
                    MciIcon renders nothing for a name it does not know. */}
                {tag.icon && (
                  <MciIcon name={tag.icon as any} size={11} color={colors.mutedForeground} />
                )}
                <Text style={[styles.tagText, { color: colors.mutedForeground }]}>{tag.name}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.editBtn, { backgroundColor: colors.surface }]}
          onPress={() => onEdit(item)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          activeOpacity={0.7}
        >
          <MciIcon name="pencil" size={16} color={colors.mutedForeground} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.logBtn,
            { backgroundColor: isSelected ? colors.success + "22" : colors.primary },
          ]}
          onPress={() => onSelect(item)}
          activeOpacity={0.75}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {isSelected ? (
            <MciIcon name="check" size={20} color={colors.success} />
          ) : (
            <MciIcon name="plus" size={20} color={colors.primaryForeground} />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const PORTIONS: Portion[] = ["small", "medium", "large"];
const PORTION_LABELS: Record<Portion, string> = { small: "S", medium: "M", large: "L" };

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 14,
    marginBottom: 10,
    gap: 10,
  },
  portions: { flexDirection: "row", gap: 6, marginTop: 6 },
  portionBtn: {
    paddingHorizontal: 10, paddingVertical: 3,
    borderRadius: 8, borderWidth: 1, minWidth: 30, alignItems: "center",
  },
  portionText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  content: {
    flex: 1,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 2,
    flexWrap: "wrap",
  },
  name: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  warningBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 20,
    borderWidth: 1,
  },
  safeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 20,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
  },
  category: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginBottom: 6,
  },
  tags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
  },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 20,
  },
  tagText: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
  },
  actions: {
    flexDirection: "column",
    gap: 6,
    alignItems: "center",
  },
  editBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  logBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
});
