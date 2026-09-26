export type PostgresQueryExecutor = {
  query(sql: string, parameters?: readonly unknown[]): Promise<{
    rows?: readonly { id?: string }[];
  }>;
};

export const POSTGRES_MIGRATIONS = [
  {
    id: "0001_foundation",
    sql: `
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  external_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS scenarios (
  scenario_id TEXT NOT NULL,
  version TEXT NOT NULL,
  scenario_level INTEGER NOT NULL CHECK (scenario_level BETWEEN 1 AND 99),
  mode TEXT NOT NULL,
  content_version TEXT NOT NULL,
  data_version TEXT NOT NULL,
  future_hash TEXT NOT NULL,
  package_json JSONB NOT NULL,
  review_status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scenario_id, version)
);

CREATE TABLE IF NOT EXISTS scenario_runs (
  run_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  scenario_id TEXT NOT NULL,
  scenario_version TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('started', 'sealed', 'revealed', 'completed')),
  idempotency_key TEXT NOT NULL UNIQUE,
  decision_json JSONB,
  score_json JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  sealed_at TIMESTAMPTZ,
  revealed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  FOREIGN KEY (scenario_id, scenario_version)
    REFERENCES scenarios(scenario_id, version)
);

CREATE INDEX IF NOT EXISTS idx_scenarios_review_status
  ON scenarios(review_status);
CREATE INDEX IF NOT EXISTS idx_scenario_runs_user_created
  ON scenario_runs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_scenario_runs_scenario
  ON scenario_runs(scenario_id, scenario_version);
`,
  },
  {
    id: "0002_auth_boundary",
    sql: `
CREATE TABLE IF NOT EXISTS user_identities (
  identity_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS auth_replay_keys (
  replay_key TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_active
  ON auth_sessions(user_id, expires_at, revoked_at);
CREATE INDEX IF NOT EXISTS idx_auth_replay_keys_expiry
  ON auth_replay_keys(expires_at);
`,
  },
  {
    id: "0003_historical_snapshots",
    sql: `
CREATE TABLE IF NOT EXISTS historical_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL,
  as_of TIMESTAMPTZ NOT NULL,
  content_hash TEXT NOT NULL UNIQUE,
  snapshot_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_historical_snapshots_lookup
  ON historical_snapshots(provider, symbol, interval, as_of);
`,
  },
  {
    id: "0004_economy_ledger",
    sql: `
CREATE TABLE IF NOT EXISTS user_economy_state (
  user_id TEXT PRIMARY KEY REFERENCES users(user_id),
  xp INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  coins INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
  promo_coins INTEGER NOT NULL DEFAULT 0 CHECK (promo_coins >= 0),
  mastery_stars INTEGER NOT NULL DEFAULT 0 CHECK (mastery_stars >= 0),
  energy INTEGER NOT NULL DEFAULT 5 CHECK (energy BETWEEN 0 AND 5),
  energy_updated_at TIMESTAMPTZ NOT NULL,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0)
);

CREATE TABLE IF NOT EXISTS ledger_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  kind TEXT NOT NULL CHECK (kind IN ('coin_reward_xp', 'coin_spend', 'coin_referral_activation', 'coin_referral_purchase_bonus', 'energy_regen', 'mastery_star_grant')),
  amount INTEGER NOT NULL,
  promo BOOLEAN NOT NULL DEFAULT FALSE,
  run_id TEXT REFERENCES scenario_runs(run_id),
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_ledger_events_user_created
  ON ledger_events(user_id, created_at);
`,
  },
  {
    // Ledger v2 (mirrors the SQLite 0005 rebuild). Economy is dev-only at this
    // stage, so we drop and recreate ledger_events with the asset/reason/source/
    // scenario/risk columns and the new kind set, then add the progression tables.
    id: "0005_ledger_v2",
    sql: `
DROP TABLE IF EXISTS ledger_events;

CREATE TABLE ledger_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  kind TEXT NOT NULL CHECK (kind IN ('xp_awarded', 'mastery_awarded', 'energy_spent', 'energy_regenerated', 'energy_refilled', 'coin_pack_credited', 'coin_promo_granted', 'coin_spent')),
  asset TEXT NOT NULL CHECK (asset IN ('xp', 'energy', 'coin', 'mastery_star')),
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  promo BOOLEAN NOT NULL DEFAULT FALSE,
  run_id TEXT REFERENCES scenario_runs(run_id),
  scenario_id TEXT,
  source_id TEXT,
  risk_state TEXT NOT NULL DEFAULT 'clear' CHECK (risk_state IN ('clear', 'hold', 'review', 'granted', 'rejected')),
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(user_id, idempotency_key)
);

CREATE INDEX idx_ledger_events_user_created
  ON ledger_events(user_id, created_at);

CREATE TABLE IF NOT EXISTS reward_grants (
  reward_grant_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  run_id TEXT NOT NULL UNIQUE REFERENCES scenario_runs(run_id),
  scenario_id TEXT NOT NULL,
  xp_granted INTEGER NOT NULL CHECK (xp_granted >= 0),
  mastery_delta INTEGER NOT NULL CHECK (mastery_delta >= 0),
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS scenario_completions (
  user_id TEXT NOT NULL REFERENCES users(user_id),
  scenario_id TEXT NOT NULL,
  scenario_version TEXT NOT NULL,
  completions INTEGER NOT NULL DEFAULT 0 CHECK (completions >= 0),
  best_score INTEGER NOT NULL DEFAULT 0 CHECK (best_score >= 0),
  first_completed_at TIMESTAMPTZ NOT NULL,
  last_completed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, scenario_id, scenario_version)
);

CREATE TABLE IF NOT EXISTS user_scenario_mastery (
  user_id TEXT NOT NULL REFERENCES users(user_id),
  scenario_id TEXT NOT NULL,
  best_stars INTEGER NOT NULL DEFAULT 0 CHECK (best_stars BETWEEN 0 AND 3),
  best_score INTEGER NOT NULL DEFAULT 0 CHECK (best_score >= 0),
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, scenario_id)
);
`,
  },
  {
    // Academy Level 0 progression (Iteration 04 Phase 2), mirroring the SQLite
    // 0006 migration. Server-authoritative tables only.
    id: "0006_learning_progression",
    sql: `
CREATE TABLE IF NOT EXISTS learning_modules (
  module_id TEXT NOT NULL,
  version TEXT NOT NULL,
  title TEXT NOT NULL,
  level INTEGER NOT NULL CHECK (level BETWEEN 0 AND 99),
  content_json JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'validated', 'published', 'deprecated')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (module_id, version)
);

CREATE TABLE IF NOT EXISTS user_module_progress (
  user_id TEXT NOT NULL REFERENCES users(user_id),
  module_id TEXT NOT NULL,
  module_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('locked', 'available', 'learning', 'ready_for_verification', 'verified', 'transfer_pending', 'mastered', 'review_due')),
  started_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  mastered_at TIMESTAMPTZ,
  review_due_at TIMESTAMPTZ,
  verification_source TEXT CHECK (verification_source IN ('guided_path', 'challenge_out', 'exam', 'arena_transfer', 'delayed_rematch')),
  best_score INTEGER NOT NULL DEFAULT 0 CHECK (best_score BETWEEN 0 AND 100),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  UNIQUE (user_id, module_id, module_version)
);

CREATE TABLE IF NOT EXISTS learning_attempts (
  attempt_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  module_id TEXT NOT NULL,
  module_version TEXT NOT NULL,
  attempt_type TEXT NOT NULL CHECK (attempt_type IN ('guided_practice', 'challenge', 'transfer', 'rematch')),
  scenario_id TEXT NOT NULL,
  scenario_version TEXT NOT NULL,
  run_id TEXT REFERENCES scenario_runs(run_id),
  status TEXT NOT NULL CHECK (status IN ('started', 'verified', 'failed')),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  result_json JSONB
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
  last_demonstrated_at TIMESTAMPTZ,
  review_due_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  PRIMARY KEY (user_id, skill_id, skill_version)
);
`,
  },
  {
    // Decision Telemetry v1 (Iteration 04 Phase 3), mirroring SQLite 0007.
    // Append-only, observational, decoupled from scoring/economy.
    id: "0007_decision_telemetry",
    sql: `
CREATE TABLE IF NOT EXISTS decision_events (
  event_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL CHECK (event_version >= 1),
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  occurred_at TIMESTAMPTZ NOT NULL,
  server_received_at TIMESTAMPTZ NOT NULL,
  client_elapsed_ms INTEGER NOT NULL CHECK (client_elapsed_ms >= 0),
  run_id TEXT,
  scenario_id TEXT,
  scenario_version TEXT,
  module_id TEXT,
  skill_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  payload_json JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_decision_events_user_occurred
  ON decision_events(user_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_decision_events_run_sequence
  ON decision_events(run_id, sequence);
CREATE INDEX IF NOT EXISTS idx_decision_events_type_occurred
  ON decision_events(event_type, occurred_at);
CREATE INDEX IF NOT EXISTS idx_decision_events_module_occurred
  ON decision_events(module_id, occurred_at);
`,
  }
] as const;

const MIGRATION_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS signal_arena_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const MIGRATION_LOCK_SQL = "SELECT pg_advisory_xact_lock(731946102);";

export async function applyPostgresMigrations(
  executor: PostgresQueryExecutor
): Promise<void> {
  await executor.query("BEGIN;");
  try {
    await executor.query(MIGRATION_LOCK_SQL);
    await executor.query(MIGRATION_TABLE_SQL);

    const applied = await executor.query("SELECT id FROM signal_arena_migrations;");
    const appliedIds = new Set(
      (applied.rows ?? [])
        .map((row) => row.id)
        .filter((id): id is string => typeof id === "string")
    );

    for (const migration of POSTGRES_MIGRATIONS) {
      if (appliedIds.has(migration.id)) {
        continue;
      }
      await executor.query(migration.sql);
      await executor.query(
        "INSERT INTO signal_arena_migrations (id) VALUES ($1);",
        [migration.id]
      );
    }

    await executor.query("COMMIT;");
  } catch (error) {
    await executor.query("ROLLBACK;");
    throw error;
  }
}
