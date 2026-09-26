import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { academyIntroProgram, programScenarios } from "../packages/content/src/academy/index.js";
import { validateLearningProgram } from "../packages/content/src/validate-learning.js";

// Canonical Entity names are the source of truth in the asset manifest
// (assetId `entity_<name>_portrait`). Learning scenarios may only hide Entities
// that already exist here; we never invent Entity names (AGENTS.md invariant).
const manifestPath = resolve(process.cwd(), "assets/asset-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
  assets: Array<{ assetId: string }>;
};

const knownEntityNames = new Set<string>();
for (const asset of manifest.assets) {
  const match = /^entity_(.+)_portrait$/.exec(asset.assetId);
  if (match?.[1]) knownEntityNames.add(match[1]);
}

const result = validateLearningProgram({
  program: academyIntroProgram,
  scenarios: programScenarios,
  knownEntityNames
});

console.log(
  `Learning validation passed: ${result.moduleCount} module(s), ${result.skillCount} skill(s), ` +
    `${result.lessonCount} lesson(s) across ${result.scenarioCount} scenario(s); ` +
    `${knownEntityNames.size} canonical Entity names recognised.`
);
