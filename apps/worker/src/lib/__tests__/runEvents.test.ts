import { buildRunEventRow, logRunEvent, checkLabel } from "../runEvents"

describe("worker runEvents", () => {
  it("builds a row", () => {
    expect(
      buildRunEventRow({ runId: "r", kind: "check.done", status: "failed", message: "Links failed", detail: { check: "links" } }),
    ).toEqual({
      run_id: "r",
      ted_task_id: null,
      kind: "check.done",
      status: "failed",
      message: "Links failed",
      detail: { check: "links" },
    })
  })
  it("never throws", async () => {
    const bad = {
      from: () => ({
        insert: async () => {
          throw new Error("down")
        },
      }),
    }
    await expect(logRunEvent({ kind: "k", status: "ok", message: "m" }, bad)).resolves.toBeUndefined()
  })
  it("labels check keys", () => {
    expect(checkLabel("contact_form")).toBe("Contact form")
    expect(checkLabel("")).toBe("Check")
  })
})
