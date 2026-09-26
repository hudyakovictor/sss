import { starterScenario } from "../fixtures/starter-scenario.js";
import { invalidationChallengeA } from "../fixtures/invalidation-challenge-a.js";
import { invalidationChallengeB } from "../fixtures/invalidation-challenge-b.js";
import { invalidationTransfer } from "../fixtures/invalidation-transfer.js";
import { academyIntroProgram } from "./invalidation-before-direction.js";

import type { ScenarioPackage } from "../../../contracts/src/scenario.js";

// Every scenario the Academy Level 0 program references must resolve inside
// this registry, so the validator can prove there are no dangling IDs.
export const programScenarios: ScenarioPackage[] = [
  starterScenario,
  invalidationChallengeA,
  invalidationChallengeB,
  invalidationTransfer
];

export { academyIntroProgram };
