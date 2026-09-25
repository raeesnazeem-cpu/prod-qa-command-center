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

/**
 * How many findings could need work, uncapped — the same filter as
 * selectFixQueue. Lets the report say how many were left out by the cap.
 */
export function countFixEligible<T>(findings: readonly T[] | null | undefined): number {
  let n = 0
  for (const f of findings || []) {
    if (!isCleanPassFinding(f) && !isInformationalFinding(f)) n++
  }
  return n
}

/**
 * Stable order for the fix queue: check_factor, then page_id, then id. The DB
 * returns findings in no fixed order, so without this the SAME site could get a
 * different set of findings fixed each run once the cap is hit. Returns a copy.
 */
export function sortFindingsForFix<
  T extends { check_factor?: unknown; page_id?: unknown; id?: unknown },
>(findings: readonly T[] | null | undefined): T[] {
  const key = (v: unknown) => String(v ?? "")
  return [...(findings || [])].sort(
    (a, b) =>
      key(a.check_factor).localeCompare(key(b.check_factor)) ||
      key(a.page_id).localeCompare(key(b.page_id)) ||
      key(a.id).localeCompare(key(b.id)),
  )
}
