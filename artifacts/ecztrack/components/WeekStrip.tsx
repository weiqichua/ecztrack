import React, { useState, useEffect, useMemo, useRef } from "react";
import { todayKey, localDateKey } from "@/lib/dates";
import { View, Text, TouchableOpacity, StyleSheet, PanResponder } from "react-native";
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
  }

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        return Math.abs(gestureState.dx) > Math.abs(gestureState.dy) && Math.abs(gestureState.dx) > 10;
      },
      onPanResponderRelease: (evt, gestureState) => {
        if (gestureState.dx > 50) {
          stepWeek(-1); // Swipe right -> previous week
        } else if (gestureState.dx < -50) {
          stepWeek(1); // Swipe left -> next week
        }
      },
    })
  ).current;

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => stepWeek(-1)} style={styles.arrowButton} hitSlop={12}>
        <MciIcon name="chevron-left" size={24} color={colors.primary} />
      </TouchableOpacity>

      <View style={styles.gridContainer} {...panResponder.panHandlers}>
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
                <View style={styles.dotRow}>
                  {dots.map(d => (
                    <View key={d.kind} style={[styles.dot, d.color ? { backgroundColor: d.color } : null]} />
                  ))}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <TouchableOpacity onPress={() => stepWeek(1)} style={styles.arrowButton} hitSlop={12}>
        <MciIcon name="chevron-right" size={24} color={colors.primary} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
  },
  arrowButton: {
    paddingHorizontal: 4,
  },
  gridContainer: {
    flex: 1,
  },
  grid: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  cell: {
    alignItems: "center",
    width: 36,
  },
  letterLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 6,
  },
  circle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    overflow: 'hidden',
    alignItems: "center",
    justifyContent: "center",
  },
  circleFuture: {
    opacity: 0.25,
  },
  dayNum: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  dotRow: {
    flexDirection: "row",
    gap: 3,
    marginTop: 3,
    height: 5,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "transparent",
  },
});
