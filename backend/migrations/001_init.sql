-- Migration: 001_init.sql
-- Base schema and indexes for Operations Under Pressure

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- users
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- teams
CREATE TABLE IF NOT EXISTS teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL
);

-- memberships
CREATE TABLE IF NOT EXISTS memberships (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('viewer', 'member', 'lead', 'admin')),
    PRIMARY KEY (user_id, team_id)
);

-- work_items
CREATE TABLE IF NOT EXISTS work_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL CHECK (length(title) >= 3 AND length(title) <= 200),
    description TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL CHECK (type IN ('incident', 'customer_issue', 'payment', 'compliance', 'task')),
    priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'awaiting_approval', 'resolved', 'closed')),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    assignee_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    due_date TIMESTAMPTZ NULL,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || description)) STORED
);

-- activity_events (append-only table)
CREATE TABLE IF NOT EXISTS activity_events (
    id BIGSERIAL PRIMARY KEY,
    item_id UUID NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger function enforcing append-only guarantee on activity_events
CREATE OR REPLACE FUNCTION prevent_activity_events_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'activity_events table is append-only: updates and deletes are forbidden';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_activity_events_immutable ON activity_events;
CREATE TRIGGER trg_activity_events_immutable
BEFORE UPDATE OR DELETE ON activity_events
FOR EACH ROW
EXECUTE FUNCTION prevent_activity_events_modification();

-- comments
CREATE TABLE IF NOT EXISTS comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES users(id),
    body TEXT NOT NULL CHECK (length(body) >= 1 AND length(body) <= 2000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- idempotency_keys
CREATE TABLE IF NOT EXISTS idempotency_keys (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    status_code INT NULL,
    response_body JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, key)
);

-- outbox_jobs
CREATE TABLE IF NOT EXISTS outbox_jobs (
    id BIGSERIAL PRIMARY KEY,
    type TEXT NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 5,
    run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_at TIMESTAMPTZ NULL,
    last_error TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- notifications
CREATE TABLE IF NOT EXISTS notifications (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
    job_id BIGINT NOT NULL REFERENCES outbox_jobs(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    read_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (job_id, user_id)
);

-- Required Indexes
CREATE INDEX IF NOT EXISTS idx_work_items_team_created_id
    ON work_items(team_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_work_items_team_status_created_id
    ON work_items(team_id, status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_work_items_assignee_active
    ON work_items(assignee_id, created_at DESC, id DESC)
    WHERE status NOT IN ('resolved', 'closed');

CREATE INDEX IF NOT EXISTS idx_work_items_unassigned_urgent
    ON work_items(team_id, created_at DESC, id DESC)
    WHERE assignee_id IS NULL AND priority = 'urgent' AND status NOT IN ('resolved', 'closed');

CREATE INDEX IF NOT EXISTS idx_work_items_awaiting_approval
    ON work_items(team_id, created_at DESC, id DESC)
    WHERE status = 'awaiting_approval';

CREATE INDEX IF NOT EXISTS idx_work_items_search_vector
    ON work_items USING GIN(search_vector);

CREATE INDEX IF NOT EXISTS idx_activity_events_item_id
    ON activity_events(item_id, id DESC);

CREATE INDEX IF NOT EXISTS idx_comments_item_created
    ON comments(item_id, created_at);

CREATE INDEX IF NOT EXISTS idx_memberships_team_id
    ON memberships(team_id);

CREATE INDEX IF NOT EXISTS idx_outbox_jobs_pending
    ON outbox_jobs(run_at, id)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_notifications_user_id
    ON notifications(user_id, id DESC);
