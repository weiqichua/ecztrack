import React, { useRef } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  Modal, ScrollView, Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MciIcon from "@/components/MciIcon";
import { useColors } from "@/hooks/useColors";
import { useAppContext } from "@/context/AppContext";
import { phaseStatus } from "@/lib/phaseLabels";
import { confirmDestructive } from "@/lib/dialogs";

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Ending whichever phase is running — the only way out of one.
 *
 * The end-date nudger this sheet used to open with is gone with the computed
 * phase model: the ledger has already written down every day the phase has
 * owned so far, and moving its end date would silently rewrite them. Extending
 * or shortening a run is a new phase, not an edit to this one.
 *
 * A challenge ends the same way an elimination does, so this sheet reads the
 * open span's kind rather than assuming elimination — the wrong mutator here
 * would end a phase the user is not looking at.
 */
export default function PhaseEditModal({ visible, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { ledger, todayDateKey, endEliminationEarly, endChallenge } = useAppContext();

  const status = phaseStatus(ledger, todayDateKey);

  // A schedule that has not started owns no day, so `endEliminationEarly` drops
  // the record outright rather than stamping an end on it. Same button, but the
  // copy must not promise an outcome that will never happen. Only an
  // elimination can be scheduled, so a scheduled status is always one.
  const isScheduled = status.kind === "scheduled";
  const isChallenge = status.kind === "running" && status.phase === "challenge";
  const noun = isChallenge ? "challenge" : "elimination";
  const Noun = isChallenge ? "Challenge" : "Elimination";
  const outcome = isScheduled
    ? "Nothing has been logged against it yet, so it will be removed entirely."
    : `Today stays a ${noun} day; from tomorrow you're on no phase.`;

  // A ref, not a state: a state update only lands on the next render, so two
  // taps inside one frame would both read `false` and both fire. Ending an
  // elimination cannot be undone, so the window is worth closing properly.
  const ending = useRef(false);

  async function handleAbort() {
    if (ending.current) return;
    ending.current = true;
    try {
      // `confirmDestructive`, never Alert: react-native-web's Alert is a no-op,
      // so an Alert here would end the elimination with no confirmation at all.
      const confirmed = await confirmDestructive(
        isScheduled ? "Cancel this elimination?" : `End ${noun}${isChallenge ? "" : " early"}?`,
        `This cannot be undone. ${outcome}`,
        isScheduled ? "Cancel it" : "End it",
      );
      if (!confirmed) return;
      await (isChallenge ? endChallenge() : endEliminationEarly());
      onClose();
    } finally {
      ending.current = false;
    }
  }

  const styles = makeStyles(colors);
  const bottomPad = Platform.OS === "web" ? 84 : insets.bottom + 50;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: bottomPad + 8 }]}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {isScheduled ? "Cancel Elimination" : `End ${Noun}${isChallenge ? "" : " Early"}`}
          </Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <MciIcon name="close" size={22} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={[styles.abortHeader, { backgroundColor: colors.destructive + "18", borderColor: colors.destructive + "55" }]}>
            <MciIcon name="alert" size={22} color={colors.destructive} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.abortTitle, { color: colors.destructive }]}>
                {isScheduled ? "Cancel Elimination?" : `End ${Noun}${isChallenge ? "" : " Early"}?`}
              </Text>
              <Text style={[styles.abortSub, { color: colors.mutedForeground }]}>
                This cannot be undone. {outcome}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={[
              styles.confirmAbortBtn,
              { backgroundColor: colors.destructive },
            ]}
            onPress={handleAbort}
            activeOpacity={0.8}
          >
            <MciIcon
              name="flag-remove"
              size={18}
              color="#fff"
            />
            <Text style={[styles.confirmAbortText, { color: "#fff" }]}>
              {isScheduled ? "Confirm Cancel" : `End ${Noun}`}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.backBtn} onPress={onClose}>
            <MciIcon name="arrow-left" size={16} color={colors.mutedForeground} />
            <Text style={[styles.backBtnText, { color: colors.mutedForeground }]}>Back</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

function makeStyles(colors: ReturnType<typeof import("@/hooks/useColors").useColors>) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: 20,
      paddingTop: 12,
      maxHeight: "90%",
    },
    handle: {
      width: 36, height: 4, borderRadius: 2,
      backgroundColor: colors.border,
      alignSelf: "center", marginBottom: 16,
    },
    header: {
      flexDirection: "row", alignItems: "center",
      justifyContent: "space-between", marginBottom: 20,
    },
    title: { fontSize: 18, fontFamily: "Inter_700Bold" },
    abortHeader: {
      flexDirection: "row", alignItems: "flex-start", gap: 12,
      padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 20,
    },
    abortTitle: { fontSize: 16, fontFamily: "Inter_700Bold", marginBottom: 4 },
    abortSub: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
    confirmAbortBtn: {
      flexDirection: "row", alignItems: "center",
      justifyContent: "center", gap: 8,
      paddingVertical: 16, borderRadius: 16, marginBottom: 12,
    },
    confirmAbortText: { fontSize: 15, fontFamily: "Inter_700Bold" },
    backBtn: {
      flexDirection: "row", alignItems: "center",
      justifyContent: "center", gap: 6,
      paddingVertical: 10, marginBottom: 8,
    },
    backBtnText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  });
}
