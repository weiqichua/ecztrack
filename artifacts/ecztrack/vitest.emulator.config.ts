import { defineConfig } from "vitest/config";
import path from "node:path";

// `pnpm run test:emulator` requires a JDK 21+ on PATH — the Firestore
// emulator (invoked by firebase-tools) needs it, and rejects older
// versions with "firebase-tools no longer supports Java version before
// 21." On macOS, `/usr/bin/java` may exist but be a non-functional stub
// if no JDK is installed (`java -version` prints "Unable to locate a
// Java Runtime"). The `test:emulator` npm script wraps this command with
// `scripts/with-java.sh`, which finds a working JDK 21+ (already on PATH,
// or a Homebrew/`java_home` install) and adds it to PATH automatically —
// no manual `export` needed. If none is found it fails with:
//   brew install openjdk@21

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.emulator.test.ts"],
    exclude: ["node_modules/**"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
