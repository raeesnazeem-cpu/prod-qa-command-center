jest.mock("../supabase", () => ({ supabase: {} }))
jest.mock("../queue", () => ({ qaQueue: {} }))

import { resumeStageFor, resumeMessage, ResumeRunRow } from "../runResume"

const NOW = new Date("2026-11-12T12:00:00Z").getTime()
const ago = (mins: number) => new Date(NOW - mins * 60_000).toISOString()

const run = (over: Partial<ResumeRunRow> = {}): ResumeRunRow => ({
  id: "r1",
  status: "running",
  run_type: "pre_release",
  site_url: "https://site.gogroth.com",
  created_at: ago(90),
  updated_at: ago(30),
  ted_task_id: "11404",
  ted_report_posted_at: null,
  ted_completed_at: null,
  ai_fix_status: null,
  ...over,
})
const opts = { now: NOW, maxAgeHours: 72, minIdleSeconds: 120, aiFixEnabled: true }
const pages = (rows: number, unfinished: number) => ({ rows, unfinished })

describe("resumeStageFor — stopped on purpose is never resumed", () => {
  it("cancelled run → fresh run", () => {
    expect(resumeStageFor(run({ status: "cancelled" }), pages(10, 4), opts)).toBeNull()
  })
  it("paused run → not resumed", () => {
    expect(resumeStageFor(run({ status: "paused" }), pages(10, 4), opts)).toBeNull()
  })
  it("aborted run (failed, no site URL) → fresh run", () => {
    expect(resumeStageFor(run({ status: "failed", site_url: "" }), pages(0, 0), opts)).toBeNull()
  })
})

describe("resumeStageFor — runs that died midway", () => {
  it("died while finding pages → discover", () => {
    expect(resumeStageFor(run(), pages(0, 0), opts)).toBe("discover")
  })
  it("crash-failed run while finding pages → discover", () => {
    expect(resumeStageFor(run({ status: "failed" }), pages(0, 0), opts)).toBe("discover")
  })
  it("died during the page scan → pages", () => {
    expect(resumeStageFor(run(), pages(100, 6), opts)).toBe("pages")
  })
  it("timed out during the page scan → pages", () => {
    expect(resumeStageFor(run({ status: "timed_out" }), pages(100, 6), opts)).toBe("pages")
  })
  it("all pages done, report never posted → finalize", () => {
    expect(resumeStageFor(run({ status: "completed" }), pages(100, 0), opts)).toBe("finalize")
  })
  it("report posted, AI fix stuck → ai_fix", () => {
    const r = run({ status: "completed", ted_report_posted_at: ago(40), ai_fix_status: "running" })
    expect(resumeStageFor(r, pages(100, 0), opts)).toBe("ai_fix")
  })
  it("AI fix stuck but the fix module is off → fresh run", () => {
    const r = run({ status: "completed", ted_report_posted_at: ago(40), ai_fix_status: "running" })
    expect(resumeStageFor(r, pages(100, 0), { ...opts, aiFixEnabled: false })).toBeNull()
  })
})

describe("resumeStageFor — finished, too old, or too fresh", () => {
  it("fully finished run → fresh run", () => {
    const r = run({ status: "completed", ted_report_posted_at: ago(40), ai_fix_status: "done", ted_completed_at: ago(35) })
    expect(resumeStageFor(r, pages(100, 0), opts)).toBeNull()
  })
  it("report posted, no AI fix needed → fresh run", () => {
    const r = run({ status: "completed", ted_report_posted_at: ago(40) })
    expect(resumeStageFor(r, pages(100, 0), opts)).toBeNull()
  })
  it("older than the max age → fresh run", () => {
    expect(resumeStageFor(run({ created_at: ago(73 * 60) }), pages(100, 6), opts)).toBeNull()
  })
  it("touched in the last 2 minutes → not resumed (start-up race)", () => {
    expect(resumeStageFor(run({ updated_at: ago(1) }), pages(0, 0), opts)).toBeNull()
  })
  it("completed run with no pages → fresh run", () => {
    expect(resumeStageFor(run({ status: "completed" }), pages(0, 0), opts)).toBeNull()
  })
})

describe("resumeMessage", () => {
  it("says how many pages are left", () => {
    const msg = resumeMessage({ run: run(), stage: "pages", pages: pages(100, 6) })
    expect(msg).toContain("6 of 100 pages left")
  })
})
