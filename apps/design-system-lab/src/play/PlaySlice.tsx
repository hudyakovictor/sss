import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  api,
  type RewardResult,
  type RunResponse
} from './api';
import type { ScenarioPublicProjection, UserEconomyState } from '@signal-arena/contracts';
import { DecisionWorkspace, type DecisionDraft } from '../academy/DecisionWorkspace';

// A deliberately minimal, real vertical slice wired to the API (not fixtures):
// start a run, then decide — evidence, direction, invalidation, confidence — seal,
// reveal, and claim the server-scored XP/Mastery. Coins stay 0 throughout; every
// mutation is server-made and idempotent, and a reload restores the run from the
// server. The decision form is the corrected, shared Decision Workspace (5.4):
// run-first, one evidence step, required invalidation, human labels, localized.

const SCENARIO_ID = 'foundation-false-breakout-001';
const SCENARIO_VERSION = '1.0.0';
const ACTIVE_RUN_KEY = 'sa-play-active-run';

type Stage = 'boot' | 'brief' | 'decide' | 'revealed' | 'rewarded';

type ActiveRun = {
  runId: string;
  scenarioId: string;
  scenarioVersion: string;
  idempotencyKey: string;
};

function readActiveRun(): ActiveRun | null {
  try {
    const raw = window.localStorage.getItem(ACTIVE_RUN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveRun;
    return typeof parsed.runId === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function writeActiveRun(run: ActiveRun | null): void {
  try {
    if (run) window.localStorage.setItem(ACTIVE_RUN_KEY, JSON.stringify(run));
    else window.localStorage.removeItem(ACTIVE_RUN_KEY);
  } catch {
    /* storage may be unavailable; the slice still works for one session */
  }
}

function newIdempotencyKey(): string {
  return `play:${(globalThis.crypto?.randomUUID?.() ?? String(Date.now()))}`;
}

function stageFromRunState(state: RunResponse['state']): Stage {
  if (state === 'revealed' || state === 'completed') return 'revealed';
  return 'decide';
}

const STAGE_LABELS: Record<Stage, string> = {
  boot: 'Подключение…',
  brief: 'Сценарий готов',
  decide: 'Принятие решения',
  revealed: 'Решение зафиксировано',
  rewarded: 'Награда получена'
};

export function PlaySlice() {
  const [userId, setUserId] = useState<string | null>(null);
  const [balance, setBalance] = useState<UserEconomyState | null>(null);
  const [scenario, setScenario] = useState<ScenarioPublicProjection | null>(null);
  const [run, setRun] = useState<RunResponse | null>(null);
  const [stage, setStage] = useState<Stage>('boot');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [insufficientEnergy, setInsufficientEnergy] = useState(false);
  const [rewards, setRewards] = useState<RewardResult | null>(null);
  const booted = useRef(false);

  const loadScenario = useCallback(async () => {
    const projection = await api.getScenario(SCENARIO_ID, SCENARIO_VERSION);
    setScenario(projection);
    setStage('brief');
  }, []);

  // Boot once: resolve identity + balance, then either restore an active run or
  // present a fresh scenario.
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void (async () => {
      try {
        const me = await api.me();
        setUserId(me.userId);
        setBalance(await api.getBalance(me.userId));

        const active = readActiveRun();
        if (active) {
          const restored = await api.getRun(active.runId);
          setRun(restored.run);
          if (restored.run.state === 'revealed' || restored.run.state === 'completed') {
            const revealed = await api.revealRun(active.runId);
            setRun(revealed.run);
            setStage('revealed');
          } else {
            const projection = await api.getScenario(active.scenarioId, active.scenarioVersion);
            setScenario(projection);
            setStage(stageFromRunState(restored.run.state));
          }
          setBalance(await api.getBalance(me.userId));
        } else {
          await loadScenario();
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.code : 'boot_failed');
        setStage('brief');
      }
    })();
  }, [loadScenario]);

  const startRun = useCallback(async () => {
    setBusy(true);
    setError(null);
    setInsufficientEnergy(false);
    try {
      const idempotencyKey = newIdempotencyKey();
      const result = await api.startRun({
        scenarioId: SCENARIO_ID,
        scenarioVersion: SCENARIO_VERSION,
        idempotencyKey
      });
      writeActiveRun({
        runId: result.run.runId,
        scenarioId: SCENARIO_ID,
        scenarioVersion: SCENARIO_VERSION,
        idempotencyKey
      });
      setRun(result.run);
      setBalance(result.balance);
      setStage('decide');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'insufficient_energy') setInsufficientEnergy(true);
      else setError(err instanceof ApiError ? err.code : 'start_failed');
    } finally {
      setBusy(false);
    }
  }, []);

  const sealRun = useCallback(
    async (draft: DecisionDraft) => {
      if (!run) return;
      setBusy(true);
      setError(null);
      try {
        const sealed = await api.sealRun(run.runId, {
          action: draft.action as never,
          evidenceSourceIds: draft.evidenceSourceIds,
          invalidation: draft.invalidation,
          confidence: draft.confidence
        });
        setRun(sealed.run);
        const revealed = await api.revealRun(run.runId);
        setRun(revealed.run);
        setStage('revealed');
      } catch (err) {
        setError(err instanceof ApiError ? err.code : 'seal_failed');
      } finally {
        setBusy(false);
      }
    },
    [run]
  );

  const claimRewards = useCallback(async () => {
    if (!run || !userId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.claimRewards(run.runId);
      setRewards(result);
      setBalance(result.balance);
      setStage('rewarded');
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'reward_failed');
    } finally {
      setBusy(false);
    }
  }, [run, userId]);

  const resetRun = useCallback(async () => {
    writeActiveRun(null);
    setRun(null);
    setRewards(null);
    setError(null);
    setInsufficientEnergy(false);
    try {
      await loadScenario();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'reset_failed');
    }
  }, [loadScenario]);

  const qualityScore = run?.score?.score ?? null;
  const coinsAreZero = balance ? balance.coins === 0 : true;

  return (
    <section className="play-slice" data-testid="play-slice" aria-label="Сценарий">
      <header className="play-head">
        <div>
          <span className="kicker">SIGNAL ARENA · ТРЕНИРОВКА РЕШЕНИЙ</span>
          <h2>{scenario ? scenario.marketSegment : 'Загрузка сценария…'}</h2>
        </div>
        <div className="play-balance" aria-label="Баланс">
          <span data-testid="balance-xp">Опыт {balance?.xp ?? 0}</span>
          <span data-testid="balance-mastery">★ {balance?.masteryStars ?? 0}</span>
          <span data-testid="balance-energy">Энергия {balance?.energy ?? 0}/5</span>
          <span data-testid="balance-coins" className={coinsAreZero ? 'coins-zero' : 'coins-nonzero'}>
            Монеты {balance?.coins ?? 0}
          </span>
        </div>
      </header>

      <p data-testid="status" className="play-status">
        {STAGE_LABELS[stage]}
      </p>

      {error ? (
        <p data-testid="error" className="play-error" role="alert">
          Ошибка: {error}
        </p>
      ) : null}

      {insufficientEnergy ? (
        <p data-testid="insufficient-energy" className="play-energy" role="alert">
          Недостаточно энергии для запуска. Попробуй позже.
        </p>
      ) : null}

      {stage === 'boot' ? <p className="play-loading">Подключение к арене…</p> : null}

      {stage === 'brief' && scenario ? (
        <div className="play-scenario">
          <p>
            {scenario.marketSegment} · {scenario.timeframe} · уровень {scenario.scenarioLevel}
          </p>
          <p className="play-note">Сначала запусти сценарий, затем прими решение.</p>
          <button className="primary" data-testid="start-run" disabled={busy} onClick={startRun}>
            Начать сценарий
          </button>
        </div>
      ) : null}

      {stage === 'brief' && !scenario && !busy ? (
        <div className="play-empty">
          <p>Сценарий пока недоступен.</p>
          <button className="secondary" data-testid="retry-run" onClick={resetRun}>
            Повторить
          </button>
        </div>
      ) : null}

      {stage === 'decide' && scenario ? (
        <DecisionWorkspace
          scenario={scenario}
          busy={busy}
          error={error}
          onSeal={(draft) => void sealRun(draft)}
        />
      ) : null}

      {stage === 'revealed' && run ? (
        <div className="play-revealed">
          <p>
            Оценка процесса: <b data-testid="quality-score">{qualityScore ?? '—'}</b>/100
          </p>
          <button className="primary" data-testid="claim-rewards" disabled={busy} onClick={claimRewards}>
            Забрать награду
          </button>
        </div>
      ) : null}

      {stage === 'rewarded' && rewards ? (
        <div className="play-result">
          <p>
            Результат: <b data-testid="reward-xp">+{rewards.xpGranted} опыта</b>,{' '}
            <b data-testid="reward-mastery">+{rewards.masteryDelta} ★</b>
            {!rewards.granted ? ' (уже начислено)' : ''}
          </p>
          <p className={coinsAreZero ? 'coins-zero' : 'coins-nonzero'} data-testid="result-coins">
            Монеты за прохождение: {balance?.coins ?? 0}
          </p>
          <button className="secondary" data-testid="reset-run" onClick={resetRun}>
            Пройти ещё раз
          </button>
        </div>
      ) : null}
    </section>
  );
}
