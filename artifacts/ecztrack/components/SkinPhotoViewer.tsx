import React from "react";
import {
  View, Text, StyleSheet, Image, TouchableOpacity, Modal, Platform, ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as FileSystem from "expo-file-system/legacy";
import MciIcon from "@/components/MciIcon";
import { confirmDestructive } from "@/lib/dialogs";
import { useColors } from "@/hooks/useColors";
import { useAppContext } from "@/context/AppContext";
import { activeItems, itemName } from "@/constants/catalog";
import { photoUri } from "@/lib/skinPhotos";
import { SkinPhoto } from "@/constants/types";

interface Props {
  photo: SkinPhoto | null;
  onClose: () => void;
}

import TimestampPicker from "@/components/TimestampPicker";
import PickerHeader from "@/components/PickerHeader";
import CatalogManagerModal from "@/components/CatalogManagerModal";

/**
 * Full-screen viewer for one skin photo: the image, when it was taken, a
 * body-location tag, and delete.
 *
 * `photo` is the object itself rather than an id — same reasoning as
 * ScratchLogEditModal — so the sheet can render immediately without a lookup,
 * and the caller sets it back to null in the same commit that closes it.
 */
export default function SkinPhotoViewer({ photo, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { bodyLocations, deleteSkinPhoto, setPhotoLocation, setPhotoTime } = useAppContext();

  const activeLocations = React.useMemo(() => activeItems(bodyLocations), [bodyLocations]);

  const [managerOpen, setManagerOpen] = React.useState(false);

  // A local uri that `Image` can display across OSs. Doing this on every
  // render was lagging Android significantly when dragging the sheet down.
  const uri = React.useMemo(
    () => (photo ? photoUri(FileSystem.documentDirectory, photo.file) : null),
    [photo?.file],
  );

  async function handleDelete() {
    if (!photo) return;
    const confirmed = await confirmDestructive(
      "Delete this photo?",
      "The picture will be removed from this device. This cannot be undone.",
    );
    if (!confirmed) return;
    await deleteSkinPhoto(photo.id);
    onClose();
  }

  return (
    <Modal
      visible={photo !== null}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.modal, { backgroundColor: colors.background }]}>
        <View style={[styles.modalHeader, { borderBottomColor: colors.border, paddingTop: Platform.OS === "web" ? 20 : insets.top + 8 }]}>
          <TouchableOpacity onPress={onClose}>
            <MciIcon name="close" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>Photo</Text>
          <TouchableOpacity onPress={handleDelete} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <MciIcon name="trash-can-outline" size={22} color={colors.destructive} />
          </TouchableOpacity>
        </View>

        {photo && (
          <>
            {uri && <Image source={{ uri }} style={styles.image} resizeMode="contain" />}
            <ScrollView style={{ flex: 1 }}>
              <View style={styles.body}>
                <TimestampPicker
                  value={photo.takenAt}
                  onChange={(val) => setPhotoTime(photo.id, val)}
                  label="Taken at"
                />

                <PickerHeader
                  label="Body Location"
                  colors={colors}
                  onManage={() => setManagerOpen(true)}
                  style={styles.pickerHeader}
                  labelStyle={styles.sectionLabel}
                />
                <View style={styles.chipGrid}>
                  <TouchableOpacity
                    style={[styles.chip, {
                      backgroundColor: !photo.location ? colors.primary : colors.card,
                      borderColor: !photo.location ? colors.primary : colors.border,
                    }]}
                    onPress={() => setPhotoLocation(photo.id, undefined)}
                  >
                    <Text style={[styles.chipText, {
                      color: !photo.location ? colors.primaryForeground : colors.foreground,
                    }]}>
                      None
                    </Text>
                  </TouchableOpacity>
                  {activeLocations.map(loc => (
                    <TouchableOpacity
                      key={loc.id}
                      style={[styles.chip, {
                        backgroundColor: photo.location === loc.id ? colors.primary : colors.card,
                        borderColor: photo.location === loc.id ? colors.primary : colors.border,
                      }]}
                      onPress={() => setPhotoLocation(photo.id, loc.id)}
                    >
                      <Text style={[styles.chipText, {
                        color: photo.location === loc.id ? colors.primaryForeground : colors.foreground,
                      }]}>
                        {loc.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  {/* A retired location the photo still points at — shown so the
                      tag is never silently hidden, the same rule
                      ScratchLogEditModal applies to its own retired chips. */}
                  {photo.location && !activeLocations.some(l => l.id === photo.location) && (
                    <View style={[styles.chip, styles.chipRetired, { borderColor: colors.mutedForeground }]}>
                      <MciIcon name="archive-outline" size={12} color={colors.mutedForeground} />
                      <Text style={[styles.chipText, { color: colors.mutedForeground }]}>
                        {itemName(bodyLocations, photo.location)} · retired
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            </ScrollView>
          </>
        )}
        
        <CatalogManagerModal
          visible={managerOpen}
          onClose={() => setManagerOpen(false)}
          kind="bodyLocation"
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
  image: { width: "100%", height: "60%", backgroundColor: "#000" },
  body: { padding: 16 },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  chipGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  pickerHeader: {
    marginTop: 18,
    marginBottom: 0,
  },
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
});
