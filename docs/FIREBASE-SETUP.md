# Firebase setup — optional

**You do not need this to use the app.** The app is local-first: everything is
stored on the device with AsyncStorage, and it works fully with no Firebase
project, no sign-in, and no network.

Firebase adds one thing: an off-device **backup** you trigger from the Export
tab, which also lets a second phone pick your data up. If Firebase is not
configured, the Backup card simply does not appear.

**Rough time:** ten minutes.

---

## 1. Create the Firebase project

1. Go to <https://console.firebase.google.com/> and create a project.
   Analytics is not needed — decline it unless you want it.
2. Inside the project, click the **Web** icon (`</>`) to register a web app.
   Nickname is arbitrary. Skip the Hosting offer on that screen; see section 4.
3. Copy the six values from the `firebaseConfig` snippet it shows you. You can
   find them again later under **Project settings → General → Your apps → SDK
   setup and configuration**.

### Where the six values go

Paste into **`artifacts/ecztrack/.env.local`** (already created, keys
present and empty, and git-ignored — verify with
`git check-ignore artifacts/ecztrack/.env.local`):

| `.env.local` key | Console field |
|---|---|
| `EXPO_PUBLIC_FIREBASE_API_KEY` | `apiKey` |
| `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` | `authDomain` |
| `EXPO_PUBLIC_FIREBASE_PROJECT_ID` | `projectId` |
| `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` | `storageBucket` |
| `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
| `EXPO_PUBLIC_FIREBASE_APP_ID` | `appId` |

Consumed by `artifacts/ecztrack/lib/firebase.ts`. Only `apiKey`,
`projectId` and `appId` decide whether backup is considered available; the
others are filled in for completeness.

Restart the dev server after editing `.env.local` — Expo reads
`EXPO_PUBLIC_*` at bundle time, not at runtime.

### One more place the project id goes

**`artifacts/ecztrack/.firebaserc`** — replace the placeholder:

```json
"default": "your-real-project-id"   ← replace with your real projectId
```

This file is **not** used by `pnpm run test:emulator`, which always passes
`--project demo-health-tracker` so the emulator runs fully offline.

> **On secrecy:** `EXPO_PUBLIC_*` values are compiled into the client bundle
> and are *not* secrets — every Firebase web app ships them. What protects
> your data is the security rule in `artifacts/ecztrack/firestore.rules`,
> a single recursive `match /users/{uid}/{document=**}` that scopes every
> document under a user's own uid to that user's `request.auth.uid` and
> denies everything else. That said, `.env.local` stays git-ignored; there is
> no reason to commit it.
>
> If you ever generate a Firebase **service-account JSON** (for a CI deploy or
> an admin script) — this app's own client SDK never needs one — that file
> *is* a secret: it grants full admin access regardless of `firestore.rules`.
> Keep it outside the repo entirely, e.g. `~/.config/health-tracker/`, and
> never commit it.

---

## 2. Enable Email/Password auth and create your account

1. **Authentication → Get started → Sign-in method → Email/Password → Enable.**
   Leave "Email link (passwordless sign-in)" off.
2. **Authentication → Users → Add user.** Enter the email and password you want
   to sign in with. This is the only account that will ever exist.

There is no sign-up flow in the app on purpose — one account, created here.

---

## 3. Publish the security rules

```bash
cd artifacts/ecztrack
npx firebase-tools deploy --only firestore:rules
```

`firestore.rules` allows a signed-in user to read and write only under
`users/{their uid}` and denies everything else. Without this deploy, Firestore
runs in whatever default mode the console gave you.

---

## 4. Using it

Open the **Export** tab. With Firebase configured you get a **Backup** card:

- **Sign in** with the account from section 2.
- **Back up now** pushes everything currently on the device.
- **Restore** pulls the backup and merges it in.

Backups are manual only — neither runs on its own. Nothing runs in the
background, and there is no automatic sync between opening the app and
pressing one of these buttons.

The merge is **union-only**: restoring can add entries but never removes one.
That means deletions do not travel between devices — delete a food on the
phone and it is still in the backup; restoring brings it back. This is
deliberate, and is the price of never being able to lose data to a merge.

A restore also refuses a snapshot from the wrong schema: one written before
the app moved to user-created catalogs (pre-v4), and one written by a newer
build than this one. Both are rejected rather than partially applied.

### What gets backed up

Alongside the log collections (`consumptionLogs`, `symptomLogs`,
`scratchLogs`, `habitDefinitions`, `habitLogs`), a backup carries the four
user-created catalogs — `bodyLocations`, `cues`, `routines`, `symptoms` — plus
`customFoods`, since nothing is seeded any more and all of these are
per-user data. The phase ledger lives in its own document at
`users/<uid>/meta/phase`.

`symptomLogs` documents are now keyed by **date alone** (`users/<uid>/symptomLogs/<date>`)
— one document per day, holding every symptom score for that day. There is no
longer a `type` field splitting a day into a morning and evening document.

---

## Checklist

- [ ] Firebase project created, web app registered
- [ ] Six `EXPO_PUBLIC_FIREBASE_*` values in `artifacts/ecztrack/.env.local`
- [ ] Real project id in `artifacts/ecztrack/.firebaserc`
- [ ] Email/Password enabled; the one account created
- [ ] `firestore.rules` deployed
- [ ] Signed in on the Export tab and pressed **Back up now** once
