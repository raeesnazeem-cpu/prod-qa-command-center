import { isSubtaskEvent } from "../tedSubtaskEvent"

describe("isSubtaskEvent", () => {
  it("treats a row event (subjectKind subtask) as a subtask", () => {
    expect(isSubtaskEvent({ subjectKind: "subtask", parentTaskId: "94872" })).toBe(true)
  })

  it("treats a row event with a parent id as a subtask even without subjectKind", () => {
    // Status-change events carry parentTaskId but not subjectKind.
    expect(isSubtaskEvent({ parentTaskId: 94872 })).toBe(true)
  })

  it("does not treat a top-level task as a subtask", () => {
    expect(isSubtaskEvent({ subjectKind: "task", parentTaskId: "" })).toBe(false)
  })

  it("does not treat an older payload with neither field as a subtask (unchanged behavior)", () => {
    expect(isSubtaskEvent({})).toBe(false)
  })

  it("ignores a blank or null parent id", () => {
    expect(isSubtaskEvent({ parentTaskId: "   " })).toBe(false)
    expect(isSubtaskEvent({ parentTaskId: null })).toBe(false)
    expect(isSubtaskEvent({ parentTaskId: undefined })).toBe(false)
  })
})
