import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import MciIcon from "@/components/MciIcon";
import { useColors } from "@/hooks/useColors";
import { ScratchLog, SUCCESS_LABELS } from "@/constants/types";
import { itemName } from "@/constants/catalog";
import { useAppContext } from "@/context/AppContext";

interface ScratchLogCardProps {
  log: ScratchLog;
  /**
   * Opens the edit sheet. Passed wherever delete is: an entry the user can
   * only destroy and not correct is the wrong pair of choices to offer, and
   * the home page's own list already offers the edit.
   */
  onEdit?: (log: ScratchLog) => void;
  onDelete?: (id: string) => void;
}

const SUCCESS_COLORS: Record<number, string> = {
  1: "#EF5350",
  2: "#FFB300",
  3: "#29B6F6",
  4: "#66BB6A",
};

export default function ScratchLogCard({ log, onEdit, onDelete }: ScratchLogCardProps) {
  const colors = useColors();
  const { bodyLocations, cues, routines } = useAppContext();
  const cueName = itemName(cues, log.cue);
  const routineName = itemName(routines, log.routine_id);
  const successColor = SUCCESS_COLORS[log.success] ?? colors.primary;
  const timestamp = new Date(log.timestamp);
  const timeStr = timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateStr = timestamp.toLocaleDateString([], { month: "short", day: "numeric" });

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.successBar, { backgroundColor: successColor }]} />
      <View style={styles.content}>
        <View style={styles.topRow}>
          <View style={styles.locationBadge}>
            <MciIcon name="map-marker" size={13} color={colors.primary} />
            <Text style={[styles.locationText, { color: colors.foreground }]}>{itemName(bodyLocations, log.location)}</Text>
          </View>
          <View style={styles.timeRow}>
            <Text style={[styles.time, { color: colors.mutedForeground }]}>{dateStr} {timeStr}</Text>
            {onEdit && (
              <TouchableOpacity
                style={[styles.iconBtn, { backgroundColor: colors.muted }]}
                onPress={() => onEdit(log)}
                activeOpacity={0.7}
                hitSlop={{ top: 7, bottom: 7, left: 7, right: 7 }}
              >
                <MciIcon name="pencil-outline" size={15} color={colors.mutedForeground} />
              </TouchableOpacity>
            )}
            {onDelete && (
              <TouchableOpacity
                style={[styles.iconBtn, { backgroundColor: colors.destructive + "1A" }]}
                onPress={() => onDelete(log.id)}
                activeOpacity={0.7}
                hitSlop={{ top: 7, bottom: 7, left: 7, right: 7 }}
              >
                <MciIcon name="trash-can-outline" size={15} color={colors.destructive} />
              </TouchableOpacity>
            )}
          </View>
        </View>
        <View style={styles.midRow}>
          <View style={[styles.successBadge, { backgroundColor: successColor + "22", borderColor: successColor + "55" }]}>
            <Text style={[styles.successText, { color: successColor }]}>
              {SUCCESS_LABELS[log.success]}
            </Text>
          </View>
          {routineName !== "" && (
            <View style={[styles.routineBadge, { backgroundColor: colors.muted }]}>
              <MciIcon name="refresh" size={12} color={colors.mutedForeground} />
              <Text style={[styles.routineText, { color: colors.mutedForeground }]}>{routineName}</Text>
            </View>
          )}
        </View>
        {cueName !== "" && (
          <Text style={[styles.cue, { color: colors.mutedForeground }]}>Trigger: {cueName}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
    overflow: "hidden",
  },
  successBar: {
    width: 4,
  },
  content: {
    flex: 1,
    padding: 12,
    gap: 6,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  locationBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flex: 1,
  },
  locationText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  time: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  iconBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  midRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  successBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
  },
  successText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  routineBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  routineText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  cue: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    fontStyle: "italic",
  },
});
