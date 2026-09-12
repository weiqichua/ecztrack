import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import MciIcon from "@/components/MciIcon";
import { PATHS } from "@/components/mciPaths";
import { useColors } from "@/hooks/useColors";

/**
 * The icons a food tag may carry, curated rather than the full Material set.
 *
 * `MciIcon` renders null for a name with no registered path, so an unlisted
 * icon is an invisible cell rather than a visible error — which is why the
 * offered list is filtered through `PATHS` instead of trusted. A typo here
 * drops the icon from the grid; it can never reach an item.
 *
 * The first thirteen are the ones the seeded tags already use, so a user who
 * renames or rebuilds a seeded tag can put its icon back.
 */
export const FOOD_TAG_ICONS: string[] = [
  "coffee", "cow", "leaf", "barley", "cube-outline", "tree", "grain",
  "egg", "fire", "shaker-outline", "water", "chili-hot", "flask-outline",
  "food-apple", "fruit-citrus", "fruit-grapes", "carrot", "mushroom", "corn",
  "peanut", "fish", "food-drumstick", "food-steak", "bread-slice", "cheese",
  "rice", "noodles", "ice-cream", "cupcake", "glass-wine",
].filter(name => PATHS[name]);

interface Props {
  /** The currently chosen icon, or undefined for a text-only tag. */
  value?: string;
  onChange: (icon: string | undefined) => void;
}

/**
 * A grid of tag icons where the selected one toggles off.
 *
 * An icon is optional — a tag without one is a text-only chip, not a broken
 * one — so clearing has to be reachable. Tapping the selection again is the
 * whole affordance; a separate "None" cell would be a second way to say the
 * same thing.
 */
export default function IconPicker({ value, onChange }: Props) {
  const colors = useColors();

  return (
    <View style={styles.wrap}>
      <Text style={[styles.hint, { color: colors.mutedForeground }]}>
        Optional icon — tap the chosen one again to clear it.
      </Text>
      <View style={styles.grid}>
        {FOOD_TAG_ICONS.map(name => {
          const selected = value === name;
          return (
            <TouchableOpacity
              key={name}
              style={[
                styles.cell,
                {
                  backgroundColor: selected ? colors.primary + "22" : colors.card,
                  borderColor: selected ? colors.primary : colors.border,
                },
              ]}
              onPress={() => onChange(selected ? undefined : name)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={name}
              accessibilityState={{ selected }}
            >
              <MciIcon
                name={name}
                size={22}
                color={selected ? colors.primary : colors.mutedForeground}
              />
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  hint: { fontSize: 12, fontFamily: "Inter_400Regular" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cell: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
