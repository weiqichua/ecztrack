import { isFirebaseConfigured } from "./firebase";

/**
 * Optional email/password auth.
 *
 * Signing in is not required to use the app — it only enables off-device
 * backup. Every function here is safe to call when Firebase is unconfigured;
 * they simply report "not configured" rather than throwing at import time.
 */

export type AuthUser = { uid: string; email: string | null };

export function isAuthAvailable(): boolean {
  return isFirebaseConfigured();
}

export async function signIn(email: string, password: string): Promise<AuthUser> {
  const { getFirebaseAuth } = await import("./firebase");
  const { signInWithEmailAndPassword } = await import("firebase/auth");
  const cred = await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
  return { uid: cred.user.uid, email: cred.user.email };
}

export async function signOut(): Promise<void> {
  const { getFirebaseAuth } = await import("./firebase");
  const { signOut: fbSignOut } = await import("firebase/auth");
  await fbSignOut(getFirebaseAuth());
}

/**
 * Subscribes to sign-in state. Returns an unsubscribe function.
 *
 * When Firebase is unconfigured this reports "signed out" once and never
 * calls back again, so callers need no special case.
 */
export function watchAuth(cb: (user: AuthUser | null) => void): () => void {
  if (!isFirebaseConfigured()) {
    cb(null);
    return () => {};
  }
  let unsub = () => {};
  let cancelled = false;
  (async () => {
    const { getFirebaseAuth } = await import("./firebase");
    const { onAuthStateChanged } = await import("firebase/auth");
    if (cancelled) return;
    unsub = onAuthStateChanged(getFirebaseAuth(), (u) =>
      cb(u ? { uid: u.uid, email: u.email } : null),
    );
  })().catch(() => cb(null));
  return () => { cancelled = true; unsub(); };
}
