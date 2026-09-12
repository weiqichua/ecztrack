import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  Modal, ScrollView, Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MciIcon from "@/components/MciIcon";
import DateScroller from "@/components/DateScroller";
import { useColors } from "@/hooks/useColors";
import { useAppContext } from "@/context/AppContext";
import { formatShortDate } from "@/constants/types";
import { addDaysToKey } from "@/lib/dates";
import { openSpan } from "@/lib/phases";
import { notify } from "@/lib/dialogs";
import { ON_ACCENT } from "@/constants/colors";

const ELIMINATION_COLOR = "#81D4FA";
const CHALLENGE_COLOR = "#FFB300";

/** How far ahead an elimination may be scheduled. */
const MAX_FUTURE_DAYS = 30;

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Starting a phase: scheduling an elimination, or beginning a challenge.
 *
 * The three-way phase picker this sheet used to open with is gone, and picking
 * any phase while another ran is exactly the replacement rule 4 forbids. The way
 * out of a running phase is to end it, so both actions here refuse while one is
 * open, and say why.
 *
 * The gate asks `openSpan`, not "does a span cover today": on the day a phase is
 * ended those two disagree, and the day's own span still owning today is not a
 * reason to refuse the next one. Asking the wrong question here would contradict
 * the mutators, which are the actual authority — and `openSpan` is asked about
 * today for the same reason, so an elimination whose plan ran out months ago
 * stops greying this sheet out.
 *
 * A challenge carries what is being reintroduced, as free text and required —
 * an unlabelled challenge is the record the analysis cannot read back.
 */
export default function PhaseStartModal({ visible, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { ledger, todayDateKey, scheduleElimination, startChallenge } = useAppContext();

  const [startDate, setStartDate] = useState(todayDateKey);
  const [durationDays, setDurationDays] = useState(14);
  const [eliminationWhat, setEliminationWhat] = useState("");
  const [challengeWhat, setChallengeWhat] = useState("");

  // This sheet never unmounts (Expo Router keeps the home screen alive for the
  // app's whole lifetime), so the `useState` above only seeds `startDate` once,
  // ever. Left alone, a sheet opened after midnight would still default to
  // yesterday's date. Reseeding on `visible` also clears a date the user picked
  // and then dismissed the sheet on — a stale pick surviving reopen would be a
  // second, milder version of the same bug.
  useEffect(() => {
    if (visible) {
      setStartDate(todayDateKey);
      setEliminationWhat("");
      setChallengeWhat("");
    }
  }, [visible, todayDateKey]);

  // A ref, not a state: a state update lands on the next render, so two taps
  // inside one frame both read `false` and both write. Starting a phase twice
  // would schedule an elimination and then have the second call throw at the
  // user, so the window is worth closing properly.
  const submitting = useRef(false);

  // The last day of the run, not the day after it: the start date is Day 1.
  const lastDay = addDaysToKey(startDate, durationDays - 1);
  const isFutureStart = startDate > todayDateKey;

  const open = openSpan(ledger, todayDateKey);
  const canChallenge = open === null;
  // Required, not merely encouraged: the mutator throws on a blank label, so the
  // button that would trigger that throw is off until there is one to send.
  const eWhat = eliminationWhat.trim();
  const canStartElimination = canChallenge && eWhat !== "";

  const what = challengeWhat.trim();
  const canStartChallenge = canChallenge && what !== "";

  async function submit(action: () => Promise<void>, failureTitle: string) {
    if (submitting.current) return;
    submitting.current = true;
    try {
      await action();
      onClose();
    } catch (e: any) {
      // The mutators throw rather than no-op when a transition is illegal, so
      // the reason has to be shown instead of the sheet closing as if it worked.
      // `notify`, never Alert — react-native-web's Alert is a no-op.
      notify(failureTitle, e?.message ?? String(e));
    } finally {
      submitting.current = false;
    }
  }

  function handleStartElimination() {
    if (open) {
      notify(
        "Can't start an elimination yet",
        open.kind === "elimination"
          ? todayDateKey < open.startDate
            ? `An elimination is already scheduled to start ${formatShortDate(open.startDate)}.`
            : "An elimination is already running. End it before starting another."
          : "A challenge is already running. End it before starting an elimination.",
      );
      return;
    }
    void submit(
      () => scheduleElimination(startDate, durationDays, eWhat),
      "Can't start elimination",
    );
  }

  function handleStartChallenge() {
    if (open) {
      // Named for what it is and, when it has not begun, said as pending rather
      // than as running — "an elimination is running" over a blank today is the
      // kind of copy that reads as a bug in the app rather than a rule.
      notify(
        "Can't start a challenge yet",
        open.kind === "challenge"
          ? "A challenge is already running. End it before starting another."
          : todayDateKey < open.startDate
            ? `An elimination is scheduled to start ${formatShortDate(open.startDate)}. Cancel it before starting a challenge.`
            : "An elimination is running today. End it early before starting a challenge.",
      );
      return;
    }
    void submit(() => startChallenge(what), "Can't start a challenge");
  }

  const styles = makeStyles(colors);
  const bottomPad = Platform.OS === "web" ? 84 : insets.bottom + 50;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: bottomPad + 8 }]}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.foreground }]}>Start a Phase</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <MciIcon name="close" size={22} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={[styles.durationSection, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.durationLabel, { color: colors.mutedForeground }]}>
                What are you eliminating?
              </Text>
              <TextInput
                value={eliminationWhat}
                onChangeText={setEliminationWhat}
                placeholder="e.g. dairy"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.whatInput, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border, marginBottom: 16 }]}
                autoCapitalize="none"
                returnKeyType="done"
              />

              <Text style={[styles.durationLabel, { color: colors.mutedForeground }]}>Start date</Text>
              <View style={styles.scrollerWrap}>
                <DateScroller
                  selectedDate={startDate}
                  onSelect={setStartDate}
                  days={1}
                  futureDays={MAX_FUTURE_DAYS}
                />
              </View>

              <Text style={[styles.durationLabel, { color: colors.mutedForeground }]}>Duration</Text>
              <View style={styles.durationRow}>
                <TouchableOpacity
                  style={[styles.durationBtn, { backgroundColor: colors.background, borderColor: colors.border }]}
                  onPress={() => setDurationDays(d => Math.max(7, d - 1))}
                  hitSlop={8}
                >
                  <MciIcon name="minus" size={18} color={colors.foreground} />
                </TouchableOpacity>
                <View style={styles.durationCenter}>
                  <Text style={[styles.durationNum, { color: ELIMINATION_COLOR }]}>{durationDays}</Text>
                  <Text style={[styles.durationUnit, { color: colors.mutedForeground }]}>days</Text>
                </View>
                <TouchableOpacity
                  style={[styles.durationBtn, { backgroundColor: colors.background, borderColor: colors.border }]}
                  onPress={() => setDurationDays(d => Math.min(90, d + 1))}
                  hitSlop={8}
                >
                  <MciIcon name="plus" size={18} color={colors.foreground} />
                </TouchableOpacity>
              </View>
              <View style={styles.datePreview}>
                <Text style={[styles.datePreviewText, { color: colors.mutedForeground }]}>
                  Day 1{" "}
                  <Text style={[styles.datePreviewValue, { color: colors.foreground }]}>
                    {formatShortDate(startDate)}
                  </Text>
                  {" · Last day "}
                  <Text style={[styles.datePreviewValue, { color: colors.foreground }]}>
                    {formatShortDate(lastDay)}
                  </Text>
                </Text>
                {isFutureStart && (
                  // Otherwise a future start looks like it takes effect now.
                  <Text style={[styles.datePreviewNote, { color: colors.mutedForeground }]}>
                    Today stays without a phase until then.
                  </Text>
                )}
              </View>
              <View style={styles.quickDurations}>
                {[7, 14, 21, 28].map(d => (
                  <TouchableOpacity
                    key={d}
                    style={[
                      styles.quickBtn,
                      {
                        backgroundColor: durationDays === d ? ELIMINATION_COLOR + "22" : colors.background,
                        borderColor: durationDays === d ? ELIMINATION_COLOR : colors.border,
                      },
                    ]}
                    onPress={() => setDurationDays(d)}
                  >
                    <Text style={[styles.quickBtnText, { color: durationDays === d ? ELIMINATION_COLOR : colors.foreground }]}>
                      {d}d
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
          </View>

          <TouchableOpacity
            style={[
              styles.startBtn,
              { backgroundColor: ELIMINATION_COLOR, opacity: canStartElimination || open ? 1 : 0.4 },
            ]}
            onPress={handleStartElimination}
            activeOpacity={0.8}
            disabled={!canStartElimination && !open}
          >
            <MciIcon name="shield-remove" size={20} color={ON_ACCENT} />
            <Text style={styles.startBtnText}>
              {isFutureStart ? "Schedule Elimination" : "Start Elimination"}
            </Text>
          </TouchableOpacity>
          {!canStartElimination && !open && (
            <Text style={[styles.requiredNote, { color: colors.mutedForeground }]}>
              Name what you are eliminating to start.
            </Text>
          )}

          <View style={styles.divider}>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
            <Text style={[styles.dividerText, { color: colors.mutedForeground }]}>or</Text>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          </View>

          <View style={[styles.whatSection, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.durationLabel, { color: colors.mutedForeground }]}>
              What are you challenging?
            </Text>
            <TextInput
              value={challengeWhat}
              onChangeText={setChallengeWhat}
              placeholder="e.g. dairy"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.whatInput, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
              autoCapitalize="none"
              returnKeyType="done"
            />
          </View>

          {/* Still pressable while a phase is open: tapping it is how the user
              finds out why, and a dead button explains nothing. It is only truly
              disabled when nothing but the label is missing, which the line
              underneath says outright. */}
          <TouchableOpacity
            style={[
              styles.challengeBtn,
              {
                borderColor: canStartChallenge ? CHALLENGE_COLOR : colors.border,
                backgroundColor: canStartChallenge ? CHALLENGE_COLOR + "18" : "transparent",
              },
            ]}
            onPress={handleStartChallenge}
            disabled={canChallenge && !what}
            activeOpacity={0.8}
          >
            <MciIcon
              name="flask"
              size={20}
              color={canStartChallenge ? CHALLENGE_COLOR : colors.mutedForeground}
            />
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.challengeBtnText,
                  { color: canStartChallenge ? CHALLENGE_COLOR : colors.mutedForeground },
                ]}
              >
                Start Challenge
              </Text>
              <Text style={[styles.challengeSub, { color: colors.mutedForeground }]}>
                {open
                  ? open.kind === "challenge"
                    ? "A challenge is already running."
                    : todayDateKey < open.startDate
                      ? "Not available while an elimination is scheduled."
                      : "Not available while an elimination is on."
                  : what
                    ? `Reintroduce ${what} from today onward.`
                    : "Name what you're reintroducing to start."}
              </Text>
            </View>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

function makeStyles(colors: ReturnType<typeof import("@/hooks/useColors").useColors>) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.55)",
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: 20,
      paddingTop: 12,
      maxHeight: "88%",
    },
    handle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      alignSelf: "center",
      marginBottom: 16,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 20,
    },
    title: {
      fontSize: 18,
      fontFamily: "Inter_700Bold",
    },
    durationSection: {
      borderRadius: 16,
      borderWidth: 1,
      padding: 16,
      marginBottom: 16,
      gap: 14,
    },
    durationLabel: {
      fontSize: 11,
      fontFamily: "Inter_600SemiBold",
      textTransform: "uppercase",
      letterSpacing: 0.8,
    },
    scrollerWrap: {
      marginHorizontal: -16,
    },
    durationRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    durationBtn: {
      width: 48,
      height: 48,
      borderRadius: 12,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    durationCenter: {
      alignItems: "center",
      flex: 1,
    },
    durationNum: {
      fontSize: 36,
      fontFamily: "Inter_700Bold",
    },
    durationUnit: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      marginTop: -4,
    },
    datePreview: {
      alignItems: "center",
      gap: 4,
    },
    datePreviewText: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
    },
    datePreviewValue: {
      fontFamily: "Inter_600SemiBold",
    },
    datePreviewNote: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
    },
    quickDurations: {
      flexDirection: "row",
      gap: 8,
      justifyContent: "center",
    },
    quickBtn: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 20,
      borderWidth: 1,
    },
    quickBtnText: {
      fontSize: 13,
      fontFamily: "Inter_600SemiBold",
    },
    startBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingVertical: 16,
      borderRadius: 16,
      marginBottom: 8,
    },
    startBtnText: {
      fontSize: 16,
      fontFamily: "Inter_700Bold",
      color: ON_ACCENT,
    },
    requiredNote: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      textAlign: "center",
      marginTop: -4,
      marginBottom: 16,
    },
    divider: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginVertical: 8,
    },
    dividerLine: {
      flex: 1,
      height: 1,
    },
    dividerText: {
      fontSize: 11,
      fontFamily: "Inter_600SemiBold",
      textTransform: "uppercase",
      letterSpacing: 0.8,
    },
    whatSection: {
      borderRadius: 16,
      borderWidth: 1,
      padding: 16,
      marginBottom: 12,
      gap: 8,
    },
    whatInput: {
      borderRadius: 12,
      borderWidth: 1,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 15,
      fontFamily: "Inter_400Regular",
    },
    challengeBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderRadius: 16,
      borderWidth: 1.5,
      marginBottom: 8,
    },
    challengeBtnText: {
      fontSize: 15,
      fontFamily: "Inter_700Bold",
    },
    challengeSub: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      marginTop: 2,
    },
  });
}
