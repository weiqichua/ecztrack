import { describe, it, expect } from "vitest";
import { stamp, mergeByRecency } from "./recency";

interface Rec { id: string; name: string; updated_at?: string }
const rec = (name: string, updated_at?: string): Rec => ({ id: "x1", name, updated_at });

describe("stamp", () => {
  it("writes a fresh ISO timestamp", () => {
    const before = new Date().toISOString();
    const out = stamp(rec("Water"));
    expect(out.updated_at! >= before).toBe(true);
    expect(Number.isNaN(Date.parse(out.updated_at!))).toBe(false);
  });

  it("replaces an older timestamp rather than keeping it", () => {
    expect(stamp(rec("Water", "2020-01-01T00:00:00.000Z")).updated_at).not.toBe("2020-01-01T00:00:00.000Z");
  });

  it("does not mutate the input", () => {
    const original = rec("Water");
    stamp(original);
    expect(original.updated_at).toBeUndefined();
  });
});

describe("mergeByRecency", () => {
  const merge = (local: Rec[], remote: Rec[]) => mergeByRecency(local, remote);

  it("adopts a genuinely newer remote record", () => {
    const merged = merge([rec("Older", "2026-01-01T00:00:00.000Z")], [rec("Newer", "2026-06-01T00:00:00.000Z")]);
    expect(merged[0].name).toBe("Newer");
  });

  it("keeps local when the remote copy is older", () => {
    const merged = merge([rec("Newer", "2026-06-01T00:00:00.000Z")], [rec("Older", "2026-01-01T00:00:00.000Z")]);
    expect(merged[0].name).toBe("Newer");
  });

  it("keeps local when only the remote carries a timestamp", () => {
    // Regression: `(r.updated_at ?? "") > (l.updated_at ?? "")` made "" sort
    // before every real timestamp, so a local record predating the field lost
    // to ANY remote copy — including a much older edit.
    const merged = merge([rec("Local")], [rec("Stale remote", "2020-01-01T00:00:00.000Z")]);
    expect(merged[0].name).toBe("Local");
  });

  it("keeps local when neither side carries a timestamp", () => {
    expect(merge([rec("Local")], [rec("Remote")])[0].name).toBe("Local");
  });

  it("keeps local when only the local carries a timestamp", () => {
    expect(merge([rec("Local", "2020-01-01T00:00:00.000Z")], [rec("Remote")])[0].name).toBe("Local");
  });

  it("keeps local on an exact timestamp tie", () => {
    const at = "2026-06-01T00:00:00.000Z";
    expect(merge([rec("Local", at)], [rec("Remote", at)])[0].name).toBe("Local");
  });

  it("is union-only — neither side can delete the other's records", () => {
    const merged = merge([{ id: "a", name: "A" }], [{ id: "b", name: "B" }]);
    expect(merged.map(r => r.id).sort()).toEqual(["a", "b"]);
  });

  it("is idempotent", () => {
    const local = [rec("Local", "2026-06-01T00:00:00.000Z")];
    const remote = [rec("Remote", "2026-01-01T00:00:00.000Z")];
    expect(mergeByRecency(merge(local, remote), remote)).toEqual(merge(local, remote));
  });
});
