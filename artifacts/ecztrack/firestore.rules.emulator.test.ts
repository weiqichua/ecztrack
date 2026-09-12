import { describe, it, beforeAll, afterAll, expect } from "vitest";
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import fs from "node:fs";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "rules-test",
    firestore: {
      rules: fs.readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8181,
    },
  });
});

afterAll(async () => { await env.cleanup(); });

describe("firestore rules", () => {
  it("lets a user write their own document", async () => {
    const db = env.authenticatedContext("alice").firestore();
    await assertSucceeds(
      setDoc(doc(db, "users/alice/consumptionLogs/log1"), { item_id: "EGG" })
    );
  });

  it("denies reading another user's document", async () => {
    const db = env.authenticatedContext("bob").firestore();
    await assertFails(getDoc(doc(db, "users/alice/consumptionLogs/log1")));
  });

  it("denies writing another user's document", async () => {
    const db = env.authenticatedContext("bob").firestore();
    await assertFails(
      setDoc(doc(db, "users/alice/consumptionLogs/log2"), { item_id: "EGG" })
    );
  });

  it("denies unauthenticated access entirely", async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "users/alice/consumptionLogs/log1")));
  });

  it("lets a user write to a different nested collection (meta/phase), proving the rule is recursive and not scoped to a single collection name", async () => {
    const db = env.authenticatedContext("alice").firestore();
    await assertSucceeds(
      setDoc(doc(db, "users/alice/meta/phase"), { phase: "elimination" })
    );
  });
});
