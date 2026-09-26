import { z } from "zod";

import { ScoreDimensionSchema } from "./scenario.js";

// Server-authoritative learning contracts — Iteration 04 (Academy Level 0).
//
// Invariants (canonical, from AGENTS.md and the Iteration 04 guardrails):
//   - These are *publication* shapes (content authored and versioned by us),
//     plus the user-facing progression vocabulary. The client never computes
//     mastery, skill status, or Personal Insight; it only reads server output.
//   - A confirmed skill may later become `review_due` (delayed rematch), so the
//     progression enum has no terminal `closed` state.
//   - "Я это знаю" opens a Challenge Test; it never closes a topic by itself,
//     so verification is always tied to a `VerificationSource`, never to a
//     free-form self-report.
//   - Canonical Entity names remain exact English; content blocks carry plain
//     text only (no arbitrary HTML).

// Learning content is authored copy, not user input. We forbid angle brackets
// so a block can never smuggle markup into the renderer, and cap length so a
// micro-lesson stays a micro-lesson.
const PlainText = z
  .string()
  .min(1)
  .max(600)
  .refine((value) => !/[<>]/.test(value), {
    message: "Learning text must be plain text (no HTML tags)"
  });

const StableId = z.string().min(1).max(120);
const Semver = z.string().min(1).max(40);

export const LearningStatusSchema = z.enum([
  "locked",
  "available",
  "learning",
  "ready_for_verification",
  "verified",
  "transfer_pending",
  "mastered",
  "review_due"
]);

export const VerificationSourceSchema = z.enum([
  "guided_path",
  "challenge_out",
  "exam",
  "arena_transfer",
  "delayed_rematch"
]);

// Publication lifecycle for authored learning objects (skill/module/lesson/
// challenge). This is separate from per-user LearningStatus above.
export const LearningPublicationStatusSchema = z.enum([
  "draft",
  "validated",
  "published",
  "deprecated"
]);

const ContentBlockBase = {
  blockId: StableId
};

export const ContentBlockSchema = z.discriminatedUnion("blockType", [
  z.object({ ...ContentBlockBase, blockType: z.literal("principle"), text: PlainText }).strict(),
  z.object({ ...ContentBlockBase, blockType: z.literal("market_fact"), text: PlainText }).strict(),
  z.object({ ...ContentBlockBase, blockType: z.literal("not_evidence"), text: PlainText }).strict(),
  z
    .object({
      ...ContentBlockBase,
      blockType: z.literal("worked_example"),
      exampleId: StableId,
      text: PlainText
    })
    .strict(),
  z
    .object({
      ...ContentBlockBase,
      blockType: z.literal("comparison"),
      correctText: PlainText,
      incorrectText: PlainText
    })
    .strict(),
  z
    .object({
      ...ContentBlockBase,
      blockType: z.literal("recall_prompt"),
      question: PlainText,
      expectedAnswer: PlainText
    })
    .strict(),
  z.object({ ...ContentBlockBase, blockType: z.literal("warning"), text: PlainText }).strict(),
  z.object({ ...ContentBlockBase, blockType: z.literal("final_rule"), text: PlainText }).strict()
]);

export const SkillSchema = z
  .object({
    skillId: StableId,
    canonicalName: z.string().min(1).max(120),
    description: PlainText,
    version: Semver,
    prerequisiteSkillIds: z.array(StableId),
    scoringDimensions: z.array(ScoreDimensionSchema).min(1),
    status: LearningPublicationStatusSchema
  })
  .strict()
  .superRefine((skill, ctx) => {
    if (skill.prerequisiteSkillIds.includes(skill.skillId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["prerequisiteSkillIds"],
        message: `Skill '${skill.skillId}' cannot be its own prerequisite`
      });
    }
    if (new Set(skill.prerequisiteSkillIds).size !== skill.prerequisiteSkillIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["prerequisiteSkillIds"],
        message: `Skill '${skill.skillId}' repeats a prerequisite`
      });
    }
    if (new Set(skill.scoringDimensions).size !== skill.scoringDimensions.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scoringDimensions"],
        message: `Skill '${skill.skillId}' repeats a scoring dimension`
      });
    }
  });

export const AcademyModuleSchema = z
  .object({
    moduleId: StableId,
    version: Semver,
    title: PlainText,
    level: z.number().int().min(0).max(99),
    skillIds: z.array(StableId).min(1),
    prerequisiteModuleIds: z.array(StableId),
    lessonIds: z.array(StableId).min(1),
    challengeDefinitionId: StableId,
    transferScenarioIds: z.array(StableId).min(1),
    status: LearningPublicationStatusSchema
  })
  .strict()
  .superRefine((module, ctx) => {
    if (module.prerequisiteModuleIds.includes(module.moduleId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["prerequisiteModuleIds"],
        message: `Module '${module.moduleId}' cannot be its own prerequisite`
      });
    }
    for (const [key, list] of [
      ["skillIds", module.skillIds],
      ["lessonIds", module.lessonIds],
      ["transferScenarioIds", module.transferScenarioIds]
    ] as const) {
      if (new Set(list).size !== list.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `Module '${module.moduleId}' repeats an id in '${key}'`
        });
      }
    }
  });

export const LessonSchema = z
  .object({
    lessonId: StableId,
    moduleId: StableId,
    version: Semver,
    title: PlainText,
    learningObjective: PlainText,
    contentBlocks: z.array(ContentBlockSchema).min(1),
    workedExampleId: StableId,
    practiceScenarioIds: z.array(StableId).min(1),
    estimatedMinutes: z.number().int().min(1).max(30),
    status: LearningPublicationStatusSchema
  })
  .strict()
  .superRefine((lesson, ctx) => {
    const blockIds = lesson.contentBlocks.map((block) => block.blockId);
    if (new Set(blockIds).size !== blockIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contentBlocks"],
        message: `Lesson '${lesson.lessonId}' repeats a content block id`
      });
    }
    // A lesson must contain at least one worked_example block whose exampleId
    // matches the lesson's workedExampleId, so the reference is never dangling.
    const workedExample = lesson.contentBlocks.find((block) => block.blockType === "worked_example");
    if (!workedExample || workedExample.exampleId !== lesson.workedExampleId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workedExampleId"],
        message: `Lesson '${lesson.lessonId}' must contain a worked_example block matching workedExampleId`
      });
    }
  });

export const ChallengePassCriteriaSchema = z
  .object({
    minQualityScore: z.number().int().min(0).max(100),
    requireInvalidationBeforeAction: z.boolean(),
    minEvidenceCount: z.number().int().min(0).max(10),
    confidenceMin: z.number().int().min(0).max(100),
    confidenceMax: z.number().int().min(0).max(100)
  })
  .strict()
  .superRefine((criteria, ctx) => {
    if (criteria.confidenceMin > criteria.confidenceMax) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confidenceMin"],
        message: "confidenceMin must not exceed confidenceMax"
      });
    }
  });

export const ChallengeDefinitionSchema = z
  .object({
    challengeDefinitionId: StableId,
    moduleId: StableId,
    skillIds: z.array(StableId).min(1),
    scoringDimensions: z.array(ScoreDimensionSchema).min(1),
    scenarioIds: z.array(StableId).min(1),
    criticalGates: z.array(StableId).min(1),
    passCriteria: ChallengePassCriteriaSchema,
    version: Semver,
    status: LearningPublicationStatusSchema
  })
  .strict();

// Client-facing request to open a Challenge Test for a module. The client names
// *which* equivalent scenario it will attempt (both share one criteria set); the
// server validates it belongs to the module's challenge before starting a run.
// Opening a challenge never changes progression — only the verify step does.
export const AcademyChallengeStartRequestSchema = z.object({
  scenarioId: StableId,
  idempotencyKey: z.string().min(1).max(200)
}).strict();

export type LearningStatus = z.infer<typeof LearningStatusSchema>;
export type VerificationSource = z.infer<typeof VerificationSourceSchema>;
export type LearningPublicationStatus = z.infer<typeof LearningPublicationStatusSchema>;
export type ContentBlock = z.infer<typeof ContentBlockSchema>;
export type Skill = z.infer<typeof SkillSchema>;
export type AcademyModule = z.infer<typeof AcademyModuleSchema>;
export type Lesson = z.infer<typeof LessonSchema>;
export type ChallengePassCriteria = z.infer<typeof ChallengePassCriteriaSchema>;
export type ChallengeDefinition = z.infer<typeof ChallengeDefinitionSchema>;
export type AcademyChallengeStartRequest = z.infer<typeof AcademyChallengeStartRequestSchema>;
