import { supabase } from "../lib/supabase";
import {
  parseStorageUrl,
  removeStoredObjects,
  removeStoredPrefix,
} from "../lib/supabaseStorage";

export async function bulkDeleteRuns(runIds: string[]) {
  if (!runIds || !Array.isArray(runIds) || runIds.length === 0) {
    return;
  }

  // 1. Gather explicitly linked file paths from Findings & Pages
  const { data: findings } = await supabase
    .from("findings")
    .select("screenshot_url")
    .in("run_id", runIds);
  const { data: pages } = await supabase
    .from("pages")
    .select(
      "screenshot_url_desktop, screenshot_url_tablet, screenshot_url_mobile"
    )
    .in("run_id", runIds);

  const pathsToDelete = new Set<string>();
  const extractPath = (url: string) => {
    const loc = parseStorageUrl(url);
    if (loc && ["screenshots", "evidence", "public_evidence"].includes(loc.bucket)) {
      pathsToDelete.add(loc.path);
    }
  };

  findings?.forEach((f: any) => {
    if (f.screenshot_url) f.screenshot_url.split(",").forEach(extractPath);
  });

  pages?.forEach((p: any) => {
    extractPath(p.screenshot_url_desktop);
    extractPath(p.screenshot_url_tablet);
    extractPath(p.screenshot_url_mobile);
  });

  // 2. Delete explicitly linked files from potential buckets
  if (pathsToDelete.size > 0) {
    const pathArray = Array.from(pathsToDelete);
    await removeStoredObjects("screenshots", pathArray);
    await removeStoredObjects("evidence", pathArray);
    await removeStoredObjects("public_evidence", pathArray);
  }

  // 2.5 Delete all orphaned intermediate run files by runId prefix
  for (const runId of runIds) {
    // Wipe entirely runId-prefixed folders
    await removeStoredPrefix("screenshots", `${runId}/`);
    await removeStoredPrefix("evidence", `${runId}/`);
    await removeStoredPrefix("public_evidence", `${runId}/`);

    // Wipe privacy policy intermediate files prefixed with runId
    await removeStoredPrefix("evidence", `privacy_policy/${runId}`);
  }

  // 3. Delete the run
  const { error } = await supabase.from("qa_runs").delete().in("id", runIds);

  if (error) throw error;
}
