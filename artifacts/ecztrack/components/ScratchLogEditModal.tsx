import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Switch, Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MciIcon from "@/components/MciIcon";
import * as Haptics from "expo-haptics";
import { notify } from "@/lib/dialogs";
import { useColors } from "@/hooks/useColors";
import { useAppContext } from "@/context/AppContext";
import TimestampPicker from "@/components/TimestampPicker";
import CatalogManagerModal from "@/components/CatalogManagerModal";
import PickerHeader from "@/components/PickerHeader";
import { ScratchLog, SUCCESS_LABELS } from "@/constants/types";
import { activeItems, itemName, CatalogKind, CatalogItem } from "@/constants/catalog";

interface Props {
  visible: boolean;
  /** The log being edited. Null while the sheet is closing. */
  log: ScratchLog | null;
  onClose: () => void;
}

/**
 * A chip for a value the log holds that is no longer offerable, because the
 * user archived the catalog item behind it.
 *
 * Without this the edit form would open showing no body location at all and
 * Save would look like the way to fix it — silently rewriting real history. It
 * is shown, named, and selected; picking any live chip replaces it.
 */
function RetiredChip({ name, tint }: { name: string; tint: string }) {
  return (
    <View style={[styles.chip, styles.chipRetired, { borderColor: tint }]}>
      <MciIcon name="archive-outline" size={12} color={tint} />
      <Text style={[styles.chipText, { color: tint }]}>{name} · retired</Text>
    </View>
  );
}

/**
 * Edits one urge log.
 *
 * The create form lives inline in the Habits screen and carries that screen's
 * own stylesheet, so its markup could not be shared without reshaping a file
 * this change does not own. The fields, their order and their rules are the
 * same set deliberately — an edit that offers fewer choices than the create
 * form is a trap.
 */
export default function ScratchLogEditModal({ visible, log, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { updateScratchLog, bodyLocations, cues, routines } = useAppContext();

  const activeLocations = useMemo(() => activeItems(bodyLocations), [bodyLocations]);
  const activeCues = useMemo(() => activeItems(cues), [cues]);
  const activeRoutines = useMemo(() => activeItems(routines), [routines]);

  const [timestamp, setTimestamp] = useState(() => new Date().toISOString());
  const [location, setLocation] = useState<string | null>(null);
  const [cue, setCue] = useState<string | null>(null);
  const [routineId, setRoutineId] = useState<string | null>(null);
  const [success, setSuccess] = useState<1 | 2 | 3 | 4>(3);
  const [isAccident, setIsAccident] = useState(false);
  const saving = useRef(false);

  const [managing, setManaging] = useState<CatalogKind | null>(null);
  // Held separately so the title and fields do not change as the sheet slides
  // away — see the same note on the create form.
  const [managedKind, setManagedKind] = useState<CatalogKind>("bodyLocation");

  function openManager(kind: CatalogKind) {
    setManagedKind(kind);
    setManaging(kind);
  }

  // Seeded from the log each time the sheet opens, keyed on the log's id as
  // well as `visible`: reopening on a different entry has to reload the form.
  useEffect(() => {
    if (!visible || !log) return;
    setTimestamp(log.timestamp);
    setLocation(log.location);
    setCue(log.cue);
    setRoutineId(log.routine_id);
    setSuccess(log.success);
    setIsAccident(log.is_accident);
  }, [visible, log?.id]);

  async function handleSave() {
    // The awaits below yield, so a second tap could re-enter and write twice.
    if (saving.current || !log) return;
    if (!location || !cue) {
      notify(
        "Missing details",
        !location
          ? "Choose a body location — use + Add above if the list is empty."
          : "Choose a trigger — use + Add above if the list is empty.",
      );
      return;
    }
    saving.current = true;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      await updateScratchLog(log.id, {
        timestamp, location, cue, routine_id: routineId, success,
        is_accident: isAccident,
      });
      onClose();
    } finally {
      saving.current = false;
    }
  }

  /** The chosen item when it is no longer in the picker, else null. */
  function retired(items: CatalogItem[], active: CatalogItem[], id: string | null) {
    if (!id || active.some(i => i.id === id)) return null;
    return itemName(items, id);
  }

  const retiredLocation = retired(bodyLocations, activeLocations, location);
  const retiredCue = retired(cues, activeCues, cue);
  const retiredRoutine = retired(routines, activeRoutines, routineId);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.modal, { backgroundColor: colors.background }]}>
        <View style={[styles.modalHeader, { borderBottomColor: colors.border, paddingTop: Platform.OS === "web" ? 20 : insets.top + 8 }]}>
          <TouchableOpacity onPress={onClose}>
            <MciIcon name="close" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>Edit Urge Log</Text>
          <TouchableOpacity
            onPress={handleSave}
            style={[styles.saveModalBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.saveModalText, { color: colors.primaryForeground }]}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.modalContent}>
          <View style={[styles.metaCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TimestampPicker value={timestamp} onChange={setTimestamp} label="Logged for" />
            <View style={styles.accidentRow}>
              <MciIcon
                name="alert-circle-outline"
                size={14}
                color={isAccident ? colors.destructive : colors.mutedForeground}
              />
              <Text style={[styles.accidentLabel, {
                color: isAccident ? colors.destructive : colors.mutedForeground,
              }]}>
                Involuntary / accidental scratch
              </Text>
              <Switch
                value={isAccident}
                onValueChange={setIsAccident}
                trackColor={{ false: colors.border, true: colors.destructive + "88" }}
                thumbColor={isAccident ? colors.destructive : colors.mutedForeground}
              />
            </View>
          </View>

          <PickerHeader
            label="Body Location" colors={colors} onManage={() => openManager("bodyLocation")}
            style={styles.pickerHeader} labelStyle={styles.pickerHeaderLabel}
          />
          <View style={styles.chipGrid}>
            {retiredLocation && (
              <RetiredChip name={retiredLocation} tint={colors.mutedForeground} />
            )}
            {activeLocations.map(loc => (
              <TouchableOpacity
                key={loc.id}
                style={[styles.chip, {
                  backgroundColor: location === loc.id ? colors.primary : colors.card,
                  borderColor: location === loc.id ? colors.primary : colors.border,
                }]}
                onPress={() => setLocation(loc.id)}
                onLongPress={() => openManager("bodyLocation")}
              >
                <Text style={[styles.chipText, {
                  color: location === loc.id ? colors.primaryForeground : colors.foreground,
                }]}>
                  {loc.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <PickerHeader
            label="Trigger / Cue" colors={colors} onManage={() => openManager("cue")}
            style={styles.pickerHeader} labelStyle={styles.pickerHeaderLabel}
          />
          <View style={styles.chipGrid}>
            {retiredCue && (
              <RetiredChip name={retiredCue} tint={colors.mutedForeground} />
            )}
            {activeCues.map(c => (
              <TouchableOpacity
                key={c.id}
                style={[styles.chip, {
                  backgroundColor: cue === c.id ? colors.accent : colors.card,
                  borderColor: cue === c.id ? colors.accent : colors.border,
                }]}
                onPress={() => setCue(c.id)}
                onLongPress={() => openManager("cue")}
              >
                <Text style={[styles.chipText, {
                  color: cue === c.id ? colors.accentForeground : colors.foreground,
                }]}>
                  {c.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <PickerHeader
            label="Competing Routine Used" colors={colors} onManage={() => openManager("routine")}
            style={styles.pickerHeader} labelStyle={styles.pickerHeaderLabel}
          />
          <Text style={[styles.pickerHint, { color: colors.mutedForeground }]}>
            Optional — tap the selected routine again to clear it.
          </Text>
          {retiredRoutine && (
            <View style={styles.chipGrid}>
              <RetiredChip name={retiredRoutine} tint={colors.mutedForeground} />
              {/* The one clearable field, so it needs a way out even when what
                  it holds is no longer in the list. */}
              <TouchableOpacity
                style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.card }]}
                onPress={() => setRoutineId(null)}
              >
                <Text style={[styles.chipText, { color: colors.foreground }]}>Clear</Text>
              </TouchableOpacity>
            </View>
          )}
          {activeRoutines.map(routine => (
            <TouchableOpacity
              key={routine.id}
              style={[styles.routineRow, {
                backgroundColor: routineId === routine.id ? colors.primary + "22" : colors.card,
                borderColor: routineId === routine.id ? colors.primary : colors.border,
              }]}
              onPress={() => setRoutineId(routineId === routine.id ? null : routine.id)}
              onLongPress={() => openManager("routine")}
            >
              <View style={[styles.routineRadio, {
                borderColor: routineId === routine.id ? colors.primary : colors.border,
              }]}>
                {routineId === routine.id && (
                  <View style={[styles.routineRadioFill, { backgroundColor: colors.primary }]} />
                )}
              </View>
              <View style={styles.routineInfo}>
                <Text style={[styles.routineName, { color: colors.foreground }]}>{routine.name}</Text>
                {routine.description ? (
                  <Text style={[styles.routineDesc, { color: colors.mutedForeground }]}>{routine.description}</Text>
                ) : null}
              </View>
            </TouchableOpacity>
          ))}

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Outcome</Text>
          <View style={styles.outcomeRow}>
            {([1, 2, 3, 4] as const).map(val => (
              <TouchableOpacity
                key={val}
                style={[styles.outcomeBtn, {
                  backgroundColor: success === val
                    ? (val <= 1 ? colors.destructive : val === 2 ? colors.warning : val === 3 ? colors.primary : colors.success)
                    : colors.card,
                  borderColor: success === val ? "transparent" : colors.border,
                }]}
                onPress={() => setSuccess(val)}
              >
                <Text style={[styles.outcomeBtnText, {
                  color: success === val ? "#FFF" : colors.foreground,
                }]}>
                  {SUCCESS_LABELS[val]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        {/* Nested inside this sheet on purpose — it is only opened from the
            pickers above, and a sibling Modal would not layer over it. */}
        <CatalogManagerModal
          visible={managing !== null}
          kind={managedKind}
          onClose={() => setManaging(null)}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1 },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  modalTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  saveModalBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10 },
  saveModalText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  modalContent: { padding: 16, paddingBottom: 48 },

  metaCard: { borderRadius: 14, borderWidth: 1, padding: 12, gap: 8, marginBottom: 8 },
  accidentRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  accidentLabel: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular" },

  pickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 18,
    marginBottom: 8,
  },
  // This sheet's own spacing and label typography, handed to the shared
  // PickerHeader so extracting it changed nothing on screen.
  pickerHeaderLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.5,
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 18,
    marginBottom: 8,
  },
  pickerHint: { fontSize: 11, fontFamily: "Inter_400Regular", marginBottom: 8 },

  chipGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipRetired: { borderStyle: "dashed", backgroundColor: "transparent" },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },

  routineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
  },
  routineRadio: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 2,
    alignItems: "center", justifyContent: "center",
  },
  routineRadioFill: { width: 10, height: 10, borderRadius: 5 },
  routineInfo: { flex: 1 },
  routineName: { fontSize: 14, fontFamily: "Inter_500Medium" },
  routineDesc: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },

  outcomeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  outcomeBtn: {
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 12, borderWidth: 1,
  },
  outcomeBtnText: { fontSize: 13, fontFamily: "Inter_500Medium" },
});
