import { buildRunProgress, pickLatestRun, STUCK_AFTER_MS } from "../runProgress"

const NOW = Date.parse("2026-11-09T12:40:00Z")
const run = (over: any = {}) => ({
  id: "r1",
  run_type: "post_release",
  status: "running",
  enabled_checks: ["general", "links", "forms"],
  pages_processed: 14,
  pages_total: 27,
  started_at: "2026-11-09T12:26:04Z",
  completed_at: null,
  ...over,
})
const ev = (at: string, kind: string, status: string, message: string, detail: any = {}) => ({ at, kind, status, message, detail })

describe("buildRunProgress", () => {
  it("running: current step is the last running event, not stuck", () => {
    const p = buildRunProgress(
      run(),
      [
        ev("2026-11-09T12:26:04Z", "run.started", "ok", "Worker started the run"),
        ev("2026-11-09T12:27:00Z", "checks.running", "running", "Running 3 checks on 27 pages"),
        ev("2026-11-09T12:39:00Z", "page.done", "info", "Page checked: /about"),
      ],
      [],
      2,
      NOW,
    )
    expect(p).toMatchObject({
      status: "running",
      currentStep: "Running 3 checks on 27 pages",
      checksTotal: 3,
      checksDone: 0,
      failedChecks: 0,
      pagesProcessed: 14,
      pagesTotal: 27,
      issuesFound: 2,
      lastEventAt: "2026-11-09T12:39:00Z",
      stuck: false,
    })
  })

  it("running with no event for over 15 min is stuck", () => {
    const last = new Date(NOW - STUCK_AFTER_MS - 1000).toISOString()
    const p = buildRunProgress(run(), [ev(last, "checks.running", "running", "Running")], [], 0, NOW)
    expect(p.stuck).toBe(true)
  })

  it("completed: keeps qa_runs.status as-is and counts failed checks from results", () => {
    const p = buildRunProgress(
      run({ status: "completed", completed_at: "2026-11-09T12:41:00Z" }),
      [ev("2026-11-09T12:41:00Z", "run.done", "ok", "Run finished")],
      [
        { check_factor: "general", status: "passed" },
        { check_factor: "links", status: "failed" },
        { check_factor: "forms", status: "errored" },
      ],
      3,
      NOW,
    )
    expect(p.status).toBe("completed")
    expect(p.currentStep).toBe("Finished")
    expect(p.checksDone).toBe(3)
    expect(p.failedChecks).toBe(1)
    expect(p.erroredChecks).toBe(1)
    expect(p.stuck).toBe(false)
  })

  it("counts failed checks from check.done events before results are written", () => {
    const p = buildRunProgress(
      run(),
      [
        ev("2026-11-09T12:30:00Z", "check.done", "ok", "General passed", { check: "general", passed: true }),
        ev("2026-11-09T12:31:00Z", "check.done", "failed", "Links failed", { check: "links", passed: false }),
      ],
      [],
      0,
      NOW,
    )
    expect(p.checksDone).toBe(2)
    expect(p.failedChecks).toBe(1)
  })

  it("a check that could not complete is not a failure", () => {
    const p = buildRunProgress(
      run(),
      [
        ev("2026-11-09T12:31:00Z", "check.done", "failed", "Booking Links · could not complete", { check: "booking_links", passed: false, status: "errored" }),
        ev("2026-11-09T12:31:01Z", "check.done", "ok", "GSR · passed", { check: "gsr", passed: true, status: "passed" }),
      ],
      [],
      0,
      NOW,
    )
    expect(p.failedChecks).toBe(0)
    expect(p.erroredChecks).toBe(1)
  })
})

describe("pickLatestRun", () => {
  it("a could-not-start event newer than the last run wins", () => {
    const r = pickLatestRun(
      { id: "old", status: "completed", created_at: "2026-10-01T00:00:00Z", site_url: "https://a" },
      { at: "2026-11-09T12:25:23Z", kind: "project.missing", status: "failed", message: "No project.", detail: { fix: "create it." } },
    )
    expect(r).toEqual({ runId: null, status: "not_started", outcome: "not_started", reason: "No project.", fix: "create it.", at: "2026-11-09T12:25:23Z" })
  })
  it("a started run newer than any failure is returned", () => {
    const r = pickLatestRun({ id: "r2", status: "running", created_at: "2026-11-09T12:26:00Z", site_url: "https://a" }, null)
    expect(r).toMatchObject({ runId: "r2", status: "running", outcome: "started" })
  })
  it("an aborted run (no site URL) reads as not started", () => {
    const r = pickLatestRun({ id: "r3", status: "failed", created_at: "2026-11-09T12:26:00Z", site_url: "", custom_name: "No beta URL." }, null)
    expect(r).toMatchObject({ runId: "r3", outcome: "not_started", reason: "No beta URL." })
  })
  it("nothing at all", () => {
    expect(pickLatestRun(null, null).runId).toBeNull()
  })
})
