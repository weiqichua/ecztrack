#!/usr/bin/env bash
# Ensures a working JDK 21+ is on PATH, then execs the given command.
#
# `test:emulator` needs a JDK 21+ on PATH — the Firestore emulator (invoked
# by firebase-tools) needs it, and rejects older versions with "firebase-tools
# no longer supports Java version before 21." On macOS, `/usr/bin/java` may
# exist but be a non-functional stub if no JDK is installed (`java -version`
# prints "Unable to locate a Java Runtime").
#
# This script uses `java` if one already on PATH actually runs; otherwise it
# probes a few likely install locations (Homebrew arm64, Homebrew x86,
# `/usr/libexec/java_home` on macOS) and prepends the first working one to
# PATH. If none is found, it fails with an actionable message instead of
# letting firebase-tools produce an opaque stack trace.
set -euo pipefail

if java -version >/dev/null 2>&1; then
  exec "$@"
fi

CANDIDATES=(
  "/opt/homebrew/opt/openjdk@21/bin"
  "/usr/local/opt/openjdk@21/bin"
)

if command -v /usr/libexec/java_home >/dev/null 2>&1; then
  JAVA_HOME_21="$(/usr/libexec/java_home -v 21 2>/dev/null || true)"
  if [ -n "$JAVA_HOME_21" ]; then
    CANDIDATES+=("$JAVA_HOME_21/bin")
  fi
fi

for candidate in "${CANDIDATES[@]}"; do
  if [ -x "$candidate/java" ] && "$candidate/java" -version >/dev/null 2>&1; then
    export PATH="$candidate:$PATH"
    exec "$@"
  fi
done

echo "error: no working JDK 21+ found on PATH or in known locations." >&2
echo "  Checked: PATH, ${CANDIDATES[*]}" >&2
echo "  Fix: brew install openjdk@21" >&2
exit 1
