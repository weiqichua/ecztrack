# EczTrack Repository Architecture Guide

This document provides a high-level overview of the application's architecture, technology stack, and codebase structure. It is designed to help AI agents quickly orient themselves within the repository.

## 1. Technology Stack

- **Framework:** React Native with [Expo](https://expo.dev/) (SDK 54+).
- **Routing:** [Expo Router](https://docs.expo.dev/router/introduction/) (File-based routing).
- **Language:** TypeScript.
- **State Management:** React Context (`AppContext`) combined with local persistence (`AsyncStorage`).
- **Backend / Sync:** Firebase (Firestore & Auth) used primarily for data backups rather than real-time cloud-first data.
- **Testing:** [Vitest](https://vitest.dev/) for unit testing business logic.
- **Styling:** Vanilla React Native `StyleSheet` with dynamic theming via custom hooks (`useColors`).

## 2. Codebase Organization

The repository follows a clear separation of concerns, heavily relying on pure functions for business logic and keeping the UI layer mostly declarative.

### `app/` (Routing & Screens)
Contains the file-based routes for Expo Router.
- `app/_layout.tsx`: Root layout, providers initialization, and error boundaries.
- `app/(tabs)/`: Main bottom-tab navigation.
  - `index.tsx`: Home / Overview screen.
  - `food-logger.tsx`: Food and meal tracking.
  - `scratch-tracker.tsx`: Scratch/urge event tracking and skin photo gallery.
  - `calendar.tsx`: Monthly calendar view of symptoms, diets, and phases.
  - `export.tsx`: Settings, data export, and backup controls.

### `components/` (UI Components)
Reusable UI elements, separated from the screen logic.
- **Modals:** (e.g., `MealEditModal.tsx`, `FoodEditModal.tsx`, `PhaseStartModal.tsx`, `ScratchLogEditModal.tsx`).
- **Cards/Rows:** (e.g., `FoodCard.tsx`, `ScratchLogCard.tsx`, `PhaseStatusCard.tsx`).
- **Utilities:** `MciIcon.tsx` (SVG icon renderer using Material Design paths), `TimestampPicker.tsx`, `WeekStrip.tsx`.

### `context/` (State Management)
- `AppContext.tsx`: The single massive global state provider. It loads data from `AsyncStorage` on boot, exposes mutators (e.g., `addConsumptionLog`, `updateMeal`, `scheduleElimination`), and persists changes back to local storage. It also handles Firebase backup orchestration.

### `lib/` (Business Logic & Utilities)
This is where the core domain logic lives. The codebase deliberately extracts complex logic out of React components into **pure, testable functions** in this directory.
- **Domain Logic:** `phases.ts`, `mealGroups.ts`, `symptomLogs.ts`, `habitLogs.ts`, `skinPhotos.ts`.
- **Infrastructure:** `backup.ts` (Firebase syncing), `auth.ts`, `photoCapture.ts` (FileSystem operations).
- **Helpers:** `dates.ts` (Timezone/ISO logic), `dayStyle.ts` (Calendar coloring logic).

### `constants/` (Data Models & Schemas)
- `types.ts`: TypeScript interfaces for the core data models (`ConsumptionLog`, `SymptomLog`, `PhaseLedger`, `SkinPhoto`, etc.).
- `foods.ts`, `catalog.ts`: Seed data and definitions for the customizable item catalogs.
- `colors.ts`: Theming and palette definitions.

### `tests/` & `*.test.ts` (Unit Testing)
- Tests for pure functions are collocated with the source files (e.g., `lib/phases.test.ts`).
- Integration or multi-module tests are in the root `tests/` directory.

## 3. Core Data Concepts & Workflows

The application tracks several interconnected streams of health data, primarily aimed at identifying eczema triggers:

1. **Phases & Ledger (`PhaseLedger`):** The app operates in phases: `none`, `elimination` (removing potential triggers), or `challenge` (reintroducing a trigger to test reaction).
2. **Consumption Logs:** Records of what was eaten and when. Logs are individually tracked but visually grouped into "Meals" based on shared timestamps/group IDs.
3. **Symptom Logs:** Daily check-ins scoring itch, redness, dryness, sleep loss, etc., on a 0-5 scale.
4. **Scratch Logs / Urges:** Point-in-time recordings of severe itch urges, tracking intensity, body location, and suspected triggers.
5. **Skin Photos:** Progress photos mapped to specific body locations, tied to `symptomLogs` by date.
6. **Habits / Routines:** Tracking daily preventative care (moisturizing, bathing, medication).

## 4. Agent Guidelines

When working in this repository, keep the following architectural principles in mind:

- **Logic Belongs in `lib/`:** If a calculation, transformation, or grouping is complex, it should be a pure function in `lib/` with a corresponding `.test.ts` file, not embedded inside a React component.
- **Local First:** All primary data reads and writes go to `AsyncStorage`. Firebase is only for explicit, user-initiated backups.
- **Pure Functions over Mutations:** Functions like `renameMealIn` or `endEliminationEarlyIn` take the current state array/ledger and return a new one, rather than mutating in place.
- **Strict Types:** Always refer to `constants/types.ts` for the single source of truth on data structures. Use union types and discriminate carefully.
- **Testing:** The test suite runs fast via Vitest. Ensure any changes to `lib/` are covered by tests and pass `pnpm test` and `pnpm typecheck` before finalizing.
