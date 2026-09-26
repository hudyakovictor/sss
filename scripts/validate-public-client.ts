import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// Public client boundary gate.
//
// The client (React design-system-lab) and its shared UI package must never
// fabricate hidden future state, do authoritative scoring, or read server-only
// fields. Runtime boundary tests prove the values are absent before reveal; this
// static gate proves the code paths do not even try to reference them.
//
// Iteration 02: repointed from the removed `apps/client-prototype` path to the
// active client surface (`apps/design-system-lab`) plus the shared UI package
// (`packages/ui-game`). Missing directories are a hard failure, not a silent
// no-op.
const sourceRoots = [
  resolve(process.cwd(), "apps/design-system-lab/src"),
  resolve(process.cwd(), "packages/ui-game/src")
];

const forbiddenPatterns = [
  /hiddenLayer/,
  /futureSeries/,
  /revealLayer/,
  /calculateProcessScore/,
  /state\.score/,
  /scenario\.outcome/
];

function collectTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return collectTypeScriptFiles(path);
    const isSource = path.endsWith(".ts") || path.endsWith(".tsx");
    const isTest = path.endsWith(".test.ts") || path.endsWith(".test.tsx");
    return isSource && !isTest ? [path] : [];
  });
}

const violations: string[] = [];
const scannedFiles: string[] = [];

for (const root of sourceRoots) {
  if (!existsSync(root)) {
    throw new Error(
      `Public client boundary validation failed: source root is missing (${root}). ` +
      "Recreate the directory or update this script; do not let the gate silently pass."
    );
  }
  for (const filePath of collectTypeScriptFiles(root)) {
    scannedFiles.push(filePath);
    const source = readFileSync(filePath, "utf8");
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(source)) {
        violations.push(`${filePath}: forbidden public-client pattern ${pattern}`);
      }
    }
  }
}

if (violations.length > 0) {
  throw new Error(`Public client boundary validation failed:\n${violations.join("\n")}`);
}

console.log(
  `Public client boundary validation passed: ${scannedFiles.length} file(s) scanned across ${sourceRoots.length} root(s); no hidden/future truth or client-authoritative scoring patterns found.`
);
