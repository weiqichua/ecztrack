# Firestore Migration — Design

**Date:** 2026-08-17
**Status:** Approved
**Scope:** `artifacts/health-tracker`

## Goal

Replace the Supabase-backed hand-rolled sync layer with Firestore, eliminating a
class of data-loss bugs by making Firestore the single source of truth. Remove
the Replit development and hosting workflow in the same pass.

## Motivation — bugs in the current design

The app is local-first on AsyncStorage with a full-table push/pull/merge sync in
`lib/sync.ts`. Every reported symptom traces to that merge layer.

| # | Symptom | Cause |
|---|---------|-------|
| 1 | Newly added items vanish on app start | `AppContext.tsx:211-227` fires a background sync against a snapshot of just-loaded data, then `applyMerged` overwrites state *and* AsyncStorage. Writes made while it is in flight are clobbered. |
| 2 | Deleted items reappear | `sync.ts:141-150` `mergeById` unions local and remote with no tombstones. Device B re-upserts a row device A deleted. |
| 3 | Deletes silently dropped | `AppContext.tsx:224` and `:437` call `applyMerged(merged, [])`, wiping the pending-delete queue unconditionally. `trackDelete` (`:275-280`) also reads a stale closure, losing one of two same-tick deletes. |
| 4 | Custom foods never sync | Absent from `SyncPayload` (`sync.ts:16-24`). Consumption logs referencing `custom_*` ids render as unknown foods on the other device. |
| 5 | Un-checking a habit undoes itself | `AppContext.tsx:397-398` deletes the log locally without a tombstone; the next pull restores it. `deleteHabitDefinition` (`:387-389`) prunes child logs the same way. |

Secondary issues folded into this work:

- **Errors swallowed.** Deletes (`sync.ts:43-47`), the `phase_configs` upsert
  (`:116`), and all six selects (`:127-138`) never check `error`. A failed read
  becomes `data: null → ?? [] →` "remote is empty", and the merge proceeds.
- **No trust boundary.** `lib/supabase.ts` uses the anon key; rows are scoped
  only by `syncUserId`, a client-generated string in a user-editable text field
  (`AppContext.tsx:461`). Health data is readable by anyone with the anon key
  and an id.
- **Fresh device always wins.** `phaseConfigUpdatedAt` defaults to `now` when
  absent (`AppContext.tsx:184`), so a reinstall beats the server's config.
- **Unbounded payload.** Every sync pushes every row ever created; `synced_at`
  is written but never used as a cursor.
- **`generateId()`** (`AppContext.tsx:28`) is not a UUID and uses deprecated
  `substr`.

The root cause is architectural: **AsyncStorage and the server are peers
reconciled by hand.** Porting that model to Firestore would carry every bug
across. This design removes the model.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Approach | Rebuild sync on Firestore | Firestore owns reads, queueing, conflict resolution. `lib/sync.ts` is deleted, not ported. |
| SDK | `firebase` JS SDK (v12) on both clients | `@react-native-firebase` has no web support, so it would mean two SDKs regardless, plus an EAS dev build. |
| Auth | Firebase Email/Password, one account | Single user. Anonymous auth mints a different UID per device and cannot tie phone to browser. |
| Clients | Expo phone (Expo Go) + web browser | Both offline-capable; genuine concurrent edits possible. |
| Dev/deploy | Local `expo start` + Firebase Hosting | Same vendor as Firestore, one CLI. Replit removed. |

## Architecture

AsyncStorage stays, but strictly demoted:

| | Before | After |
|---|---|---|
| Source of truth | AsyncStorage | Firestore |
| AsyncStorage's role | Full mirror, merge participant | Dumb snapshot cache + write outbox |
| Merge/conflict logic | ~250 lines in `lib/sync.ts` | None — Firestore owns it |
| Precedence rule | Union of local + remote | Firestore snapshot replaces cache wholesale |

The cache never merges. It can go stale; it cannot go wrong.

### Why the cache is still needed

The Firebase JS SDK's `persistentLocalCache` is IndexedDB-backed and therefore
**browser-only**. On React Native the SDK falls back to a memory cache, which
means both:

- offline writes are lost if the app is killed, and
- **a cold start with no network renders an empty app** — a regression against
  today's instant AsyncStorage-first load.

So on native only, the app keeps:

- a **snapshot cache** — every Firestore snapshot is written to AsyncStorage;
  cold start hydrates state from it immediately, and the first snapshot (cache
  or server) replaces it wholesale.
- an **outbox** — pending mutations persisted before dispatch, cleared on
  acknowledgement, replayed on launch.

On web, `persistentLocalCache` does both jobs and the module is a no-op.

**This behaviour is assumed from documentation and MUST be verified empirically
before the caching layer is built** (Task 1 of the plan is a spike).

### Data model

```
users/{uid}/
  consumptionLogs/{autoId}
  symptomLogs/{autoId}
  scratchLogs/{autoId}
  habitDefinitions/{autoId}
  habitLogs/{habitId}_{date}     ← deterministic id
  customFoods/{autoId}           ← newly synced
  phaseHistory/{autoId}          ← was an array inside a blob
  meta/phase                     ← { current: PhaseRecord, updatedAt }
```

Three deliberate choices:

**Deletes are real deletes.** No tombstone collection, no `pendingDeletes`.
Firestore listeners deliver a `removed` change to the other client. Bugs 2, 3
and 5 become inexpressible — there is no union-merge left to resurrect a row.

**`habitLogs` uses a deterministic id, `{habitId}_{date}`.** "One log per habit
per day" is an invariant currently enforced by an array search
(`AppContext.tsx:395`), which two devices can both pass, creating duplicates. As
a document id it is structurally impossible.

**`phaseHistory` is a subcollection, not an array.** Closing a phase on the
phone and on the browser both append. As one document under per-field
last-write-wins, one append is silently lost; as separate documents both land.
`meta/phase` holds only `current`, which has a single writer in practice.

### Security rules

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

### Field naming

Firestore documents use the domain-model field names from `constants/types.ts`
verbatim (`habitId`, `isArchived`, `order`, `is_accident`, …). The
snake_case/camelCase translation layer in `sync.ts:87-112` and `:199-231` exists
only because of the Postgres schema and is deleted with it. Existing string ids
port unchanged.

## File structure

**Create**

| File | Responsibility |
|---|---|
| `lib/firebase.ts` | App/auth/Firestore init, platform-conditional persistence |
| `lib/repo/paths.ts` | Typed collection/document path helpers |
| `lib/repo/converters.ts` | Pure Firestore↔domain converters |
| `lib/repo/subscriptions.ts` | `onSnapshot` wrappers per collection |
| `lib/repo/mutations.ts` | Write/delete functions per entity |
| `lib/localCache.ts` | Snapshot cache + outbox (no-op on web) |
| `app/sign-in.tsx` | Email/password sign-in screen |
| `firestore.rules`, `firebase.json`, `.firebaserc` | Firebase project config |
| `scripts/src/migrate-to-firestore.ts` | One-time Supabase→Firestore import |

**Modify**

| File | Change |
|---|---|
| `context/AppContext.tsx` | Rewritten: subscriptions in, direct mutations out, no merge |
| `app/_layout.tsx` | Auth gate |
| `app.json` | `expo-router` origin off `replit.com` |
| `package.json` | Firebase deps in, Supabase out; de-Replit `dev` script |
| `scripts/build.js` | Drop `REPLIT_*` domain resolution |

**Delete**

`lib/sync.ts`, `lib/supabase.ts`, `server/serve.js`,
`server/templates/landing-page.html`, `.replit-artifact/artifact.toml`

## Data migration

Supabase currently holds a superset of any single device's data (both clients
push everything). A one-time Node script reads all six tables for the existing
`user_id` and writes them to `users/{uid}/…` in Firestore, mapping snake_case
columns to domain field names and splitting `phase_configs.config` into
`meta/phase` plus `phaseHistory` documents.

Local AsyncStorage data is **left untouched** as a rollback path. Custom foods
exist only on-device (never synced) and are migrated from AsyncStorage by the
app on first authenticated launch, guarded by a one-shot flag.

## Testing

The monorepo has no test infrastructure; this work establishes it with Vitest
plus the Firebase emulator suite.

| Layer | Approach |
|---|---|
| Security rules | `@firebase/rules-unit-testing` — cross-user reads/writes denied, own-user allowed |
| Converters, path helpers | Pure unit tests, no emulator |
| Mutations, subscriptions | Against the Firestore emulator |
| Outbox / snapshot cache | Unit tests with a mocked AsyncStorage |
| Migration script | Against the emulator with fixture rows |

React Native component testing is explicitly out of scope — high setup cost,
low value for a single-user app.

## Out of scope

- Removing the unused `api-server` / `lib/db` / `lib/api-*` half of the
  monorepo. `health-tracker` imports nothing from `@workspace/*`, so this is
  dead weight, but it is unrelated to the migration.
- Multi-user support, account recovery flows, social login.
- Incremental/cursor-based sync — Firestore handles this natively.
