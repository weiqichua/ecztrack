export type CollectionName =
  | "consumptionLogs"
  | "symptomLogs"
  | "scratchLogs"
  | "habitDefinitions"
  | "habitLogs"
  | "customFoods"
  | "bodyLocations"
  | "cues"
  | "routines"
  | "symptoms"
  | "foodCategories"
  | "foodTags"
  | "supplementLogs"
  | "activityLogs"
  | "supplements"
  | "activities"
  | "presetGroups"
  | "dailyNotes";

export function userRoot(uid: string): string {
  return `users/${uid}`;
}

export function collectionPath(uid: string, name: CollectionName): string {
  return `${userRoot(uid)}/${name}`;
}

export function phaseDocPath(uid: string): string {
  return `${userRoot(uid)}/meta/phase`;
}

/**
 * Where the backup records which storage schema it was written by.
 *
 * A restore has to be able to tell a current backup from one written before
 * the app moved to user-created catalogs — the ids in an old one resolve
 * against nothing on this device.
 */
export function schemaDocPath(uid: string): string {
  return `${userRoot(uid)}/meta/schema`;
}

/** One habit log per habit per day — enforced by the document id itself. */
export function habitLogId(habitId: string, date: string): string {
  return `${habitId}_${date}`;
}

/** One symptom log per date — enforced by the document id itself. */
export function symptomLogId(date: string): string {
  return date;
}
