# Skin photos and the calendar's detailed view — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Photograph skin, keep the photos on the phone against a day, and add a Calendar view that lists a month day by day with each day's symptom average and photo.

**Architecture:** Photos are a local subsystem: image files under `documentDirectory/skin/`, records in AsyncStorage, deliberately absent from the Firebase backup. Every decision that can be made without a device — filing, reconciliation, averages, month rows — lives in a pure `lib/` module that vitest can import; the screens and the context only move data between those modules and the user.

**Tech Stack:** Expo SDK 54, React Native 0.81, expo-router, TypeScript, AsyncStorage, vitest. New: `expo-image-picker`, `expo-image-manipulator`, `jszip`.

**Spec:** `docs/superpowers/specs/2026-09-01-skin-photos-and-calendar-views-design.md` — read it before Task 1.

## Global Constraints

- `CURRENT_SCHEMA_VERSION` **stays 4**. Raising it fires `runSchemaMigration`, which wipes consumption logs, symptom logs, scratch logs and custom foods. Nothing in this plan changes it, and `SKIN_PHOTOS` must **not** be added to `WIPE_STORAGE_KEYS`.
- Skin photos are **absent from the Firebase backup**: no entry in `Snapshot`, none in `CollectionSpecs`, no converter, no Firestore rule. This is deliberate — see the spec. A task that adds one has misread the design.
- Never create a `*.test.ts` under `app/`. expo-router bundles that directory and `pnpm build` breaks. New tests go in `artifacts/ecztrack/tests/`.
- Never import `context/AppContext.tsx` from a test; it does not parse under vitest. Screens are equally unimportable.
- The app uses `expo-file-system/legacy` (see `app/(tabs)/export.tsx:17`). Match it. Do not mix in the new SDK 54 `File`/`Directory` API.
- **Store a photo's file NAME, never a full path.** The iOS documents directory contains a UUID that changes on reinstall, so a stored absolute path is dead afterwards and every photo breaks at once.
- `FileSystem.documentDirectory` is `null` on react-native-web. Every filesystem helper must tolerate that and return empty rather than throw.
- `Alert.alert` is a no-op on react-native-web. Use `notify` / `confirmDestructive` from `lib/dialogs.ts`.
- Every AppContext mutator is a `useCallback` closed over its current array: derive once, write once. Two writes from one snapshot lose one.
- `"none"` is a real `Phase` member and is not nullish — never `??` over a phase.
- Date keys are `YYYY-MM-DD` from `lib/dates.ts`. Never `.split("T")[0]`.
- New optional fields are written only when present; `defined()` in `lib/repo/converters.ts` strips `undefined`.
- Run from `artifacts/ecztrack`: `pnpm test`, `pnpm typecheck`, `pnpm build`. **There is no lint script** — do not run or report one.
- Every guard added gets a mutation check: break it deliberately, confirm a named test fails, restore.

---

## Task 1: The photo record and the rules around it

Pure module first. No filesystem, no pickers, no UI.

**Files:**
- Modify: `artifacts/ecztrack/constants/types.ts`
- Modify: `artifacts/ecztrack/lib/storageKeys.ts`
- Create: `artifacts/ecztrack/lib/skinPhotos.ts`
- Create: `artifacts/ecztrack/tests/skinPhotos.test.ts`

**Interfaces:**
- Consumes: `generateId` from `lib/ids`.
- Produces, for every later task: `SkinPhoto`; `STORAGE_KEYS.SKIN_PHOTOS`; and from `lib/skinPhotos` — `SKIN_DIR_NAME`, `skinDirectory`, `photoUri`, `photoFileName`, `photosOnDate`, `latestPhotoOnDate`, `addPhoto`, `removePhoto`, `reconcile`.

- [ ] **Step 1: Add the record type**

In `constants/types.ts`, append:

```ts
/**
 * One photograph of skin, filed against a local day.
 *
 * The image itself is a file on this device; this is only the record that
 * describes it. Neither is in the Firebase backup — see the design doc. A
 * photo exists on exactly one phone until it is exported.
 */
export interface SkinPhoto {
  id: string;
  /**
   * The local day the photo belongs to, `YYYY-MM-DD`.
   *
   * Stored rather than derived from `takenAt` for the reason the consumption
   * CSV carries its own `date`: the instant belongs to a UTC day, the app
   * files by local day, and the two disagree for part of every 24 hours.
   */
  date: string;
  /**
   * The file's NAME inside the skin directory — never a full path.
   *
   * On iOS the documents directory contains a UUID that is regenerated when
   * the app is reinstalled or restored, so a stored absolute path points at
   * nothing afterwards and the entire library breaks at once.
   */
  file: string;
  /** ISO timestamp the photo was taken or imported. */
  takenAt: string;
  /**
   * `CatalogItem.id` from the body-locations catalog. Absent means untagged,
   * which is always allowed — the field is for following one area over time,
   * not for making tagging a chore.
   */
  location?: string;
}
```

- [ ] **Step 2: Add the storage key**

In `lib/storageKeys.ts`, add to `STORAGE_KEYS` after `FOOD_TAGS`:

```ts
  SKIN_PHOTOS: "@health_tracker_skin_photos",
```

**Do not add it to `WIPE_STORAGE_KEYS`.** That list is the schema-4 migration's wipe set; a new key has never held seeded data and must not be cleared.

- [ ] **Step 3: Write the failing tests**

Create `tests/skinPhotos.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  SKIN_DIR_NAME, skinDirectory, photoUri, photoFileName,
  photosOnDate, latestPhotoOnDate, addPhoto, removePhoto, reconcile,
} from "@/lib/skinPhotos";
import type { SkinPhoto } from "@/constants/types";

const p = (over: Partial<SkinPhoto>): SkinPhoto => ({
  id: "p1", date: "2026-09-01", file: "a.jpg",
  takenAt: "2026-09-01T08:00:00.000Z", ...over,
});

describe("skinDirectory", () => {
  it("appends the folder to the document directory", () => {
    expect(skinDirectory("file:///docs/")).toBe(`file:///docs/${SKIN_DIR_NAME}/`);
  });

  it("is null when there is no document directory", () => {
    // react-native-web. A screen must not go down because of where it runs.
    expect(skinDirectory(null)).toBeNull();
  });
});

describe("photoUri", () => {
  it("rebuilds the full path from the stored name", () => {
    expect(photoUri("file:///docs/", "a.jpg")).toBe("file:///docs/skin/a.jpg");
  });

  it("is null with no document directory", () => {
    expect(photoUri(null, "a.jpg")).toBeNull();
  });
});

describe("photoFileName", () => {
  it("is unique per photo and keeps the .jpg extension", () => {
    // The id is in the name because two photos can share a second.
    const a = photoFileName("2026-09-01T08:00:00.000Z", "p1");
    const b = photoFileName("2026-09-01T08:00:00.000Z", "p2");
    expect(a).not.toBe(b);
    expect(a.endsWith(".jpg")).toBe(true);
  });

  it("contains no characters that need escaping in a path", () => {
    const name = photoFileName("2026-09-01T08:00:00.000Z", "p1");
    expect(name).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});

describe("photosOnDate", () => {
  it("returns that day's photos, newest first", () => {
    const photos = [
      p({ id: "a", takenAt: "2026-09-01T08:00:00.000Z" }),
      p({ id: "b", takenAt: "2026-09-01T20:00:00.000Z" }),
      p({ id: "c", date: "2026-09-02" }),
    ];
    expect(photosOnDate(photos, "2026-09-01").map(x => x.id)).toEqual(["b", "a"]);
  });

  it("orders by instant, not by string", () => {
    // A retrospective import can carry a +08:00 offset instead of Z.
    const photos = [
      p({ id: "a", takenAt: "2026-09-01T01:00:00.000Z" }),
      p({ id: "b", takenAt: "2026-09-01T08:00:00+08:00" }),
    ];
    expect(photosOnDate(photos, "2026-09-01").map(x => x.id)).toEqual(["a", "b"]);
  });
});

describe("latestPhotoOnDate", () => {
  it("is the newest of the day, or null", () => {
    const photos = [p({ id: "a", takenAt: "2026-09-01T08:00:00.000Z" }),
                    p({ id: "b", takenAt: "2026-09-01T20:00:00.000Z" })];
    expect(latestPhotoOnDate(photos, "2026-09-01")!.id).toBe("b");
    expect(latestPhotoOnDate(photos, "2026-09-05")).toBeNull();
  });
});

describe("addPhoto", () => {
  it("puts the new photo at the front", () => {
    const out = addPhoto([p({ id: "old" })], p({ id: "new" }));
    expect(out.map(x => x.id)).toEqual(["new", "old"]);
  });
});

describe("removePhoto", () => {
  it("drops the record and names the file to delete", () => {
    const out = removePhoto([p({ id: "a", file: "a.jpg" }), p({ id: "b", file: "b.jpg" })], "a");
    expect(out.photos.map(x => x.id)).toEqual(["b"]);
    expect(out.removedFile).toBe("a.jpg");
  });

  it("names no file when the id is unknown", () => {
    // A stale tap must not delete some other photo's file.
    const out = removePhoto([p({ id: "a", file: "a.jpg" })], "gone");
    expect(out.photos).toHaveLength(1);
    expect(out.removedFile).toBeNull();
  });
});

describe("reconcile", () => {
  it("keeps a record whose file is on disk", () => {
    expect(reconcile([p({ file: "a.jpg" })], ["a.jpg"])).toHaveLength(1);
  });

  it("drops a record whose file is gone", () => {
    // What a device-level restore produces: AsyncStorage comes back, the
    // skin directory does not. Without this the gallery fills with tiles
    // that can never be cleared.
    expect(reconcile([p({ file: "a.jpg" })], [])).toHaveLength(0);
  });

  it("keeps everything when the directory could not be read", () => {
    // THE guard. `null` means "could not list", which is not the same fact as
    // "listed, and it was empty". Conflating them deletes the entire library
    // on one transient failure — or on web, where there is no directory at
    // all — and the records are the only thing that knows a photo exists.
    expect(reconcile([p({ file: "a.jpg" })], null)).toHaveLength(1);
  });

  it("returns the same array when nothing changed", () => {
    // So a load does not persist a rewrite it did not need.
    const photos = [p({ file: "a.jpg" })];
    expect(reconcile(photos, ["a.jpg"])).toBe(photos);
  });
});
```

- [ ] **Step 4: Run and watch it fail**

Run: `pnpm test tests/skinPhotos.test.ts`
Expected: FAIL — `Cannot find module '@/lib/skinPhotos'`.

- [ ] **Step 5: Write the module**

Create `lib/skinPhotos.ts`:

```ts
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
```

- [ ] **Step 6: Run the tests**

Run: `pnpm test tests/skinPhotos.test.ts`
Expected: PASS.

- [ ] **Step 7: Mutation-check the guards**

Each MUST make a named test fail. Restore after each; record the outcome.

1. In `reconcile`, delete the `if (files === null) return photos;` line. The "keeps everything when the directory could not be read" test must fail.
2. In `reconcile`, return `kept` unconditionally. The "returns the same array" test must fail.
3. In `removePhoto`, change `removedFile` to `photos.find(...)?.file ?? photos[0]?.file ?? null`. The unknown-id test must fail.
4. In `photosOnDate`, compare `a.takenAt` / `b.takenAt` as strings. The offset-ordering test must fail.
5. In `photoFileName`, drop the id from the name. The uniqueness test must fail.

- [ ] **Step 8: Verify and commit**

Run: `pnpm typecheck && pnpm test`

```bash
git add -A
git commit -m "Describe a skin photo and where its file lives"
```

---

## Task 2: Taking the picture

The device-facing wrapper, kept thin so Task 1's rules stay testable.

**Files:**
- Modify: `artifacts/ecztrack/package.json` (dependencies)
- Modify: `artifacts/ecztrack/app.json` (permission strings)
- Create: `artifacts/ecztrack/lib/photoCapture.ts`

**Interfaces:**
- Consumes: `SKIN_DIR_NAME`, `skinDirectory`, `photoUri`, `photoFileName` from `lib/skinPhotos`.
- Produces: `capturePhoto(source)`, `deletePhotoFile(file)`, `listPhotoFiles()`, `photosSupported()`.

**Why a wrapper:** the picker and the filesystem cannot run under vitest, so everything they touch is confined here and kept free of decisions. Anything in this file that needs a test belongs in `lib/skinPhotos.ts` instead.

- [ ] **Step 1: Install the dependencies**

From `artifacts/ecztrack`:

```bash
npx expo install expo-image-picker expo-image-manipulator
pnpm add jszip
pnpm add -D @types/jszip
```

Use `npx expo install` for the two Expo packages, not `pnpm add` — it resolves the versions matching this SDK, and a mismatched native module fails at runtime rather than at build. `jszip` is not an Expo package and takes `pnpm add`; it is used in Task 5.

If `@types/jszip` reports that jszip ships its own types, skip it and say so in the report.

- [ ] **Step 2: Declare the permission strings**

In `app.json`, add to `expo.plugins` (create the array if absent). iOS refuses the camera without a usage string, and the rejection is silent in some builds:

```json
[
  "expo-image-picker",
  {
    "photosPermission": "Ecztrack uses your photo library so you can add existing pictures of your skin.",
    "cameraPermission": "Ecztrack uses the camera so you can photograph your skin."
  }
]
```

Read the existing `app.json` first and merge rather than overwrite — it already carries `extra.eas.projectId`, the Android package name and the owner, and losing any of them breaks the EAS build.

- [ ] **Step 3: Write the wrapper**

Create `lib/photoCapture.ts`:

```ts
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
```

Note the asymmetry in `listPhotoFiles` and do not "simplify" it: a directory that does not exist yet is genuinely empty (`[]`), while a directory that could not be read is unknown (`null`).

- [ ] **Step 4: Verify and commit**

Run: `pnpm typecheck && pnpm test && pnpm build`

`pnpm build` matters here — it proves the new native modules did not break the web bundle, which is the platform that cannot use them.

```bash
git add -A
git commit -m "Take a photo, shrink it, and put it where it belongs"
```

---

## Task 3: Photos in the app's state

**Files:**
- Modify: `artifacts/ecztrack/context/AppContext.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1 and 2.
- Produces: `skinPhotos: SkinPhoto[]`, `addSkinPhoto(source, dateKey)`, `deleteSkinPhoto(id)`, `setPhotoLocation(id, location)`.

- [ ] **Step 1: Load, reconcile, and expose**

Add to the context interface, beside the other collections:

```ts
  /**
   * Every skin photo on this device. Not in the backup — see the design doc.
   */
  skinPhotos: SkinPhoto[];
  /**
   * Takes or picks a photo and files it against `dateKey`. Returns false when
   * the user backed out or the platform cannot store photos.
   */
  addSkinPhoto: (source: PhotoSource, dateKey: string) => Promise<boolean>;
  deleteSkinPhoto: (id: string) => Promise<void>;
  /** Sets or clears a photo's body location. */
  setPhotoLocation: (id: string, location: string | undefined) => Promise<void>;
```

Add state beside the other collections:

```ts
  const [skinPhotos, setSkinPhotos] = useState<SkinPhoto[]>([]);
```

In the existing load effect, alongside the other `STORAGE_KEYS` reads, load the records and reconcile them against the directory:

```ts
      const rawPhotos = await AsyncStorage.getItem(STORAGE_KEYS.SKIN_PHOTOS);
      const storedPhotos: SkinPhoto[] = rawPhotos ? JSON.parse(rawPhotos) : [];
      // Reconciled against what is actually on disk. `listPhotoFiles` returns
      // null when it could not read the directory, and reconcile then changes
      // nothing — an unreadable directory must never be mistaken for an empty
      // one, or the whole library goes.
      const reconciled = reconcile(storedPhotos, await listPhotoFiles());
      setSkinPhotos(reconciled);
      // Persisted only when reconcile actually dropped something; it returns
      // the same array otherwise, so this is a cheap identity check.
      if (reconciled !== storedPhotos) {
        await persist(STORAGE_KEYS.SKIN_PHOTOS, reconciled);
      }
```

Follow the file's existing load style — read how the other collections are loaded and match it rather than inventing a second shape.

- [ ] **Step 2: The three mutators**

Each derives once and writes once, like every other mutator in this file:

```ts
  const addSkinPhoto = useCallback(async (source: PhotoSource, dateKey: string) => {
    const id = generateId();
    const takenAt = new Date().toISOString();
    const saved = await capturePhoto(source, takenAt, id);
    // Cancelled, or a platform with nowhere to put it. Neither is an error.
    if (!saved) return false;
    const updated = addPhoto(skinPhotos, { id, date: dateKey, file: saved.file, takenAt });
    setSkinPhotos(updated);
    await persist(STORAGE_KEYS.SKIN_PHOTOS, updated);
    return true;
  }, [skinPhotos]);

  const deleteSkinPhoto = useCallback(async (id: string) => {
    const { photos, removedFile } = removePhoto(skinPhotos, id);
    setSkinPhotos(photos);
    await persist(STORAGE_KEYS.SKIN_PHOTOS, photos);
    // After the record, deliberately. A file deleted with the record left
    // behind is a permanently broken tile; a record dropped with the file
    // left behind is reclaimed by the next reconcile.
    if (removedFile) await deletePhotoFile(removedFile);
  }, [skinPhotos]);

  const setPhotoLocation = useCallback(async (id: string, location: string | undefined) => {
    const updated = skinPhotos.map(p => {
      if (p.id !== id) return p;
      // Cleared means the key goes, not that it holds "". Absent is the
      // untagged state everywhere else in this codebase.
      const { location: _drop, ...rest } = p;
      return location ? { ...rest, location } : rest;
    });
    setSkinPhotos(updated);
    await persist(STORAGE_KEYS.SKIN_PHOTOS, updated);
  }, [skinPhotos]);
```

Add all four members to the context value object.

- [ ] **Step 3: Confirm the backup was not touched**

Run:

```bash
grep -n "skinPhotos\|SkinPhoto\|SKIN_PHOTOS" lib/backup.ts lib/repo/converters.ts firestore.rules
```

Expected: no matches. If any appear, remove them — photos are outside the backup by design, and a record that syncs without its file renders as a permanently broken tile on the other device.

- [ ] **Step 4: Verify and commit**

Run: `pnpm typecheck && pnpm test && pnpm build`

```bash
git add -A
git commit -m "Hold the photo library in app state"
```

---

## Task 4: The Skin section on the Overview

**Files:**
- Modify: `artifacts/ecztrack/app/(tabs)/index.tsx`
- Create: `artifacts/ecztrack/components/SkinPhotoViewer.tsx`

**Interfaces:**
- Consumes: `skinPhotos`, `addSkinPhoto`, `deleteSkinPhoto`, `setPhotoLocation` from context; `photosOnDate`, `photoUri` from `lib/skinPhotos`; `photosSupported` from `lib/photoCapture`.

- [ ] **Step 1: The section**

Place a "Skin" section between the Foods section and the Phase section in `app/(tabs)/index.tsx`, matching the surrounding `sectionHeader` pattern exactly.

The strip shows the selected day's photos newest first via `photosOnDate(skinPhotos, selectedDate)`, each a `TouchableOpacity` wrapping an `<Image source={{ uri }} />` where `uri` comes from `photoUri(FileSystem.documentDirectory, photo.file)`. Import `FileSystem` from `expo-file-system/legacy`, as the export screen does.

Two controls in the header when `photosSupported()`: a camera button calling `addSkinPhoto("camera", selectedDate)` and a library button calling `addSkinPhoto("library", selectedDate)`. Both are offered on past days too — a photo taken this morning of yesterday's flare is the ordinary case, and the app already lets a past day's check-in and meals be written.

When `photosSupported()` is false, render no buttons and put one muted line in the empty card: `"Photos are available on the phone app."`

Wrap the calls so a thrown permission message reaches the user:

```tsx
  async function handleAdd(source: PhotoSource) {
    try {
      await addSkinPhoto(source, selectedDate);
    } catch (e) {
      // notify, not Alert.alert — Alert is a no-op on react-native-web.
      notify("Cannot add photo", e instanceof Error ? e.message : String(e));
    }
  }
```

- [ ] **Step 2: The viewer**

Create `components/SkinPhotoViewer.tsx`: a full-screen `Modal` taking `photo: SkinPhoto | null` and `onClose`, showing the image at `resizeMode="contain"`, the time it was taken, a body-location picker over `activeItems(bodyLocations)` (`activeItems` and `itemName` come from `@/constants/catalog`) with a "None" option, and a delete button.

Delete goes through `confirmDestructive` from `lib/dialogs.ts` — "Delete this photo?", "The picture will be removed from this device. This cannot be undone." — and closes the viewer on confirm.

Match `components/ScratchLogEditModal.tsx` for modal structure, and apply the same header padding the whole app uses: `paddingTop: Platform.OS === "web" ? 20 : insets.top + 8`.

- [ ] **Step 3: Verify and commit**

Run: `pnpm typecheck && pnpm test && pnpm build`

```bash
git add -A
git commit -m "Show a day's skin photos on the Overview"
```

---

## Task 5: Getting the photos off the phone

**Files:**
- Modify: `artifacts/ecztrack/app/(tabs)/export.tsx`
- Create: `artifacts/ecztrack/lib/photoArchive.ts`
- Create: `artifacts/ecztrack/tests/photoArchive.test.ts`

**Interfaces:**
- Consumes: `SkinPhoto`; `photoUri` from `lib/skinPhotos`.
- Produces: `ARCHIVE_LIMIT_BYTES`, `archivePlan(photos, sizes)`, `buildManifest(photos)`.

**Why this task exists at all:** photos are outside the backup, so this is the only route off the device. It is part of the feature, not an extra.

- [ ] **Step 1: Write the failing tests**

Create `tests/photoArchive.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { archivePlan, buildManifest, ARCHIVE_LIMIT_BYTES } from "@/lib/photoArchive";
import type { SkinPhoto } from "@/constants/types";

const p = (over: Partial<SkinPhoto>): SkinPhoto => ({
  id: "p1", date: "2026-09-01", file: "a.jpg",
  takenAt: "2026-09-01T08:00:00.000Z", ...over,
});

describe("archivePlan", () => {
  it("includes every photo when the total is under the limit", () => {
    const plan = archivePlan([p({ file: "a.jpg" })], { "a.jpg": 1000 });
    expect(plan.ok).toBe(true);
    expect(plan.files).toEqual(["a.jpg"]);
  });

  it("refuses rather than attempting an archive it cannot hold", () => {
    // jszip builds in memory. Over the limit the honest answer is a message,
    // not an out-of-memory crash the user cannot interpret.
    const plan = archivePlan([p({ file: "a.jpg" })], { "a.jpg": ARCHIVE_LIMIT_BYTES + 1 });
    expect(plan.ok).toBe(false);
    expect(plan.totalBytes).toBeGreaterThan(ARCHIVE_LIMIT_BYTES);
  });

  it("counts a photo whose size is unknown rather than skipping it", () => {
    // An unmeasurable file is not a free one. Treating it as zero is how the
    // limit gets silently exceeded.
    const plan = archivePlan([p({ file: "a.jpg" })], {});
    expect(plan.unsized).toEqual(["a.jpg"]);
  });

  it("is not ok with no photos at all", () => {
    expect(archivePlan([], {}).ok).toBe(false);
  });
});

describe("buildManifest", () => {
  it("is the records verbatim, as parseable JSON", () => {
    const photos = [p({ location: "b1" }), p({ id: "p2", file: "b.jpg" })];
    const parsed = JSON.parse(buildManifest(photos));
    expect(parsed.skin_photos).toHaveLength(2);
    expect(parsed.skin_photos[0].location).toBe("b1");
  });

  it("says which app version wrote it", () => {
    expect(JSON.parse(buildManifest([])).schema_version).toBeDefined();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm test tests/photoArchive.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

Create `lib/photoArchive.ts`:

```ts
/**
 * Deciding what goes into a photo export, apart from doing it.
 *
 * The zip is assembled in memory by jszip, so an archive larger than the
 * JavaScript heap does not fail politely — it takes the app down with no
 * explanation the user can act on. This module makes the size decision where
 * it can be tested, and the screen only carries it out.
 */
import type { SkinPhoto } from "@/constants/types";
import { CURRENT_SCHEMA_VERSION } from "./migrations";

/**
 * The most a single archive may hold, in bytes.
 *
 * A deliberately conservative 400MB: well inside what a modest phone can hold
 * in memory while still covering years of resized photos in one file.
 */
export const ARCHIVE_LIMIT_BYTES = 400 * 1024 * 1024;

export interface ArchivePlan {
  ok: boolean;
  files: string[];
  totalBytes: number;
  /** Files whose size could not be read. Counted, never assumed to be free. */
  unsized: string[];
  reason: string | null;
}

/**
 * What an export would contain, and whether to attempt it.
 *
 * A file whose size is unknown is reported rather than skipped: treating an
 * unmeasurable file as weightless is how the limit gets exceeded quietly, and
 * the crash then looks like the archive worked until it did not.
 */
export function archivePlan(
  photos: SkinPhoto[], sizes: Record<string, number>,
): ArchivePlan {
  const files = photos.map(p => p.file);
  const unsized = files.filter(f => typeof sizes[f] !== "number");
  const totalBytes = files.reduce((sum, f) => sum + (sizes[f] ?? 0), 0);
  if (files.length === 0) {
    return { ok: false, files, totalBytes, unsized, reason: "There are no photos to export." };
  }
  if (totalBytes > ARCHIVE_LIMIT_BYTES) {
    return {
      ok: false, files, totalBytes, unsized,
      reason: "These photos are too large to archive in one file. Delete some, or export from a desktop copy.",
    };
  }
  return { ok: true, files, totalBytes, unsized, reason: null };
}

/** The records that travel with the images, so the archive explains itself. */
export function buildManifest(photos: SkinPhoto[]): string {
  return JSON.stringify({
    exported_at: new Date().toISOString(),
    schema_version: CURRENT_SCHEMA_VERSION,
    note: "Photo files sit beside this manifest. `file` names them.",
    skin_photos: photos,
  }, null, 2);
}
```

- [ ] **Step 4: Run and mutation-check**

Run: `pnpm test tests/photoArchive.test.ts` — expect PASS.

Then, each MUST fail a named test; restore after each:

1. In `archivePlan`, change `unsized` to `[]`. The unknown-size test must fail.
2. Change `totalBytes > ARCHIVE_LIMIT_BYTES` to `>=`… that still passes. Instead remove the limit check entirely — the refusal test must fail.
3. Remove the empty-photos check — the "not ok with no photos" test must fail.

- [ ] **Step 5: Wire the archive into the Export screen**

In `app/(tabs)/export.tsx`, add a photo-archive card below the existing export rows, shown only when `photosSupported()`.

On press: stat each file with `FileSystem.getInfoAsync` to build the `sizes` map, call `archivePlan`, and `notify(...)` the plan's `reason` when it is not ok. Otherwise build the zip:

```ts
    const zip = new JSZip();
    zip.file("photos.json", buildManifest(skinPhotos));
    for (const photo of skinPhotos) {
      const uri = photoUri(FileSystem.documentDirectory, photo.file);
      if (!uri) continue;
      const b64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      zip.file(photo.file, b64, { base64: true });
    }
    const out = await zip.generateAsync({ type: "base64" });
    const target = (FileSystem.cacheDirectory ?? "") + "ecztrack-photos.zip";
    await FileSystem.writeAsStringAsync(target, out, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await Sharing.shareAsync(target, {
      mimeType: "application/zip", dialogTitle: "Export photos",
    });
```

Written to `cacheDirectory`, matching the existing exports — the OS reclaims it, and an archive left in the documents directory would double the storage the photos already occupy.

Report progress by disabling the button while it runs; a large archive takes real seconds and an unresponsive screen reads as a hang.

- [ ] **Step 6: Verify and commit**

Run: `pnpm typecheck && pnpm test && pnpm build`

```bash
git add -A
git commit -m "Let the photos leave the phone as one archive"
```

---

## Task 6: One definition of a day's symptom average

**Files:**
- Create: `artifacts/ecztrack/lib/symptomStats.ts`
- Create: `artifacts/ecztrack/tests/symptomStats.test.ts`
- Modify: `artifacts/ecztrack/lib/exportCsv.ts`

**Interfaces:**
- Produces: `averageScore(scores)` for Task 7 and for `buildSymptomCSV`.

**Why:** the average currently exists only inside `buildSymptomCSV`. The calendar needs the same number, and two implementations of one average will disagree in a way nobody sees.

- [ ] **Step 1: Write the failing tests**

Create `tests/symptomStats.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { averageScore } from "@/lib/symptomStats";

describe("averageScore", () => {
  it("averages the symptoms that were scored", () => {
    expect(averageScore({ a: 2, b: 4 })).toBe(3);
  });

  it("ignores a null rather than counting it as zero", () => {
    // null means the box was shown and left unselected. Counted as a zero it
    // would drag every average down and invent an improvement that never
    // happened — and 0 is not even on the 1-5 scale.
    expect(averageScore({ a: 4, b: null })).toBe(4);
  });

  it("is null when nothing was scored", () => {
    expect(averageScore({ a: null })).toBeNull();
    expect(averageScore({})).toBeNull();
    expect(averageScore(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm test tests/symptomStats.test.ts` — expect module-not-found.

- [ ] **Step 3: Write the module**

Create `lib/symptomStats.ts`:

```ts
/**
 * A day's symptom scores, reduced to one number.
 *
 * Extracted from the CSV exporter so the calendar shows the same figure the
 * export does. Two implementations of one average disagree eventually, and the
 * disagreement is invisible until someone compares a screen against a file.
 */

/**
 * The mean of the symptoms a day actually scored, or null if it scored none.
 *
 * Scores read 1 = no symptoms and 5 = severe, so a rising average is a
 * worsening trend. `null` means the box was shown and left unselected, and it
 * is skipped rather than counted: as a zero it would sit below the scale
 * entirely and manufacture an improvement.
 */
export function averageScore(scores: Record<string, number | null> | undefined): number | null {
  const values = Object.values(scores ?? {}).filter((v): v is number => v != null);
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
```

- [ ] **Step 4: Use it in the exporter**

In `lib/exportCsv.ts`, replace the inline average inside `buildSymptomCSV` with a call to `averageScore`, keeping the existing `.toFixed(3)` formatting and the empty-string-for-no-scores behaviour exactly as they are. The existing export tests must pass unchanged — if any needs editing, the refactor changed behaviour and is wrong.

- [ ] **Step 5: Mutation-check**

Change the filter to `v => v !== undefined` so nulls are counted. The ignores-a-null test must fail, **and** an existing `buildSymptomCSV` test should too — confirming the exporter really routes through this module now. Restore.

- [ ] **Step 6: Verify and commit**

Run: `pnpm typecheck && pnpm test`

```bash
git add -A
git commit -m "Define a day's symptom average once"
```

---

## Task 7: The Calendar's two views

**Files:**
- Create: `artifacts/ecztrack/lib/monthRows.ts`
- Create: `artifacts/ecztrack/tests/monthRows.test.ts`
- Modify: `artifacts/ecztrack/app/(tabs)/calendar.tsx`

**Interfaces:**
- Consumes: `averageScore` (Task 6), `latestPhotoOnDate` / `photoUri` (Task 1), `scoreLevel` from `lib/scoreScale`, `setSelectedDate` from context.
- Produces: `MonthDayRow`, `monthRows(...)`.

**Note on current state:** `MISSED_FILL` was removed from `lib/dayStyle.ts` and the Missed legend entry is gone from the Quick view. Do not reintroduce either. The Quick view is otherwise untouched by this task.

- [ ] **Step 1: Write the failing tests**

Create `tests/monthRows.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { monthRows } from "@/lib/monthRows";
import type { SkinPhoto, SymptomLog } from "@/constants/types";

const TODAY = "2026-09-15";

describe("monthRows", () => {
  it("returns one row per day of the month, in order", () => {
    const rows = monthRows(2026, 8, [], [], TODAY); // month is 0-based: September
    expect(rows).toHaveLength(30);
    expect(rows[0].dateKey).toBe("2026-09-01");
    expect(rows[29].dateKey).toBe("2026-09-30");
  });

  it("handles February in a leap year", () => {
    expect(monthRows(2028, 1, [], [], "2028-02-15")).toHaveLength(29);
  });

  it("carries a day's average and its latest photo", () => {
    const logs: SymptomLog[] = [{ id: "l1", date: "2026-09-02", scores: { a: 4, b: 5 } }];
    const photos: SkinPhoto[] = [
      { id: "p1", date: "2026-09-02", file: "a.jpg", takenAt: "2026-09-02T08:00:00.000Z" },
      { id: "p2", date: "2026-09-02", file: "b.jpg", takenAt: "2026-09-02T20:00:00.000Z" },
    ];
    const row = monthRows(2026, 8, logs, photos, TODAY)[1];
    expect(row.average).toBe(4.5);
    expect(row.photo!.file).toBe("b.jpg");
  });

  it("leaves an unlogged day empty rather than omitting it", () => {
    // A run of blanks says the check-ins stopped, which is a finding. A list
    // that drops them makes three skipped days look like three consecutive
    // ones and misreads a flare's timeline.
    const row = monthRows(2026, 8, [], [], TODAY)[0];
    expect(row.average).toBeNull();
    expect(row.photo).toBeNull();
  });

  it("marks days after today as future", () => {
    const rows = monthRows(2026, 8, [], [], TODAY);
    expect(rows[14].isFuture).toBe(false);  // the 15th is today
    expect(rows[15].isFuture).toBe(true);
  });

  it("ignores a check-in that recorded nothing", () => {
    // Tapping a box and tapping it off again leaves a log with every score
    // null. That is not a check-in, and it must not read as one.
    const logs: SymptomLog[] = [{ id: "l1", date: "2026-09-01", scores: { a: null } }];
    expect(monthRows(2026, 8, logs, [], TODAY)[0].average).toBeNull();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm test tests/monthRows.test.ts` — expect module-not-found.

- [ ] **Step 3: Write the module**

Create `lib/monthRows.ts`:

```ts
/**
 * A month, one row per day.
 *
 * Pure and clock-injected, like lib/phases.ts: the caller passes today, so the
 * answer for a given month cannot change depending on when it is asked.
 *
 * Every day appears, including days with nothing on them. A run of blanks is
 * itself a finding — it says the check-ins stopped — and a list that omits
 * them makes three skipped days indistinguishable from three consecutive ones.
 */
import type { SkinPhoto, SymptomLog } from "@/constants/types";
import { averageScore } from "./symptomStats";
import { latestPhotoOnDate } from "./skinPhotos";

export interface MonthDayRow {
  /** `YYYY-MM-DD`. */
  dateKey: string;
  /** Day of the month, 1-based. */
  day: number;
  /** 0 = Sunday, matching the calendar grid's week order. */
  weekday: number;
  /** The day's mean symptom score, or null if it recorded none. */
  average: number | null;
  /** The day's most recent photo, or null. */
  photo: SkinPhoto | null;
  isFuture: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * `month` is 0-based, matching `Date.getMonth()` and the calendar screen.
 *
 * Day count comes from `new Date(year, month + 1, 0).getDate()`, which is the
 * last day of the month and therefore correct for February in a leap year
 * without anyone hard-coding the rule.
 */
export function monthRows(
  year: number,
  month: number,
  symptomLogs: SymptomLog[],
  photos: SkinPhoto[],
  todayKey: string,
): MonthDayRow[] {
  const days = new Date(year, month + 1, 0).getDate();
  const rows: MonthDayRow[] = [];
  for (let day = 1; day <= days; day++) {
    const dateKey = `${year}-${pad(month + 1)}-${pad(day)}`;
    const log = symptomLogs.find(l => l.date === dateKey);
    rows.push({
      dateKey,
      day,
      weekday: new Date(year, month, day).getDay(),
      // averageScore already returns null when every score is null, which is
      // what an emptied check-in leaves behind.
      average: averageScore(log?.scores),
      photo: latestPhotoOnDate(photos, dateKey),
      // Date keys are YYYY-MM-DD, so a string comparison is a date comparison.
      isFuture: dateKey > todayKey,
    });
  }
  return rows;
}
```

- [ ] **Step 4: Mutation-check**

Each MUST fail a named test; restore after each:

1. Change the day count to a fixed `30`. The February test must fail.
2. Change `isFuture` to `dateKey >= todayKey`. The future test must fail.
3. Make `average` fall back to `0` instead of null. The unlogged-day test must fail.

- [ ] **Step 5: Add the view switch**

In `app/(tabs)/calendar.tsx`, add state:

```tsx
const [view, setView] = useState<"quick" | "detailed">("quick");
```

Render a two-button segmented control directly under the weekday row, above the `ScrollView`, styled like the food logger's category chips. Then render the grid-and-legend block only when `view === "quick"`, and the detailed list only when `view === "detailed"`.

The Quick branch is the existing markup moved unchanged — do not restyle it, and do not touch `handleDayPress` or the day modal it opens.

- [ ] **Step 6: The detailed list**

Derived per render, since this tab mounts once and never unmounts:

```tsx
const rows = monthRows(viewYear, viewMonth, symptomLogs, skinPhotos, todayDateKey);
```

`viewYear` and `viewMonth` are the screen's existing month state (calendar.tsx:50-51) and already drive the Quick grid's arrows, so both views move together. `todayDateKey` comes from `useAppContext()` — do not call `new Date()` here: this tab mounts once and never unmounts, so a value captured at mount is wrong after midnight.

Each row: the weekday abbreviation and day number; the average to one decimal with a colour from `scoreLevel(row.average)`, or a muted em dash when null; and a small square thumbnail from `photoUri(FileSystem.documentDirectory, row.photo.file)` when there is one. A future row renders muted and is not tappable.

Tapping a past or present row opens the Overview at that date:

```tsx
onPress={() => {
  setSelectedDate(row.dateKey);
  router.push("/(tabs)");
}}
```

`setSelectedDate` already exists in `AppContext` and the Overview already reads it — this is why the design needed no new plumbing. Do **not** pass the date as a router param: tabs mount once, so a param-driven jump goes stale and the same day cannot be opened twice.

- [ ] **Step 7: Verify and commit**

Run: `pnpm typecheck && pnpm test && pnpm build`

```bash
git add -A
git commit -m "Give the calendar a detailed month view"
```

---

## Task 8: Say that photos exist

**Files:**
- Modify: `docs/ANALYSING-TRIGGERS.md`
- Modify: `docs/RUNNING.md`

- [ ] **Step 1: The analysis guide**

In `## 0. What you are working with`, add a short subsection: photographs are **not** in the JSON export and not in the Firebase backup. They live on the phone and come out through the Export screen's photo archive as a zip holding the images plus a `photos.json` manifest whose `skin_photos[].file` names each image and whose `date` files it against a local day.

Say plainly what that means for analysis: a photo can be joined to a day's row by `date`, but nothing automated reads the images, and any such work happens off-device on the exported archive.

- [ ] **Step 2: The running guide**

In `docs/RUNNING.md`, add that photo capture is phone-only: the web build has no filesystem, so the Skin section explains itself and offers no add button there. Note that photos are the one thing Backup does not carry, and that the photo archive on the Export screen is the only way to copy them off the device.

- [ ] **Step 3: Verify by reading**

There is no test for a document. Check that every filename and field you named matches `lib/photoArchive.ts` and `constants/types.ts`, and that the local-not-hosted-notebook warning in the analysis guide is still intact.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Tell the docs that photos exist and where they are not"
```

---

## Manual verification after the branch

None of this is reachable from a test — there is no camera and no device here.

Take a photo on today; confirm it appears in the strip and survives closing and reopening the app. Take a second and confirm both show, newest first. Open one, set a body location, close and reopen it to confirm the location stuck; clear the location and confirm it clears rather than storing a blank.

Delete a photo and confirm both the tile and the file go — then force-quit and reopen to confirm it has not returned.

Select a past day on the week strip and add a photo to it; confirm it files under that day and not today.

Open the app in a browser and confirm the Skin section explains itself, offers no add button, and does not crash.

Export the photo archive, open the zip on a computer, and confirm the images are there and `photos.json` names them.

On the Calendar, switch to Detailed: confirm every day of the month is listed including empty ones, that a day you checked in on shows its average in the right colour, that a day with a photo shows a thumbnail, and that tapping a day lands on the Overview showing that same date. Confirm future days are muted and do not respond.

Finally, run a Backup and a Restore and confirm the photos are untouched by both — they are outside it by design, and this is the check that proves it.
