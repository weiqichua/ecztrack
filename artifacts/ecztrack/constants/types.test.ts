import { describe, it, expect } from "vitest";
import { mergeScores } from "./types";


describe("mergeScores", () => {
  it("keeps the score of a symptom the incoming map does not mention", () => {
    // The bug this exists to stop: the check-in screen can only offer the
    // symptoms currently in the catalog, so a plain overwrite silently deleted
    // an archived symptom's score on every re-save.
    const stored = { s_itch: 4, s_archived: 2 };
    expect(mergeScores(stored, { s_itch: 5 })).toEqual({ s_itch: 5, s_archived: 2 });
  });

  it("lets the incoming score win where both have one", () => {
    expect(mergeScores({ s_itch: 1 }, { s_itch: 5 })).toEqual({ s_itch: 5 });
  });

  it("adds a symptom the stored log has never seen", () => {
    expect(mergeScores({ s_itch: 4 }, { s_new: 3 })).toEqual({ s_itch: 4, s_new: 3 });
  });

  it("treats a missing stored map as empty rather than throwing", () => {
    expect(mergeScores(undefined, { s_itch: 3 })).toEqual({ s_itch: 3 });
  });

  it("treats a malformed stored map as empty rather than throwing", () => {
    // Whatever is on disk, a screen must not go down reading it.
    expect(mergeScores("nonsense" as any, { s_itch: 3 })).toEqual({ s_itch: 3 });
    expect(mergeScores(null as any, {})).toEqual({});
  });

  it("an explicit null in the incoming map clears a previously recorded score", () => {
    // Un-selecting a box sends { [id]: null }, not an omitted key — omitting
    // the key would be indistinguishable from "this screen never showed it."
    expect(mergeScores({ s_itch: 4 }, { s_itch: null })).toEqual({ s_itch: null });
  });

  it("leaves a null score alone when the incoming map omits it", () => {
    expect(mergeScores({ s_itch: null, s_heat: 2 }, { s_heat: 3 })).toEqual({ s_itch: null, s_heat: 3 });
  });

  it("does not mutate either argument", () => {
    const stored = { s_itch: 4 };
    const incoming = { s_heat: 2 };
    mergeScores(stored, incoming);
    expect(stored).toEqual({ s_itch: 4 });
    expect(incoming).toEqual({ s_heat: 2 });
  });
});
