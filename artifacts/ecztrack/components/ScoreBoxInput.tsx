import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useColors } from "@/hooks/useColors";
import { scoreLevel } from "@/lib/scoreScale";

interface ScoreBoxInputProps {
  label: string;
  /** null = not recorded. No box is selected. */
  value: number | null;
  onChange: (value: number | null) => void;
}

const VALUES = [1, 2, 3, 4, 5];

/** 1 is best and 5 is worst — see lib/scoreScale.ts, which owns that reading. */
const LEVEL_COLORS = { good: "#66BB6A", warn: "#FFB300", bad: "#EF5350" } as const;

function boxColor(value: number): string {
  return LEVEL_COLORS[scoreLevel(value)];
}

export default function ScoreBoxInput({ label, value, onChange }: ScoreBoxInputProps) {
  const colors = useColors();

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
      <View style={styles.boxRow}>
        {VALUES.map(n => {
          const selected = value === n;
          const color = boxColor(n);
          return (
            <TouchableOpacity
              key={n}
              style={[
                styles.box,
                {
                  borderColor: selected ? color : colors.border,
                  backgroundColor: selected ? color + "22" : "transparent",
                },
              ]}
              // Tapping the already-selected box clears it back to null
              // rather than re-selecting the same value — there is no
              // "select 3 again" gesture, only "3 is set" and "3 is not set."
              onPress={() => onChange(selected ? null : n)}
            >
              <Text style={[styles.boxText, { color: selected ? color : colors.mutedForeground }]}>
                {n}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 16 },
  label: { fontSize: 15, fontFamily: "Inter_500Medium", marginBottom: 8 },
  boxRow: { flexDirection: "row", gap: 8 },
  box: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  boxText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
