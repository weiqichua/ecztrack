# Running the app locally

All commands run from `artifacts/ecztrack`:

```bash
cd artifacts/ecztrack
```

Requires Node 24 and pnpm 11 (the repo hard-fails npm and yarn via a
`preinstall` hook). If `node_modules` is missing, run `pnpm install` from the
**repo root**, not from this directory — it is a pnpm workspace.

---

## Start the dev server

```bash
pnpm dev
```

Then, in the interactive menu:

- press **`w`** to open it in your browser
- scan the QR code with **Expo Go** on your phone

Both can be connected at once. They keep separate data unless you back up on
one and restore on the other.

If port 8081 is busy: `pnpm exec expo start --port 8082`.
To force a clean Metro cache: `pnpm exec expo start --clear`.

---

## Build the web bundle

```bash
pnpm build
```

Produces a bundle in `dist/`. Serve it with any static server, e.g.
`npx serve dist`.

---

## The four gates

```bash
pnpm typecheck                              # tsc, must be clean
pnpm test                                   # 393 unit tests
EXPO_NO_TELEMETRY=1 CI=1 pnpm build          # web export must succeed
pnpm run test:emulator                      # Firestore security-rules tests, needs JDK 21+
```

`EXPO_NO_TELEMETRY=1` avoids an interactive prompt if Expo wants to write
`~/.expo` and that's blocked; `CI=1` keeps the export non-interactive.

Two traps here cost real time if you don't know about them:

- **`pnpm run test:emulator` exits with code 2 even when its tests pass.**
  After the emulator tests finish, firebase-tools tries to write its
  update-check config and fails under this sandbox (`firebase-tools update
  check failed... /Users/<you>/.config`). That failure produces the nonzero
  exit, unrelated to the tests themselves. Read the pass/fail line from
  stdout (`Tests  N passed (N)`), never the exit code.
- **The Firestore emulator listens on port 8181, not the default 8080** —
  `firebase.json` pins it there because 8080 was already held by an unrelated
  process on this machine.

`test:emulator` finds a JDK itself via `scripts/with-java.sh`; it does not
need `JAVA_HOME` set. It runs fully offline against `--project
demo-health-tracker`, so it needs no Firebase credentials.

To check timezone-sensitive logic, set `TZ`. The suite passes as-is in UTC,
`America/Los_Angeles`, `Pacific/Chatham` (a fractional UTC offset), and
`Asia/Tokyo`:

```bash
TZ=America/Los_Angeles pnpm test
```

---

## Notes

- **The app needs no credentials at all to run.** It is local-first: everything
  lives in AsyncStorage on the device. Firebase is optional — with no
  `EXPO_PUBLIC_FIREBASE_*` values the app runs normally and the Backup card on
  the Export tab is simply hidden.
- **There is no automatic sync, by design.** Configure Firebase
  (`docs/FIREBASE-SETUP.md`) and the Export tab gains a manual **Back up now** /
  **Restore**. The merge is union-only, so deletions do not travel between
  devices.
- `expo start` prints a list of packages whose versions drift from what Expo 54
  expects. It is a warning, not an error, and the app runs. `pnpm exec expo
  install --check` will fix them if you want — but do that on its own commit,
  since it moves several versions at once.
- **Skin photo capture is phone-only.** The web build has no filesystem to
  save images to, so on `w` the Overview's Skin section shows no camera/library
  icons and its empty state just says photos are available on the phone app —
  it does not error.
- **Skin photos never leave the phone.** **Back up now** does not carry them
  and there is no photo export, so they exist on exactly one device and a
  reset or a lost phone loses them. That is deliberate: a photo record that
  synced without its image file would show as a permanently broken tile on the
  other device. Treat the photos as a visual record you keep, not as data the
  app protects.
