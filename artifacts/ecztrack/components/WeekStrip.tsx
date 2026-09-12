import React, { useState, useEffect, useMemo } from "react";
import { todayKey, localDateKey } from "@/lib/dates";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import MciIcon from "@/components/MciIcon";
import { useColors } from "@/hooks/useColors";
import { useAppContext } from "@/context/AppContext";
import { phaseOfRecord } from "@/lib/phases";
import { dayStyle, hasCheckinOn, loggedPhases } from "@/lib/dayStyle";
import { ON_ACCENT } from "@/constants/colors";

const WEEK_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

interface Props {
  selectedDate: string;
  onSelect: (date: string) => void;
}

function getMondayOf(dateStr: string): Date {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function WeekStrip({ selectedDate, onSelect }: Props) {
  const colors = useColors();
  // Read every render, not captured once: Expo Router mounts a tab and never
  // unmounts it, so a strip mounted yesterday must still know what today is.
  const today = todayKey();

  const { symptomLogs, consumptionLogs, scratchLogs, ledger } = useAppContext();

  const [weekMonday, setWeekMonday] = useState<Date>(() => getMondayOf(selectedDate));

  useEffect(() => {
    setWeekMonday(getMondayOf(selectedDate));
  }, [selectedDate]);

  const weekDates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekMonday);
    d.setDate(d.getDate() + i);
    weekDates.push(localDateKey(d));
  }

  const foodDateSet = useMemo(() => {
    const s = new Set<string>();
    consumptionLogs.forEach(l => s.add(localDateKey(l.timestamp)));
    return s;
  }, [consumptionLogs]);

  const urgeDateSet = useMemo(() => {
    const s = new Set<string>();
    scratchLogs.forEach(l => s.add(localDateKey(l.timestamp)));
    return s;
  }, [scratchLogs]);

  // Same rule the month grid uses: the ledger decides a day's phase, and a
  // log's stored copy is only a fallback for a day the ledger does not cover.
  function styleFor(dateStr: string) {
    return dayStyle({
      dateKey: dateStr,
      todayKey: today,
      phase: phaseOfRecord(ledger, dateStr, today, loggedPhases(dateStr, symptomLogs, consumptionLogs)),
      hasFood: foodDateSet.has(dateStr),
      hasUrge: urgeDateSet.has(dateStr),
      hasCheckin: hasCheckinOn(symptomLogs, dateStr),
    }, colors.primary);
  }

  function stepWeek(dir: -1 | 1) {
    const next = new Date(weekMonday);
    next.setDate(next.getDate() + dir * 7);
    setWeekMonday(next);
    const offset = weekDates.indexOf(selectedDate);
    const targetDate = new Date(next);
    targetDate.setDate(targetDate.getDate() + (offset >= 0 ? offset : 0));
    onSelect(localDateKey(targetDate));
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => stepWeek(-1)} style={styles.chevron} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <MciIcon name="chevron-left" size={22} color={colors.mutedForeground} />
      </TouchableOpacity>

      <View style={styles.grid}>
        {weekDates.map((dateStr, i) => {
          const isSelected = dateStr === selectedDate;
          const dayNum = new Date(dateStr + "T12:00:00").getDate();
          const { fill, isToday, isFuture, dots } = styleFor(dateStr);

          return (
            <TouchableOpacity
              key={dateStr}
              style={styles.cell}
              onPress={() => !isFuture && onSelect(dateStr)}
              disabled={isFuture}
              activeOpacity={isFuture ? 1 : 0.7}
            >
              <Text style={[styles.letterLabel, {
                color: isSelected ? colors.primary : colors.mutedForeground,
              }]}>
                {WEEK_LETTERS[i]}
              </Text>
              <View style={[
                styles.circle,
                fill ? { backgroundColor: fill } : null,
                isFuture && styles.circleFuture,
                // Today and the selected day both get a ring, but not the same
                // one: with a single colour for both, selecting any other day
                // left two identical rings on screen and no way to tell which
                // was which. Today is the quiet landmark, selection is the
                // emphatic one, and selection is listed last so it wins
                // outright on the day that is both.
                isToday && { borderWidth: 2, borderColor: colors.mutedForeground },
                isSelected && { borderWidth: 2, borderColor: colors.primary },
              ]}>
                <Text style={[
                  styles.dayNum,
                  { color: isFuture ? colors.mutedForeground : fill ? ON_ACCENT : colors.foreground },
                ]}>
                  {dayNum}
                </Text>
              </View>
              {/* Smaller and tighter than the month grid's: three 5px dots with
                  3px gaps sit under a 40px cell comfortably and under a 32px
                  one they crowd the edges. The row keeps its height whether or
                  not anything is in it, so the strip does not jump. */}
              <View style={styles.dotRow}>
                {dots.map(d => (
                  <View key={d.kind} style={[styles.dot, d.color ? { backgroundColor: d.color } : null]} />
                ))}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      <TouchableOpacity onPress={() => stepWeek(1)} style={styles.chevron} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <MciIcon name="chevron-right" size={22} color={colors.mutedForeground} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  chevron: {
    padding: 4,
  },
  grid: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-around",
  },
  cell: {
    alignItems: "center",
    gap: 3,
    flex: 1,
  },
  letterLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  circle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  circleFuture: { opacity: 0.25 },
  dayNum: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  dotRow: { flexDirection: "row", gap: 2.5, height: 4 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: "transparent" },
});
