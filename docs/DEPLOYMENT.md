# Deployment Guide: Development, Android APK, and iOS

This guide covers three stages: local development, building an Android APK, and building an iOS app.

---

## Stage 1: Development

### Start the Dev Server

```bash
cd artifacts/health-tracker
pnpm dev
```

The terminal displays an interactive menu:
- Press **`w`** to open in your browser at `http://localhost:8081`
- Scan the **QR code** with **Expo Go** on Android or iOS

### About Development Mode

- **Temporary**: The app runs live off your laptop's dev server
- **Real-time updates**: Changes to code hot-reload instantly
- **Shared data**: Browser and phone are separate devices unless you manually backup/restore
- **No network needed**: App is fully local-first (AsyncStorage)

### Troubleshooting Dev Server

| Problem | Solution |
|---------|----------|
| Port 8081 busy | `pnpm exec expo start --port 8082` |
| Metro cache stale | `pnpm exec expo start --clear` |
| Expo wants `~/.expo` access blocked | `EXPO_NO_TELEMETRY=1 pnpm dev` |

---

## Stage 2: Android APK

### Prerequisites

- **EAS CLI** installed globally:
  ```bash
  npm install -g eas-cli
  ```
- **Expo account** (free): https://expo.dev/signup
- Logged in locally:
  ```bash
  eas login
  ```

### Build for Android

1. **Set up the project** (one-time):
   ```bash
   cd artifacts/health-tracker
   eas build:configure --platform android
   ```
    - Follow the prompts (app name, slug, etc.).
    - This creates `eas.json` and updates `app.json`.

    Make sure the `preview` profile in `eas.json` is configured for an
    installable APK and uses the `preview` EAS environment:

    ```json
    {
       "build": {
          "preview": {
             "distribution": "internal",
             "environment": "preview",
             "android": {
                "buildType": "apk"
             }
          }
       }
    }
    ```

2. **Upload the local environment settings**:
    ```bash
    eas env:push preview --path .env.local
    ```
    - Confirm the upload when prompted.
    - This uploads the variables from `artifacts/health-tracker/.env.local` to
       EAS. The local file remains git-ignored.
    - The same `preview` environment is used for both the Android and iOS
       builds below.

3. **Build the APK**:
   ```bash
    eas build --platform android --profile preview
   ```
    - This builds on EAS servers and produces an `.apk`.
    - The command prints a build page and download link when it finishes.
    - Use `--local` only if you have the Android SDK and build tools installed.

4. **Install on an Android phone**:
   - Download the APK from the EAS build output link
   - Transfer to your Android phone (USB or cloud)
   - Tap the APK to install (allow "Install from unknown sources" in settings)

### Troubleshooting Android Build

| Issue | Fix |
|-------|-----|
| Build hangs | Omit `--local` and use EAS servers instead |
| "Android SDK not found" (with `--local`) | Install Android SDK, set `ANDROID_SDK_ROOT` |
| APK too large | The default is ~150 MB; this is normal for Expo apps |

### Signing (Optional, Required for Play Store)

For Play Store submission, generate a signing key:

```bash
eas credentials
```

Follow prompts to generate and manage signing keys. EAS stores them securely.

---

## Stage 3: iOS App

### Prerequisites

- **Mac required**: Expo/EAS builds iOS only on Apple Silicon or Intel Macs
- **iOS 13.4+** target device
- **Expo account** (same as Android)
- **Xcode** (optional, only if building locally): `xcode-select --install`

### Build for iOS

1. **Build the iOS app with the same uploaded environment**:
   ```bash
   cd artifacts/health-tracker
   eas build --platform ios --profile preview
   ```
   - The `preview` profile uses the same EAS environment populated from
     `.env.local`, so the `EXPO_PUBLIC_*` values are baked into this build too.
   - EAS builds iOS on its servers and outputs an `.ipa` file.
   - If prompted, let EAS manage the iOS signing credentials.

2. **Install on an iPhone**:

   **Option A: Expo Go (Easiest, for Testing)**
   - Scan the QR code with Expo Go (development only)

   **Option B: Internal distribution**
   - Register the iPhone with EAS when prompted
   - Open the EAS install link on the registered iPhone
   - Install the build from that link

   **Option C: TestFlight**
   - Use an Apple Developer account and App Store Connect
   - Submit the build to TestFlight and invite testers through the TestFlight app

   **Option D: App Store (Production)**
   - Create Apple Developer account ($99/year)
   - Set up provisioning profiles and certificates via `eas credentials`
   - Build with App Store provisioning
   - Upload to App Store Connect and submit for review

### Troubleshooting iOS Build

| Issue | Fix |
|-------|-----|
| "No provisioning profile" | Run `eas credentials` and generate iOS provisioning profile |
| "Certificate mismatch" | Use `eas credentials` to manage certificates securely |
| Build timeout on EAS | Rare; check logs in EAS dashboard |

---

## Firebase Setup (Optional, for Backup)

To enable the Backup feature on your installed app:

1. Follow [FIREBASE-SETUP.md](FIREBASE-SETUP.md)
2. Update `.env.local` with Firebase credentials
3. Rebuild and redeploy using `eas build` above

---

## Development → Production Workflow

```
┌─────────────────────────────────────────────────────────┐
│ 1. Local Dev (pnpm dev + Expo Go)                       │
│    • Fastest feedback loop                              │
│    • Test on Android/iOS simultaneously                 │
│    • Verify functionality                               │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│ 2. Build for Distribution (eas build)                   │
│    • Android: eas build --platform android              │
│    • iOS: eas build --platform ios                      │
└────────────────┬────────────────────────────────────────┘
                 │
        ┌────────┴────────┐
        ▼                 ▼
    Android           iOS
    ├─ APK            ├─ Testflight
    │  (direct)       │  (ad-hoc)
    │                 └─ App Store
    │                    (production)
    └─ Play Store
       (production)
```

---

## Quick Reference: Commands

```bash
# Development
cd artifacts/health-tracker
pnpm dev                                    # Start dev server

# Android APK, then iOS, using .env.local uploaded to EAS preview
eas login
eas build:configure --platform android       # One-time setup
eas env:push preview --path .env.local       # Upload environment settings
eas build --platform android --profile preview
eas build --platform ios --profile preview

# iOS
eas build:configure --platform ios           # One-time setup
eas build --platform ios                     # Build IPA

# Manage Credentials
eas credentials                              # View/generate signing keys
```

---

## Notes

- **No credentials needed locally**: The app works fully offline with AsyncStorage
- **Firebase is optional**: Skip [FIREBASE-SETUP.md](FIREBASE-SETUP.md) if you don't need backups
- **Data persistence**: 
  - Dev mode: Separate data per device/browser
  - Built app: Each phone keeps its own AsyncStorage
  - Backup/Restore is manual (see [FIREBASE-SETUP.md](FIREBASE-SETUP.md))
- **Bundle size**: Expo apps are ~100-150 MB; this is normal
- **Web**: Also available at `pnpm build` → `npx serve dist/`

