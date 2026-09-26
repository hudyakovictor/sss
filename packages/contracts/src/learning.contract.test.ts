import assert from "node:assert/strict";
import test from "node:test";

import {
  SkillSchema,
  AcademyModuleSchema,
  LessonSchema,
  ChallengeDefinitionSchema,
  LearningStatusSchema,
  VerificationSourceSchema,
  ContentBlockSchema
} from "./learning.js";

const BASE_SKILL = {
  skillId: "invalidation-before-direction",
  canonicalName: "Invalidation Before Direction",
  description: "Define the condition that kills the idea before choosing a direction.",
  version: "1.0.0",
  prerequisiteSkillIds: [] as string[],
  scoringDimensions: ["invalidation", "discipline"] as const,
  status: "published" as const
};

const BASE_MODULE = {
  moduleId: "invalidation_before_direction",
  version: "1.0.0",
  title: "Invalidation Before Direction",
  level: 0,
  skillIds: ["invalidation-before-direction"],
  prerequisiteModuleIds: [] as string[],
  lessonIds: ["lesson-invalidation-intro"],
  challengeDefinitionId: "challenge-invalidation-001",
  transferScenarioIds: ["invalidation-transfer-001"],
  status: "published" as const
};

const BASE_LESSON = {
  lessonId: "lesson-invalidation-intro",
  moduleId: "invalidation_before_direction",
  version: "1.0.0",
  title: "Define the death condition first",
  learningObjective: "State an invalidation before committing to a direction.",
  contentBlocks: [
    { blockId: "b1", blockType: "principle", text: "An idea without a death condition is a wish." },
    {
      blockId: "b2",
      blockType: "worked_example",
      exampleId: "example-invalidation-001",
      text: "Breakout above level; invalidation is a close back below it."
    },
    { blockId: "b3", blockType: "recall_prompt", question: "What comes first?", expectedAnswer: "Invalidation." }
  ],
  workedExampleId: "example-invalidation-001",
  practiceScenarioIds: ["foundation-false-breakout-001"],
  estimatedMinutes: 5,
  status: "published" as const
};

const BASE_CHALLENGE = {
  challengeDefinitionId: "challenge-invalidation-001",
  moduleId: "invalidation_before_direction",
  skillIds: ["invalidation-before-direction"],
  scoringDimensions: ["invalidation", "discipline", "confidence_calibration"] as const,
  scenarioIds: ["invalidation-challenge-a-001", "invalidation-challenge-b-001"],
  criticalGates: ["invalidation_before_action", "evidence_sufficient"],
  passCriteria: {
    minQualityScore: 70,
    requireInvalidationBeforeAction: true,
    minEvidenceCount: 2,
    confidenceMin: 40,
    confidenceMax: 90
  },
  version: "1.0.0",
  status: "published" as const
};

test("Skill accepts a canonical publication object", () => {
  const skill = SkillSchema.parse(BASE_SKILL);
  assert.equal(skill.skillId, "invalidation-before-direction");
  assert.equal(skill.scoringDimensions.length, 2);
});

test("Skill rejects self-prerequisite and repeated dimensions", () => {
  assert.equal(
    SkillSchema.safeParse({ ...BASE_SKILL, prerequisiteSkillIds: ["invalidation-before-direction"] }).success,
    false
  );
  assert.equal(
    SkillSchema.safeParse({ ...BASE_SKILL, scoringDimensions: ["invalidation", "invalidation"] }).success,
    false
  );
});

test("Skill requires at least one scoring dimension and rejects unknown ones", () => {
  assert.equal(SkillSchema.safeParse({ ...BASE_SKILL, scoringDimensions: [] }).success, false);
  assert.equal(SkillSchema.safeParse({ ...BASE_SKILL, scoringDimensions: ["vibes"] }).success, false);
});

test("AcademyModule allows Level 0 but bounds level to 0..99", () => {
  assert.ok(AcademyModuleSchema.safeParse(BASE_MODULE).success);
  assert.equal(AcademyModuleSchema.safeParse({ ...BASE_MODULE, level: 100 }).success, false);
  assert.equal(AcademyModuleSchema.safeParse({ ...BASE_MODULE, level: 3.5 }).success, false);
});

test("AcademyModule rejects empty skills/lessons/transfer and self-prerequisite", () => {
  assert.equal(AcademyModuleSchema.safeParse({ ...BASE_MODULE, skillIds: [] }).success, false);
  assert.equal(AcademyModuleSchema.safeParse({ ...BASE_MODULE, lessonIds: [] }).success, false);
  assert.equal(AcademyModuleSchema.safeParse({ ...BASE_MODULE, transferScenarioIds: [] }).success, false);
  assert.equal(
    AcademyModuleSchema.safeParse({ ...BASE_MODULE, prerequisiteModuleIds: ["invalidation_before_direction"] })
      .success,
    false
  );
});

test("Lesson requires a worked_example block matching workedExampleId", () => {
  assert.ok(LessonSchema.safeParse(BASE_LESSON).success);
  const orphan = { ...BASE_LESSON, workedExampleId: "does-not-exist" };
  assert.equal(LessonSchema.safeParse(orphan).success, false);
});

test("Lesson content blocks forbid HTML", () => {
  const htmlBlock = {
    blockId: "bX",
    blockType: "principle",
    text: "<script>alert(1)</script>"
  };
  assert.equal(ContentBlockSchema.safeParse(htmlBlock).success, false);
  assert.equal(
    LessonSchema.safeParse({ ...BASE_LESSON, contentBlocks: [htmlBlock, ...BASE_LESSON.contentBlocks.slice(1)] })
      .success,
    false
  );
});

test("Lesson rejects repeated block ids and out-of-range estimates", () => {
  assert.equal(
    LessonSchema.safeParse({
      ...BASE_LESSON,
      contentBlocks: [...BASE_LESSON.contentBlocks, { ...BASE_LESSON.contentBlocks[0], blockType: "warning" }]
    }).success,
    false
  );
  assert.equal(LessonSchema.safeParse({ ...BASE_LESSON, estimatedMinutes: 0 }).success, false);
  assert.equal(LessonSchema.safeParse({ ...BASE_LESSON, estimatedMinutes: 45 }).success, false);
});

test("ChallengeDefinition requires critical gates and a bounded confidence range", () => {
  assert.ok(ChallengeDefinitionSchema.safeParse(BASE_CHALLENGE).success);
  assert.equal(ChallengeDefinitionSchema.safeParse({ ...BASE_CHALLENGE, criticalGates: [] }).success, false);
  assert.equal(
    ChallengeDefinitionSchema.safeParse({
      ...BASE_CHALLENGE,
      passCriteria: { ...BASE_CHALLENGE.passCriteria, confidenceMin: 95, confidenceMax: 90 }
    }).success,
    false
  );
});

test("LearningStatus has no terminal 'closed' state", () => {
  assert.equal(LearningStatusSchema.safeParse("closed").success, false);
  for (const status of [
    "locked",
    "available",
    "learning",
    "ready_for_verification",
    "verified",
    "transfer_pending",
    "mastered",
    "review_due"
  ]) {
    assert.ok(LearningStatusSchema.safeParse(status).success);
  }
});

test("VerificationSource is a closed allowlist", () => {
  assert.ok(VerificationSourceSchema.safeParse("challenge_out").success);
  assert.equal(VerificationSourceSchema.safeParse("self_report").success, false);
});

test("Learning objects reject unknown fields (strict wire shape)", () => {
  assert.equal(SkillSchema.safeParse({ ...BASE_SKILL, coinReward: 10 }).success, false);
  assert.equal(AcademyModuleSchema.safeParse({ ...BASE_MODULE, mastery: true }).success, false);
});
