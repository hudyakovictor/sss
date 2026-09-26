import type { AcademyModule, ChallengeDefinition, Lesson, Skill } from "../../contracts/src/learning.js";
import type { ScoreDimension, ScenarioPackage } from "../../contracts/src/scenario.js";
import { validateScenarioPackage } from "./validate.js";

export interface LearningProgram {
  readonly modules: readonly AcademyModule[];
  readonly lessons: readonly Lesson[];
  readonly skills: readonly Skill[];
  readonly challenges: readonly ChallengeDefinition[];
}

export interface LearningValidationInput {
  readonly program: LearningProgram;
  readonly scenarios: readonly ScenarioPackage[];
  readonly knownEntityNames: ReadonlySet<string>;
}

export interface LearningValidationResult {
  readonly moduleCount: number;
  readonly lessonCount: number;
  readonly skillCount: number;
  readonly scenarioCount: number;
}

function collectVersion<T extends { version: string }>(
  label: string,
  idKey: keyof T,
  items: readonly T[]
): Set<string> {
  const versions = new Set<string>();
  for (const item of items) {
    const id = String(item[idKey]);
    const key = `${id}@${item.version}`;
    if (versions.has(key)) {
      throw new Error(`Learning validation: duplicate version for ${label} '${key}'`);
    }
    versions.add(key);
  }
  return versions;
}

function assertNoCycle(
  label: string,
  edges: ReadonlyMap<string, readonly string[]>
): void {
  const VISITED = 2;
  const IN_PROGRESS = 1;
  const state = new Map<string, number>();

  const visit = (node: string, path: string[]): void => {
    const current = state.get(node);
    if (current === VISITED) return;
    if (current === IN_PROGRESS) {
      throw new Error(`Learning validation: ${label} prerequisite cycle: ${[...path, node].join(" -> ")}`);
    }
    state.set(node, IN_PROGRESS);
    for (const next of edges.get(node) ?? []) {
      if (!edges.has(next)) {
        throw new Error(`Learning validation: ${label} '${node}' depends on unknown '${next}'`);
      }
      visit(next, [...path, node]);
    }
    state.set(node, VISITED);
  };

  for (const node of edges.keys()) visit(node, []);
}

export function validateLearningProgram(input: LearningValidationInput): LearningValidationResult {
  const { program, scenarios, knownEntityNames } = input;

  const skillById = new Map(program.skills.map((skill) => [skill.skillId, skill]));
  const moduleById = new Map(program.modules.map((module) => [module.moduleId, module]));
  const lessonById = new Map(program.lessons.map((lesson) => [lesson.lessonId, lesson]));
  const challengeById = new Map(program.challenges.map((challenge) => [challenge.challengeDefinitionId, challenge]));
  const scenarioById = new Map(scenarios.map((scenario) => [scenario.scenarioId, scenario]));

  // Referential integrity of versions.
  collectVersion("skill", "skillId", program.skills);
  collectVersion("module", "moduleId", program.modules);
  collectVersion("lesson", "lessonId", program.lessons);
  collectVersion("challenge", "challengeDefinitionId", program.challenges);

  // Scenario fixtures themselves must remain valid ScenarioPackages.
  for (const scenario of scenarios) {
    validateScenarioPackage(scenario);
  }

  // Skill prerequisite graph.
  assertNoCycle(
    "skill",
    new Map(program.skills.map((skill) => [skill.skillId, skill.prerequisiteSkillIds]))
  );

  // Module prerequisite graph.
  assertNoCycle(
    "module",
    new Map(program.modules.map((module) => [module.moduleId, module.prerequisiteModuleIds]))
  );

  for (const module of program.modules) {
    // Skills referenced by a module must exist.
    const moduleDimensionSet = new Set<ScoreDimension>();
    for (const skillId of module.skillIds) {
      const skill = skillById.get(skillId);
      if (!skill) {
        throw new Error(`Module '${module.moduleId}' references unknown skill '${skillId}'`);
      }
      for (const dimension of skill.scoringDimensions) moduleDimensionSet.add(dimension);
    }

    // A module must have exactly one resolvable challenge definition that
    // points back at it.
    const challenge = challengeById.get(module.challengeDefinitionId);
    if (!challenge) {
      throw new Error(`Module '${module.moduleId}' references unknown challenge '${module.challengeDefinitionId}'`);
    }
    if (challenge.moduleId !== module.moduleId) {
      throw new Error(`Challenge '${challenge.challengeDefinitionId}' is bound to module '${challenge.moduleId}', not '${module.moduleId}'`);
    }
    if (challenge.criticalGates.length === 0) {
      throw new Error(`Challenge '${challenge.challengeDefinitionId}' has no critical gates`);
    }

    // Scoring linkage: the challenge must cover every dimension the module's
    // skills are graded on.
    const challengeDimensions = new Set<ScoreDimension>(challenge.scoringDimensions);
    for (const dimension of moduleDimensionSet) {
      if (!challengeDimensions.has(dimension)) {
        throw new Error(`Challenge '${challenge.challengeDefinitionId}' misses scoring dimension '${dimension}' required by module '${module.moduleId}'`);
      }
    }

    // Lessons must belong to this module.
    for (const lessonId of module.lessonIds) {
      const lesson = lessonById.get(lessonId);
      if (!lesson) {
        throw new Error(`Module '${module.moduleId}' references unknown lesson '${lessonId}'`);
      }
      if (lesson.moduleId !== module.moduleId) {
        throw new Error(`Lesson '${lessonId}' declares moduleId '${lesson.moduleId}', not '${module.moduleId}'`);
      }
    }

    // Transfer scenarios must exist and target one of the module's skills.
    for (const scenarioId of module.transferScenarioIds) {
      const scenario = scenarioById.get(scenarioId);
      if (!scenario) {
        throw new Error(`Module '${module.moduleId}' references unknown transfer scenario '${scenarioId}'`);
      }
      if (!module.skillIds.includes(scenario.rematchLogic.targetSkillId)) {
        throw new Error(`Transfer scenario '${scenarioId}' targets skill '${scenario.rematchLogic.targetSkillId}' outside module '${module.moduleId}'`);
      }
    }
  }

  for (const lesson of program.lessons) {
    if (!lesson.learningObjective.trim()) {
      throw new Error(`Lesson '${lesson.lessonId}' has no learning objective`);
    }
    for (const scenarioId of lesson.practiceScenarioIds) {
      if (!scenarioById.has(scenarioId)) {
        throw new Error(`Lesson '${lesson.lessonId}' references unknown practice scenario '${scenarioId}'`);
      }
    }
  }

  for (const challenge of program.challenges) {
    for (const skillId of challenge.skillIds) {
      if (!skillById.has(skillId)) {
        throw new Error(`Challenge '${challenge.challengeDefinitionId}' references unknown skill '${skillId}'`);
      }
    }
    for (const scenarioId of challenge.scenarioIds) {
      const scenario = scenarioById.get(scenarioId);
      if (!scenario) {
        throw new Error(`Challenge '${challenge.challengeDefinitionId}' references unknown scenario '${scenarioId}'`);
      }
      if (!challenge.skillIds.includes(scenario.rematchLogic.targetSkillId)) {
        throw new Error(`Challenge scenario '${scenarioId}' targets skill '${scenario.rematchLogic.targetSkillId}' outside challenge '${challenge.challengeDefinitionId}'`);
      }
    }
  }

  // No unknown canonical Entity names anywhere in the program's scenarios.
  for (const scenario of scenarios) {
    for (const entity of scenario.hiddenEntities) {
      if (!knownEntityNames.has(entity)) {
        throw new Error(`Scenario '${scenario.scenarioId}' uses unknown Entity name '${entity}'`);
      }
    }
  }

  return {
    moduleCount: program.modules.length,
    lessonCount: program.lessons.length,
    skillCount: program.skills.length,
    scenarioCount: scenarios.length
  };
}
