import { describe, it, expect } from "vitest";
import { userRoot, collectionPath, habitLogId, symptomLogId, phaseDocPath, schemaDocPath } from "./paths";

describe("paths", () => {
  it("builds the user root", () => {
    expect(userRoot("u1")).toBe("users/u1");
  });

  it("builds a collection path", () => {
    expect(collectionPath("u1", "consumptionLogs")).toBe("users/u1/consumptionLogs");
  });

  it("builds a collection path for each user-created catalog", () => {
    expect(collectionPath("u1", "bodyLocations")).toBe("users/u1/bodyLocations");
    expect(collectionPath("u1", "cues")).toBe("users/u1/cues");
    expect(collectionPath("u1", "routines")).toBe("users/u1/routines");
    expect(collectionPath("u1", "symptoms")).toBe("users/u1/symptoms");
  });

  it("builds the phase document path", () => {
    expect(phaseDocPath("u1")).toBe("users/u1/meta/phase");
  });

  it("builds the schema document path", () => {
    expect(schemaDocPath("u1")).toBe("users/u1/meta/schema");
  });

  it("builds a deterministic habit log id", () => {
    expect(habitLogId("h1", "2026-08-17")).toBe("h1_2026-08-17");
  });

  it("produces the same habit log id for the same habit and date", () => {
    expect(habitLogId("h1", "2026-08-17")).toBe(habitLogId("h1", "2026-08-17"));
  });

  it("keys a symptom log doc by date alone", () => {
    expect(symptomLogId("2026-08-17")).toBe("2026-08-17");
  });

  it("gives different dates different ids", () => {
    expect(symptomLogId("2026-08-17")).not.toBe(symptomLogId("2026-08-18"));
  });
});
