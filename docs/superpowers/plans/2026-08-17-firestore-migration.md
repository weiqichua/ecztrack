# Firestore Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Supabase hand-rolled sync layer in `artifacts/health-tracker` with Firestore as the single source of truth, and remove the Replit dev/hosting workflow.

**Architecture:** Firestore owns all reads, write queueing and conflict resolution; `lib/sync.ts` is deleted rather than ported. AsyncStorage is demoted to a dumb snapshot cache plus write outbox on native only (the JS SDK's persistent cache is browser-only). Data nests under `users/{uid}/…` so one security rule covers everything.

**Tech Stack:** Expo SDK 54 / React Native 0.81, `firebase` JS SDK v12, Firestore + Firebase Auth (email/password) + Firebase Hosting, Vitest, Firebase Emulator Suite.

**Spec:** `docs/superpowers/specs/2026-08-17-firestore-migration-design.md`

## Global Constraints

- Package manager is **pnpm** only. The root `preinstall` hook hard-fails npm and yarn. Always `pnpm --filter @workspace/health-tracker add <pkg>`.
- Typecheck **from the repo root** with `pnpm run typecheck`. This is a composite-project monorepo; running `tsc` inside a package fails if dependencies are not built.
- Firestore documents use domain field names from `constants/types.ts` **verbatim** (`habitId`, `isArchived`, `order`, `is_accident`, `lip_status`, `routine_id`, `item_id`). No snake_case translation layer.
- `habitLogs` document id is always `` `${habitId}_${date}` ``. Never an auto-id.
- Every collection lives under `users/{uid}/`. Nothing at the root.
- Existing record ids are arbitrary strings and must port unchanged. Do not regenerate them.
- Do not delete local AsyncStorage data at any point — it is the rollback path.
- Only `artifacts/health-tracker` and `scripts/` are in scope. Do not touch `api-server`, `lib/db`, `lib/api-*`, or `mockup-sandbox`.
- Commit after every task.

---

### Task 1: Spike — verify Firestore persistence behaviour

**Purpose:** The entire caching layer (Task 7) exists only if the JS SDK really has no durable cache on React Native. Verify before building. **Output is an answer, not code** — throw the probe away.

**Files:**
- Create (throwaway): `artifacts/health-tracker/app/_spike.tsx`

- [ ] **Step 1: Install Firebase**

```bash
pnpm --filter @workspace/health-tracker add firebase
```

- [ ] **Step 2: Create a throwaway probe screen**

Create `artifacts/health-tracker/app/_spike.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Text, View, Platform } from "react-native";
import { initializeApp } from "firebase/app";
import {
  initializeFirestore, persistentLocalCache, memoryLocalCache,
  doc, setDoc, getDocFromCache,
} from "firebase/firestore";

export default function Spike() {
  const [out, setOut] = useState("running…");
  useEffect(() => {
    (async () => {
      const app = initializeApp({ projectId: "spike-probe", apiKey: "x", appId: "x" });
      const lines: string[] = [`platform=${Platform.OS}`];
      try {
        initializeFirestore(app, { localCache: persistentLocalCache({}) });
        lines.push("persistentLocalCache: ACCEPTED");
      } catch (e: any) {
        lines.push(`persistentLocalCache: REJECTED — ${e?.message ?? e}`);
      }
      setOut(lines.join("\n"));
    })();
  }, []);
  return <View style={{ padding: 40 }}><Text style={{ color: "#fff" }}>{out}</Text></View>;
}
```

- [ ] **Step 3: Run on web and read the output**

Run: `pnpm --filter @workspace/health-tracker exec expo start --web`
Navigate to `/_spike`. Expected: `persistentLocalCache: ACCEPTED`.

- [ ] **Step 4: Run on the phone and read the output**

Run: `pnpm --filter @workspace/health-tracker exec expo start`
Open in Expo Go, navigate to `/_spike`. Expected: `REJECTED` (IndexedDB unavailable), confirming native needs the Task 7 cache.

- [ ] **Step 5: Record the finding and delete the probe**

Append the two observed outputs to the spec's "Why the cache is still needed" section, replacing the "MUST be verified" note with the result. Then:

```bash
rm artifacts/health-tracker/app/_spike.tsx
git add docs/superpowers/specs/2026-08-17-firestore-migration-design.md artifacts/health-tracker/package.json pnpm-lock.yaml
git commit -m "chore: add firebase dep; record firestore persistence spike findings"
```

**If native ACCEPTED persistent cache:** Task 7 shrinks to the outbox only, and its snapshot-cache steps are skipped. Note this in the plan before continuing.

---

### Task 2: Test infrastructure

**Files:**
- Create: `artifacts/health-tracker/vitest.config.ts`
- Create: `artifacts/health-tracker/firebase.json`
- Create: `artifacts/health-tracker/.firebaserc`
- Modify: `artifacts/health-tracker/package.json`

**Interfaces:**
- Produces: `pnpm --filter @workspace/health-tracker run test` (unit only) and `run test:emulator` (emulator-backed). All later tasks use these.

- [ ] **Step 1: Install test dependencies**

```bash
pnpm --filter @workspace/health-tracker add -D vitest @firebase/rules-unit-testing firebase-tools
```

- [ ] **Step 2: Write vitest config**

Create `artifacts/health-tracker/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
```

- [ ] **Step 3: Write Firebase project config**

Create `artifacts/health-tracker/firebase.json`:

```json
{
  "firestore": {
    "rules": "firestore.rules"
  },
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }]
  },
  "emulators": {
    "auth": { "port": 9099 },
    "firestore": { "port": 8080 },
    "ui": { "enabled": false }
  }
}
```

Create `artifacts/health-tracker/.firebaserc` (replace `health-tracker-XXXX` with the real project id created in the Firebase console):

```json
{
  "projects": {
    "default": "health-tracker-XXXX"
  }
}
```

- [ ] **Step 4: Add test scripts**

In `artifacts/health-tracker/package.json`, add to `scripts`:

```json
"test": "vitest run",
"test:emulator": "firebase emulators:exec --only firestore,auth \"vitest run\""
```

- [ ] **Step 5: Write a smoke test proving the harness runs**

Create `artifacts/health-tracker/lib/repo/paths.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("test harness", () => {
  it("runs", () => {
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 6: Run it**

Run: `pnpm --filter @workspace/health-tracker run test`
Expected: 1 passed.

- [ ] **Step 7: Commit**

```bash
git add artifacts/health-tracker/vitest.config.ts artifacts/health-tracker/firebase.json artifacts/health-tracker/.firebaserc artifacts/health-tracker/package.json artifacts/health-tracker/lib/repo/paths.test.ts pnpm-lock.yaml
git commit -m "test: add vitest + firebase emulator infrastructure"
```

---

### Task 3: Security rules

**Files:**
- Create: `artifacts/health-tracker/firestore.rules`
- Create: `artifacts/health-tracker/firestore.rules.test.ts`

**Interfaces:**
- Produces: deployed rule set enforcing `request.auth.uid == uid` on `users/{uid}/**`.

- [ ] **Step 1: Write the failing rules test**

Create `artifacts/health-tracker/firestore.rules.test.ts`:

```ts
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
      port: 8080,
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
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @workspace/health-tracker run test:emulator`
Expected: FAIL — `firestore.rules` does not exist (ENOENT).

- [ ] **Step 3: Write the rules**

Create `artifacts/health-tracker/firestore.rules`:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @workspace/health-tracker run test:emulator`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add artifacts/health-tracker/firestore.rules artifacts/health-tracker/firestore.rules.test.ts
git commit -m "feat: add firestore security rules scoping all data to the owning uid"
```

---

### Task 4: Path helpers

**Files:**
- Create: `artifacts/health-tracker/lib/repo/paths.ts`
- Test: `artifacts/health-tracker/lib/repo/paths.test.ts` (replace the smoke test)

**Interfaces:**
- Produces:
  - `userRoot(uid: string): string`
  - `collectionPath(uid: string, name: CollectionName): string`
  - `habitLogId(habitId: string, date: string): string`
  - `phaseDocPath(uid: string): string`
  - `type CollectionName = "consumptionLogs" | "symptomLogs" | "scratchLogs" | "habitDefinitions" | "habitLogs" | "customFoods" | "phaseHistory"`

- [ ] **Step 1: Write the failing test**

Replace `artifacts/health-tracker/lib/repo/paths.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { userRoot, collectionPath, habitLogId, phaseDocPath } from "./paths";

describe("paths", () => {
  it("builds the user root", () => {
    expect(userRoot("u1")).toBe("users/u1");
  });

  it("builds a collection path", () => {
    expect(collectionPath("u1", "consumptionLogs")).toBe("users/u1/consumptionLogs");
  });

  it("builds the phase document path", () => {
    expect(phaseDocPath("u1")).toBe("users/u1/meta/phase");
  });

  it("builds a deterministic habit log id", () => {
    expect(habitLogId("h1", "2026-08-17")).toBe("h1_2026-08-17");
  });

  it("produces the same habit log id for the same habit and date", () => {
    expect(habitLogId("h1", "2026-08-17")).toBe(habitLogId("h1", "2026-08-17"));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @workspace/health-tracker run test`
Expected: FAIL — cannot resolve `./paths`.

- [ ] **Step 3: Implement**

Create `artifacts/health-tracker/lib/repo/paths.ts`:

```ts
export type CollectionName =
  | "consumptionLogs"
  | "symptomLogs"
  | "scratchLogs"
  | "habitDefinitions"
  | "habitLogs"
  | "customFoods"
  | "phaseHistory";

export const COLLECTION_NAMES: CollectionName[] = [
  "consumptionLogs", "symptomLogs", "scratchLogs",
  "habitDefinitions", "habitLogs", "customFoods", "phaseHistory",
];

export function userRoot(uid: string): string {
  return `users/${uid}`;
}

export function collectionPath(uid: string, name: CollectionName): string {
  return `${userRoot(uid)}/${name}`;
}

export function phaseDocPath(uid: string): string {
  return `${userRoot(uid)}/meta/phase`;
}

/** One habit log per habit per day — enforced by the document id itself. */
export function habitLogId(habitId: string, date: string): string {
  return `${habitId}_${date}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @workspace/health-tracker run test`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add artifacts/health-tracker/lib/repo/paths.ts artifacts/health-tracker/lib/repo/paths.test.ts
git commit -m "feat: add firestore path helpers with deterministic habit log ids"
```

---

### Task 5: Firebase initialisation

**Files:**
- Create: `artifacts/health-tracker/lib/firebase.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `getDb(): Firestore`, `getFirebaseAuth(): Auth`, `getApp(): FirebaseApp`.

**Note:** Configure the `localCache` branch according to the Task 1 spike result. The code below assumes native rejected `persistentLocalCache`.

- [ ] **Step 1: Add environment variables**

Create `artifacts/health-tracker/.env.local` (git-ignored; values from the Firebase console → Project settings → Your apps → Web app):

```
EXPO_PUBLIC_FIREBASE_API_KEY=
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=
EXPO_PUBLIC_FIREBASE_PROJECT_ID=
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
EXPO_PUBLIC_FIREBASE_APP_ID=
```

Confirm `.env.local` is covered by `artifacts/health-tracker/.gitignore`; add the line if not.

- [ ] **Step 2: Implement initialisation**

Create `artifacts/health-tracker/lib/firebase.ts`:

```ts
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  initializeFirestore, getFirestore,
  persistentLocalCache, persistentMultipleTabManager, memoryLocalCache,
  type Firestore,
} from "firebase/firestore";
import {
  initializeAuth, getAuth, getReactNativePersistence,
  browserLocalPersistence, type Auth,
} from "firebase/auth";

const config = {
  apiKey:            process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain:        process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const isWeb = Platform.OS === "web";

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;

export function getApp(): FirebaseApp {
  if (!app) app = getApps().length ? getApps()[0] : initializeApp(config);
  return app;
}

export function getDb(): Firestore {
  if (db) return db;
  try {
    db = initializeFirestore(getApp(), {
      // Web: IndexedDB-backed durable cache. Native: memory only —
      // durability is provided by lib/localCache.ts instead.
      localCache: isWeb
        ? persistentLocalCache({ tabManager: persistentMultipleTabManager() })
        : memoryLocalCache(),
      // Expo's networking stack does not reliably support Firestore's
      // default streaming transport.
      ...(isWeb ? {} : { experimentalForceLongPolling: true }),
    });
  } catch {
    // Already initialised (fast refresh).
    db = getFirestore(getApp());
  }
  return db;
}

export function getFirebaseAuth(): Auth {
  if (auth) return auth;
  try {
    auth = initializeAuth(getApp(), {
      persistence: isWeb
        ? browserLocalPersistence
        : getReactNativePersistence(AsyncStorage),
    });
  } catch {
    auth = getAuth(getApp());
  }
  return auth;
}
```

- [ ] **Step 3: Verify it typechecks**

Run: `pnpm run typecheck`
Expected: PASS. If `getReactNativePersistence` is not exported from `firebase/auth` in the installed version, import it from `firebase/auth/react-native` instead and re-run.

- [ ] **Step 4: Commit**

```bash
git add artifacts/health-tracker/lib/firebase.ts artifacts/health-tracker/.gitignore
git commit -m "feat: add firebase app, auth and firestore initialisation"
```

---

### Task 6: Converters

**Files:**
- Create: `artifacts/health-tracker/lib/repo/converters.ts`
- Test: `artifacts/health-tracker/lib/repo/converters.test.ts`

**Interfaces:**
- Consumes: types from `@/constants/types`, `FoodItem` from `@/constants/foodLibrary`.
- Produces, for each entity, a `{ toDoc, fromDoc }` pair:
  - `consumptionLogConverter`, `symptomLogConverter`, `scratchLogConverter`,
    `habitDefinitionConverter`, `habitLogConverter`, `customFoodConverter`,
    `phaseRecordConverter`
  - Each is `{ toDoc(entity): Record<string, unknown>; fromDoc(id: string, data: Record<string, unknown>): Entity }`

- [ ] **Step 1: Write the failing test**

Create `artifacts/health-tracker/lib/repo/converters.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  consumptionLogConverter, habitDefinitionConverter, habitLogConverter,
} from "./converters";
import type { ConsumptionLog, HabitDefinition, HabitLog } from "@/constants/types";

describe("consumptionLogConverter", () => {
  const log: ConsumptionLog = {
    id: "c1", timestamp: "2026-08-17T10:00:00.000Z", item_id: "EGG",
    phase: "elimination", is_challenge: false, is_accident: true,
  };

  it("omits the id from the document body", () => {
    expect(consumptionLogConverter.toDoc(log)).not.toHaveProperty("id");
  });

  it("round-trips without losing fields", () => {
    const doc = consumptionLogConverter.toDoc(log);
    expect(consumptionLogConverter.fromDoc("c1", doc)).toEqual(log);
  });
});

describe("habitDefinitionConverter", () => {
  it("round-trips an optional goal that is absent", () => {
    const def: HabitDefinition = {
      id: "h1", name: "Water", icon: "water", unit: "check",
      order: 0, isArchived: false, updated_at: "2026-08-17T10:00:00.000Z",
    };
    const doc = habitDefinitionConverter.toDoc(def);
    expect(habitDefinitionConverter.fromDoc("h1", doc)).toEqual(def);
  });

  it("never writes undefined, which firestore rejects", () => {
    const def: HabitDefinition = {
      id: "h1", name: "Water", icon: "water", unit: "check",
      order: 0, isArchived: false,
    };
    const doc = habitDefinitionConverter.toDoc(def);
    expect(Object.values(doc).every((v) => v !== undefined)).toBe(true);
  });
});

describe("habitLogConverter", () => {
  it("round-trips", () => {
    const log: HabitLog = { id: "h1_2026-08-17", habitId: "h1", date: "2026-08-17", value: 3 };
    const doc = habitLogConverter.toDoc(log);
    expect(habitLogConverter.fromDoc("h1_2026-08-17", doc)).toEqual(log);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @workspace/health-tracker run test`
Expected: FAIL — cannot resolve `./converters`.

- [ ] **Step 3: Implement**

Create `artifacts/health-tracker/lib/repo/converters.ts`:

```ts
import type {
  ConsumptionLog, SymptomLog, ScratchLog,
  HabitDefinition, HabitLog, PhaseRecord, Phase,
} from "@/constants/types";
import type { FoodItem } from "@/constants/foodLibrary";

export interface Converter<T extends { id: string }> {
  toDoc(entity: T): Record<string, unknown>;
  fromDoc(id: string, data: Record<string, unknown>): T;
}

/** Firestore rejects `undefined` values outright — drop those keys. */
function defined(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

export const consumptionLogConverter: Converter<ConsumptionLog> = {
  toDoc: ({ id, ...rest }) => defined({ ...rest }),
  fromDoc: (id, d) => ({
    id,
    timestamp: d.timestamp as string,
    item_id: d.item_id as string,
    phase: d.phase as Phase,
    is_challenge: Boolean(d.is_challenge),
    is_accident: Boolean(d.is_accident),
  }),
};

export const symptomLogConverter: Converter<SymptomLog> = {
  toDoc: ({ id, ...rest }) => defined({ ...rest }),
  fromDoc: (id, d) => ({
    id,
    date: d.date as string,
    type: d.type as "Morning" | "Evening",
    phase: d.phase as Phase | undefined,
    reflux: d.reflux as number,
    redness: d.redness as number,
    heat: d.heat as number,
    itch: d.itch as number,
    lip_status: d.lip_status as number,
  }),
};

export const scratchLogConverter: Converter<ScratchLog> = {
  toDoc: ({ id, ...rest }) => defined({ ...rest }),
  fromDoc: (id, d) => ({
    id,
    timestamp: d.timestamp as string,
    phase: d.phase as Phase,
    location: d.location as string,
    cue: d.cue as string,
    routine_id: d.routine_id as string,
    success: d.success as 1 | 2 | 3 | 4,
    is_accident: Boolean(d.is_accident),
  }),
};

export const habitDefinitionConverter: Converter<HabitDefinition> = {
  toDoc: ({ id, ...rest }) => defined({ ...rest }),
  fromDoc: (id, d) => {
    const def: HabitDefinition = {
      id,
      name: d.name as string,
      icon: d.icon as string,
      unit: d.unit as "check" | "count",
      order: (d.order as number) ?? 0,
      isArchived: Boolean(d.isArchived),
    };
    if (d.goal !== undefined) def.goal = d.goal as number;
    if (d.updated_at !== undefined) def.updated_at = d.updated_at as string;
    return def;
  },
};

export const habitLogConverter: Converter<HabitLog> = {
  toDoc: ({ id, ...rest }) => defined({ ...rest }),
  fromDoc: (id, d) => ({
    id,
    habitId: d.habitId as string,
    date: d.date as string,
    value: d.value as number,
  }),
};

export const customFoodConverter: Converter<FoodItem> = {
  toDoc: ({ id, ...rest }) => defined({ ...rest }),
  fromDoc: (id, d) => ({ id, ...d } as FoodItem),
};

export const phaseRecordConverter: Converter<PhaseRecord & { id: string }> = {
  toDoc: ({ id, ...rest }) => defined({ ...rest }),
  fromDoc: (id, d) => ({
    id,
    type: d.type as Phase,
    startDate: d.startDate as string,
    endDate: (d.endDate as string | null) ?? null,
    durationDays: (d.durationDays as number | null) ?? null,
  }),
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @workspace/health-tracker run test`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add artifacts/health-tracker/lib/repo/converters.ts artifacts/health-tracker/lib/repo/converters.test.ts
git commit -m "feat: add firestore document converters for all entities"
```

---

### Task 7: Mutations

**Files:**
- Create: `artifacts/health-tracker/lib/repo/mutations.ts`
- Test: `artifacts/health-tracker/lib/repo/mutations.test.ts`

**Interfaces:**
- Consumes: `getDb` (Task 5), `collectionPath`/`habitLogId`/`phaseDocPath` (Task 4), converters (Task 6).
- Produces:
  - `newId(): string`
  - `putConsumptionLog(uid, log: ConsumptionLog): Promise<void>` (and equivalents for symptom, scratch, habitDefinition, customFood)
  - `putHabitLog(uid, habitId: string, date: string, value: number): Promise<void>`
  - `removeDoc(uid, name: CollectionName, id: string): Promise<void>`
  - `removeHabitDefinitionCascade(uid, habitId: string): Promise<void>`
  - `putCurrentPhase(uid, current: PhaseRecord): Promise<void>`
  - `appendPhaseHistory(uid, record: PhaseRecord): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `artifacts/health-tracker/lib/repo/mutations.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { initializeApp, deleteApp, type FirebaseApp } from "firebase/app";
import {
  initializeFirestore, connectFirestoreEmulator, getDocs, collection,
  doc, getDoc, type Firestore,
} from "firebase/firestore";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

let app: FirebaseApp;
let db: Firestore;

beforeAll(() => {
  app = initializeApp({ projectId: "mutations-test" }, "mutations-test");
  db = initializeFirestore(app, {});
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
});

describe("putHabitLog", () => {
  it("writes to a deterministic document id", async () => {
    const { putHabitLog } = await import("./mutations");
    await putHabitLog("u1", "h1", "2026-08-17", 2, db);
    const snap = await getDoc(doc(db, "users/u1/habitLogs/h1_2026-08-17"));
    expect(snap.exists()).toBe(true);
    expect(snap.data()?.value).toBe(2);
  });

  it("overwrites rather than duplicating on a second write", async () => {
    const { putHabitLog } = await import("./mutations");
    await putHabitLog("u2", "h1", "2026-08-17", 1, db);
    await putHabitLog("u2", "h1", "2026-08-17", 5, db);
    const all = await getDocs(collection(db, "users/u2/habitLogs"));
    expect(all.size).toBe(1);
    expect(all.docs[0].data().value).toBe(5);
  });
});

describe("removeDoc", () => {
  it("actually removes the document", async () => {
    const { putHabitLog, removeDoc } = await import("./mutations");
    await putHabitLog("u3", "h1", "2026-08-17", 1, db);
    await removeDoc("u3", "habitLogs", "h1_2026-08-17", db);
    const snap = await getDoc(doc(db, "users/u3/habitLogs/h1_2026-08-17"));
    expect(snap.exists()).toBe(false);
  });
});

describe("removeHabitDefinitionCascade", () => {
  it("removes the definition and every log belonging to it", async () => {
    const { putHabitDefinition, putHabitLog, removeHabitDefinitionCascade } =
      await import("./mutations");
    await putHabitDefinition("u4", {
      id: "h1", name: "Water", icon: "water", unit: "check",
      order: 0, isArchived: false,
    }, db);
    await putHabitLog("u4", "h1", "2026-08-17", 1, db);
    await putHabitLog("u4", "h1", "2026-08-18", 1, db);
    await putHabitLog("u4", "h2", "2026-08-17", 1, db);

    await removeHabitDefinitionCascade("u4", "h1", db);

    const defs = await getDocs(collection(db, "users/u4/habitDefinitions"));
    const logs = await getDocs(collection(db, "users/u4/habitLogs"));
    expect(defs.size).toBe(0);
    expect(logs.size).toBe(1);
    expect(logs.docs[0].data().habitId).toBe("h2");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @workspace/health-tracker run test:emulator`
Expected: FAIL — cannot resolve `./mutations`.

- [ ] **Step 3: Implement**

Create `artifacts/health-tracker/lib/repo/mutations.ts`. Every function takes an optional trailing `Firestore` so tests can inject an emulator instance:

```ts
import {
  doc, setDoc, deleteDoc, collection, getDocs, query, where, writeBatch,
  type Firestore,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { collectionPath, habitLogId, phaseDocPath, type CollectionName } from "./paths";
import {
  consumptionLogConverter, symptomLogConverter, scratchLogConverter,
  habitDefinitionConverter, habitLogConverter, customFoodConverter,
  phaseRecordConverter,
} from "./converters";
import type {
  ConsumptionLog, SymptomLog, ScratchLog,
  HabitDefinition, HabitLog, PhaseRecord,
} from "@/constants/types";
import type { FoodItem } from "@/constants/foodLibrary";

/** Replaces AppContext's generateId(); collision-safe across devices. */
export function newId(): string {
  return doc(collection(getDb(), "ids")).id;
}

function db_(injected?: Firestore): Firestore {
  return injected ?? getDb();
}

export async function putConsumptionLog(uid: string, log: ConsumptionLog, d?: Firestore) {
  await setDoc(doc(db_(d), collectionPath(uid, "consumptionLogs"), log.id),
    consumptionLogConverter.toDoc(log));
}

export async function putSymptomLog(uid: string, log: SymptomLog, d?: Firestore) {
  await setDoc(doc(db_(d), collectionPath(uid, "symptomLogs"), log.id),
    symptomLogConverter.toDoc(log));
}

export async function putScratchLog(uid: string, log: ScratchLog, d?: Firestore) {
  await setDoc(doc(db_(d), collectionPath(uid, "scratchLogs"), log.id),
    scratchLogConverter.toDoc(log));
}

export async function putHabitDefinition(uid: string, def: HabitDefinition, d?: Firestore) {
  await setDoc(doc(db_(d), collectionPath(uid, "habitDefinitions"), def.id),
    habitDefinitionConverter.toDoc(def));
}

export async function putCustomFood(uid: string, food: FoodItem, d?: Firestore) {
  await setDoc(doc(db_(d), collectionPath(uid, "customFoods"), food.id),
    customFoodConverter.toDoc(food));
}

export async function putHabitLog(
  uid: string, habitId: string, date: string, value: number, d?: Firestore
) {
  const id = habitLogId(habitId, date);
  const log: HabitLog = { id, habitId, date, value };
  await setDoc(doc(db_(d), collectionPath(uid, "habitLogs"), id),
    habitLogConverter.toDoc(log));
}

export async function removeDoc(
  uid: string, name: CollectionName, id: string, d?: Firestore
) {
  await deleteDoc(doc(db_(d), collectionPath(uid, name), id));
}

/** Deleting a habit must delete its logs, or they are orphaned forever. */
export async function removeHabitDefinitionCascade(
  uid: string, habitId: string, d?: Firestore
) {
  const database = db_(d);
  const logs = await getDocs(query(
    collection(database, collectionPath(uid, "habitLogs")),
    where("habitId", "==", habitId)
  ));
  const batch = writeBatch(database);
  batch.delete(doc(database, collectionPath(uid, "habitDefinitions"), habitId));
  logs.forEach((l) => batch.delete(l.ref));
  await batch.commit();
}

export async function putCurrentPhase(uid: string, current: PhaseRecord, d?: Firestore) {
  await setDoc(doc(db_(d), phaseDocPath(uid)), {
    current: phaseRecordConverter.toDoc({ ...current, id: "current" }),
    updatedAt: new Date().toISOString(),
  });
}

export async function appendPhaseHistory(uid: string, record: PhaseRecord, d?: Firestore) {
  const id = newId();
  await setDoc(doc(db_(d), collectionPath(uid, "phaseHistory"), id),
    phaseRecordConverter.toDoc({ ...record, id }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @workspace/health-tracker run test:emulator`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add artifacts/health-tracker/lib/repo/mutations.ts artifacts/health-tracker/lib/repo/mutations.test.ts
git commit -m "feat: add firestore mutations with cascading habit deletion"
```

---

### Task 8: Subscriptions

**Files:**
- Create: `artifacts/health-tracker/lib/repo/subscriptions.ts`
- Test: `artifacts/health-tracker/lib/repo/subscriptions.test.ts`

**Interfaces:**
- Consumes: `getDb`, `collectionPath`, `phaseDocPath`, converters.
- Produces:
  - `subscribeCollection<T>(uid, name: CollectionName, converter: Converter<T>, cb: (rows: T[]) => void, d?: Firestore): Unsubscribe`
  - `subscribeCurrentPhase(uid, cb: (current: PhaseRecord | null) => void, d?: Firestore): Unsubscribe`

- [ ] **Step 1: Write the failing test**

Create `artifacts/health-tracker/lib/repo/subscriptions.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { initializeApp, type FirebaseApp } from "firebase/app";
import { initializeFirestore, connectFirestoreEmulator, type Firestore } from "firebase/firestore";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

let app: FirebaseApp;
let db: Firestore;

beforeAll(() => {
  app = initializeApp({ projectId: "subs-test" }, "subs-test");
  db = initializeFirestore(app, {});
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
});

/** Resolves on the first callback whose rows satisfy `predicate`. */
function nextMatching<T>(
  subscribe: (cb: (rows: T[]) => void) => () => void,
  predicate: (rows: T[]) => boolean,
): Promise<T[]> {
  return new Promise((resolve) => {
    const unsub = subscribe((rows) => {
      if (predicate(rows)) { unsub(); resolve(rows); }
    });
  });
}

describe("subscribeCollection", () => {
  it("emits added documents", async () => {
    const { subscribeCollection } = await import("./subscriptions");
    const { putHabitLog } = await import("./mutations");
    const { habitLogConverter } = await import("./converters");

    const pending = nextMatching<any>(
      (cb) => subscribeCollection("s1", "habitLogs", habitLogConverter, cb, db),
      (rows) => rows.length === 1,
    );
    await putHabitLog("s1", "h1", "2026-08-17", 4, db);
    const rows = await pending;
    expect(rows[0].value).toBe(4);
  });

  it("emits removals so a delete propagates instead of resurrecting", async () => {
    const { subscribeCollection } = await import("./subscriptions");
    const { putHabitLog, removeDoc } = await import("./mutations");
    const { habitLogConverter } = await import("./converters");

    await putHabitLog("s2", "h1", "2026-08-17", 4, db);
    const pending = nextMatching<any>(
      (cb) => subscribeCollection("s2", "habitLogs", habitLogConverter, cb, db),
      (rows) => rows.length === 0,
    );
    await removeDoc("s2", "habitLogs", "h1_2026-08-17", db);
    expect(await pending).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @workspace/health-tracker run test:emulator`
Expected: FAIL — cannot resolve `./subscriptions`.

- [ ] **Step 3: Implement**

Create `artifacts/health-tracker/lib/repo/subscriptions.ts`:

```ts
import {
  collection, doc, onSnapshot, type Firestore, type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { collectionPath, phaseDocPath, type CollectionName } from "./paths";
import type { Converter } from "./converters";
import { phaseRecordConverter } from "./converters";
import type { PhaseRecord } from "@/constants/types";

function db_(injected?: Firestore): Firestore {
  return injected ?? getDb();
}

export function subscribeCollection<T extends { id: string }>(
  uid: string,
  name: CollectionName,
  converter: Converter<T>,
  cb: (rows: T[]) => void,
  d?: Firestore,
): Unsubscribe {
  return onSnapshot(
    collection(db_(d), collectionPath(uid, name)),
    (snap) => cb(snap.docs.map((s) => converter.fromDoc(s.id, s.data()))),
    (err) => console.error(`subscribe ${name} failed:`, err),
  );
}

export function subscribeCurrentPhase(
  uid: string,
  cb: (current: PhaseRecord | null) => void,
  d?: Firestore,
): Unsubscribe {
  return onSnapshot(
    doc(db_(d), phaseDocPath(uid)),
    (snap) => {
      const data = snap.data();
      if (!data?.current) return cb(null);
      const { id, ...rest } = phaseRecordConverter.fromDoc(
        "current", data.current as Record<string, unknown>
      );
      cb(rest);
    },
    (err) => console.error("subscribe phase failed:", err),
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @workspace/health-tracker run test:emulator`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add artifacts/health-tracker/lib/repo/subscriptions.ts artifacts/health-tracker/lib/repo/subscriptions.test.ts
git commit -m "feat: add firestore collection and phase subscriptions"
```

---

### Task 9: Local cache and outbox (native only)

**Skip this task entirely if the Task 1 spike showed native accepts `persistentLocalCache`.**

**Files:**
- Create: `artifacts/health-tracker/lib/localCache.ts`
- Test: `artifacts/health-tracker/lib/localCache.test.ts`

**Interfaces:**
- Produces:
  - `readCache<T>(name: string): Promise<T[] | null>`
  - `writeCache<T>(name: string, rows: T[]): Promise<void>`
  - `enqueue(op: OutboxOp): Promise<void>`
  - `drain(run: (op: OutboxOp) => Promise<void>): Promise<void>`
  - `type OutboxOp = { kind: "put" | "remove"; collection: string; id: string; data?: Record<string, unknown> }`

- [ ] **Step 1: Write the failing test**

Create `artifacts/health-tracker/lib/localCache.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const store = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => { store.set(k, v); },
    removeItem: async (k: string) => { store.delete(k); },
  },
}));

beforeEach(() => store.clear());

describe("snapshot cache", () => {
  it("returns null before anything is cached", async () => {
    const { readCache } = await import("./localCache");
    expect(await readCache("habitLogs")).toBeNull();
  });

  it("round-trips rows", async () => {
    const { readCache, writeCache } = await import("./localCache");
    await writeCache("habitLogs", [{ id: "a", value: 1 }]);
    expect(await readCache("habitLogs")).toEqual([{ id: "a", value: 1 }]);
  });

  it("replaces wholesale rather than merging", async () => {
    const { readCache, writeCache } = await import("./localCache");
    await writeCache("habitLogs", [{ id: "a" }, { id: "b" }]);
    await writeCache("habitLogs", [{ id: "b" }]);
    expect(await readCache("habitLogs")).toEqual([{ id: "b" }]);
  });
});

describe("outbox", () => {
  it("replays queued operations in order", async () => {
    const { enqueue, drain } = await import("./localCache");
    await enqueue({ kind: "put", collection: "habitLogs", id: "a", data: { value: 1 } });
    await enqueue({ kind: "remove", collection: "habitLogs", id: "b" });
    const seen: string[] = [];
    await drain(async (op) => { seen.push(`${op.kind}:${op.id}`); });
    expect(seen).toEqual(["put:a", "remove:b"]);
  });

  it("clears operations that succeed", async () => {
    const { enqueue, drain } = await import("./localCache");
    await enqueue({ kind: "put", collection: "habitLogs", id: "a", data: {} });
    await drain(async () => {});
    const seen: string[] = [];
    await drain(async (op) => { seen.push(op.id); });
    expect(seen).toEqual([]);
  });

  it("keeps operations that fail so they retry later", async () => {
    const { enqueue, drain } = await import("./localCache");
    await enqueue({ kind: "put", collection: "habitLogs", id: "a", data: {} });
    await drain(async () => { throw new Error("offline"); });
    const seen: string[] = [];
    await drain(async (op) => { seen.push(op.id); });
    expect(seen).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @workspace/health-tracker run test`
Expected: FAIL — cannot resolve `./localCache`.

- [ ] **Step 3: Implement**

Create `artifacts/health-tracker/lib/localCache.ts`:

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";

const CACHE_PREFIX = "@ht_cache_";
const OUTBOX_KEY = "@ht_outbox";

export interface OutboxOp {
  kind: "put" | "remove";
  collection: string;
  id: string;
  data?: Record<string, unknown>;
}

/**
 * Snapshot cache. Firestore snapshots replace this wholesale — it is never
 * merged with server data, so it can go stale but cannot go wrong.
 */
export async function readCache<T>(name: string): Promise<T[] | null> {
  const raw = await AsyncStorage.getItem(CACHE_PREFIX + name);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T[];
  } catch {
    return null;
  }
}

export async function writeCache<T>(name: string, rows: T[]): Promise<void> {
  await AsyncStorage.setItem(CACHE_PREFIX + name, JSON.stringify(rows));
}

async function readOutbox(): Promise<OutboxOp[]> {
  const raw = await AsyncStorage.getItem(OUTBOX_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as OutboxOp[];
  } catch {
    return [];
  }
}

export async function enqueue(op: OutboxOp): Promise<void> {
  const ops = await readOutbox();
  ops.push(op);
  await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(ops));
}

/**
 * Replay pending writes in order. Operations that succeed are dropped;
 * the first failure stops the drain and everything from it onward is kept,
 * preserving ordering for the next attempt.
 */
export async function drain(run: (op: OutboxOp) => Promise<void>): Promise<void> {
  const ops = await readOutbox();
  let i = 0;
  for (; i < ops.length; i++) {
    try {
      await run(ops[i]);
    } catch {
      break;
    }
  }
  await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(ops.slice(i)));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @workspace/health-tracker run test`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add artifacts/health-tracker/lib/localCache.ts artifacts/health-tracker/lib/localCache.test.ts
git commit -m "feat: add native snapshot cache and durable write outbox"
```

---

### Task 10: Sign-in screen and auth gate

**Files:**
- Create: `artifacts/health-tracker/app/sign-in.tsx`
- Create: `artifacts/health-tracker/hooks/useAuthUser.ts`
- Modify: `artifacts/health-tracker/app/_layout.tsx`

**Interfaces:**
- Consumes: `getFirebaseAuth` (Task 5).
- Produces: `useAuthUser(): { user: User | null; initialising: boolean }`.

- [ ] **Step 1: Create the auth hook**

Create `artifacts/health-tracker/hooks/useAuthUser.ts`:

```ts
import { useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase";

export function useAuthUser() {
  const [user, setUser] = useState<User | null>(null);
  const [initialising, setInitialising] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(getFirebaseAuth(), (u) => {
      setUser(u);
      setInitialising(false);
    });
  }, []);

  return { user, initialising };
}
```

- [ ] **Step 2: Create the sign-in screen**

Create `artifacts/health-tracker/app/sign-in.tsx`. Match the existing dark theme by pulling colours from `useColors()` as the other screens do:

```tsx
import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { signInWithEmailAndPassword } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase";
import { useColors } from "@/hooks/useColors";

export default function SignIn() {
  const colors = useColors();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.wrap, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>Health Tracker</Text>
      <TextInput
        style={[styles.input, { color: colors.text, borderColor: colors.border }]}
        placeholder="Email"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={[styles.input, { color: colors.text, borderColor: colors.border }]}
        placeholder="Password"
        placeholderTextColor={colors.textMuted}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      {error ? <Text style={{ color: colors.destructive }}>{error}</Text> : null}
      <TouchableOpacity
        style={[styles.btn, { backgroundColor: colors.primary }]}
        onPress={submit}
        disabled={busy}
      >
        <Text style={styles.btnText}>{busy ? "Signing in…" : "Sign in"}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "center", padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: "600", marginBottom: 12 },
  input: { borderWidth: 1, borderRadius: 8, padding: 14, fontSize: 16, minHeight: 44 },
  btn: { borderRadius: 8, padding: 14, alignItems: "center", minHeight: 44 },
  btnText: { color: "#000", fontSize: 16, fontWeight: "600" },
});
```

Verify the colour keys used here (`background`, `text`, `textMuted`, `border`, `primary`, `destructive`) exist in `constants/colors.ts`; substitute the actual names if they differ.

- [ ] **Step 3: Gate the app on auth in `_layout.tsx`**

In `artifacts/health-tracker/app/_layout.tsx`, render `<SignIn />` when `useAuthUser()` returns no user, and a blank view while `initialising` is true. `AppProvider` must only mount once a user exists, since every subscription needs the uid.

- [ ] **Step 4: Create the account and verify sign-in works**

In the Firebase console: Authentication → Sign-in method → enable Email/Password, then Users → Add user with your email and a password.

Run: `pnpm --filter @workspace/health-tracker exec expo start --web`
Expected: sign-in screen renders; correct credentials proceed to the app; wrong credentials show an error.

- [ ] **Step 5: Commit**

```bash
git add artifacts/health-tracker/app/sign-in.tsx artifacts/health-tracker/hooks/useAuthUser.ts artifacts/health-tracker/app/_layout.tsx
git commit -m "feat: add email/password sign-in and auth gate"
```

---

### Task 11: Rewrite AppContext

This is the largest task. `AppContext` keeps its **exact public interface** — every screen and modal consumes it and none of them should need changing — while its internals switch from AsyncStorage-plus-merge to subscriptions-plus-mutations.

**Files:**
- Modify: `artifacts/health-tracker/context/AppContext.tsx` (full rewrite of internals)

**Interfaces:**
- Consumes: `subscribeCollection`, `subscribeCurrentPhase` (Task 8); all mutation functions (Task 7); `readCache`/`writeCache`/`enqueue`/`drain` (Task 9); `useAuthUser` (Task 10).
- Produces: the same `AppContextValue` shape, minus the sync-specific members.

- [ ] **Step 1: Change the context interface**

Remove from `AppContextValue`: `syncUserId`, `setSyncUserId`, `syncNow`, `syncStatus`, `syncError`, `lastSyncedAt`. Firestore syncs continuously; there is nothing to trigger.

Keep every data field and every `add*`/`delete*`/`save*` method signature **byte-for-byte identical** so no screen changes.

- [ ] **Step 2: Replace load-and-sync with subscriptions**

Delete the entire mount effect (`AppContext.tsx:153-234`) — the background-sync race in bug 1 — and the `applyMerged` function (`:128-150`). Replace with one effect per collection:

```tsx
const { user } = useAuthUser();
const uid = user?.uid ?? null;

useEffect(() => {
  if (!uid) return;
  const unsubs = [
    subscribeCollection(uid, "consumptionLogs", consumptionLogConverter, (rows) => {
      setConsumptionLogs(rows);
      void writeCache("consumptionLogs", rows);
    }),
    subscribeCollection(uid, "symptomLogs", symptomLogConverter, (rows) => {
      setSymptomLogs(rows);
      void writeCache("symptomLogs", rows);
    }),
    subscribeCollection(uid, "scratchLogs", scratchLogConverter, (rows) => {
      setScratchLogs(rows);
      void writeCache("scratchLogs", rows);
    }),
    subscribeCollection(uid, "habitDefinitions", habitDefinitionConverter, (rows) => {
      setHabitDefinitions([...rows].sort((a, b) => a.order - b.order));
      void writeCache("habitDefinitions", rows);
    }),
    subscribeCollection(uid, "habitLogs", habitLogConverter, (rows) => {
      setHabitLogs(rows);
      void writeCache("habitLogs", rows);
    }),
    subscribeCollection(uid, "customFoods", customFoodConverter, (rows) => {
      setCustomFoods(rows);
      void writeCache("customFoods", rows);
    }),
    subscribeCollection(uid, "phaseHistory", phaseRecordConverter, (rows) => {
      setPhaseHistory(rows);
      void writeCache("phaseHistory", rows);
    }),
    subscribeCurrentPhase(uid, (current) => {
      if (current) setCurrentPhaseRecord(current);
      setIsLoaded(true);
    }),
  ];
  return () => unsubs.forEach((u) => u());
}, [uid]);
```

- [ ] **Step 3: Hydrate from cache on mount**

Before subscriptions attach, populate state from the snapshot cache so a cold offline start renders instantly:

```tsx
useEffect(() => {
  (async () => {
    const [c, s, scr, hd, hl, cf, ph] = await Promise.all([
      readCache<ConsumptionLog>("consumptionLogs"),
      readCache<SymptomLog>("symptomLogs"),
      readCache<ScratchLog>("scratchLogs"),
      readCache<HabitDefinition>("habitDefinitions"),
      readCache<HabitLog>("habitLogs"),
      readCache<FoodItem>("customFoods"),
      readCache<PhaseRecord & { id: string }>("phaseHistory"),
    ]);
    if (c) setConsumptionLogs(c);
    if (s) setSymptomLogs(s);
    if (scr) setScratchLogs(scr);
    if (hd) setHabitDefinitions(hd);
    if (hl) setHabitLogs(hl);
    if (cf) setCustomFoods(cf);
    if (ph) setPhaseHistory(ph);
    setIsLoaded(true);
  })();
}, []);
```

The subscription callbacks overwrite this wholesale when they fire. That precedence — snapshot always wins, never merges — is the fix for bug 1.

- [ ] **Step 4: Rewrite mutations as fire-and-forget writes**

Each `add*`/`delete*` becomes a single call. Do **not** call `setState` — the subscription echoes the change back, including Firestore's local optimistic update, so the UI still updates instantly. Example:

```tsx
const addConsumptionLog = useCallback(async (
  itemId: string,
  opts: { isChallenge?: boolean; isAccident?: boolean; timestamp?: string } = {}
) => {
  if (!uid) return;
  const ts = opts.timestamp ?? new Date().toISOString();
  const log: ConsumptionLog = {
    id: newId(),
    timestamp: ts,
    item_id: itemId,
    phase: getPhaseOnDate(ts.split("T")[0], phaseConfig),
    is_challenge: opts.isChallenge ?? false,
    is_accident: opts.isAccident ?? false,
  };
  await putConsumptionLog(uid, log);
}, [uid, phaseConfig]);

const deleteConsumptionLog = useCallback(async (id: string) => {
  if (!uid) return;
  await removeDoc(uid, "consumptionLogs", id);
}, [uid]);
```

Apply the same shape to symptom logs, scratch logs, custom foods and habit definitions. `deleteHabitDefinition` calls `removeHabitDefinitionCascade` — this is the fix for the orphaned-logs half of bug 5. `setHabitLog` calls `putHabitLog` when `value > 0` and `removeDoc(uid, "habitLogs", habitLogId(habitId, date))` when `value <= 0` — the other half of bug 5. Delete `trackDelete` and all `pendingDeletes` state entirely.

- [ ] **Step 5: Rebuild phaseConfig from its two sources**

`phaseConfig` is no longer stored; derive it so every consumer is unchanged:

```tsx
const phaseConfig: PhaseConfig = useMemo(() => ({
  current: currentPhaseRecord,
  history: [...phaseHistory].sort((a, b) => a.startDate.localeCompare(b.startDate)),
}), [currentPhaseRecord, phaseHistory]);
```

`startPhase` and `abortElimination` now do two writes — `appendPhaseHistory(uid, closedCurrent)` then `putCurrentPhase(uid, newCurrent)`. `updatePhaseEndDate` writes only `putCurrentPhase`.

- [ ] **Step 6: Migrate device-local custom foods once**

Custom foods have never been synced, so they exist only in AsyncStorage. On first authenticated launch, copy them up:

```tsx
useEffect(() => {
  if (!uid) return;
  (async () => {
    const done = await AsyncStorage.getItem("@ht_custom_foods_migrated");
    if (done) return;
    const raw = await AsyncStorage.getItem("@health_tracker_custom_foods");
    if (raw) {
      const foods: FoodItem[] = JSON.parse(raw);
      await Promise.all(foods.map((f) => putCustomFood(uid, f)));
    }
    await AsyncStorage.setItem("@ht_custom_foods_migrated", "1");
  })();
}, [uid]);
```

The original key is left in place as the rollback path.

- [ ] **Step 7: Typecheck and fix every consumer that referenced removed members**

Run: `pnpm run typecheck`
Expected: errors only where `syncNow`/`syncStatus`/`syncError`/`syncUserId`/`lastSyncedAt` were consumed. Fix each: delete `components/SyncButton.tsx` and remove its usages from the screens that render it, and remove the sync-id text field and last-synced display from `app/(tabs)/export.tsx`. Re-run until clean.

- [ ] **Step 8: Verify the reported bugs manually**

Run: `pnpm --filter @workspace/health-tracker exec expo start --web` in one browser and a second browser window signed in as the same user.

Verify each:
1. Add a food log in window A → appears in window B without a manual sync.
2. Delete it in B → disappears in A and **stays** deleted after reloading both.
3. Add a custom food in A → it is selectable in B.
4. Toggle a habit off in A → it stays off in B and after reload.
5. Delete a habit definition → its logs are gone too.
6. Hard-reload A immediately after adding an item → the item is still there.

- [ ] **Step 9: Commit**

```bash
git add artifacts/health-tracker/context/AppContext.tsx artifacts/health-tracker/app artifacts/health-tracker/components
git commit -m "feat: rewrite AppContext on firestore subscriptions, removing the manual sync layer"
```

---

### Task 12: Migrate existing Supabase data

**Files:**
- Create: `scripts/src/migrate-to-firestore.ts`
- Test: `scripts/src/migrate-to-firestore.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (standalone Node script using firebase-admin).
- Produces: `migrate(rows: SupabaseExport, uid: string, db: Firestore): Promise<void>` plus a CLI entry point.

> **MANDATORY — date-key recomputation (added 2026-08-17, user-approved).**
> A codebase-wide review found the app mixes UTC-derived date strings
> (`toISOString().split("T")[0]`) with local-derived ones
> (`getFullYear()/getMonth()/getDate()`) for the same "which day" concept. The
> fix is a single local-date convention. That switch **re-buckets existing
> data**: every `symptom_logs.date` and `habit_logs.date` already stored was
> written under the UTC convention, so any entry logged between local midnight
> and the UTC offset (00:00–08:00 for a UTC+8 user) is filed one day early.
>
> This import is the agreed moment to correct it. `transform` MUST recompute
> each date key from the row's own timestamp **in local time**, not copy the
> stored `date` column verbatim. Where a row has no timestamp of its own,
> state the fallback explicitly in the report rather than guessing.
>
> Add a test asserting that a row whose timestamp is 02:00 local on day N —
> stored under day N-1 by the old UTC convention — imports under day N.
> See `.superpowers/sdd/2026-08-17-firestore-migration/bugreview-*.md`.

- [ ] **Step 1: Install dependencies**

```bash
pnpm --filter @workspace/scripts add firebase-admin @supabase/supabase-js
pnpm --filter @workspace/scripts add -D vitest
```

- [ ] **Step 2: Write the failing test**

Create `scripts/src/migrate-to-firestore.test.ts`. It exercises the pure transform, not the network:

```ts
import { describe, it, expect } from "vitest";
import { transform } from "./migrate-to-firestore";

describe("transform", () => {
  it("maps habit definition columns to domain field names", () => {
    const out = transform({
      consumption_logs: [], symptom_logs: [], scratch_logs: [],
      habit_definitions: [{
        id: "h1", name: "Water", icon: "water", unit: "check",
        goal: null, sort_order: 2, is_archived: false,
        updated_at: "2026-08-01T00:00:00.000Z",
      }],
      habit_logs: [], phase_config: null,
    });
    expect(out.habitDefinitions[0]).toEqual({
      id: "h1", name: "Water", icon: "water", unit: "check",
      order: 2, isArchived: false, updated_at: "2026-08-01T00:00:00.000Z",
    });
  });

  it("gives habit logs deterministic ids", () => {
    const out = transform({
      consumption_logs: [], symptom_logs: [], scratch_logs: [],
      habit_definitions: [],
      habit_logs: [{ id: "old", habit_id: "h1", date: "2026-08-17", value: 3 }],
      phase_config: null,
    });
    expect(out.habitLogs[0].id).toBe("h1_2026-08-17");
  });

  it("splits the phase config blob into current plus history", () => {
    const out = transform({
      consumption_logs: [], symptom_logs: [], scratch_logs: [],
      habit_definitions: [], habit_logs: [],
      phase_config: {
        current: { type: "elimination", startDate: "2026-08-01T00:00:00.000Z", endDate: null, durationDays: 14 },
        history: [{ type: "maintenance", startDate: "2026-07-01T00:00:00.000Z", endDate: "2026-07-31T00:00:00.000Z", durationDays: null }],
      },
    });
    expect(out.currentPhase?.type).toBe("elimination");
    expect(out.phaseHistory).toHaveLength(1);
    expect(out.phaseHistory[0].type).toBe("maintenance");
  });

  it("tolerates a missing phase config", () => {
    const out = transform({
      consumption_logs: [], symptom_logs: [], scratch_logs: [],
      habit_definitions: [], habit_logs: [], phase_config: null,
    });
    expect(out.currentPhase).toBeNull();
    expect(out.phaseHistory).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @workspace/scripts exec vitest run`
Expected: FAIL — cannot resolve `./migrate-to-firestore`.

- [ ] **Step 4: Implement the transform and the CLI**

Create `scripts/src/migrate-to-firestore.ts` exporting a pure `transform(rows)` returning
`{ consumptionLogs, symptomLogs, scratchLogs, habitDefinitions, habitLogs, currentPhase, phaseHistory }`,
mapping `sort_order → order`, `is_archived → isArchived`, `habit_id → habitId`,
`goal: null → omitted`, and habit log ids to `` `${habit_id}_${date}` ``.

Then a `main()` that reads `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_USER_ID`,
`FIREBASE_UID` and `GOOGLE_APPLICATION_CREDENTIALS` from the environment, selects all
six tables filtered by `user_id`, calls `transform`, and writes each collection to
`users/{FIREBASE_UID}/…` via `firebase-admin` batched writes (chunk at 500 operations,
the Firestore batch limit). Custom foods are **not** included — they were never in
Supabase and are handled by Task 11 Step 6.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @workspace/scripts exec vitest run`
Expected: 4 passed.

- [ ] **Step 6: Dry-run against the emulator, then run for real**

```bash
cd artifacts/health-tracker && firebase emulators:start --only firestore &
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 pnpm --filter @workspace/scripts exec tsx src/migrate-to-firestore.ts
```

Confirm counts per collection match the Supabase row counts, then re-run without
`FIRESTORE_EMULATOR_HOST` against the real project. Sign in on the app and confirm
your history is present.

- [ ] **Step 7: Commit**

```bash
git add scripts/src/migrate-to-firestore.ts scripts/src/migrate-to-firestore.test.ts scripts/package.json pnpm-lock.yaml
git commit -m "feat: add one-time supabase to firestore migration script"
```

---

### Task 13: Remove Supabase

**Files:**
- Delete: `artifacts/health-tracker/lib/sync.ts`, `artifacts/health-tracker/lib/supabase.ts`
- Modify: `artifacts/health-tracker/package.json`

- [ ] **Step 1: Confirm nothing imports them**

Run: `grep -rn "lib/sync\|lib/supabase\|@supabase" artifacts/health-tracker --include="*.ts" --include="*.tsx" | grep -v node_modules`
Expected: no output.

- [ ] **Step 2: Delete the files and the dependency**

```bash
rm artifacts/health-tracker/lib/sync.ts artifacts/health-tracker/lib/supabase.ts
pnpm --filter @workspace/health-tracker remove @supabase/supabase-js
```

- [ ] **Step 3: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A artifacts/health-tracker
git commit -m "refactor: remove supabase client and hand-rolled sync layer"
```

---

### Task 14: Remove the Replit workflow

**Files:**
- Modify: `artifacts/health-tracker/package.json:7`, `artifacts/health-tracker/app.json:27`, `artifacts/health-tracker/scripts/build.js:58-71`
- Delete: `artifacts/health-tracker/server/`, `artifacts/health-tracker/.replit-artifact/`

- [ ] **Step 1: Simplify the dev script**

In `artifacts/health-tracker/package.json`, replace the `dev` script with:

```json
"dev": "expo start"
```

- [ ] **Step 2: Fix the expo-router origin**

In `artifacts/health-tracker/app.json`, change the `expo-router` plugin's `origin` from `"https://replit.com/"` to your Firebase Hosting URL (`https://<project-id>.web.app`).

- [ ] **Step 3: Replace the web build script**

The Replit-specific manifest server and landing page are obsolete — Firebase Hosting serves the static export directly.

```bash
rm -rf artifacts/health-tracker/server artifacts/health-tracker/.replit-artifact
```

In `package.json`, replace the `build` and `serve` scripts with:

```json
"build": "expo export --platform web --output-dir dist",
"deploy": "pnpm run build && firebase deploy --only hosting"
```

Delete `artifacts/health-tracker/scripts/build.js` if nothing else references it
(`grep -rn "scripts/build.js" artifacts/health-tracker`).

- [ ] **Step 4: Verify local dev still works on both clients**

Run: `pnpm --filter @workspace/health-tracker run dev`
Expected: web opens and the phone connects over LAN via Expo Go.

- [ ] **Step 5: Commit**

```bash
git add -A artifacts/health-tracker
git commit -m "chore: remove replit dev and hosting workflow"
```

---

### Task 15: Deploy

- [ ] **Step 1: Deploy the security rules**

```bash
cd artifacts/health-tracker && firebase deploy --only firestore:rules
```

- [ ] **Step 2: Verify the rules are live**

In the Firebase console → Firestore → Rules, confirm the deployed rules match `firestore.rules`.

- [ ] **Step 3: Build and deploy the web client**

```bash
pnpm --filter @workspace/health-tracker run deploy
```

- [ ] **Step 4: Verify end to end**

Open the hosted URL, sign in, confirm your migrated history is present, add an item, and confirm it appears on the phone.

- [ ] **Step 5: Update project documentation**

In `replit.md`, replace the health-tracker section's AsyncStorage/Supabase description with the Firestore model, the new scripts (`dev`, `build`, `deploy`, `test`, `test:emulator`), and the removal of the Replit workflow. Consider renaming the file, since it no longer describes a Replit project.

- [ ] **Step 6: Commit**

```bash
git add replit.md
git commit -m "docs: update project documentation for the firestore migration"
```

---

## Self-Review Notes

**Spec coverage:** every spec section maps to a task — data model (4, 6), rules (3), init (5), cache rationale (1, 9), file structure (4–11), migration (11 step 6, 12), testing (2), Replit removal (14), hosting (15).

**Known risks:**
- Task 1 is a genuine spike; a native `ACCEPTED` result makes Task 9 mostly unnecessary and simplifies Task 11 steps 2–3.
- `getReactNativePersistence` has moved between `firebase/auth` and `firebase/auth/react-native` across major versions — Task 5 step 3 handles both.
- Task 11 is large by necessity: the subscription rewrite and the mutation rewrite cannot land separately without leaving the app in a state where writes go to Firestore but reads come from AsyncStorage.
