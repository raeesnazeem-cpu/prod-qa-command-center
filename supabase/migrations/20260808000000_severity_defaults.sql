-- Severity was removed from all application code, UI, and reports. The DB
-- columns are intentionally kept (to avoid a destructive drop on existing
-- rows), but the app no longer writes them. `findings.severity` was NOT NULL
-- with no default, so give it one; inserts that omit severity now succeed.
-- `tasks.severity` already defaults to 'medium'. Columns and the existing
-- index are left in place, unused.

ALTER TABLE findings ALTER COLUMN severity SET DEFAULT 'medium';
