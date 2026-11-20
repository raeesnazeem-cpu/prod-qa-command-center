jest.mock("../supabase", () => ({ supabase: {} }))
jest.mock("../queue", () => ({ qaQueue: {}, connection: {} }))
jest.mock("@qacc/ai", () => ({}), { virtual: true })
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { latestOpenSubtasks, subtaskOpenMap } = require("../tedSync")

// QA sheet 2026-11-12 (Bright Eyes, Sage and Silence, BodySong): the parent QA
// task closed Completed while subtasks with issues were still open.
const row = (task: string, status: string) => ({
  ted_task_id: task,
  event_key: `status:${task}:${status}:run1`,
})

describe("latestOpenSubtasks", () => {
  it("a subtask left In Progress keeps the parent open", () => {
    expect(latestOpenSubtasks([row("11", "Completed"), row("12", "In Progress")], "10")).toEqual(["12"])
  })
  it("uses each subtask's LATEST status", () => {
    const rows = [row("12", "In Progress"), row("12", "Completed"), row("13", "Completed"), row("13", "In Progress")]
    expect(latestOpenSubtasks(rows, "10")).toEqual(["13"])
  })
  it("ignores the parent's own status rows", () => {
    expect(latestOpenSubtasks([row("10", "In Progress"), row("11", "Completed")], "10")).toEqual([])
  })
  it("all subtasks completed → nothing open", () => {
    expect(latestOpenSubtasks([row("11", "Completed"), row("12", "Completed")], "10")).toEqual([])
  })
})

// QA sheet 2026-11-19 (TED 57012): false_breakpoint FAILED and header_breakpoints
// PASSED, both on subtask 57012 — the later pass overwrote In Progress with
// Completed. A shared subtask stays open while ANY of its checks is open.
describe("subtaskOpenMap", () => {
  const isOpen = (s: { status: string }) => s.status === "failed"
  it("a shared subtask stays open when one of its checks failed", () => {
    const m = subtaskOpenMap(
      [
        { factor: "false_breakpoint", status: "failed" },
        { factor: "header_breakpoints", status: "passed" },
      ],
      { false_breakpoint: ["56993", "57012"], header_breakpoints: ["56993", "57012"] },
      isOpen,
    )
    expect(m.get("57012")).toBe(true)
    expect(m.get("56993")).toBe(true)
  })
  it("closes a subtask when all its checks passed", () => {
    const m = subtaskOpenMap(
      [{ factor: "footer_logo", status: "passed" }, { factor: "footer_copyright", status: "passed" }],
      { footer_logo: ["57013"], footer_copyright: ["57013"] },
      isOpen,
    )
    expect(m.get("57013")).toBe(false)
  })
  it("a mapped check with no result keeps its subtask open; video is skipped", () => {
    const m = subtaskOpenMap(
      [{ factor: "dead_links", status: "passed" }],
      { dead_links: ["1"], gsr_check: ["1", "2"], video_recording: ["3"] },
      isOpen,
    )
    expect(m.get("1")).toBe(true)
    expect(m.get("2")).toBe(true)
    expect(m.has("3")).toBe(false)
  })
})
