import type BetterSqlite3 from "better-sqlite3";

export const MIGRATIONS = [
  {
    id: "0001_foundation",
    sql: `
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY NOT NULL,
  external_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scenarios (
  scenario_id TEXT NOT NULL,
  version TEXT NOT NULL,
  scenario_level INTEGER NOT NULL CHECK (scenario_level BETWEEN 1 AND 99),
  mode TEXT NOT NULL,
  content_version TEXT NOT NULL,
  data_version TEXT NOT NULL,
  future_hash TEXT NOT NULL,
  package_json TEXT NOT NULL,
  review_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scenario_id, version)
);

CREATE TABLE IF NOT EXISTS scenario_runs (
  run_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  scenario_id TEXT NOT NULL,
  scenario_version TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('started', 'sealed', 'revealed', 'completed')),
  idempotency_key TEXT NOT NULL UNIQUE,
  decision_json TEXT,
  score_json TEXT,
  created_at TEXT NOT NULL,
  sealed_at TEXT,
  revealed_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (scenario_id, scenario_version)
    REFERENCES scenarios(scenario_id, version)
);

CREATE INDEX IF NOT EXISTS idx_scenarios_review_status
  ON scenarios(review_status);

CREATE INDEX IF NOT EXISTS idx_scenario_runs_user_created
  ON scenario_runs(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_scenario_runs_scenario
  ON scenario_runs(scenario_id, scenario_version);
`
  },
  {
    id: "0002_auth_boundary",
    sql: `
CREATE TABLE IF NOT EXISTS user_identities (
  identity_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS auth_replay_keys (
  replay_key TEXT PRIMARY KEY NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  session_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_active
  ON auth_sessions(user_id, expires_at, revoked_at);

CREATE INDEX IF NOT EXISTS idx_auth_replay_keys_expiry
  ON auth_replay_keys(expires_at);
`
  },
  {
    id: "0003_historical_snapshots",
    sql: `
CREATE TABLE IF NOT EXISTS historical_snapshots (
  snapshot_id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL,
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL,
  as_of TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_historical_snapshots_lookup
  ON historical_snapshots(provider, symbol, interval, as_of);
`
  },
  {
    id: "0004_economy_ledger",
    sql: `
CREATE TABLE IF NOT EXISTS user_economy_state (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(user_id),
  xp INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  coins INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
  promo_coins INTEGER NOT NULL DEFAULT 0 CHECK (promo_coins >= 0),
  mastery_stars INTEGER NOT NULL DEFAULT 0 CHECK (mastery_stars >= 0),
  energy INTEGER NOT NULL DEFAULT 5 CHECK (energy BETWEEN 0 AND 5),
  energy_updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0)
);

CREATE TABLE IF NOT EXISTS ledger_events (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  kind TEXT NOT NULL CHECK (kind IN ('coin_reward_xp', 'coin_spend', 'coin_referral_activation', 'coin_referral_purchase_bonus', 'energy_regen', 'mastery_star_grant')),
  amount INTEGER NOT NULL,
  promo INTEGER NOT NULL DEFAULT 0 CHECK (promo IN (0, 1)),
  run_id TEXT REFERENCES scenario_runs(run_id),
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_ledger_events_user_created
  ON ledger_events(user_id, created_at);
`
  },
  {
    // Ledger v2. Iteration 02 shipped economy as dev-only data, so this is a
    // forward-only, replayable rebuild rather than an in-place ALTER (SQLite
    // cannot relax a CHECK without a table copy). It drops the old kind set,
    // widens the event with asset/reason/source/scenario/risk, and adds the
    // progression tables the reward path needs.
    id: "0005_ledger_v2",
    sql: `
DROP TABLE IF EXISTS ledger_events;

CREATE TABLE ledger_events (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  kind TEXT NOT NULL CHECK (kind IN ('xp_awarded', 'mastery_awarded', 'energy_spent', 'energy_regenerated', 'energy_refilled', 'coin_pack_credited', 'coin_promo_granted', 'coin_spent')),
  asset TEXT NOT NULL CHECK (asset IN ('xp', 'energy', 'coin', 'mastery_star')),
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  promo INTEGER NOT NULL DEFAULT 0 CHECK (promo IN (0, 1)),
  run_id TEXT REFERENCES scenario_runs(run_id),
  scenario_id TEXT,
  source_id TEXT,
  risk_state TEXT NOT NULL DEFAULT 'clear' CHECK (risk_state IN ('clear', 'hold', 'review', 'granted', 'rejected')),
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, idempotency_key)
);

CREATE INDEX idx_ledger_events_user_created
  ON ledger_events(user_id, created_at);

CREATE TABLE IF NOT EXISTS reward_grants (
  reward_grant_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  run_id TEXT NOT NULL UNIQUE REFERENCES scenario_runs(run_id),
  scenario_id TEXT NOT NULL,
  xp_granted INTEGER NOT NULL CHECK (xp_granted >= 0),
  mastery_delta INTEGER NOT NULL CHECK (mastery_delta >= 0),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scenario_completions (
  user_id TEXT NOT NULL REFERENCES users(user_id),
  scenario_id TEXT NOT NULL,
  scenario_version TEXT NOT NULL,
  completions INTEGER NOT NULL DEFAULT 0 CHECK (completions >= 0),
  best_score INTEGER NOT NULL DEFAULT 0 CHECK (best_score >= 0),
  first_completed_at TEXT NOT NULL,
  last_completed_at TEXT NOT NULL,
  PRIMARY KEY (user_id, scenario_id, scenario_version)
);

CREATE TABLE IF NOT EXISTS user_scenario_mastery (
  user_id TEXT NOT NULL REFERENCES users(user_id),
  scenario_id TEXT NOT NULL,
  best_stars INTEGER NOT NULL DEFAULT 0 CHECK (best_stars BETWEEN 0 AND 3),
  best_score INTEGER NOT NULL DEFAULT 0 CHECK (best_score >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, scenario_id)
);
`
  },
  {
    // Academy Level 0 progression (Iteration 04 Phase 2). Server-authoritative:
    // these tables are only ever written by the API/domain layer, never by the
    // client. The module registry stores the canonical published content so a
    // run can always be replayed against the exact module version it used.
    id: "0006_learning_progression",
    sql: `
CREATE TABLE IF NOT EXISTS learning_modules (
  module_id TEXT NOT NULL,
  version TEXT NOT NULL,
  title TEXT NOT NULL,
  level INTEGER NOT NULL CHECK (level BETWEEN 0 AND 99),
  content_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'validated', 'published', 'deprecated')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (module_id, version)
);

CREATE TABLE IF NOT EXISTS user_module_progress (
  user_id TEXT NOT NULL REFERENCES users(user_id),
  module_id TEXT NOT NULL,
  module_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('locked', 'available', 'learning', 'ready_for_verification', 'verified', 'transfer_pending', 'mastered', 'review_due')),
  started_at TEXT,
  verified_at TEXT,
  mastered_at TEXT,
  review_due_at TEXT,
  verification_source TEXT CHECK (verification_source IN ('guided_path', 'challenge_out', 'exam', 'arena_transfer', 'delayed_rematch') OR verification_source IS NULL),
  best_score INTEGER NOT NULL DEFAULT 0 CHECK (best_score BETWEEN 0 AND 100),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  UNIQUE (user_id, module_id, module_version)
);

CREATE TABLE IF NOT EXISTS learning_attempts (
  attempt_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  module_id TEXT NOT NULL,
  module_version TEXT NOT NULL,
  attempt_type TEXT NOT NULL CHECK (attempt_type IN ('guided_practice', 'challenge', 'transfer', 'rematch')),
  scenario_id TEXT NOT NULL,
  scenario_version TEXT NOT NULL,
  run_id TEXT REFERENCES scenario_runs(run_id),
  status TEXT NOT NULL CHECK (status IN ('started', 'verified', 'failed')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  result_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_learning_attempts_user
  ON learning_attempts(user_id, module_id, started_at);

CREATE TABLE IF NOT EXISTS user_skill_state (
  user_id TEXT NOT NULL REFERENCES users(user_id),
  skill_id TEXT NOT NULL,
  skill_version TEXT NOT NULL,
  recognition_state TEXT NOT NULL CHECK (recognition_state IN ('locked', 'available', 'learning', 'ready_for_verification', 'verified', 'transfer_pending', 'mastered', 'review_due')),
  application_state TEXT NOT NULL CHECK (application_state IN ('locked', 'available', 'learning', 'ready_for_verification', 'verified', 'transfer_pending', 'mastered', 'review_due')),
  transfer_state TEXT NOT NULL CHECK (transfer_state IN ('locked', 'available', 'learning', 'ready_for_verification', 'verified', 'transfer_pending', 'mastered', 'review_due')),
  retention_state TEXT NOT NULL CHECK (retention_state IN ('locked', 'available', 'learning', 'ready_for_verification', 'verified', 'transfer_pending', 'mastered', 'review_due')),
  evidence_count INTEGER NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  confidence INTEGER NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 100),
  last_demonstrated_at TEXT,
  review_due_at TEXT,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  PRIMARY KEY (user_id, skill_id, skill_version)
);
`
  },
  {
    // Decision Telemetry v1 (Iteration 04 Phase 3). Strictly observational:
    // append-only raw events that let one run be reconstructed as an ordered
    // timeline. There is deliberately no foreign key from run_id and no coupling
    // to scoring/economy tables — a telemetry row can never change a score or a
    // reward, and an event may arrive for a run that no longer resolves.
    id: "0007_decision_telemetry",
    sql: `
CREATE TABLE IF NOT EXISTS decision_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL CHECK (event_version >= 1),
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  occurred_at TEXT NOT NULL,
  server_received_at TEXT NOT NULL,
  client_elapsed_ms INTEGER NOT NULL CHECK (client_elapsed_ms >= 0),
  run_id TEXT,
  scenario_id TEXT,
  scenario_version TEXT,
  module_id TEXT,
  skill_ids TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_decision_events_user_occurred
  ON decision_events(user_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_decision_events_run_sequence
  ON decision_events(run_id, sequence);
CREATE INDEX IF NOT EXISTS idx_decision_events_type_occurred
  ON decision_events(event_type, occurred_at);
CREATE INDEX IF NOT EXISTS idx_decision_events_module_occurred
  ON decision_events(module_id, occurred_at);
`
  }
] as const;

type Migration = (typeof MIGRATIONS)[number];

export function applyMigrations(sqlite: BetterSqlite3.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const hasMigration = sqlite.prepare(
    "SELECT id FROM _migrations WHERE id = ?"
  );
  const recordMigration = sqlite.prepare(
    "INSERT INTO _migrations (id, applied_at) VALUES (?, ?)"
  );

  for (const migration of MIGRATIONS satisfies readonly Migration[]) {
    if (hasMigration.get(migration.id)) {
      continue;
    }

    const apply = sqlite.transaction(() => {
      sqlite.exec(migration.sql);
      recordMigration.run(migration.id, new Date().toISOString());
    });

    apply();
  }
}
