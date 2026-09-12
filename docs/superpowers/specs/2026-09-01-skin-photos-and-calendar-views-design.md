# Skin photos and a detailed calendar view — design

**Date:** 2026-09-01
**Status:** approved in conversation; written for review.

Two features that meet in one place. The app can take and keep photographs of
skin, shown on the Overview for the selected day. The Calendar gains a second
view that lists a month a day at a time, carrying each day's symptom average
and its photo, so a flare can be found by scrolling rather than remembered.

## Why photos are a subsystem and not a field

Everything the app stores today is small JSON: a few hundred bytes per log,
written to AsyncStorage and optionally mirrored to Firestore. A photograph is
three to five megabytes of binary, which breaks every one of those assumptions
at once. AsyncStorage is the wrong home for it, Firestore documents cap at a
megabyte, and the JSON export would become unopenable.

So photos get their own storage, their own lifecycle, and their own way out of
the device. The metadata that describes them is ordinary JSON and behaves like
everything else.

## Where a photo lives

Image files go in `${FileSystem.documentDirectory}skin/`. The records go in
AsyncStorage under a new `STORAGE_KEYS.SKIN_PHOTOS`.

```ts
export interface SkinPhoto {
  id: string;
  /** The local day the photo belongs to, `YYYY-MM-DD`. */
  date: string;
  /**
   * The file's NAME inside the skin directory — never a full path.
   *
   * On iOS the documents directory contains a UUID that is regenerated when
   * the app is reinstalled or restored from a device backup. A stored absolute
   * path therefore points at nothing after any reinstall, and every photo in
   * the library breaks at once. The directory is resolved at read time and only
   * the name is persisted.
   */
  file: string;
  /** ISO timestamp the photo was taken or imported. */
  takenAt: string;
  /**
   * `CatalogItem.id` from the body-locations catalog the urge log already uses.
   * Absent means untagged, which is always allowed — the field exists so that
   * one area can be followed over time, not to make tagging a chore.
   */
  location?: string;
}
```

`date` is stored rather than derived from `takenAt`, for the same reason the
consumption CSV carries a `date` column: the instant belongs to a UTC day and
the app files everything by local day, and the two disagree for part of every
24 hours.

## Photos do not sync, and neither do their records

The Firebase backup carries JSON only, and adding photo *records* to it while
the *files* stay local would be worse than leaving both out: a second device
would pull a list of photographs it cannot display, and every one of them would
render as a permanent broken tile with no way to clear it.

So `SkinPhoto` is absent from `Snapshot`, from `CollectionSpecs`, and from the
Firestore rules. This is the one collection deliberately outside the backup.

The consequence is real and was accepted explicitly: **losing the phone loses
every photo not already exported.** The Export screen is therefore the only
route out, and it is part of this feature rather than a later addition.

## Getting photos off the device

The Export screen gains a photo archive: a single zip holding the image files
plus a `photos.json` manifest of their records, handed to `expo-sharing` the
same way the CSV and JSON exports already are.

One file rather than many, because `Sharing.shareAsync` takes one URI — sharing
a hundred photographs individually is not an export, it is an afternoon.

The zip is assembled in memory by `jszip`, which is the cost of this choice. A
large library on a modest phone can exhaust the JavaScript heap, and the failure
mode of ignoring that is a crash with no explanation. The archive therefore
reports its size before building and refuses politely above a threshold, telling
the user to narrow the range rather than dying.

## Capture, and why the image is not stored as taken

`expo-image-picker` supplies both paths — camera and existing library — and
`expo-image-manipulator` downscales to a 1600px long edge and re-encodes as
JPEG before the file is saved.

This is not an optimisation. A daily photograph kept at full resolution is over
a gigabyte within a year, on a device whose owner will never think to look for
it; resized it is closer to a hundred megabytes. The app is asking for this
storage indefinitely and should ask for as little as it can.

## The web build has no photos

`FileSystem.documentDirectory` is `null` under react-native-web, so there is
nowhere to put a file, and `expo-image-picker`'s camera path is unavailable.

Rather than a broken button, the web build hides the add control and the Skin
section explains that photos are phone-only. Nothing is lost by this: photos
never leave the phone, so a browser on another machine would have none to show
even if it could read them.

Every function that touches the filesystem must therefore tolerate a null
directory and return empty rather than throw. A screen must not go down because
of where it is running.

## Lifecycle

Deleting a photo deletes its file and its record together. A record without its
file is a broken tile; a file without its record is invisible and permanent, and
the second is worse because nothing will ever reclaim it.

On load the library reconciles: a record whose file is missing is dropped. This
is the state a device-level restore produces — AsyncStorage comes back, the
skin directory does not — and without reconciliation the gallery fills with
tiles that can never be cleared.

Reconciliation only ever drops records. It does not delete files it cannot
explain, because a file the current build does not recognise may belong to a
newer one.

## The Overview's Skin section

A horizontal strip of the selected day's photos, newest first, with an add
control on today. Tapping one opens it full-screen, where it can be deleted and
its body location set.

Past days show their photos and accept new ones — the app already lets a past
day's check-in and meals be written, and a photograph taken this morning of
yesterday's flare is the ordinary case, not an edge one.

## The Calendar's two views

A segmented control sits below the month grid. **Quick** is the present view,
unchanged — the grid, its phase colouring, its activity dots and its legend.
**Detailed** replaces the grid with a list of the month's days.

Each row carries the weekday and date, the day's average symptom score coloured
by `lib/scoreScale.ts`, and the most recent photo of that day as a thumbnail.

Every day of the month appears, including empty ones, rendered as a thin muted
row. A run of blanks is a finding — it says the check-ins stopped — and a list
that omits them makes three skipped days look identical to three consecutive
ones, which misreads a flare's timeline in exactly the direction that matters.

The average is over the symptoms a day actually scored, ignoring nulls, which is
the rule `buildSymptomCSV` already applies. That logic currently exists only
inside the exporter and moves to a pure module both can use, because two
implementations of one average will disagree and the disagreement will be
invisible.

## Tapping a day

A row opens the Overview at that date. This needs no new plumbing:
`selectedDate` and `setSelectedDate` already live in `AppContext`, and the
Overview's week strip already drives them. The Calendar calls `setSelectedDate`
and navigates to the Overview tab.

An earlier draft of this design called for lifting `selectedDate` out of the
Overview. That work is already done, and done better than described — the
context also advances the selected date at local midnight, but only for someone
who was sitting on "today", so a user reviewing an earlier date keeps the date
they chose.

The alternative of passing the date as a router param stays rejected. Expo
Router mounts every tab once and never unmounts it, so a param-driven jump has
to be observed by an effect and cleared afterwards, or the same day cannot be
opened twice. That is the class of defect the recomputed-per-render "today"
value exists to avoid.

## Testing

The pure parts are unit-testable and must be: the average, the reconciliation
decision, the day-key filing of a photo, and the grouping of a month into rows.
`lib/` modules are importable under vitest; `context/AppContext.tsx` is not, and
neither is any screen, so nothing testable may live in them.

Filesystem and picker calls are wrapped behind a thin module so the logic above
them can be tested without a device.

Every guard gets a mutation check before it is called done. Specifically: the
reconciliation must fail a test if it deletes files rather than only records,
and the average must fail a test if a `null` score is counted as a zero.

## Out of scope

Syncing photos anywhere. Editing or annotating an image. Comparing two dates
side by side. Any automatic analysis of a photograph — the export exists so that
can happen off-device, where it belongs.

Backfilling `location` onto photos taken before it was set. Absent means
untagged, permanently and legitimately.
