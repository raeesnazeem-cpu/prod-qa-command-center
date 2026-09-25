import { isCleanPassFinding, isInformationalFinding } from "@qacc/shared"

/**
 * Pick the findings the AI-fix loop works on: the first `max` that could need
 * work. Pass results ("Footer Logo Verified", "No … issues found") and purely
 * informational rows are skipped — several fix handlers match loosely on
 * factor + keyword (footer_logo on /logo/, gitops privacy_policy on /privacy/),
 * so a pass would trigger a real edit and burn a slot a real defect needed.
 * Tool lapses are kept: the loop records them for the Dry-run Data tab.
 *
 * One pass with early exit: O(k) until `max` are found (worst O(n)), and
 * O(max) extra space — no filtered copy of the full set.
 */
export function selectFixQueue<T>(findings: readonly T[] | null | undefined, max: number): T[] {
  const out: T[] = []
  if (!findings || max <= 0) return out
  for (const f of findings) {
    if (isCleanPassFinding(f) || isInformationalFinding(f)) continue
    out.push(f)
    if (out.length === max) break
  }
  return out
}
