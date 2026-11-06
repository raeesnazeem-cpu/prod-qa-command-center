import type { WebAuditCroResult } from "./webAuditClient"

// One CRO finding per page. Its context_text holds the full WebAudit CRO result
// as plain, sectioned text, so the web finding card shows it as-is and the TED
// report parses it back (parseCroContext) into a per-page block:
//
//   Page: https://site.com/
//   Score: 82/100 (Average)
//   Issues found:
//   - ...
//   Recommended fixes:
//   - ...
//   High-impact failed checks:
//   - [critical] Primary CTA above the fold: Add a CTA in the hero.
//   Source: G99 WebAudit

// WebAudit's own score bands (its dashboard: Excellent 90+, Average 70-89,
// Poor <70). A page passes unless WebAudit rates it Poor.
export const CRO_PASS_SCORE = 70
export function croBand(score: number): "Excellent" | "Average" | "Poor" {
  return score >= 90 ? "Excellent" : score >= CRO_PASS_SCORE ? "Average" : "Poor"
}

const MAX_ITEMS = 5
const MAX_ITEM_CHARS = 500
const MAX_FAILED_CHECKS = 8

const oneLine = (s: string, max = MAX_ITEM_CHARS): string => {
  const t = String(s || "").replace(/\s+/g, " ").trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

export interface CroPageReport {
  url: string
  score: number | null
  band: string
  issues: string[]
  fixes: string[]
  failedChecks: { impact: string; name: string; fix: string }[]
  reportUrl: string
}

export function highImpactFailed(cro: WebAuditCroResult) {
  const rank: Record<string, number> = { critical: 0, high: 1 }
  return cro.checks
    .filter((c) => !c.passed && (c.impact === "critical" || c.impact === "high"))
    .sort((a, b) => rank[a.impact!] - rank[b.impact!])
    .slice(0, MAX_FAILED_CHECKS)
}

/** Build the sectioned context_text for one page. */
export function formatCroContext(url: string, cro: WebAuditCroResult): string {
  const lines = [`Page: ${url}`, `Score: ${cro.score}/100 (${croBand(cro.score)})`]
  const issues = cro.issues.map((s) => oneLine(s)).filter(Boolean).slice(0, MAX_ITEMS)
  const fixes = cro.recommendations.map((s) => oneLine(s)).filter(Boolean).slice(0, MAX_ITEMS)
  const failed = highImpactFailed(cro)
  if (issues.length) lines.push("Issues found:", ...issues.map((s) => `- ${s}`))
  if (fixes.length) lines.push("Recommended fixes:", ...fixes.map((s) => `- ${s}`))
  if (failed.length)
    lines.push(
      "High-impact failed checks:",
      ...failed.map((c) => {
        const fix = oneLine(c.remediation || "", 300)
        return `- [${c.impact}] ${oneLine(c.checkName, 120)}${fix ? `: ${fix}` : ""}`
      }),
    )
  if (cro.reportUrl) lines.push(`WebAudit report: ${cro.reportUrl}`)
  lines.push("Source: G99 WebAudit")
  return lines.join("\n")
}

/** Read a context_text written by formatCroContext back into its parts. */
export function parseCroContext(ctx: string | null | undefined): CroPageReport | null {
  const text = String(ctx || "")
  if (!/^Score:\s*\d+/m.test(text)) return null
  const out: CroPageReport = { url: "", score: null, band: "", issues: [], fixes: [], failedChecks: [], reportUrl: "" }
  let section: "issues" | "fixes" | "failed" | null = null
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    let m: RegExpMatchArray | null
    if ((m = line.match(/^Page:\s*(\S+)/))) out.url = m[1]
    else if ((m = line.match(/^Score:\s*(\d+)\/100(?:\s*\(([^)]+)\))?/))) {
      out.score = Number(m[1])
      out.band = m[2] || croBand(out.score)
    } else if (/^Issues found:$/i.test(line)) section = "issues"
    else if (/^Recommended fixes:$/i.test(line)) section = "fixes"
    else if (/^High-impact failed checks:$/i.test(line)) section = "failed"
    else if ((m = line.match(/^WebAudit report:\s*(https?:\/\/\S+)/))) {
      out.reportUrl = m[1]
      section = null
    } else if (/^Source:/i.test(line)) section = null
    else if (line.startsWith("- ") && section) {
      const item = line.slice(2)
      if (section === "issues") out.issues.push(item)
      else if (section === "fixes") out.fixes.push(item)
      else {
        const fm = item.match(/^\[(\w+)\]\s*([^:]+?)(?::\s*(.*))?$/)
        out.failedChecks.push(
          fm ? { impact: fm[1], name: fm[2].trim(), fix: (fm[3] || "").trim() } : { impact: "", name: item, fix: "" },
        )
      }
    }
  }
  return out
}
