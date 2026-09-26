import type { LearningStatus, ScenarioPublicProjection } from "@signal-arena/contracts";

// Human-facing Russian copy for the Academy / Decision workspace (Phase 5.4).
// The learner must never see raw technical ids like `source_ohlcv_demo` or an
// internal `Stage: scenario`; these maps turn contract enums into a localized,
// product-friendly vocabulary. Canonical Entity names stay exact English (an
// AGENTS.md invariant) — that rule is about Entity names, not UI labels, so
// source groups and trade actions are localised freely here.

export const ACTION_LABELS: Record<string, string> = {
  long: "Лонг",
  short: "Шорт",
  wait: "Ждать",
  no_trade: "Без сделки",
  hold_plan: "Держать план",
  close_position: "Закрыть позицию",
  move_protection: "Перенести защиту",
  wait_for_confirmation: "Ждать подтверждения",
  do_not_average: "Не усредняться",
  invalidate_idea: "Отменить идею"
};

const SOURCE_GROUP_LABELS: Record<string, string> = {
  PRICE: "Ценовое действие",
  CONTEXT: "Контекст рынка",
  FLOW: "Поток ордеров",
  EVENT: "События",
  PROJECT: "Проектные данные"
};

const RELIABILITY_LABELS: Record<string, string> = {
  low: "низкая надёжность",
  medium: "средняя надёжность",
  high: "высокая надёжность"
};

export const STATUS_LABELS: Record<LearningStatus, string> = {
  locked: "Закрыто",
  available: "Доступно",
  learning: "Изучается",
  ready_for_verification: "Готово к проверке",
  verified: "Навык подтверждён",
  transfer_pending: "Перенос в арену",
  mastered: "Освоен",
  review_due: "Пора повторить"
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export function sourceLabel(source: ScenarioPublicProjection["availableSources"][number]): string {
  const group = SOURCE_GROUP_LABELS[source.sourceGroup] ?? source.sourceGroup;
  const reliability = RELIABILITY_LABELS[source.reliability] ?? source.reliability;
  return `${group} · ${reliability}`;
}

export function statusLabel(status: LearningStatus): string {
  return STATUS_LABELS[status] ?? status;
}
