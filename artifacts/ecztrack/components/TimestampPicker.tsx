import React, { useState, useEffect } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, Modal,
  ScrollView, TextInput, Platform,
} from "react-native";
import { todayKey, localDateKey } from "@/lib/dates";
import MciIcon from "@/components/MciIcon";
import { useColors } from "@/hooks/useColors";
import DateScroller from "@/components/DateScroller";

interface Props {
  value: string;
  onChange: (iso: string) => void;
  label?: string;
}

function twoDigit(n: number) {
  return String(n).padStart(2, "0");
}

function isoToLocal(iso: string): { dateStr: string; hour: number; minute: number } {
  const d = new Date(iso);
  return {
    dateStr: localDateKey(d),
    hour: d.getHours(),
    minute: d.getMinutes(),
  };
}

function buildIso(dateStr: string, hour: number, minute: number): string {
  const d = new Date(`${dateStr}T${twoDigit(hour)}:${twoDigit(minute)}:00`);
  return d.toISOString();
}

export default function TimestampPicker({ value, onChange, label = "Log time" }: Props) {
  const colors = useColors();
  const [open, setOpen] = useState(false);

  const todayStr = todayKey();
  const { dateStr, hour, minute } = isoToLocal(value);
  const isNow = Math.abs(Date.now() - new Date(value).getTime()) < 60_000;

  const [pickerDate, setPickerDate] = useState(dateStr);
  const [pickerHour, setPickerHour] = useState(hour);
  const [pickerMinute, setPickerMinute] = useState(minute);
  const [hourText, setHourText] = useState(twoDigit(hour));
  const [minuteText, setMinuteText] = useState(twoDigit(minute));

  function openPicker() {
    const { dateStr: d, hour: h, minute: m } = isoToLocal(value);
    setPickerDate(d);
    setPickerHour(h);
    setPickerMinute(m);
    setHourText(twoDigit(h));
    setMinuteText(twoDigit(m));
    setOpen(true);
  }

  function confirm() {
    onChange(buildIso(pickerDate, pickerHour, pickerMinute));
    setOpen(false);
  }

  function setNow() {
    onChange(new Date().toISOString());
    setOpen(false);
  }

  function adjustHour(delta: number) {
    const h = ((pickerHour + delta + 24) % 24);
    setPickerHour(h);
    setHourText(twoDigit(h));
  }

  function adjustMinute(delta: number) {
    let m = pickerMinute + delta;
    let h = pickerHour;
    if (m < 0) { m += 60; h = ((h - 1 + 24) % 24); }
    if (m >= 60) { m -= 60; h = (h + 1) % 24; }
    setPickerMinute(m);
    setPickerHour(h);
    setMinuteText(twoDigit(m));
    setHourText(twoDigit(h));
  }

  function displayLabel(): string {
    if (isNow) return "Now";
    const d = new Date(value);
    const datePart = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const timePart = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    return `${datePart} · ${timePart}`;
  }

  return (
    <>
      <View style={styles.row}>
        <MciIcon name="clock-outline" size={14} color={colors.mutedForeground} />
        <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
        <TouchableOpacity
          style={[styles.pill, { backgroundColor: isNow ? colors.primary + "22" : colors.warning + "22",
            borderColor: isNow ? colors.primary + "55" : colors.warning + "55" }]}
          onPress={openPicker}
          activeOpacity={0.7}
        >
          <Text style={[styles.pillText, { color: isNow ? colors.primary : colors.warning }]}>
            {displayLabel()}
          </Text>
          <MciIcon name="pencil" size={11} color={isNow ? colors.primary : colors.warning} />
        </TouchableOpacity>
      </View>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setOpen(false)} />
        <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Set log time</Text>
            <TouchableOpacity onPress={() => setOpen(false)}>
              <MciIcon name="close" size={22} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.nowBtn, { backgroundColor: colors.primary + "22", borderColor: colors.primary + "44" }]}
            onPress={setNow}
            activeOpacity={0.7}
          >
            <MciIcon name="clock-fast" size={16} color={colors.primary} />
            <Text style={[styles.nowBtnText, { color: colors.primary }]}>Use current time</Text>
          </TouchableOpacity>

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Date</Text>
          <DateScroller selectedDate={pickerDate} onSelect={setPickerDate} days={14} />

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 16 }]}>Time</Text>
          <View style={styles.timeRow}>
            {/* Hour */}
            <View style={styles.timeCol}>
              <TouchableOpacity style={styles.stepBtn} onPress={() => adjustHour(1)}>
                <MciIcon name="chevron-up" size={22} color={colors.primary} />
              </TouchableOpacity>
              <TextInput
                style={[styles.timeInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
                value={hourText}
                keyboardType="number-pad"
                maxLength={2}
                onChangeText={t => {
                  setHourText(t);
                  const n = parseInt(t, 10);
                  if (!isNaN(n) && n >= 0 && n <= 23) setPickerHour(n);
                }}
                onBlur={() => setHourText(twoDigit(pickerHour))}
              />
              <TouchableOpacity style={styles.stepBtn} onPress={() => adjustHour(-1)}>
                <MciIcon name="chevron-down" size={22} color={colors.primary} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.timeSep, { color: colors.foreground }]}>:</Text>
            {/* Minute */}
            <View style={styles.timeCol}>
              <TouchableOpacity style={styles.stepBtn} onPress={() => adjustMinute(5)}>
                <MciIcon name="chevron-up" size={22} color={colors.primary} />
              </TouchableOpacity>
              <TextInput
                style={[styles.timeInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
                value={minuteText}
                keyboardType="number-pad"
                maxLength={2}
                onChangeText={t => {
                  setMinuteText(t);
                  const n = parseInt(t, 10);
                  if (!isNaN(n) && n >= 0 && n <= 59) setPickerMinute(n);
                }}
                onBlur={() => setMinuteText(twoDigit(pickerMinute))}
              />
              <TouchableOpacity style={styles.stepBtn} onPress={() => adjustMinute(-5)}>
                <MciIcon name="chevron-down" size={22} color={colors.primary} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.timeHint, { color: colors.mutedForeground }]}>
              {pickerHour < 12 ? "AM" : "PM"}
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.confirmBtn, { backgroundColor: colors.primary }]}
            onPress={confirm}
            activeOpacity={0.8}
          >
            <Text style={[styles.confirmText, { color: colors.primaryForeground }]}>Confirm</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 14 },
  label: { fontSize: 12, fontFamily: "Inter_500Medium" },
  pill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1, marginLeft: 4,
  },
  pillText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: {
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: Platform.OS === "web" ? 40 : 60,
  },
  sheetHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: "#444", alignSelf: "center", marginBottom: 16,
  },
  sheetHeader: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", marginBottom: 16,
  },
  sheetTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  nowBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 20,
  },
  nowBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  sectionLabel: {
    fontSize: 11, fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase", letterSpacing: 0.8,
    marginBottom: 8, marginHorizontal: 4,
  },
  timeRow: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: 12, marginBottom: 24,
  },
  timeCol: { alignItems: "center", gap: 4 },
  stepBtn: { padding: 4 },
  timeInput: {
    width: 64, height: 52, textAlign: "center",
    fontSize: 28, fontFamily: "Inter_700Bold",
    borderWidth: 1, borderRadius: 12,
  },
  timeSep: { fontSize: 28, fontFamily: "Inter_700Bold", marginBottom: 4 },
  timeHint: { fontSize: 14, fontFamily: "Inter_500Medium", marginBottom: 4 },
  confirmBtn: {
    paddingVertical: 16, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
  },
  confirmText: { fontSize: 15, fontFamily: "Inter_700Bold" },
});
