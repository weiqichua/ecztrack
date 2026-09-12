import React, { useRef, useEffect, useMemo } from "react";
import { todayKey, localDateKey } from "@/lib/dates";
import { View, Text, TouchableOpacity, FlatList, StyleSheet } from "react-native";
import { useColors } from "@/hooks/useColors";

const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

interface Props {
  selectedDate: string;
  onSelect: (date: string) => void;
  days?: number;
  /**
   * Days after today to offer as well. Zero for the log pickers, which can only
   * ever backdate; an elimination can be scheduled to start on a future day.
   */
  futureDays?: number;
}

export default function DateScroller({ selectedDate, onSelect, days = 30, futureDays = 0 }: Props) {
  const colors = useColors();
  const listRef = useRef<FlatList>(null);

  const today = todayKey();

  const dates = useMemo(() => {
    const result: string[] = [];
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    for (let i = days - 1; i >= -futureDays; i--) {
      const d = new Date(base);
      d.setDate(d.getDate() - i);
      result.push(localDateKey(d));
    }
    return result;
    // `today` is not read in the body — `new Date()` already reads the clock —
    // but it has to be a dependency anyway. This sheet never unmounts (Expo
    // Router keeps the home screen alive for the app's lifetime), so without a
    // dependency that changes at midnight this memo would keep yesterday's
    // window forever, no matter how long the app stays open.
  }, [days, futureDays, today]);

  const todayIndex = dates.indexOf(today);
  const selectedIndex = dates.indexOf(selectedDate);

  useEffect(() => {
    const scrollTo = selectedIndex >= 0 ? selectedIndex : todayIndex;
    if (scrollTo >= 0 && listRef.current) {
      setTimeout(() => {
        listRef.current?.scrollToIndex({ index: scrollTo, animated: true, viewPosition: 0.5 });
      }, 150);
    }
  }, [selectedDate]);

  function getDateInfo(dateStr: string) {
    const d = new Date(dateStr + "T12:00:00");
    return {
      dayOfWeek: DAY_LABELS[d.getDay()],
      dayNum: d.getDate(),
      month: MONTH_SHORT[d.getMonth()],
      isToday: dateStr === today,
      isSelected: dateStr === selectedDate,
    };
  }

  return (
    <FlatList
      ref={listRef}
      data={dates}
      horizontal
      keyExtractor={d => d}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.list}
      onScrollToIndexFailed={() => {}}
      renderItem={({ item: dateStr }) => {
        const { dayOfWeek, dayNum, month, isToday, isSelected } = getDateInfo(dateStr);
        return (
          <TouchableOpacity
            style={[
              styles.dayBtn,
              isSelected && { backgroundColor: colors.primary + "22", borderColor: colors.primary },
              !isSelected && { borderColor: "transparent" },
            ]}
            onPress={() => onSelect(dateStr)}
            activeOpacity={0.7}
          >
            <Text style={[
              styles.dowLabel,
              { color: isSelected ? colors.primary : colors.mutedForeground },
            ]}>
              {dayOfWeek}
            </Text>
            <View style={[
              styles.dayCircle,
              isToday && !isSelected && { borderWidth: 1.5, borderColor: colors.primary },
              isSelected && { backgroundColor: colors.primary },
            ]}>
              <Text style={[
                styles.dayNum,
                { color: isSelected ? colors.primaryForeground : isToday ? colors.primary : colors.foreground },
              ]}>
                {dayNum}
              </Text>
            </View>
            {isToday && (
              <Text style={[styles.todayLabel, { color: isSelected ? colors.primary : colors.mutedForeground }]}>
                Today
              </Text>
            )}
            {!isToday && (
              <Text style={[styles.monthLabel, { color: colors.mutedForeground }]}>
                {month}
              </Text>
            )}
          </TouchableOpacity>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    gap: 4,
  },
  dayBtn: {
    alignItems: "center",
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1.5,
    minWidth: 48,
    gap: 3,
  },
  dowLabel: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  dayCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  dayNum: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
  },
  todayLabel: {
    fontSize: 9,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  monthLabel: {
    fontSize: 9,
    fontFamily: "Inter_400Regular",
  },
});
