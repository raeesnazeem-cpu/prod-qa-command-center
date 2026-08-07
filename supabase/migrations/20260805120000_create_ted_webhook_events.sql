-- Audit table for every webhook received from TED.
-- Gives QACC a permanent, queryable history of what TED sent (full raw payload),
-- how it was interpreted, and whether it triggered a QA run. Useful for debugging
-- and for inspecting the exact shape of real production payloads (e.g. where the
-- client name lives).
CREATE TABLE IF NOT EXISTS ted_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Top-level event context
  event_type text,               -- e.g. TASK_STATUS_CHANGED
  source text,                   -- e.g. TED_PLATFORM

  -- Trigger (source) task that fired the event
  ted_task_id text,              -- trigger.id
  template_key text,             -- trigger.templateKey
  task_title text,               -- trigger.title
  assignee text,                 -- trigger.assignee
  status text,                   -- trigger.status
  previous_status text,          -- trigger.previousStatus

  -- Sibling / target task (when TED includes it)
  target_task_id text,           -- target.id
  target_template_key text,      -- payload.targetTemplateKey

  -- Resolved QACC context
  client_name text,              -- best-effort extracted client name (may be null)
  triggered_run boolean DEFAULT false,  -- did this event start a QA run?
  qa_run_id uuid REFERENCES qa_runs(id) ON DELETE SET NULL,

  -- Raw capture + outcome
  raw_payload jsonb,             -- full parsed payload, verbatim
  error text,                    -- populated if processing threw

  received_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ted_webhook_events_received_at ON ted_webhook_events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_ted_webhook_events_ted_task_id ON ted_webhook_events(ted_task_id);
CREATE INDEX IF NOT EXISTS idx_ted_webhook_events_event_type ON ted_webhook_events(event_type);

-- The API writes to this table with the service role key, which bypasses RLS.
-- Enable RLS and allow authenticated users to read the history from the app.
ALTER TABLE ted_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "TED webhook events are readable by authenticated users"
  ON ted_webhook_events FOR SELECT
  TO authenticated
  USING (true);
