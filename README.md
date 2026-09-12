# EczTrack (Health Tracker)

EczTrack is a comprehensive mobile application for tracking and managing eczema and related health symptoms. Built with React Native and Expo, it provides users with tools to log symptoms, food intake, skin photos, and analyze potential triggers.

## Features
- **Symptom Tracking**: Log daily eczema symptoms and their intensity.
- **Diet/Food Logger**: Keep track of meals and identify potential food triggers.
- **Skin Photos**: Take and store daily photos to track skin progress over time.
- **Analytics & Triggers**: Analyze logged data to find correlations and triggers.
- **Firebase Integration**: Secure authentication and data storage using Firebase.

## Technology Stack
- **Framework**: [React Native](https://reactnative.dev/) with [Expo](https://expo.dev/)
- **Routing**: Expo Router
- **Backend/Database**: Firebase (Firestore, Auth)
- **Language**: TypeScript
- **Testing**: Vitest

## Documentation
For detailed guides on setting up, running, and deploying the app, please refer to the `docs/` directory:

- [Running the App Locally](docs/RUNNING.md)
- [Firebase Setup Guide](docs/FIREBASE-SETUP.md)
- [Deployment Instructions](docs/DEPLOYMENT.md)
- [Analysing Triggers (Data Model)](docs/ANALYSING-TRIGGERS.md)

## Getting Started

1. **Install Dependencies** (uses `pnpm` workspace):
   ```bash
   pnpm install
   ```

2. **Run the Development Server**:
   Please check out [docs/RUNNING.md](docs/RUNNING.md) for detailed instructions on running the app via Expo or with the Firebase local emulator suite.
