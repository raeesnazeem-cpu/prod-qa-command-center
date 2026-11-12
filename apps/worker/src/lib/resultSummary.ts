import { CHECK_AREAS, checkArea } from "@qacc/shared"

// The test-case block of the TED result comment. Posted short so pass and fail
// read at a glance: a verdict line, the counts, the failed check names and the
// could-not-run names. "Show full summary" (<details>) opens two tables: failed
// and could-not-run checks with area and reason, then passed checks by area.
// TED keeps <details>/<summary>; an older TED strips the tags and the tables
// simply show open, so nothing is lost either way.

export type TestCaseRow = {
  factor: string
  label: string
  status: "failed" | "passed" | "errored"
  // Failed: one short reason, plain text (escaped here).
  reason?: string
  // Could not run: the reason line, already HTML (e.g. "Could not complete: …").
  couldNotRunHtml?: string
}

const RED = "color: #b91c1c"
const GREEN = "color: #15803d"
const AMBER = "color: #b45309"

const esc = (s: any) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

const byArea = (rows: TestCaseRow[]): TestCaseRow[] => {
  const order = new Map<string, number>(CHECK_AREAS.map((a, i) => [a, i]))
  return rows
    .map((r, i) => ({ r, i }))
    .sort(
      (a, b) =>
        order.get(checkArea(a.r.factor))! - order.get(checkArea(b.r.factor))! || a.i - b.i,
    )
    .map((x) => x.r)
}

export function renderTestCaseSummary(rows: TestCaseRow[]): string {
  const failed = rows.filter((r) => r.status === "failed")
  const errored = rows.filter((r) => r.status === "errored")
  const passed = rows.filter((r) => r.status === "passed")
  const total = rows.length
  if (!total) return ""

  const verdict = failed.length
    ? `<p><strong><span style="${RED}">❌ ${failed.length} of ${total} checks failed</span></strong></p>`
    : errored.length
      ? `<p><strong><span style="${GREEN}">✅ No check failed</span></strong> (${errored.length} could not run)</p>`
      : `<p><strong><span style="${GREEN}">✅ All ${total} checks passed</span></strong></p>`

  const counts =
    `<p><span style="${RED}">❌ ${failed.length} failed</span> · ` +
    `<span style="${GREEN}">✅ ${passed.length} passed</span>` +
    (errored.length ? ` · <span style="${AMBER}">⚠️ ${errored.length} could not run</span>` : "") +
    `</p>`

  const failedNames = failed.length
    ? `<p><strong><span style="${RED}">❌ Failed:</span></strong> ${failed.map((r) => esc(r.label)).join(", ")}</p>`
    : ""
  const erroredNames = errored.length
    ? `<p><strong><span style="${AMBER}">⚠️ Could not run:</span></strong> ${errored.map((r) => esc(r.label)).join(", ")}</p>`
    : ""

  const problemRows = [...byArea(failed), ...byArea(errored)]
  const problemTable = problemRows.length
    ? `<p><strong>❌ Failed (${failed.length})${errored.length ? ` and ⚠️ could not run (${errored.length})` : ""}</strong></p>` +
      // Area is a heading row, not a column, so the reason column fits a task's
      // comment panel without scrolling sideways.
      `<table><thead><tr><th>#</th><th>Check</th><th>What QACC found</th></tr></thead><tbody>` +
      problemRows
        .map((r, i) => {
          const mark = r.status === "failed" ? "❌" : "⚠️"
          const found =
            r.status === "failed" ? esc(r.reason || "Failed") : r.couldNotRunHtml || "Could not run"
          const area = checkArea(r.factor)
          const prev = i ? checkArea(problemRows[i - 1].factor) : ""
          const head =
            area !== prev || (i && problemRows[i - 1].status !== r.status)
              ? `<tr><td colspan="3"><strong>${esc(area)}</strong></td></tr>`
              : ""
          return head + `<tr><td>${mark} ${i + 1}</td><td>${esc(r.label)}</td><td>${found}</td></tr>`
        })
        .join("") +
      `</tbody></table>`
    : ""

  const passedGroups = new Map<string, string[]>()
  for (const r of byArea(passed)) {
    const a = checkArea(r.factor)
    if (!passedGroups.has(a)) passedGroups.set(a, [])
    passedGroups.get(a)!.push(esc(r.label))
  }
  const passedTable = passed.length
    ? `<p><strong>✅ Passed (${passed.length})</strong></p>` +
      `<table><thead><tr><th>Area</th><th>Checks</th></tr></thead><tbody>` +
      [...passedGroups]
        .map(([area, labels]) => `<tr><td>${esc(area)}</td><td>${labels.join(" · ")}</td></tr>`)
        .join("") +
      `</tbody></table>`
    : ""

  return (
    verdict +
    counts +
    failedNames +
    erroredNames +
    `<details><summary>Show full summary (${total} checks)</summary>` +
    problemTable +
    passedTable +
    `</details>`
  )
}
