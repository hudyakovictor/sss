import type {
  HistoricalMarketSnapshot,
  LedgerPage,
  ScenarioPackage,
  ScoreResult,
  UserEconomyState
} from "../../contracts/src/index.js";
import type { DecisionTrace } from "../../contracts/src/run.js";
import type { DatabaseHandle } from "./database.js";
import {
  appendDecisionEvents,
  appendLedgerEvent,
  applyScenarioCompletionRewards,
  consumeAuthReplayKey,
  createAuthSession,
  createLearningAttempt,
  createScenarioRun,
  ensureEconomyState,
  finalizeLearningAttempt,
  getActiveAuthSession,
  getEconomyState,
  getHistoricalSnapshot,
  getLearningAttempt,
  getLearningModule,
  getModuleProgress,
  getOrCreateUserForIdentity,
  getScenarioPackage,
  getScenarioRun,
  listDecisionEventsByRun,
  listLedgerEvents,
  projectEconomyState,
  revokeAuthSession,
  revealScenarioRun,
  sealScenarioRun,
  startEligibleScenarioRun,
  upsertHistoricalSnapshot,
  upsertLearningModule,
  upsertModuleProgress,
  type AppendDecisionEventsResult,
  type AppendLedgerEventInput,
  type AppendLedgerEventResult,
  type AuthSessionRecord,
  type CreateAuthSessionInput,
  type CreateLearningAttemptInput,
  type CreateScenarioRunInput,
  type DecisionEventRecord,
  type FinalizeLearningAttemptInput,
  type HistoricalSnapshotRecord,
  type LearningAttemptRecord,
  type LearningModuleRecord,
  type ListLedgerEventsOptions,
  type ModuleProgressRecord,
  type PlatformIdentityInput,
  type ScenarioCompletionRewardsInput,
  type ScenarioCompletionRewardsResult,
  type ScenarioRunRecord,
  type StartEligibleRunInput,
  type StartEligibleRunResult,
  type UpsertLearningModuleInput,
  type UpsertModuleProgressInput
} from "./repository.js";
import type { PersistencePort } from "./ports.js";

export class SqlitePersistenceAdapter implements PersistencePort {
  public constructor(private readonly handle: DatabaseHandle) {}

  public async getOrCreateUserForIdentity(
    input: PlatformIdentityInput
  ): Promise<{ userId: string; created: boolean }> {
    return getOrCreateUserForIdentity(this.handle, input);
  }

  public async consumeAuthReplayKey(
    replayKey: string,
    expiresAtMs: number,
    nowMs?: number
  ): Promise<boolean> {
    return consumeAuthReplayKey(this.handle, replayKey, expiresAtMs, nowMs);
  }

  public async createAuthSession(input: CreateAuthSessionInput): Promise<AuthSessionRecord> {
    return createAuthSession(this.handle, input);
  }

  public async getActiveAuthSession(
    tokenHash: string,
    now?: string
  ): Promise<AuthSessionRecord | undefined> {
    return getActiveAuthSession(this.handle, tokenHash, now);
  }

  public async revokeAuthSession(sessionId: string, revokedAt?: string): Promise<boolean> {
    return revokeAuthSession(this.handle, sessionId, revokedAt);
  }

  public async getScenarioPackage(
    scenarioId: string,
    version: string
  ): Promise<ScenarioPackage | undefined> {
    return getScenarioPackage(this.handle, scenarioId, version);
  }

  public async createScenarioRun(input: CreateScenarioRunInput): Promise<ScenarioRunRecord> {
    return createScenarioRun(this.handle, input);
  }

  public async getScenarioRun(
    runId: string,
    userId: string
  ): Promise<ScenarioRunRecord | undefined> {
    return getScenarioRun(this.handle, runId, userId);
  }

  public async sealScenarioRun(
    runId: string,
    userId: string,
    decision: DecisionTrace,
    score: ScoreResult
  ): Promise<ScenarioRunRecord> {
    return sealScenarioRun(this.handle, runId, userId, decision, score);
  }

  public async revealScenarioRun(
    runId: string,
    userId: string
  ): Promise<ScenarioRunRecord> {
    return revealScenarioRun(this.handle, runId, userId);
  }

  public async upsertHistoricalSnapshot(
    snapshot: HistoricalMarketSnapshot,
    snapshotId?: string,
    createdAt?: string
  ): Promise<HistoricalSnapshotRecord> {
    return upsertHistoricalSnapshot(this.handle, snapshot, snapshotId, createdAt);
  }

  public async getHistoricalSnapshot(
    snapshotId: string
  ): Promise<HistoricalSnapshotRecord | undefined> {
    return getHistoricalSnapshot(this.handle, snapshotId);
  }

  public async getEconomyState(userId: string): Promise<UserEconomyState | undefined> {
    return getEconomyState(this.handle, userId);
  }

  public async ensureEconomyState(userId: string, now?: string): Promise<UserEconomyState> {
    return ensureEconomyState(this.handle, userId, now);
  }

  public async appendLedgerEvent(
    input: AppendLedgerEventInput
  ): Promise<AppendLedgerEventResult> {
    return appendLedgerEvent(this.handle, input);
  }

  public async listLedgerEvents(
    userId: string,
    options?: ListLedgerEventsOptions
  ): Promise<LedgerPage> {
    return listLedgerEvents(this.handle, userId, options);
  }

  public async projectEconomyState(
    userId: string,
    now?: string
  ): Promise<UserEconomyState> {
    return projectEconomyState(this.handle, userId, now);
  }

  public async startEligibleScenarioRun(
    input: StartEligibleRunInput
  ): Promise<StartEligibleRunResult> {
    return startEligibleScenarioRun(this.handle, input);
  }

  public async applyScenarioCompletionRewards(
    input: ScenarioCompletionRewardsInput
  ): Promise<ScenarioCompletionRewardsResult> {
    return applyScenarioCompletionRewards(this.handle, input);
  }

  public async upsertLearningModule(
    input: UpsertLearningModuleInput
  ): Promise<LearningModuleRecord> {
    return upsertLearningModule(this.handle, input);
  }

  public async getLearningModule(
    moduleId: string,
    version: string
  ): Promise<LearningModuleRecord | undefined> {
    return getLearningModule(this.handle, moduleId, version);
  }

  public async getModuleProgress(
    userId: string,
    moduleId: string,
    moduleVersion: string
  ): Promise<ModuleProgressRecord | undefined> {
    return getModuleProgress(this.handle, userId, moduleId, moduleVersion);
  }

  public async upsertModuleProgress(
    input: UpsertModuleProgressInput
  ): Promise<ModuleProgressRecord> {
    return upsertModuleProgress(this.handle, input);
  }

  public async createLearningAttempt(
    input: CreateLearningAttemptInput
  ): Promise<LearningAttemptRecord> {
    return createLearningAttempt(this.handle, input);
  }

  public async getLearningAttempt(
    attemptId: string,
    userId: string
  ): Promise<LearningAttemptRecord | undefined> {
    return getLearningAttempt(this.handle, attemptId, userId);
  }

  public async finalizeLearningAttempt(
    input: FinalizeLearningAttemptInput
  ): Promise<LearningAttemptRecord> {
    return finalizeLearningAttempt(this.handle, input);
  }

  public async appendDecisionEvents(
    events: readonly DecisionEventRecord[]
  ): Promise<AppendDecisionEventsResult> {
    return appendDecisionEvents(this.handle, events);
  }

  public async listDecisionEventsByRun(
    userId: string,
    runId: string
  ): Promise<DecisionEventRecord[]> {
    return listDecisionEventsByRun(this.handle, userId, runId);
  }
}
