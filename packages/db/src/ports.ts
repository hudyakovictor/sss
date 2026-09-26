import type {
  AppendLedgerEventInput,
  AppendLedgerEventResult,
  AppendDecisionEventsResult,
  AuthSessionRecord,
  CreateAuthSessionInput,
  CreateLearningAttemptInput,
  CreateScenarioRunInput,
  DecisionEventRecord,
  FinalizeLearningAttemptInput,
  HistoricalSnapshotRecord,
  LearningAttemptRecord,
  LearningModuleRecord,
  ListLedgerEventsOptions,
  ModuleProgressRecord,
  PlatformIdentityInput,
  ScenarioCompletionRewardsInput,
  ScenarioCompletionRewardsResult,
  ScenarioRunRecord,
  StartEligibleRunInput,
  StartEligibleRunResult,
  UpsertLearningModuleInput,
  UpsertModuleProgressInput
} from "./repository.js";
import type { DecisionTrace } from "../../contracts/src/run.js";
import type {
  HistoricalMarketSnapshot,
  LedgerPage,
  ScenarioPackage,
  ScoreResult,
  UserEconomyState
} from "../../contracts/src/index.js";

export type PersistencePort = {
  getOrCreateUserForIdentity(
    input: PlatformIdentityInput
  ): Promise<{ userId: string; created: boolean }>;
  consumeAuthReplayKey(
    replayKey: string,
    expiresAtMs: number,
    nowMs?: number
  ): Promise<boolean>;
  createAuthSession(input: CreateAuthSessionInput): Promise<AuthSessionRecord>;
  getActiveAuthSession(tokenHash: string, now?: string): Promise<AuthSessionRecord | undefined>;
  revokeAuthSession(sessionId: string, revokedAt?: string): Promise<boolean>;
  getScenarioPackage(scenarioId: string, version: string): Promise<ScenarioPackage | undefined>;
  createScenarioRun(input: CreateScenarioRunInput): Promise<ScenarioRunRecord>;
  getScenarioRun(runId: string, userId: string): Promise<ScenarioRunRecord | undefined>;
  sealScenarioRun(
    runId: string,
    userId: string,
    decision: DecisionTrace,
    score: ScoreResult
  ): Promise<ScenarioRunRecord>;
  revealScenarioRun(runId: string, userId: string): Promise<ScenarioRunRecord>;
  upsertHistoricalSnapshot(
    snapshot: HistoricalMarketSnapshot,
    snapshotId?: string,
    createdAt?: string
  ): Promise<HistoricalSnapshotRecord>;
  getHistoricalSnapshot(snapshotId: string): Promise<HistoricalSnapshotRecord | undefined>;
  getEconomyState(userId: string): Promise<UserEconomyState | undefined>;
  ensureEconomyState(userId: string, now?: string): Promise<UserEconomyState>;
  appendLedgerEvent(input: AppendLedgerEventInput): Promise<AppendLedgerEventResult>;
  listLedgerEvents(userId: string, options?: ListLedgerEventsOptions): Promise<LedgerPage>;
  projectEconomyState(userId: string, now?: string): Promise<UserEconomyState>;
  startEligibleScenarioRun(input: StartEligibleRunInput): Promise<StartEligibleRunResult>;
  applyScenarioCompletionRewards(
    input: ScenarioCompletionRewardsInput
  ): Promise<ScenarioCompletionRewardsResult>;
  upsertLearningModule(input: UpsertLearningModuleInput): Promise<LearningModuleRecord>;
  getLearningModule(moduleId: string, version: string): Promise<LearningModuleRecord | undefined>;
  getModuleProgress(
    userId: string,
    moduleId: string,
    moduleVersion: string
  ): Promise<ModuleProgressRecord | undefined>;
  upsertModuleProgress(input: UpsertModuleProgressInput): Promise<ModuleProgressRecord>;
  createLearningAttempt(input: CreateLearningAttemptInput): Promise<LearningAttemptRecord>;
  getLearningAttempt(
    attemptId: string,
    userId: string
  ): Promise<LearningAttemptRecord | undefined>;
  finalizeLearningAttempt(
    input: FinalizeLearningAttemptInput
  ): Promise<LearningAttemptRecord>;
  appendDecisionEvents(
    events: readonly DecisionEventRecord[]
  ): Promise<AppendDecisionEventsResult>;
  listDecisionEventsByRun(
    userId: string,
    runId: string
  ): Promise<DecisionEventRecord[]>;
};
