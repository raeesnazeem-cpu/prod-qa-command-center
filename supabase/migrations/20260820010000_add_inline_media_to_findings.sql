-- Scan-time screenshot preparation (scan speed-up plan, Task 12).
--
-- The TED report inlines screenshots as base64 webp data-URIs (TED renders those,
-- not remote URLs). That fetch+compress used to run at POST time, on the critical
-- path. This column lets the worker precompute those inline payloads during the
-- scan and store them here, so posting is just string assembly.
--
-- Shape (all optional; absent = fall back to fetching at post time):
--   {
--     "shots": { "<remote url>": { "d": "data:image/webp;base64,...", "w": 150, "h": 100 } },
--     "grid":  { "d": "data:image/webp;base64,...", "w": 1200, "h": 300 }
--   }
alter table public.findings
  add column if not exists inline_media jsonb;
