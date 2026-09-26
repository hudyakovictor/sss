import { useCallback, useEffect, useState } from "react";
import { ApiError, api, type AcademyModuleState } from "../play/api";
import { statusLabel } from "./labels";

// Hub → Next Best Action (Phase 5.5). The panel is driven entirely by the
// learner's real server progression for the Level 0 module: no fake percentages,
// no invented insights. It maps the authoritative `status` to the one next action
// and a single CTA that routes into the Academy flow.

type NextBestAction = {
  label: string;
  action: "continue_module" | "take_challenge" | "complete_transfer" | "review_weak_skill";
};

function nextBestAction(state: AcademyModuleState): NextBestAction {
  switch (state.status) {
    case "verified":
    case "transfer_pending":
      return { label: "Завершить Arena Transfer", action: "complete_transfer" };
    case "ready_for_verification":
      return { label: "Пройти Challenge Test", action: "take_challenge" };
    case "review_due":
      return { label: "Повторить слабый навык", action: "review_weak_skill" };
    case "learning":
      return state.bestScore > 0
        ? { label: "Пройти Challenge Test", action: "take_challenge" }
        : { label: "Продолжить модуль", action: "continue_module" };
    case "mastered":
      return { label: "Повторить слабый навык", action: "review_weak_skill" };
    default:
      return { label: "Продолжить модуль", action: "continue_module" };
  }
}

interface HubNextBestActionProps {
  moduleId: string;
  onOpen: () => void;
}

export function HubNextBestAction({ moduleId, onOpen }: HubNextBestActionProps) {
  const [state, setState] = useState<AcademyModuleState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await api.getModuleState(moduleId));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : "hub_load_failed");
    }
  }, [moduleId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="hub-nba hub-nba--error" data-testid="hub-nba">
        <span className="kicker">HUB · СЛЕДУЮЩИЙ ШАГ</span>
        <p>Не удалось загрузить прогресс: {error}</p>
        <button className="secondary" onClick={() => void load()}>
          Повторить
        </button>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="hub-nba" data-testid="hub-nba">
        <span className="kicker">HUB · СЛЕДУЮЩИЙ ШАГ</span>
        <p className="hub-nba--loading">Загрузка прогресса…</p>
      </div>
    );
  }

  const nba = nextBestAction(state);
  return (
    <div className="hub-nba" data-testid="hub-nba">
      <span className="kicker">HUB · СЛЕДУЮЩИЙ ШАГ</span>
      <p className="hub-nba__module">{state.module.title}</p>
      <p className="hub-nba__status">Статус: {statusLabel(state.status)}</p>
      <p className="hub-nba__action" data-testid="hub-next-action">
        {nba.label}
      </p>
      <button className="primary" data-testid="hub-nba-open" onClick={onOpen}>
        Открыть в Академии
      </button>
    </div>
  );
}
