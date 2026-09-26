import {
  AcademyModuleSchema,
  ChallengeDefinitionSchema,
  LessonSchema,
  SkillSchema
} from "../../../contracts/src/learning.js";

// Academy Level 0 — first canonical module: "Invalidation Before Direction".
//
// Learning ladder (AGENTS.md): Theory Module -> Worked Example -> Skill Card ->
// Recall -> Decision -> Debrief -> Delayed Rematch. This module is intentionally
// minimal: one micro-lesson, one worked example, one recall prompt, one guided
// practice, one Challenge Test (two equivalent scenarios) and one Arena Transfer.
//
// No Coins gate any of this; verification is server-authoritative (Phase 2).

export const invalidationSkill = SkillSchema.parse({
  skillId: "invalidation-before-direction",
  canonicalName: "Invalidation Before Direction",
  description:
    "State the condition that kills the idea before choosing a trade direction, so the plan is falsifiable from the start.",
  version: "1.0.0",
  prerequisiteSkillIds: [],
  scoringDimensions: ["invalidation", "discipline", "decision_quality", "confidence_calibration"],
  status: "published"
});

export const invalidationLesson = LessonSchema.parse({
  lessonId: "lesson-invalidation-intro",
  moduleId: "invalidation_before_direction",
  version: "1.0.0",
  title: "Define the death condition first",
  learningObjective:
    "Given a setup, write a concrete invalidation level before selecting long, short, or wait.",
  contentBlocks: [
    {
      blockId: "blk-problem",
      blockType: "principle",
      text: "A direction chosen without an invalidation is a wish, not a plan."
    },
    {
      blockId: "blk-market-fact",
      blockType: "market_fact",
      text: "Breakouts frequently fail back through the level they just crossed."
    },
    {
      blockId: "blk-not-evidence",
      blockType: "not_evidence",
      text: "A single strong candle is momentum, not confirmation of a new regime."
    },
    {
      blockId: "blk-comparison",
      blockType: "comparison",
      correctText: "Invalidation: a 4h close back below the reclaimed level. Then decide.",
      incorrectText: "Invalidation: 'it feels overextended' — no level, no exit."
    },
    {
      blockId: "blk-worked-example",
      blockType: "worked_example",
      exampleId: "example-invalidation-001",
      text: "Price reclaims resistance at 100. Invalidation is a close below 98. Only above 98 stays valid does a long plan remain open."
    },
    {
      blockId: "blk-warning",
      blockType: "warning",
      text: "Writing the invalidation after the direction is confirmation bias, not risk control."
    },
    {
      blockId: "blk-recall",
      blockType: "recall_prompt",
      question: "What must exist before you pick a direction?",
      expectedAnswer: "A concrete invalidation level that kills the idea."
    },
    {
      blockId: "blk-final-rule",
      blockType: "final_rule",
      text: "No invalidation, no trade. Define the death condition, then choose."
    }
  ],
  workedExampleId: "example-invalidation-001",
  practiceScenarioIds: ["foundation-false-breakout-001"],
  estimatedMinutes: 6,
  status: "published"
});

export const invalidationChallenge = ChallengeDefinitionSchema.parse({
  challengeDefinitionId: "challenge-invalidation-001",
  moduleId: "invalidation_before_direction",
  skillIds: ["invalidation-before-direction"],
  scoringDimensions: ["invalidation", "discipline", "decision_quality", "confidence_calibration"],
  scenarioIds: ["invalidation-challenge-a-001", "invalidation-challenge-b-001"],
  criticalGates: ["invalidation_before_action", "evidence_sufficient", "confidence_in_range"],
  passCriteria: {
    minQualityScore: 70,
    requireInvalidationBeforeAction: true,
    minEvidenceCount: 2,
    confidenceMin: 40,
    confidenceMax: 90
  },
  version: "1.0.0",
  status: "published"
});

export const invalidationModule = AcademyModuleSchema.parse({
  moduleId: "invalidation_before_direction",
  version: "1.0.0",
  title: "Invalidation Before Direction",
  level: 0,
  skillIds: ["invalidation-before-direction"],
  prerequisiteModuleIds: [],
  lessonIds: ["lesson-invalidation-intro"],
  challengeDefinitionId: "challenge-invalidation-001",
  transferScenarioIds: ["invalidation-transfer-001"],
  status: "published"
});

export const academyIntroProgram = {
  modules: [invalidationModule],
  lessons: [invalidationLesson],
  skills: [invalidationSkill],
  challenges: [invalidationChallenge]
};
