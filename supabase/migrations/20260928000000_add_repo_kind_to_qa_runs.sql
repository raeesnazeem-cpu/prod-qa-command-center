-- Records the shape of the client's GitHub repo (from the TED client page
-- "GitHub site URL"): 'gitops' (resources/*.json + g99-control MU plugin) or
-- 'theme' (a WordPress/Bedrock theme repo). Detected once at scan start from the
-- GitHub file tree (no clone) and refined by the AI-fix job after it clones.
-- QACC-only column: nothing is written to TED.
-- Nullable + no default: null means no repo could be read (behave as before).
alter table qa_runs add column if not exists repo_kind text;
