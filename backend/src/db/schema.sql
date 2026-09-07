-- UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- users
CREATE TABLE IF NOT EXISTS users(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- workspaces
CREATE TABLE IF NOT EXISTS workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- projects
CREATE TABLE IF NOT EXISTS projects(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name text not null,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- meetings
CREATE TABLE IF NOT EXISTS meetings(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    raw_transcript TEXT NOT NULL,
    transcript_hash TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (project_id, transcript_hash)
);

-- wokflow runs
CREATE TABLE IF NOT EXISTS workflow_runs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  state_json JSONB NOT NULL DEFAULT '{}',
  status     TEXT NOT NULL DEFAULT 'processing'
             CHECK (status IN (
               'processing','pending_review','executing',
               'completed','rejected','failed'
             )),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- decisions
CREATE TABLE IF NOT EXISTS decisions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  meeting_id       UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  workflow_run_id  UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  content          TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'superseded')),
  superseded_by    UUID REFERENCES decisions(id),
  confidence       NUMERIC(4,3) CHECK (confidence >= 0 AND confidence <= 1),
  source_quote     TEXT,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- action items
CREATE TABLE IF NOT EXISTS action_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  meeting_id      UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  task            TEXT NOT NULL,
  owner           TEXT,
  deadline        DATE,
  status          TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'done')),
  confidence      NUMERIC(4,3) CHECK (confidence >= 0 AND confidence <= 1),
  ambiguity_flags TEXT[] DEFAULT '{}',
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- open-questions
CREATE TABLE IF NOT EXISTS open_questions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id               UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  meeting_id               UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  workflow_run_id          UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  question                 TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'open'
                           CHECK (status IN ('open', 'resolved')),
  resolved_by_decision_id  UUID REFERENCES decisions(id),
  created_at               TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- integration connections
CREATE TABLE IF NOT EXISTS integration_connections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL CHECK (provider IN ('jira')),
  encrypted_token TEXT NOT NULL,
  expires_at      TIMESTAMP WITH TIME ZONE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);


-- proposed actions
CREATE TABLE IF NOT EXISTS proposed_actions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('create_jira_issue')),
  payload_json    JSONB NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected','executed')),
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- execution logs
CREATE TABLE IF NOT EXISTS execution_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposed_action_id  UUID NOT NULL REFERENCES proposed_actions(id) ON DELETE CASCADE,
  external_id         TEXT,
  idempotency_key     TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  error_message       TEXT,
  executed_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);


-- indexes
CREATE INDEX IF NOT EXISTS idx_open_questions_project_status
  ON open_questions(project_id, status);
CREATE INDEX IF NOT EXISTS idx_decisions_project_status
  ON decisions(project_id, status);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_meeting
  ON workflow_runs(meeting_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_logs_idempotency
  ON execution_logs(idempotency_key);