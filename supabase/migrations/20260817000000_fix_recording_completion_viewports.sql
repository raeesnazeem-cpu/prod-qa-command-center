-- Fix the full-project video-recording completion gate.
--
-- The recorder (apps/worker/src/recordingWorker.ts) only ever produces THREE
-- viewports — desktop, tablet, mobile. The original merge_qa_run_recording_url
-- (20260623165730_remote_schema.sql) required a fourth key, 'laptop', before it
-- flipped recording_status to 'completed'. That key is never written, so the
-- status never reached 'completed' — the video_url_verify barrier that waits on
-- it would hang forever. Require exactly the three real viewports instead.
set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.merge_qa_run_recording_url(p_run_id uuid, p_viewport text, p_url text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_new_urls jsonb;
BEGIN
  -- Safely merge the URL and return the updated JSONB object.
  UPDATE public.qa_runs
  SET recording_video_urls = COALESCE(recording_video_urls, '{}'::jsonb) || jsonb_build_object(p_viewport, p_url),
      recording_updated_at = now()
  WHERE id = p_run_id
  RETURNING recording_video_urls INTO v_new_urls;

  -- Once all THREE recordings the worker produces are present, mark the run's
  -- recording as 'completed' (unless it already errored out).
  IF v_new_urls ? 'desktop' AND v_new_urls ? 'tablet' AND v_new_urls ? 'mobile' THEN
    UPDATE public.qa_runs
    SET recording_status = 'completed'
    WHERE id = p_run_id AND recording_status IS DISTINCT FROM 'error';
  END IF;
END;
$function$
;
