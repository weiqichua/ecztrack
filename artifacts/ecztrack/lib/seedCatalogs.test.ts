import { describe, it, expect } from "vitest";
import { seedIfUnwritten } from "./seedCatalogs";
import type { CatalogItem } from "@/constants/catalog";

describe("seedIfUnwritten", () => {
  const seed: CatalogItem[] = [{ id: "a", name: "A", order: 0, isArchived: false }];

  it("seeds when the key has never been written", () => {
    expect(seedIfUnwritten(null, seed)).toEqual(seed);
  });

  it("does NOT seed over a stored empty list", () => {
    // The distinction the whole feature rests on. A user who deleted every tag
    // has an empty ARRAY stored; refilling it on next launch would undo their
    // deletions every time they opened the app.
    expect(seedIfUnwritten("[]", seed)).toEqual([]);
  });

  it("returns what is stored when there is something", () => {
    expect(seedIfUnwritten('[{"id":"z","name":"Z","order":0,"isArchived":false}]', seed))
      .toEqual([{ id: "z", name: "Z", order: 0, isArchived: false }]);
  });

  it("seeds rather than throwing on unparseable storage", () => {
    expect(seedIfUnwritten("{not json", seed)).toEqual(seed);
  });
});
