import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import MciIcon from "@/components/MciIcon";
import { useColors } from "@/hooks/useColors";
import { useAppContext } from "@/context/AppContext";
import { Phase, formatShortDate } from "@/constants/types";
import { phaseStatus } from "@/lib/phaseLabels";

const ELIMINATION_COLOR = "#81D4FA";

const PHASE_META: Record<Phase, { label: string; icon: string; color: string }> = {
  // `"none"` is a phase with a name, not a missing value — rule 2 of the ledger.
  none:        { label: "No Phase",           icon: "checkbox-blank-circle-outline", color: "#78909C" },
  elimination: { label: "Elimination Phase",  icon: "shield-remove", color: ELIMINATION_COLOR },
  challenge:   { label: "Challenge Phase",    icon: "flask",         color: "#FFB300" },
};

interface Props {
  onEdit: () => void;
  onChangePhase: () => void;
}

/**
 * Today's phase, in the three states the ledger actually has.
 *
 * The card used to have one: it read the elimination's start date and printed
 * "Since <it>" whenever a day number was unavailable, so an elimination
 * scheduled for next week rendered as "No Phase / Since <a date in the future>".
 * Scheduled and running are now distinct, and neither borrows the other's words.
 */
export default function PhaseStatusCard({ onEdit, onChangePhase }: Props) {
  const colors = useColors();
  const { ledger, todayDateKey } = useAppContext();

  // Counted in whole local days off the ledger: the start date is Day 1, and the
  // counter ticks at local midnight rather than at the elapsed 24-hour mark.
  const status = phaseStatus(ledger, todayDateKey);

  // The headline reads off `status`, the same value the rest of the card reads,
  // rather than off the context's `activePhase`. The two cannot disagree today —
  // `activePhase` is the same `spanOnDate` call — but one fact derived twice is
  // how the calendar and the week strip once ended up contradicting each other
  // about a single day. A scheduled elimination owns no day yet, so today is
  // still "No Phase" and the sub-line below is what names the schedule.
  const phase: Phase = status.kind === "running" ? status.phase : "none";
  const meta = PHASE_META[phase];

  // The span that owns today keeps its card for the whole of the day it was
  // ended on — the calendar still paints today in its colour, so the card
  // reading "Nothing running" beside it would be a straight contradiction.
  // Only the action goes: `canEnd` is false once `endedOn` is set. A schedule
  // has nothing to end yet but can still be cancelled, which is the other thing
  // the pencil opens.
  const canEdit = status.kind === "scheduled" || (status.kind === "running" && status.canEnd);

  // Only an elimination has a planned length, so only it has a bar to fill and
  // a last day to name. A challenge runs until it is ended.
  const plan = status.kind === "running" && status.phase === "elimination" ? status : null;

  const styles = makeStyles(colors);

  return (
    <View style={[styles.card, { borderColor: meta.color + "44", backgroundColor: meta.color + "0D" }]}>
      <View style={styles.topRow}>
        <View style={styles.phaseLeft}>
          <View style={[styles.iconCircle, { backgroundColor: meta.color + "22" }]}>
            <MciIcon name={meta.icon as any} size={22} color={meta.color} />
          </View>
          <View>
            <Text style={[styles.phaseType, { color: meta.color }]}>{meta.label}</Text>
            {status.kind === "running" ? (
              <Text style={[styles.phaseSub, { color: colors.mutedForeground }]}>
                {status.label}
              </Text>
            ) : status.kind === "scheduled" ? (
              // Today is still blank; the elimination is only coming. Naming it
              // here is what keeps "No Phase" from reading as a bug.
              <Text style={[styles.phaseSub, { color: ELIMINATION_COLOR }]}>
                Elimination · {status.label}
              </Text>
            ) : phase === "none" ? (
              <Text style={[styles.phaseSub, { color: colors.mutedForeground }]}>
                Nothing running
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.actions}>
          {canEdit && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: colors.surface }]}
              onPress={onEdit}
              hitSlop={10}
            >
              <MciIcon name="pencil" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.surface }]}
            onPress={onChangePhase}
            hitSlop={10}
          >
            <MciIcon name="swap-horizontal" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </View>

      {plan && (
        <View style={styles.progressSection}>
          <View style={[styles.progressBg, { backgroundColor: colors.border }]}>
            <View
              style={[
                styles.progressFill,
                {
                  backgroundColor: meta.color,
                  width: `${Math.round(plan.progress * 100)}%` as any,
                },
              ]}
            />
          </View>
          <Text style={[styles.progressLabel, { color: colors.mutedForeground }]}>
            {Math.round(plan.progress * 100)}% complete
          </Text>
        </View>
      )}

      {status.kind !== "none" && (
        <View style={[styles.dateRow, { borderTopColor: meta.color + "22" }]}>
          <View style={styles.dateItem}>
            <Text style={[styles.dateLabel, { color: colors.mutedForeground }]}>
              {status.kind === "scheduled" ? "Starts" : "Started"}
            </Text>
            <Text style={[styles.dateValue, { color: colors.foreground }]}>{formatShortDate(status.startDate)}</Text>
          </View>
          {plan && (
            <>
              <View style={[styles.dateDivider, { backgroundColor: meta.color + "33" }]} />
              <View style={styles.dateItem}>
                <Text style={[styles.dateLabel, { color: colors.mutedForeground }]}>Last day</Text>
                <Text style={[styles.dateValue, { color: colors.foreground }]}>{formatShortDate(plan.lastDay)}</Text>
              </View>
            </>
          )}
        </View>
      )}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof import("@/hooks/useColors").useColors>) {
  return StyleSheet.create({
    card: {
      borderRadius: 18,
      borderWidth: 1.5,
      padding: 16,
      marginBottom: 22,
    },
    topRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    phaseLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      flex: 1,
    },
    iconCircle: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
    },
    phaseType: {
      fontSize: 16,
      fontFamily: "Inter_700Bold",
    },
    phaseSub: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      marginTop: 2,
    },
    actions: {
      flexDirection: "row",
      gap: 8,
    },
    actionBtn: {
      width: 34,
      height: 34,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
    },
    progressSection: {
      marginTop: 14,
      gap: 6,
    },
    progressBg: {
      height: 8,
      borderRadius: 4,
      overflow: "hidden",
    },
    progressFill: {
      height: "100%",
      borderRadius: 4,
    },
    progressLabel: {
      fontSize: 11,
      fontFamily: "Inter_400Regular",
      textAlign: "right",
    },
    dateRow: {
      flexDirection: "row",
      marginTop: 14,
      paddingTop: 14,
      borderTopWidth: 1,
    },
    dateItem: {
      flex: 1,
      alignItems: "center",
      gap: 2,
    },
    dateLabel: {
      fontSize: 11,
      fontFamily: "Inter_400Regular",
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    dateValue: {
      fontSize: 13,
      fontFamily: "Inter_600SemiBold",
    },
    dateDivider: {
      width: 1,
      alignSelf: "stretch",
      marginHorizontal: 8,
    },
  });
}
