jest.mock("../supabase", () => ({ supabase: {} }))
jest.mock("../queue", () => ({ qaQueue: {}, connection: {} }))
jest.mock("@qacc/ai", () => ({}), { virtual: true })
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { latestOpenSubtasks } = require("../tedSync")

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
