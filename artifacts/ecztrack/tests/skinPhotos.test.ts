import { describe, it, expect } from "vitest";
import {
  SKIN_DIR_NAME, skinDirectory, photoUri, photoFileName,
  photosOnDate, latestPhotoOnDate, addPhoto, removePhoto, setLocation, reconcile,
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

describe("setLocation", () => {
  it("sets a location", () => {
    const out = setLocation([p({ id: "a" })], "a", "arm");
    expect(out[0].location).toBe("arm");
  });

  it("clearing removes the key entirely, not just its value", () => {
    // toBeUndefined() would also pass for a key present and set to
    // undefined, which is the exact bug this rule exists to prevent — a
    // stored "location": undefined round-trips differently through JSON
    // than an absent key on the way back in.
    const out = setLocation([p({ id: "a", location: "arm" })], "a", undefined);
    expect("location" in out[0]).toBe(false);
  });

  it("returns the same array reference for an unknown id", () => {
    // A stale tap must write nothing rather than persist an unchanged copy.
    const photos = [p({ id: "a", location: "arm" })];
    expect(setLocation(photos, "gone", "leg")).toBe(photos);
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

  it("ignores a file in the listing that no record claims", () => {
    // The spec requires a test that fails if reconciliation ever starts
    // deleting files rather than only records. `reconcile`'s signature makes
    // that structurally impossible — it takes a listing and returns records,
    // never a file path to remove — but nothing in the suite said so
    // explicitly. An untracked extra file must survive untouched: the
    // records come back unchanged, and reconcile reports nothing about it.
    const photos = [p({ file: "a.jpg" })];
    expect(reconcile(photos, ["a.jpg", "untracked.jpg"])).toBe(photos);
  });
});
