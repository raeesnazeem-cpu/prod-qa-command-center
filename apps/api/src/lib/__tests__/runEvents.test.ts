import {
  buildRunEventRow,
  logRunEvent,
  TriggerTracker,
  couldNotStartText,
  startedText,
} from "../runEvents"

// A fake supabase client that records inserts into run_events.
function fakeDb(fail: "error" | "throw" | null = null) {
  const rows: any[] = []
  return {
    rows,
    from(table: string) {
      return {
        insert: async (row: any) => {
          if (fail === "throw") throw new Error("db down")
          rows.push({ table, ...row })
          return { error: fail === "error" ? { message: "insert failed" } : null }
        },
      }
    },
  }
}

describe("buildRunEventRow", () => {
  it("maps fields and stringifies the TED task id", () => {
    expect(
      buildRunEventRow({ runId: "r1", tedTaskId: 7618, kind: "run.queued", status: "ok", message: "m" }),
    ).toEqual({ run_id: "r1", ted_task_id: "7618", kind: "run.queued", status: "ok", message: "m", detail: {} })
  })
  it("uses nulls when there is no run or task", () => {
    const r = buildRunEventRow({ kind: "k", status: "info", message: "m" })
    expect(r.run_id).toBeNull()
    expect(r.ted_task_id).toBeNull()
  })
})

describe("logRunEvent", () => {
  it("never throws when the insert throws or errors", async () => {
    await expect(logRunEvent({ kind: "k", status: "ok", message: "m" }, fakeDb("throw"))).resolves.toBeUndefined()
    await expect(logRunEvent({ kind: "k", status: "ok", message: "m" }, fakeDb("error"))).resolves.toBeUndefined()
  })
})

describe("TriggerTracker", () => {
  it("is ignored until a trigger is received", () => {
    const tr = new TriggerTracker("post-release", fakeDb())
    expect(tr.responseData()).toEqual({ outcome: "ignored" })
    expect(tr.needsCouldNotStartComment()).toBe(false)
  })

  it("no project: not_started with reason, fix, a failed event and a comment owed", async () => {
    const db = fakeDb()
    const tr = new TriggerTracker("post-release", db)
    await tr.received("7618")
    await tr.fail("project.missing", "There is no QACC project for Katie Pizzo Orthodontics (TED client 135).", "create the project.")
    expect(tr.responseData()).toEqual({
      outcome: "not_started",
      reason: "There is no QACC project for Katie Pizzo Orthodontics (TED client 135).",
      fix: "create the project.",
    })
    expect(tr.needsCouldNotStartComment()).toBe(true)
    expect(db.rows.map((r) => [r.kind, r.status, r.ted_task_id])).toEqual([
      ["trigger.received", "ok", "7618"],
      ["project.missing", "failed", "7618"],
    ])
    expect(db.rows[1].detail.fix).toBe("create the project.")
  })

  it("started clears the reason and owes no comment", async () => {
    const db = fakeDb()
    const tr = new TriggerTracker("pre-release", db)
    await tr.received("9815")
    await tr.started("run-1", { checks: ["links"] })
    expect(tr.responseData()).toEqual({ outcome: "started" })
    expect(tr.runId).toBe("run-1")
    expect(tr.needsCouldNotStartComment()).toBe(false)
    expect(db.rows[1]).toMatchObject({ kind: "run.queued", run_id: "run-1" })
  })

  it("duplicate keeps the existing run and owes no extra comment", async () => {
    const tr = new TriggerTracker("pre-release", fakeDb())
    await tr.received("1")
    await tr.duplicate("run-0", "A test run for this task is already in progress (run run-0).")
    expect(tr.responseData().outcome).toBe("duplicate")
    expect(tr.runId).toBe("run-0")
    expect(tr.needsCouldNotStartComment()).toBe(false)
  })

  it("an aborted run (no URL) keeps its run id for the log", async () => {
    const tr = new TriggerTracker("post-release", fakeDb())
    await tr.received("1")
    await tr.fail("url.missing", "No live URL.", "add it.", "aborted-1")
    expect(tr.runId).toBe("aborted-1")
    expect(tr.needsCouldNotStartComment()).toBe(true)
  })
})

describe("comment texts", () => {
  it("could-not-start says the reason and the fix", () => {
    expect(couldNotStartText("No project.", "create it.")).toBe("Could not start the test run. No project. To fix: create it.")
  })
  it("started names url, source, checks and run", () => {
    expect(startedText("https://a.com", "release task", ["links", "forms"], "r9")).toBe(
      "Test run started on https://a.com (URL from release task). Checks: links, forms. Run r9.",
    )
  })
})
