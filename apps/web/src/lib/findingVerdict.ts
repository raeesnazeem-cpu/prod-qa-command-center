import { QAFinding } from "../api/runs.api"

export type FindingVerdict = "pass" | "fix" | "fail"

// Findings do not carry a structured pass/fix/fail flag — every finding is
// stored with status "open". The verdict is encoded in the wording the checks
// produce (see apps/worker/src/checks/*). We derive it here so every finding
// card colour-codes consistently:
//   pass  (green)  – check ran, no issue found
//   fix   (orange) – check ran, real issue detected that a dev must fix
//   fail  (red)    – check could not run / errored / was skipped (no verdict)
//
// Order matters: a failed check never says "no issues found", so test for
// failure first, then pass, then default to fix.
const FAIL_RE =
  /\bcheck (failed|skipped)\b|\bfailed to run\b|\(failed\)|\bskipped\b|\bnot configured\b|could not (fetch|run|be)/i

const PASS_RE = /no issues (found|detected)/i

export function findingVerdict(finding: QAFinding): FindingVerdict {
  const haystack = `${finding.title ?? ""}\n${finding.description ?? ""}\n${
    finding.context_text ?? ""
  }`

  if (FAIL_RE.test(finding.title ?? "")) return "fail"
  if (PASS_RE.test(haystack)) return "pass"
  return "fix"
}

const BORDER: Record<FindingVerdict, string> = {
  pass: "border-emerald-500 ring-1 ring-emerald-500/20",
  fix: "border-amber-500 ring-1 ring-amber-500/20",
  fail: "border-red-500 ring-1 ring-red-500/20",
}

// Full border className for a finding card. False positives keep their colour
// but are dimmed, matching the previous muted treatment.
export function findingBorderClass(finding: QAFinding): string {
  const base = BORDER[findingVerdict(finding)]
  return finding.status === "false_positive" ? `opacity-60 ${base}` : base
}
