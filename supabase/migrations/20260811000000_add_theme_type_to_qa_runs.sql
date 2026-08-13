-- Records the target site's theme type (classic PHP vs block/FSE) so checks and
-- fixes can run a classic-theme-compatible variant. Detected once at scan start
-- (hybrid: repo peek -> front-end fallback) and reused by the AI-fix job.
-- Nullable + no default: absent/"unknown" means "behave exactly as before".
alter table qa_runs add column if not exists theme_type text;
