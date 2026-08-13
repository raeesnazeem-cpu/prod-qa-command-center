-- ============================================================
-- 20260809020000_add_released_site_url_to_qa_runs.sql
-- The released site URL parsed from the TED `release.security` task's
-- automation.payload at post-release webhook time. The live_site_link check
-- compares this against `live_site_url` (the canonical URL resolved from the
-- HubSpot client notes via TED) to confirm the site went live on the correct
-- final domain.
-- Additive + idempotent (mirrors live_site_url).
-- ============================================================
ALTER TABLE qa_runs ADD COLUMN IF NOT EXISTS released_site_url TEXT;
