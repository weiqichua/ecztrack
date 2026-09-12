/**
 * The device side of skin photos: the picker, the resize, and the files.
 *
 * Deliberately thin and deliberately untested — none of this loads under
 * vitest. Every rule that can be decided without a device lives in
 * lib/skinPhotos.ts, and anything added here that needs a test belongs there
 * instead.
 */
import { Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystem from "expo-file-system/legacy";
import { skinDirectory, photoUri, photoFileName } from "./skinPhotos";

/**
 * The longest edge a stored photo may have.
 *
 * Not an optimisation. A full-resolution daily photo is over a gigabyte within
 * a year on a device whose owner will never think to look for it; at this size
 * it is closer to a hundred megabytes. The app is asking to keep this
 * indefinitely and should ask for as little as it can.
 */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.7;

/** Whether this platform can hold photos at all — false on web. */
export function photosSupported(): boolean {
  return Platform.OS !== "web" && !!FileSystem.documentDirectory;
}

async function ensureDir(): Promise<string | null> {
  const dir = skinDirectory(FileSystem.documentDirectory);
  if (!dir) return null;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
}

export type PhotoSource = "camera" | "library";

/**
 * Takes or picks a photo, resizes it, and saves it under `file`.
 *
 * Returns null when the user backed out or the platform cannot store photos —
 * both are ordinary outcomes, not errors, and neither should reach a dialog.
 */
export async function capturePhoto(
  source: PhotoSource, takenAt: string, id: string,
): Promise<{ file: string } | null> {
  if (!photosSupported()) return null;

  const perm = source === "camera"
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error(
    source === "camera"
      ? "Camera access is off for Ecztrack. Turn it on in Settings to take a photo."
      : "Photo access is off for Ecztrack. Turn it on in Settings to add a picture.",
  );

  const result = source === "camera"
    ? await ImagePicker.launchCameraAsync({ quality: 1, exif: false })
    : await ImagePicker.launchImageLibraryAsync({ quality: 1, exif: false });
  if (result.canceled || !result.assets?.[0]) return null;

  const shrunk = await ImageManipulator.manipulateAsync(
    result.assets[0].uri,
    [{ resize: { width: MAX_EDGE } }],
    { compress: JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
  );

  const dir = await ensureDir();
  if (!dir) return null;
  const file = photoFileName(takenAt, id);
  await FileSystem.copyAsync({ from: shrunk.uri, to: `${dir}${file}` });
  return { file };
}

/** Deletes one image. A file already gone is not an error. */
export async function deletePhotoFile(file: string): Promise<void> {
  const uri = photoUri(FileSystem.documentDirectory, file);
  if (!uri) return;
  await FileSystem.deleteAsync(uri, { idempotent: true });
}

/**
 * The image files actually on disk, or **null when the directory could not be
 * read** — which `reconcile` treats as "do not touch anything".
 *
 * The distinction is the whole point: returning `[]` for an unreadable
 * directory would tell reconcile every photo is gone and delete the library.
 */
export async function listPhotoFiles(): Promise<string[] | null> {
  try {
    const dir = skinDirectory(FileSystem.documentDirectory);
    if (!dir) return null;
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) return [];
    return await FileSystem.readDirectoryAsync(dir);
  } catch {
    return null;
  }
}
