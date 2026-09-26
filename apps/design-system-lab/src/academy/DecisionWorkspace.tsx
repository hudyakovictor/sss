import { useCallback, useState } from "react";
import type { ScenarioPublicProjection } from "@signal-arena/contracts";
import { actionLabel, sourceLabel } from "./labels";

export type DecisionDraft = {
  action: string;
  evidenceSourceIds: string[];
  invalidation: string;
  confidence: number;
};

// The corrected Decision Workspace (Phase 5.4). A single, ordered form:
// Evidence → Decision → Seal. Evidence is chosen exactly once (no duplication
// before/after start), invalidation is required and captured before the seal,
// sources render human labels instead of technical ids, and there is no internal
// "Stage" text. It owns no server knowledge: it only collects a draft and hands
// it up; scoring/verification stay server-side.

interface DecisionWorkspaceProps {
  scenario: ScenarioPublicProjection;
  busy: boolean;
  error?: string | null;
  sealLabel?: string;
  onSeal: (decision: DecisionDraft) => void;
}

const MIN_INVALIDATION_CHARS = 8;

export function DecisionWorkspace({
  scenario,
  busy,
  error,
  sealLabel = "Зафиксировать решение",
  onSeal
}: DecisionWorkspaceProps) {
  const [evidence, setEvidence] = useState<string[]>([]);
  const [action, setAction] = useState<string>(scenario.allowedActions[0] ?? "");
  const [invalidation, setInvalidation] = useState("");
  const [confidence, setConfidence] = useState(70);
  const [formError, setFormError] = useState<string | null>(null);

  const toggleEvidence = useCallback((sourceId: string) => {
    setFormError(null);
    setEvidence((current) =>
      current.includes(sourceId) ? current.filter((id) => id !== sourceId) : [...current, sourceId]
    );
  }, []);

  const trimmedInvalidation = invalidation.trim();
  const canSeal =
    evidence.length > 0 &&
    Boolean(action) &&
    trimmedInvalidation.length >= MIN_INVALIDATION_CHARS &&
    !busy;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (evidence.length === 0) {
      setFormError("Выбери хотя бы один источник данных.");
      return;
    }
    if (trimmedInvalidation.length < MIN_INVALIDATION_CHARS) {
      setFormError("Сначала сформулируй инвалидацию — условие, при котором идея умирает.");
      return;
    }
    onSeal({ action, evidenceSourceIds: evidence, invalidation: trimmedInvalidation, confidence });
  };

  return (
    <form className="decision-workspace" onSubmit={handleSubmit} aria-label="Рабочее пространство решения">
      <fieldset className="decision-evidence" data-testid="decision-evidence">
        <legend>1 · Улики</legend>
        <p className="decision-hint">Отметь источники, на которые опирается твоё решение.</p>
        {scenario.availableSources.map((source) => (
          <label key={source.sourceId} className="decision-source">
            <input
              type="checkbox"
              data-testid={`evidence-${source.sourceId}`}
              checked={evidence.includes(source.sourceId)}
              onChange={() => toggleEvidence(source.sourceId)}
            />
            <span>{sourceLabel(source)}</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="decision-decision">
        <legend>2 · Решение</legend>
        <label className="decision-field">
          <span>Направление</span>
          <select data-testid="action" value={action} onChange={(e) => setAction(e.target.value)}>
            {scenario.allowedActions.map((option) => (
              <option key={option} value={option}>
                {actionLabel(option)}
              </option>
            ))}
          </select>
        </label>

        <label className="decision-field">
          <span>Инвалидация (условие отмены идеи)</span>
          <textarea
            data-testid="invalidation"
            value={invalidation}
            rows={2}
            placeholder="Например: закрытие 4H ниже возвращённого уровня отменяет лонг."
            onChange={(e) => {
              setFormError(null);
              setInvalidation(e.target.value);
            }}
          />
        </label>

        <label className="decision-field">
          <span>Уверенность: {confidence}%</span>
          <input
            data-testid="confidence"
            type="range"
            min={0}
            max={100}
            value={confidence}
            onChange={(e) => setConfidence(Number(e.target.value))}
          />
        </label>
      </fieldset>

      {formError ? (
        <p className="decision-form-error" role="alert" data-testid="decision-form-error">
          {formError}
        </p>
      ) : null}
      {error ? (
        <p className="decision-error" role="alert" data-testid="error">
          Ошибка: {error}
        </p>
      ) : null}

      <div className="decision-seal">
        <button
          type="submit"
          className="primary"
          data-testid="seal-run"
          disabled={!canSeal}
        >
          {sealLabel}
        </button>
      </div>
    </form>
  );
}
