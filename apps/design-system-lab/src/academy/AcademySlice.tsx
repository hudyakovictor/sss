import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  api,
  type AcademyModuleState,
  type AcademyVerifyResult,
  type RunResponse
} from "../play/api";
import type {
  ContentBlock,
  LearningStatus,
  ScenarioPublicProjection
} from "@signal-arena/contracts";
import { DecisionWorkspace, type DecisionDraft } from "./DecisionWorkspace";
import { statusLabel } from "./labels";

// Academy Level 0 — the first real, server-driven learning UI (Phase 5).
//
// The screen reads its module/lesson content and the learner's progression from
// the API; nothing user-facing is hard-coded. "Я это знаю — проверить" opens a
// Challenge Test; only the server /verify step can move a topic to `verified`.
// A failed challenge never closes the topic — it returns the learner to a
// corrective state, never a downgrade of an already-verified skill.

const MODULE_ID = "invalidation_before_direction";
const PRACTICE_SCENARIO = { id: "foundation-false-breakout-001", version: "1.0.0" };

type RunMode = "practice" | "challenge" | "transfer";

type Step =
  | { name: "boot" }
  | { name: "level0" }
  | { name: "lesson" }
  | { name: "practice-brief" }
  | { name: "challenge-brief" }
  | { name: "transfer-brief" }
  | { name: "decide"; mode: RunMode }
  | { name: "practice-result" }
  | { name: "challenge-result"; result: AcademyVerifyResult };

type ActiveRun = {
  runId: string;
  scenarioId: string;
  scenarioVersion: string;
  idempotencyKey: string;
  attemptId?: string;
  mode: RunMode;
};

const ACTIVE_KEY = "sa-academy-active-run";

function readActive(): ActiveRun | null {
  try {
    const raw = window.localStorage.getItem(ACTIVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveRun;
    return typeof parsed.runId === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function writeActive(run: ActiveRun | null): void {
  try {
    if (run) window.localStorage.setItem(ACTIVE_KEY, JSON.stringify(run));
    else window.localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* storage may be unavailable; the flow still works for one session */
  }
}

function newKey(prefix: string): string {
  return `${prefix}:${(globalThis.crypto?.randomUUID?.() ?? String(Date.now()))}`;
}

function blockText(block: ContentBlock): string {
  switch (block.blockType) {
    case "comparison":
      return `✓ ${block.correctText}\n✕ ${block.incorrectText}`;
    case "recall_prompt":
      return `${block.question}`;
    default:
      return block.text;
  }
}

export function AcademySlice() {
  const [state, setState] = useState<AcademyModuleState | null>(null);
  const [step, setStep] = useState<Step>({ name: "boot" });
  const [scenario, setScenario] = useState<ScenarioPublicProjection | null>(null);
  const [run, setRun] = useState<RunResponse | null>(null);
  const [practiceScore, setPracticeScore] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [insufficientEnergy, setInsufficientEnergy] = useState(false);
  const booted = useRef(false);

  const loadModule = useCallback(async () => {
    const next = await api.getModuleState(MODULE_ID);
    setState(next);
    return next;
  }, []);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void (async () => {
      try {
        await loadModule();
        const active = readActive();
        if (active) {
          const restored = await api.getRun(active.runId);
          setRun(restored.run);
          if (active.mode === "challenge" || active.mode === "transfer") {
            setStep({ name: "decide", mode: active.mode });
            const projection = await api.getScenario(active.scenarioId, active.scenarioVersion);
            setScenario(projection);
          } else if (restored.run.state === "revealed" || restored.run.state === "completed") {
            setPracticeScore(restored.run.score?.score ?? null);
            setStep({ name: "practice-result" });
          } else {
            setStep({ name: "decide", mode: "practice" });
            const projection = await api.getScenario(active.scenarioId, active.scenarioVersion);
            setScenario(projection);
          }
        } else {
          setStep({ name: "level0" });
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.code : "academy_boot_failed");
        setStep({ name: "level0" });
      }
    })();
  }, [loadModule]);

  const status: LearningStatus = state?.status ?? "available";
  const challengeScenarioId = state?.challenge?.scenarioIds[0];
  const transferScenarioId = state?.module.transferScenarioIds[0];

  const loadPracticeScenario = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const projection = await api.getScenario(PRACTICE_SCENARIO.id, PRACTICE_SCENARIO.version);
      setScenario(projection);
      setStep({ name: "practice-brief" });
    } catch (err) {
      setError(err instanceof ApiError ? err.code : "scenario_load_failed");
    } finally {
      setBusy(false);
    }
  }, []);

  const loadChallengeScenario = useCallback(async () => {
    if (!challengeScenarioId) {
      setError("challenge_unavailable");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const projection = await api.getScenario(challengeScenarioId);
      setScenario(projection);
      setStep({ name: "challenge-brief" });
    } catch (err) {
      setError(err instanceof ApiError ? err.code : "scenario_load_failed");
    } finally {
      setBusy(false);
    }
  }, [challengeScenarioId]);

  const beginPractice = useCallback(async () => {
    if (!scenario) return;
    setBusy(true);
    setError(null);
    setInsufficientEnergy(false);
    try {
      const idempotencyKey = newKey("academy-practice");
      const result = await api.startRun({
        scenarioId: scenario.scenarioId,
        scenarioVersion: scenario.version,
        idempotencyKey
      });
      writeActive({
        runId: result.run.runId,
        scenarioId: scenario.scenarioId,
        scenarioVersion: scenario.version,
        idempotencyKey,
        mode: "practice"
      });
      setRun(result.run);
      setStep({ name: "decide", mode: "practice" });
    } catch (err) {
      if (err instanceof ApiError && err.code === "insufficient_energy") setInsufficientEnergy(true);
      else setError(err instanceof ApiError ? err.code : "start_failed");
    } finally {
      setBusy(false);
    }
  }, [scenario]);

  const beginChallenge = useCallback(async () => {
    if (!scenario || !challengeScenarioId) return;
    setBusy(true);
    setError(null);
    setInsufficientEnergy(false);
    try {
      const idempotencyKey = newKey("academy-challenge");
      const started = await api.startChallenge(MODULE_ID, {
        scenarioId: scenario.scenarioId,
        idempotencyKey
      });
      writeActive({
        runId: started.run.runId,
        scenarioId: started.attempt.scenarioId,
        scenarioVersion: scenario.version,
        idempotencyKey,
        attemptId: started.attempt.attemptId,
        mode: "challenge"
      });
      setRun(started.run);
      setStep({ name: "decide", mode: "challenge" });
    } catch (err) {
      if (err instanceof ApiError && err.code === "insufficient_energy") setInsufficientEnergy(true);
      else setError(err instanceof ApiError ? err.code : "challenge_start_failed");
    } finally {
      setBusy(false);
    }
  }, [scenario, challengeScenarioId]);

  const loadTransferScenario = useCallback(async () => {
    if (!transferScenarioId) {
      setError("transfer_unavailable");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const projection = await api.getScenario(transferScenarioId);
      setScenario(projection);
      setStep({ name: "transfer-brief" });
    } catch (err) {
      setError(err instanceof ApiError ? err.code : "scenario_load_failed");
    } finally {
      setBusy(false);
    }
  }, [transferScenarioId]);

  const beginTransfer = useCallback(async () => {
    if (!scenario || !transferScenarioId) return;
    setBusy(true);
    setError(null);
    setInsufficientEnergy(false);
    try {
      const idempotencyKey = newKey("academy-transfer");
      const started = await api.startTransfer(MODULE_ID, {
        scenarioId: scenario.scenarioId,
        idempotencyKey
      });
      writeActive({
        runId: started.run.runId,
        scenarioId: started.attempt.scenarioId,
        scenarioVersion: scenario.version,
        idempotencyKey,
        attemptId: started.attempt.attemptId,
        mode: "transfer"
      });
      setRun(started.run);
      setStep({ name: "decide", mode: "transfer" });
    } catch (err) {
      if (err instanceof ApiError && err.code === "insufficient_energy") setInsufficientEnergy(true);
      else setError(err instanceof ApiError ? err.code : "transfer_start_failed");
    } finally {
      setBusy(false);
    }
  }, [scenario, transferScenarioId]);

  const sealAndFinish = useCallback(
    async (draft: DecisionDraft) => {
      if (!run) return;
      const active = readActive();
      setBusy(true);
      setError(null);
      try {
        await api.sealRun(run.runId, {
          action: draft.action as never,
          evidenceSourceIds: draft.evidenceSourceIds,
          invalidation: draft.invalidation,
          confidence: draft.confidence
        });
        if ((active?.mode === "challenge" || active?.mode === "transfer") && active.attemptId) {
          const verdict = await api.verifyAttempt(active.attemptId);
          await loadModule();
          writeActive(null);
          setRun(null);
          setStep({ name: "challenge-result", result: verdict });
        } else {
          const revealed = await api.revealRun(run.runId);
          setRun(revealed.run);
          setPracticeScore(revealed.run.score?.score ?? null);
          writeActive(null);
          setStep({ name: "practice-result" });
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.code : "seal_failed");
      } finally {
        setBusy(false);
      }
    },
    [run, loadModule]
  );

  const backToLevel0 = useCallback(async () => {
    writeActive(null);
    setRun(null);
    setScenario(null);
    setPracticeScore(null);
    setError(null);
    await loadModule();
    setStep({ name: "level0" });
  }, [loadModule]);

  const header = useMemo(
    () => (
      <div className="academy-head">
        <div>
          <span className="kicker">ACADEMY · LEVEL {state?.module.level ?? 0}</span>
          <h2 data-testid="academy-title">{state?.module.title ?? "Загрузка…"}</h2>
        </div>
        <div className="academy-status">
          <span className="academy-badge" data-testid="academy-status">
            {statusLabel(status)}
          </span>
          <button className="secondary" data-testid="academy-home" onClick={backToLevel0}>
            К началу
          </button>
        </div>
      </div>
    ),
    [state, status, backToLevel0]
  );

  if (step.name === "boot" || (!state && step.name !== "level0")) {
    return (
      <section className="academy-slice" data-testid="academy-slice">
        {header}
        <p className="academy-loading" data-testid="academy-loading">
          Подключение к Академии…
        </p>
      </section>
    );
  }

  return (
    <section className="academy-slice" data-testid="academy-slice">
      {header}

      {error ? (
        <p className="academy-error" role="alert" data-testid="error">
          Ошибка: {error}{" "}
          <button className="link" onClick={() => setError(null)} data-testid="dismiss-error">
            скрыть
          </button>
        </p>
      ) : null}

      {step.name === "level0" && state ? (
        <div className="academy-level0" data-testid="academy-level0">
          <p className="academy-lede">Ты здесь не за сигналами. Здесь учат думать.</p>
          <p className="academy-objective">{state.lessons[0]?.learningObjective}</p>
          <div className="academy-actions">
            <button
              className="primary"
              data-testid="academy-start"
              onClick={() => setStep({ name: "lesson" })}
            >
              {status === "available" || status === "locked" ? "Начать обучение" : "Продолжить обучение"}
            </button>
            <div className="academy-known">
              <span>Уже знаком с темой?</span>
              <button
                className="secondary"
                data-testid="academy-challenge-entry"
                onClick={loadChallengeScenario}
                disabled={busy}
              >
                Я это знаю — проверить
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {step.name === "lesson" && state ? (
        <div className="academy-lesson" data-testid="academy-lesson">
          <h3>{state.lessons[0]?.title}</h3>
          <ol className="academy-blocks">
            {state.lessons[0]?.contentBlocks.map((block) => (
              <li key={block.blockId} className={`academy-block academy-block--${block.blockType}`}>
                <span className="academy-block__type">{block.blockType.replace(/_/g, " ")}</span>
                <p className="academy-block__text">{blockText(block)}</p>
                {block.blockType === "recall_prompt" ? (
                  <details className="academy-recall">
                    <summary>Показать ответ</summary>
                    <p>{block.expectedAnswer}</p>
                  </details>
                ) : null}
              </li>
            ))}
          </ol>
          <div className="academy-actions">
            <button className="primary" data-testid="academy-practice-entry" onClick={loadPracticeScenario} disabled={busy}>
              Тренировка
            </button>
            <button className="secondary" data-testid="academy-challenge-entry" onClick={loadChallengeScenario} disabled={busy}>
              Я это знаю — проверить
            </button>
          </div>
        </div>
      ) : null}

      {step.name === "practice-brief" && scenario ? (
        <div className="academy-brief">
          <p>
            {scenario.marketSegment} · {scenario.timeframe} · уровень {scenario.scenarioLevel}
          </p>
          <p className="academy-note">
            Тренировка не подтверждает навык и не влияет на прогресс. Это репетиция.
          </p>
          <button className="primary" data-testid="start-run" onClick={beginPractice} disabled={busy}>
            Начать тренировку
          </button>
        </div>
      ) : null}

      {step.name === "challenge-brief" && scenario ? (
        <div className="academy-brief" data-testid="challenge-brief">
          <p>
            {scenario.marketSegment} · {scenario.timeframe} · уровень {scenario.scenarioLevel}
          </p>
          <p className="academy-note">
            Теория будет пропущена только при подтверждении навыка. Оценивается процесс решения, а не
            угаданное направление.
          </p>
          <button className="primary" data-testid="start-challenge" onClick={beginChallenge} disabled={busy}>
            Пройти Challenge Test
          </button>
        </div>
      ) : null}

      {insufficientEnergy ? (
        <p className="academy-energy" role="alert" data-testid="insufficient-energy">
          Недостаточно энергии. Попробуй позже.
        </p>
      ) : null}

      {step.name === "transfer-brief" && scenario ? (
        <div className="academy-brief" data-testid="transfer-brief">
          <p>
            {scenario.marketSegment} · {scenario.timeframe} · уровень {scenario.scenarioLevel}
          </p>
          <p className="academy-note">
            Arena Transfer — тот же навык в новом контексте и без учебной подсказки. Успех даёт
            предварительное mastery; полное mastery требует отложенного rematch.
          </p>
          <button className="primary" data-testid="start-transfer" onClick={beginTransfer} disabled={busy}>
            Пройти Arena Transfer
          </button>
        </div>
      ) : null}

      {step.name === "decide" && scenario ? (
        <div className="academy-decide">
          <p className="academy-decide__title">
            {step.mode === "challenge" ? "Challenge Test" : step.mode === "transfer" ? "Arena Transfer" : "Тренировка"}
          </p>
          <DecisionWorkspace
            scenario={scenario}
            busy={busy}
            error={error}
            sealLabel={step.mode === "practice" ? "Зафиксировать решение" : "Проверить меня"}
            onSeal={(draft) => void sealAndFinish(draft)}
          />
        </div>
      ) : null}

      {step.name === "practice-result" ? (
        <div className="academy-result" data-testid="practice-result">
          <p>
            Тренировка завершена. Оценка процесса:{" "}
            <b data-testid="practice-score">{practiceScore ?? "—"}</b>/100
          </p>
          <p className="academy-note">Это не подтверждение навыка — пройди Challenge Test.</p>
          <button className="primary" data-testid="academy-challenge-entry" onClick={loadChallengeScenario} disabled={busy}>
            Я это знаю — проверить
          </button>
        </div>
      ) : null}

      {step.name === "challenge-result" ? (
        <ChallengeResult
          result={step.result}
          onDone={() => void backToLevel0()}
          onTransfer={() => void loadTransferScenario()}
        />
      ) : null}
    </section>
  );
}

function ChallengeResult({
  result,
  onDone,
  onTransfer
}: {
  result: AcademyVerifyResult;
  onDone: () => void;
  onTransfer: () => void;
}) {
  const { verification } = result;
  const verified = verification.verified;
  const isTransfer = verification.attemptType === "transfer";
  return (
    <div
      className={`academy-result ${verified ? "is-verified" : "is-failed"}`}
      data-testid="challenge-result"
      aria-live="polite"
    >
      {verified ? (
        isTransfer ? (
          <>
            <h3 data-testid="transfer-success">Навык перенесён в арену</h3>
            <p>Предварительное mastery закреплено. Полный статус требует отложенного rematch.</p>
          </>
        ) : (
          <>
            <h3 data-testid="challenge-success">Тема подтверждена</h3>
            <p>Следующий этап: Arena Transfer.</p>
          </>
        )
      ) : (
        <>
          <h3 data-testid="challenge-fail">{isTransfer ? "Transfer пока не пройден" : "Пока не подтверждено"}</h3>
          <p data-testid="challenge-fail-reason">
            {verification.reasons[0] ??
              "Ты знаешь термин, но сформулировал инвалидацию после выбора направления."}
          </p>
          <p className="academy-note">
            Рекомендуем материал: «Инвалидация — условие смерти гипотезы».
          </p>
        </>
      )}
      <p>
        Оценка: <b data-testid="challenge-score">{verification.qualityScore}</b>/100
      </p>
      {verified && !isTransfer ? (
        <button className="primary" data-testid="transfer-entry" onClick={onTransfer}>
          Перейти к Arena Transfer
        </button>
      ) : null}
      <button className={verified && !isTransfer ? "secondary" : "primary"} data-testid="challenge-done" onClick={onDone}>
        Готово
      </button>
    </div>
  );
}

