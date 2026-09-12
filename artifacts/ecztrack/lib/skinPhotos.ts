/**
 * Where a skin photo lives, and the rules for keeping the records honest.
 *
 * Pure: it takes the document directory and a directory listing as arguments
 * rather than reading either, so every rule here is testable without a device
 * and behaves identically on a platform that has no filesystem at all.
 *
 * The records are the only thing that knows a photo exists — nothing else
 * indexes the directory — so the functions that drop records are written to
 * fail closed.
 */
import type { SkinPhoto } from "@/constants/types";

/** The folder inside the document directory that holds the images. */
export const SKIN_DIR_NAME = "skin";

/**
 * The directory the images live in, or null where there is no filesystem.
 *
 * `FileSystem.documentDirectory` is null under react-native-web. Returning
 * null rather than throwing is what lets the Skin section render an
 * explanation there instead of taking the screen down.
 */
export function skinDirectory(documentDirectory: string | null): string | null {
  if (!documentDirectory) return null;
  return `${documentDirectory}${SKIN_DIR_NAME}/`;
}

/**
 * The full path to one image, rebuilt from its stored name.
 *
 * Rebuilt on every read, never persisted: on iOS the documents directory
 * contains a UUID that is regenerated when the app is reinstalled or restored
 * from a device backup, so a stored absolute path is dead afterwards.
 */
export function photoUri(documentDirectory: string | null, file: string): string | null {
  const dir = skinDirectory(documentDirectory);
  return dir ? `${dir}${file}` : null;
}

/**
 * The filename for a new photo.
 *
 * Carries the id as well as the timestamp because two photos can be taken in
 * the same second, and a collision would have one silently overwrite the
 * other. Restricted to path-safe characters so no caller has to escape it.
 */
export function photoFileName(takenAt: string, id: string): string {
  const stamp = takenAt.replace(/[:.]/g, "-");
  const safeId = id.replace(/[^A-Za-z0-9]/g, "");
  return `${stamp}_${safeId}.jpg`;
}

const at = (p: SkinPhoto) => new Date(p.takenAt).getTime();

/**
 * A day's photos, newest first.
 *
 * Compares instants rather than the timestamp strings: an imported photo can
 * carry a UTC offset instead of `Z`, and string order then disagrees with time
 * order, putting the wrong photo at the front.
 */
export function photosOnDate(photos: SkinPhoto[], dateKey: string): SkinPhoto[] {
  return photos.filter(p => p.date === dateKey).sort((a, b) => at(b) - at(a));
}

/** The day's most recent photo — what the calendar shows as its thumbnail. */
export function latestPhotoOnDate(photos: SkinPhoto[], dateKey: string): SkinPhoto | null {
  return photosOnDate(photos, dateKey)[0] ?? null;
}

/** Adds a photo to the front of the library. */
export function addPhoto(photos: SkinPhoto[], photo: SkinPhoto): SkinPhoto[] {
  return [photo, ...photos];
}

/**
 * Removes one photo, naming the file the caller must delete.
 *
 * The file is named rather than deleted here so this stays pure, and it is
 * null for an unknown id: a stale tap must remove nothing rather than take
 * some other photo's file with it.
 */
export function removePhoto(
  photos: SkinPhoto[], id: string,
): { photos: SkinPhoto[]; removedFile: string | null } {
  const target = photos.find(p => p.id === id) ?? null;
  return {
    photos: target ? photos.filter(p => p.id !== id) : photos,
    removedFile: target?.file ?? null,
  };
}

/**
 * Sets or clears one photo's body location.
 *
 * Clearing removes the `location` key entirely rather than storing it as `""`
 * or `undefined` — absent is the untagged state everywhere else in this
 * codebase, and a key present but set to `undefined` still round-trips
 * through JSON as absent on the way out but not on the way in, which is the
 * exact gap this function exists to close.
 *
 * Returns the original array for an unknown id, like `removePhoto`: a stale
 * tap must write nothing rather than persist an unchanged copy of the whole
 * library.
 */
export function setLocation(
  photos: SkinPhoto[], id: string, location: string | undefined,
): SkinPhoto[] {
  const target = photos.find(p => p.id === id);
  if (!target) return photos;
  return photos.map(p => {
    if (p.id !== id) return p;
    const { location: _drop, ...rest } = p;
    return location ? { ...rest, location } : rest;
  });
}

/**
 * Drops records whose image is no longer on disk.
 *
 * `files` is the directory listing, or **null when the directory could not be
 * read**. Those are different facts and conflating them is destructive: an
 * unreadable directory would look like an empty one and take the whole library
 * with it, on a platform with no filesystem or on one transient failure. So
 * null keeps everything.
 *
 * Only ever drops records. It does not delete files it cannot account for — an
 * unrecognised file may belong to a newer build, and nothing here is entitled
 * to assume otherwise.
 *
 * Returns the original array when nothing changed, so a load does not persist
 * a rewrite it did not need.
 */
export function reconcile(photos: SkinPhoto[], files: string[] | null): SkinPhoto[] {
  if (files === null) return photos;
  const present = new Set(files);
  const kept = photos.filter(p => present.has(p.file));
  return kept.length === photos.length ? photos : kept;
}

/**
 * Updates the timestamp and derived date key of a photo.
 *
 * Returns the original array if the id is unknown or the values are unchanged.
 */
export function setPhotoTime(
  photos: SkinPhoto[], id: string, takenAt: string, dateKey: string,
): SkinPhoto[] {
  const target = photos.find(p => p.id === id);
  if (!target || (target.takenAt === takenAt && target.date === dateKey)) return photos;
  return photos.map(p => (p.id === id ? { ...p, takenAt, date: dateKey } : p));
}
