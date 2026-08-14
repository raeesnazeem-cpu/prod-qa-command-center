import { Finding } from "@qacc/shared"

/**
 * Video Recording check (hardcoded pass).
 * ---------------------------------------
 * Desktop / tablet / mobile functional video recording is a HUMAN task — there
 * is no automation for it. This check intentionally posts a fixed instructional
 * comment and passes, so the "Video recording" pre-release subtask is closed as
 * a reminder rather than left open or falsely failed.
 *
 * check_factor "video_recording" is registered as INFORMATIONAL in tedSync, so
 * this finding is reported as a PASS that surfaces the instruction (never a
 * defect). Deliberately no logic — replace if it is ever automated.
 *
 * check_factor: "video_recording"
 */
const CHECK_FACTOR = "video_recording"

export async function checkVideoRecording(
  pageUrl: string,
  runId: string,
): Promise<Finding[]> {
  return [
    {
      check_factor: CHECK_FACTOR,
      title: "Desktop, Tablet & Mobile video recording",
      description: "Perform a full functional recording manually of all pages.",
      context_text: `Manual task — no automation. Page: ${pageUrl}`,
      screenshot_url: null,
      status: "open",
      ai_generated: false,
    } as Finding,
  ]
}
