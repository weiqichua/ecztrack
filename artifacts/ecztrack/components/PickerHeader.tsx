import React from "react";
import {
  View, Text, TouchableOpacity, StyleSheet,
  type StyleProp, type ViewStyle, type TextStyle,
} from "react-native";
import MciIcon from "@/components/MciIcon";
import { useColors } from "@/hooks/useColors";

type Colors = ReturnType<typeof useColors>;

interface Props {
  label: string;
  colors: Colors;
  onManage: () => void;
  /** Spacing override; the two urge forms sit in differently spaced sheets. */
  style?: StyleProp<ViewStyle>;
  /** Label typography override, for the same reason. */
  labelStyle?: StyleProp<TextStyle>;
}

/**
 * A picker's label plus the inline "+ Add" that opens the catalog manager.
 *
 * Shared by the create form on the Habits screen and the urge edit sheet,
 * which had a verbatim copy each. Only the two forms' spacing and label
 * typography differ, so those come in as overrides rather than being unified —
 * this change is not a restyle of either sheet.
 *
 * The forms themselves stay separate on purpose: the create form clears a
 * selection whose catalog item was archived, while the edit form preserves it
 * behind a retired chip so Save cannot rewrite history. One body holding both
 * rules behind an inverted flag is how history gets rewritten by accident.
 *
 * Declared as a module-level component, not inside a render body: a component
 * defined during render is a new type on every pass, so React unmounts and
 * remounts the subtree, losing any state it had.
 */
export default function PickerHeader({ label, colors, onManage, style, labelStyle }: Props) {
  return (
    <View style={[styles.pickerHeader, style]}>
      <Text style={[styles.label, { color: colors.mutedForeground }, labelStyle]}>
        {label}
      </Text>
      <TouchableOpacity
        style={styles.inlineAddBtn}
        onPress={onManage}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <MciIcon name="plus" size={14} color={colors.primary} />
        <Text style={[styles.inlineAddText, { color: colors.primary }]}>Add</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  pickerHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginTop: 8, marginBottom: 6,
  },
  label: {
    fontSize: 12, fontFamily: "Inter_500Medium",
    letterSpacing: 0.8, textTransform: "uppercase",
  },
  inlineAddBtn: { flexDirection: "row", alignItems: "center", gap: 3, paddingVertical: 2 },
  inlineAddText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
