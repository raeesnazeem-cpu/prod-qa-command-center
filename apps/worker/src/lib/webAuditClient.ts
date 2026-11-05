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
      throw new WebAuditError(`WebAudit error: ${msg.message || "unknown"}`)
    }
    if (msg?.type === "agent_error") {
      agentError = String(msg.message || msg.agent || "AI step failed")
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
      // `sections` lets a WebAudit that supports it skip PageSpeed; older
      // WebAudit builds ignore unknown fields.
      body: JSON.stringify({ url, sections: ["cro"] }),
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
