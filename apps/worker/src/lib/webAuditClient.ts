// Client for G99 WebAudit (Growth99ops/g99-web-audit, auditarena.gogroth.com).
//
// WebAudit owns the CRO logic (one Gemini vision call over the page's
// screenshots). QACC never copies it — it calls POST /api/audit and reads the
// streamed NDJSON answer:
//   {"type":"status",...}            progress lines (ignored)
//   {"type":"agent_error",...}       an AI step failed (quota, etc.)
//   {"type":"error","message":...}   the whole audit failed
//   {"type":"complete","data":{...}} the result; data.report.rawResults.cro
//
// Env: WEB_AUDIT_URL (default https://auditarena.gogroth.com),
//      WEB_AUDIT_TOKEN (sent as x-webaudit-token; WebAudit should require it),
//      WEB_AUDIT_TIMEOUT_MS (per page, default 5 min = WebAudit's own limit).

export interface WebAuditCheck {
  checkName: string
  passed: boolean
  remediation?: string
  impact?: "low" | "medium" | "high" | "critical"
}

export interface WebAuditCroResult {
  score: number
  severity?: string
  observations: string[]
  issues: string[]
  recommendations: string[]
  checks: WebAuditCheck[]
  // Link to this audit on WebAudit's dashboard (WebAudit saves token-caller
  // audits since Growth99ops/g99-web-audit#4). Null on older WebAudit builds.
  reportUrl?: string | null
}

export class WebAuditError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WebAuditError"
  }
}

const DEFAULT_URL = "https://auditarena.gogroth.com"
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

export function webAuditBaseUrl(): string {
  return (process.env.WEB_AUDIT_URL || DEFAULT_URL).trim().replace(/\/+$/, "")
}

/**
 * First non-empty line of an upstream error, max 300 chars. WebAudit passes
 * through raw errors such as Playwright's multi-line ASCII box, which would
 * otherwise land verbatim in the TED report. Exported for tests.
 */
export function firstLine(s: unknown): string {
  const line = String(s ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !/^[╔║╚═]/.test(l))
  if (!line) return ""
  return line.length > 300 ? `${line.slice(0, 299)}…` : line
}

/**
 * Read an NDJSON body and return the CRO section of the "complete" line.
 * Exported for tests. Throws WebAuditError on an error line, on an agent
 * error (the CRO section would be missing), or if the stream ends early.
 */
export function parseWebAuditNdjson(text: string): WebAuditCroResult {
  let agentError: string | null = null
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (!line) continue
    let msg: any
    try {
      msg = JSON.parse(line)
    } catch {
      continue
    }
    if (msg?.type === "error") {
      throw new WebAuditError(`WebAudit error: ${firstLine(msg.message) || "unknown"}`)
    }
    if (msg?.type === "agent_error") {
      agentError = firstLine(msg.message || msg.agent) || "AI step failed"
    }
    if (msg?.type === "complete") {
      const cro = msg?.data?.report?.rawResults?.cro
      if (!cro || typeof cro.score !== "number") {
        throw new WebAuditError(
          `WebAudit returned no CRO result${agentError ? ` (${agentError})` : ""}`,
        )
      }
      return {
        score: Math.round(cro.score),
        severity: cro.severity,
        observations: Array.isArray(cro.observations) ? cro.observations.map(String) : [],
        issues: Array.isArray(cro.issues) ? cro.issues.map(String) : [],
        recommendations: Array.isArray(cro.recommendations)
          ? cro.recommendations.map(String)
          : [],
        checks: Array.isArray(cro.checks)
          ? cro.checks
              .filter((c: any) => c && typeof c.checkName === "string")
              .map((c: any) => ({
                checkName: c.checkName,
                passed: !!c.passed,
                remediation: c.remediation ? String(c.remediation) : undefined,
                impact: c.impact,
              }))
          : [],
        reportUrl:
          typeof msg?.data?.reportUrl === "string" && /^https?:\/\//.test(msg.data.reportUrl)
            ? msg.data.reportUrl
            : null,
      }
    }
  }
  throw new WebAuditError(
    `WebAudit stream ended without a result${agentError ? ` (${agentError})` : ""}`,
  )
}

/** Run WebAudit on one URL and return its CRO section. */
export async function runWebAuditCro(url: string): Promise<WebAuditCroResult> {
  const timeoutMs = parseInt(process.env.WEB_AUDIT_TIMEOUT_MS || "", 10) || DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (process.env.WEB_AUDIT_TOKEN) headers["x-webaudit-token"] = process.env.WEB_AUDIT_TOKEN
  try {
    const res = await fetch(`${webAuditBaseUrl()}/api/audit`, {
      method: "POST",
      headers,
      // `sections` lets WebAudit skip PageSpeed; `source` labels the audit it
      // saves on its dashboard. Older WebAudit builds ignore unknown fields.
      body: JSON.stringify({ url, sections: ["cro"], source: "qacc-full-scan" }),
      signal: controller.signal,
    })
    if (!res.ok) {
      throw new WebAuditError(`WebAudit request failed with status code ${res.status}`)
    }
    return parseWebAuditNdjson(await res.text())
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new WebAuditError(`WebAudit encountered a timeout after ${Math.round(timeoutMs / 1000)}s`)
    }
    if (e instanceof WebAuditError) throw e
    throw new WebAuditError(`WebAudit could not be reached: ${e?.message || e}`)
  } finally {
    clearTimeout(timer)
  }
}
