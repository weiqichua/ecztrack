import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Share,
  Platform,
  ActivityIndicator,
} from "react-native";
import { todayKey } from "@/lib/dates";
import { notify, confirmDestructive } from "@/lib/dialogs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MciIcon from "@/components/MciIcon";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useColors } from "@/hooks/useColors";
import { useAppContext } from "@/context/AppContext";
import {
  buildConsumptionCSV, buildHabitsCSV, buildJSON, buildSymptomCSV, buildUrgeCSV,
} from "@/lib/exportCsv";
import { isRecordedCheckin } from "@/lib/dayStyle";
import { ON_ACCENT } from "@/constants/colors";

// ── Web download helper ──────────────────────────────────────────────────────

function webDownload(content: string, filename: string, mimeType: string) {
  if (typeof document === "undefined") return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  // Firefox ignores a click on an anchor that is not in the document, and
  // revoking the URL in the same tick can cancel a download that has not
  // started yet.
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 10_000);
}

// ── Native share helper ──────────────────────────────────────────────────────

async function nativeShare(content: string, filename: string) {
  const uri = (FileSystem.cacheDirectory ?? "") + filename;
  await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
  await Sharing.shareAsync(uri, { mimeType: "text/plain", dialogTitle: "Export " + filename });
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ExportScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    consumptionLogs, symptomLogs, scratchLogs, allFoods, habitLogs, habitDefinitions,
    ledger, bodyLocations, cues, routines, symptoms, foodCategories, foodTags,
    supplementLogs, activityLogs, supplements, activities,
    backupAvailable, backupUser, backupStatus, backupError, lastBackupAt,
    signIn, signOut, backupNow, restoreFromBackup,
  } = useAppContext();
  const [exporting, setExporting] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const busy = backupStatus === "working";
  // A log whose every score is null records nothing — the user tapped a box and
  // tapped it off again. The symptom CSV omits those rows, so the count beside
  // the button has to omit them too or it promises rows the file will not hold.
  const recordedCheckins = symptomLogs.filter(isRecordedCheckin);

  async function handleSignIn() {
    try { await signIn(email, password); setPassword(""); } catch { /* surfaced via backupError */ }
  }

  // Local entry counts, so an obviously-stale device is visible before you push
  // it over the cloud copy. Backup is the irreversible direction: it overwrites
  // remote documents by id, and the cloud is the only other copy.
  const localCount =
    consumptionLogs.length + symptomLogs.length + scratchLogs.length +
    habitLogs.length + habitDefinitions.length;

  async function handleBackup() {
    const ok = await confirmDestructive(
      "Replace the cloud backup?",
      `Everything on this device except skin photos (${localCount} entries) will overwrite the cloud copy. ` +
        `Last backup: ${fmtBackupTime(lastBackupAt)}. If this device is out of date, ` +
        `restore first instead — this direction cannot be undone.`,
      "Upload",
    );
    if (ok) await backupNow();
  }

  async function handleRestore() {
    const ok = await confirmDestructive(
      "Restore from backup?",
      "Entries in the backup that are missing here will be added. Nothing on this device is deleted.",
      "Restore",
    );
    if (ok) await restoreFromBackup();
  }

  function fmtBackupTime(iso: string | null) {
    if (!iso) return "Never";
    const d = new Date(iso);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 58 : insets.bottom + 50;

  const todayTag = todayKey();

  async function doExport(label: string, content: string, filename: string, mime: string) {
    setExporting(label);
    try {
      if (Platform.OS === "web") {
        webDownload(content, filename, mime);
      } else {
        await nativeShare(content, filename);
      }
    } catch (e) {
      console.warn("Export error", e);
      notify("Export failed", e instanceof Error ? e.message : "Something went wrong while exporting.");
    } finally {
      setExporting(null);
    }
  }

  const EXPORTS: {
    id: string;
    title: string;
    subtitle: string;
    icon: string;
    iconColor: string;
    count: number;
    build: () => { content: string; filename: string; mime: string };
  }[] = [
    {
      id: "consumption_csv",
      title: "Food Log — CSV",
      subtitle: "One row per consumption event, with one binary column per tag in your Contains list. Ready for pandas/sklearn.",
      icon: "food-apple",
      iconColor: "#66BB6A",
      count: consumptionLogs.length,
      build: () => ({
        content: buildConsumptionCSV(consumptionLogs, allFoods, foodTags),
        filename: `food_log_${todayTag}.csv`,
        mime: "text/csv",
      }),
    },
    {
      id: "symptom_csv",
      title: "Symptom Log — CSV",
      subtitle: "One row per daily check-in with one column per symptom scored, plus computed average.",
      icon: "clipboard-pulse",
      iconColor: "#81D4FA",
      count: recordedCheckins.length,
      build: () => ({
        content: buildSymptomCSV(symptomLogs, symptoms),
        filename: `symptom_log_${todayTag}.csv`,
        mime: "text/csv",
      }),
    },
    {
      id: "urge_csv",
      title: "Urge / Habit Log — CSV",
      subtitle: "Scratch events with location, environmental cue, competing routine and success score. Phase + is_accident columns included.",
      icon: "hand-back-right-off",
      iconColor: "#EF5350",
      count: scratchLogs.length,
      build: () => ({
        content: buildUrgeCSV(scratchLogs, bodyLocations, cues, routines),
        filename: `urge_log_${todayTag}.csv`,
        mime: "text/csv",
      }),
    },
    {
      id: "habits_csv",
      title: "Daily Habits — CSV",
      subtitle: "One row per habit log entry with habit name, unit, goal, value logged, and a goal_met boolean. Include as lifestyle confounder features in your ML model.",
      icon: "checkbox-marked-circle-outline",
      iconColor: "#66BB6A",
      count: habitLogs.length,
      build: () => ({
        content: buildHabitsCSV(habitLogs, habitDefinitions),
        filename: `habits_log_${todayTag}.csv`,
        mime: "text/csv",
      }),
    },
    {
      id: "full_json",
      title: "Full Dataset — JSON",
      subtitle: "Every log, plus your item lists and the phase ledger, with each event's local date. Best for exploratory Python notebooks — see docs/ANALYSING-TRIGGERS.md.",
      icon: "code-json",
      iconColor: "#FFB300",
      count: consumptionLogs.length + symptomLogs.length + scratchLogs.length + habitLogs.length,
      build: () => ({
        content: buildJSON(consumptionLogs, supplementLogs, activityLogs, symptomLogs, scratchLogs, allFoods, habitLogs, habitDefinitions, ledger, { symptoms, bodyLocations, cues, routines, foodCategories, foodTags, supplements, activities }),
        filename: `health_tracker_full_${todayTag}.json`,
        mime: "application/json",
      }),
    },
  ];




  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={styles.titleRow}>
        <Text style={[styles.title, { color: colors.foreground }]}>Data Export</Text>
      </View>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        Export your logs as ML-ready CSVs or a full JSON bundle. Every row includes a phase tag, ISO timestamp, and is_accident flag for lag-mapping.
      </Text>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 16 }]}
        showsVerticalScrollIndicator={false}
      >

        {/* Backup — hidden entirely when Firebase is not configured */}
        {backupAvailable && (
          <View style={[styles.backupCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.backupHeader}>
              <MciIcon name="cloud-sync-outline" size={18} color={colors.primary} />
              <Text style={[styles.backupTitle, { color: colors.foreground }]}>Backup</Text>
            </View>

            {backupUser ? (
              <>
                <Text style={[styles.backupHint, { color: colors.mutedForeground }]}>
                  Signed in as {backupUser.email ?? backupUser.uid}
                </Text>
                <Text style={[styles.backupHint, { color: colors.mutedForeground }]}>
                  Skin photos are not backed up and stay on this device only.
                </Text>
                {/* Both sides, so the direction of each button is a decision
                    rather than a guess. */}
                <View style={[styles.backupSides, { borderColor: colors.border }]}>
                  <View style={styles.backupSide}>
                    <Text style={[styles.backupSideLabel, { color: colors.mutedForeground }]}>This device</Text>
                    <Text style={[styles.backupSideValue, { color: colors.foreground }]}>{localCount} entries</Text>
                  </View>
                  <MciIcon name="arrow-left-right" size={14} color={colors.mutedForeground} />
                  <View style={styles.backupSide}>
                    <Text style={[styles.backupSideLabel, { color: colors.mutedForeground }]}>Cloud</Text>
                    <Text style={[styles.backupSideValue, { color: colors.foreground }]}>{fmtBackupTime(lastBackupAt)}</Text>
                  </View>
                </View>
                <View style={styles.backupRow}>
                  <TouchableOpacity
                    style={[styles.backupBtn, { backgroundColor: colors.primary, opacity: busy ? 0.6 : 1 }]}
                    onPress={handleBackup}
                    disabled={busy}
                    activeOpacity={0.8}
                  >
                    {busy ? <ActivityIndicator size="small" color={colors.primaryForeground} />
                          : <Text style={[styles.backupBtnText, { color: colors.primaryForeground }]}>Upload to cloud</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.backupBtn, { backgroundColor: colors.muted, opacity: busy ? 0.6 : 1 }]}
                    onPress={handleRestore}
                    disabled={busy}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.backupBtnText, { color: colors.mutedForeground }]}>Download</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity onPress={signOut} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={[styles.backupSignOut, { color: colors.mutedForeground }]}>Sign out</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={[styles.backupHint, { color: colors.mutedForeground }]}>
                  Optional. Sign in to keep an off-device copy and pick it up on another phone.
                  Both directions are manual, and neither one deletes anything.
                </Text>
                <TextInput
                  style={[styles.backupInput, { backgroundColor: colors.surface, color: colors.foreground, borderColor: colors.border }]}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Email"
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                />
                <TextInput
                  style={[styles.backupInput, { backgroundColor: colors.surface, color: colors.foreground, borderColor: colors.border }]}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Password"
                  placeholderTextColor={colors.mutedForeground}
                  secureTextEntry
                  autoComplete="current-password"
                />
                <TouchableOpacity
                  style={[styles.backupBtn, { backgroundColor: colors.primary, opacity: busy || !email || !password ? 0.6 : 1 }]}
                  onPress={handleSignIn}
                  disabled={busy || !email || !password}
                  activeOpacity={0.8}
                >
                  {busy ? <ActivityIndicator size="small" color={colors.primaryForeground} />
                        : <Text style={[styles.backupBtnText, { color: colors.primaryForeground }]}>Sign in</Text>}
                </TouchableOpacity>
              </>
            )}

            {backupError ? (
              <Text style={[styles.backupErr, { color: colors.destructive }]} numberOfLines={3}>{backupError}</Text>
            ) : backupStatus === "success" ? (
              <Text style={[styles.backupErr, { color: colors.success }]}>Done.</Text>
            ) : null}
          </View>
        )}

        {/* Dataset summary */}
        <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.summaryTitle, { color: colors.mutedForeground }]}>Dataset Summary</Text>
          <View style={styles.summaryRow}>
            {[
              { label: "Food events", count: consumptionLogs.length, color: "#66BB6A" },
              { label: "Check-ins",   count: recordedCheckins.length, color: "#81D4FA" },
              { label: "Urge events", count: scratchLogs.length,     color: "#EF5350" },
              { label: "Habit logs",  count: habitLogs.length,       color: "#FFB300" },
            ].map(s => (
              <View key={s.label} style={styles.summaryCell}>
                <Text style={[styles.summaryCount, { color: s.color }]}>{s.count}</Text>
                <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Schema info */}
        <View style={[styles.schemaCard, { backgroundColor: colors.primary + "11", borderColor: colors.primary + "33" }]}>
          <MciIcon name="information-outline" size={16} color={colors.primary} />
          <Text style={[styles.schemaText, { color: colors.primary }]}>
            Food IDs are semantic slugs (e.g. RAMEN_SPICY, FRIED_CHICKEN) — stable across app updates for consistent ML encoding. Join CSVs on timestamp_iso for 48-hour lag analysis.
          </Text>
        </View>

        {/* Export cards */}
        {EXPORTS.map(exp => {
          const isLoading = exporting === exp.id;
          const isEmpty = exp.count === 0;
          return (
            <View key={exp.id} style={[styles.exportCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.exportCardHeader}>
                <View style={[styles.exportIcon, { backgroundColor: exp.iconColor + "22" }]}>
                  <MciIcon name={exp.icon as any} size={20} color={exp.iconColor} />
                </View>
                <View style={styles.exportCardInfo}>
                  <Text style={[styles.exportTitle, { color: colors.foreground }]}>{exp.title}</Text>
                  <Text style={[styles.exportCount, { color: colors.mutedForeground }]}>
                    {exp.count} row{exp.count !== 1 ? "s" : ""}
                  </Text>
                </View>
              </View>
              <Text style={[styles.exportDesc, { color: colors.mutedForeground }]}>{exp.subtitle}</Text>
              <TouchableOpacity
                style={[
                  styles.exportBtn,
                  {
                    backgroundColor: isEmpty ? colors.muted : exp.iconColor,
                    opacity: isLoading ? 0.7 : 1,
                  },
                ]}
                onPress={() => {
                  if (isEmpty || isLoading) return;
                  const { content, filename, mime } = exp.build();
                  doExport(exp.id, content, filename, mime);
                }}
                activeOpacity={isEmpty ? 1 : 0.8}
                disabled={isEmpty || !!exporting}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color={ON_ACCENT} />
                ) : (
                  <>
                    <MciIcon
                      name={Platform.OS === "web" ? "download" : "share"}
                      size={16}
                      color={isEmpty ? colors.mutedForeground : ON_ACCENT}
                    />
                    <Text style={[styles.exportBtnText, { color: isEmpty ? colors.mutedForeground : ON_ACCENT }]}>
                      {Platform.OS === "web" ? "Download" : "Share"} {isEmpty ? "(no data)" : ""}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          );
        })}

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  titleRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginHorizontal: 20, marginBottom: 6,
  },
  title: { fontSize: 26, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginHorizontal: 20, marginBottom: 16, lineHeight: 20 },
  syncIdRow: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  syncIdInput: { fontSize: 13, fontFamily: Platform.OS === "ios" ? "Courier" : "monospace", padding: 0 },
  syncActions: { flexDirection: "row", gap: 8 },
  syncLastTime: { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center" },
  content: { paddingHorizontal: 16, gap: 14 },
  summaryCard: { borderRadius: 16, borderWidth: 1, padding: 16 },
  summaryTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 },
  summaryRow: { flexDirection: "row", justifyContent: "space-around" },
  summaryCell: { alignItems: "center", gap: 4 },
  summaryCount: { fontSize: 28, fontFamily: "Inter_700Bold" },
  summaryLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  schemaCard: { flexDirection: "row", gap: 10, padding: 14, borderRadius: 14, borderWidth: 1, alignItems: "flex-start" },
  schemaText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  exportCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 10 },
  exportCardHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  exportIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  exportCardInfo: { flex: 1 },
  exportTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  exportCount: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  exportDesc: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  backupCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 10 },
  backupHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  backupTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  backupHint: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  backupRow: { flexDirection: "row", gap: 8 },
  backupSides: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, gap: 8,
  },
  backupSide: { gap: 2 },
  backupSideLabel: { fontSize: 10, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.4 },
  backupSideValue: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  backupBtn: {
    flex: 1, alignItems: "center", justifyContent: "center",
    paddingVertical: 12, borderRadius: 12, minHeight: 44,
  },
  backupBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  backupInput: {
    borderRadius: 12, borderWidth: 1, paddingHorizontal: 12,
    minHeight: 44, fontSize: 14, fontFamily: "Inter_400Regular",
  },
  backupSignOut: { fontSize: 12, fontFamily: "Inter_600SemiBold", textAlign: "center", paddingTop: 2 },
  backupErr: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  exportBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 12, borderRadius: 12, minHeight: 44,
  },
  exportBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
