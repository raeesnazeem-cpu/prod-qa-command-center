// Runs against a real Redis (the gate is a Lua script, so a mock would only
// test the mock). Opt-in: REPORT_GATE_REDIS_URL=redis://127.0.0.1:6390
const url = process.env.REPORT_GATE_REDIS_URL
const d = url ? describe : describe.skip

d("reportGate", () => {
  let gate: typeof import("../reportGate")
  let queue: typeof import("../queue")

  beforeAll(async () => {
    process.env.UPSTASH_REDIS_URL = url
    queue = await import("../queue")
    gate = await import("../reportGate")
  })

  afterAll(async () => {
    await queue.qaQueue.close()
    queue.connection.disconnect()
  })

  const run = () => `test-${Math.random().toString(36).slice(2)}`

  it("opens only for the last part, whatever the order", async () => {
    const id = run()
    await gate.armReportGate(id, ["project_plan", "paid_media"])
    expect(await gate.releaseReportGate(id, "paid_media")).toBe("wait")
    expect(await gate.releaseReportGate(id, gate.PAGES_PART)).toBe("wait")
    expect(await gate.releaseReportGate(id, "project_plan")).toBe("open")
  })

  it("opens exactly once under concurrent releases", async () => {
    const id = run()
    await gate.armReportGate(id, ["project_plan", "paid_media"])
    const results = await Promise.all([
      gate.releaseReportGate(id, gate.PAGES_PART),
      gate.releaseReportGate(id, "project_plan"),
      gate.releaseReportGate(id, "paid_media"),
      gate.releaseReportGate(id, "paid_media"), // duplicate release
    ])
    expect(results.filter((r) => r === "open")).toHaveLength(1)
  })

  it("a duplicate release never re-opens a finished gate", async () => {
    const id = run()
    await gate.armReportGate(id, ["paid_media"])
    expect(await gate.releaseReportGate(id, "paid_media")).toBe("wait")
    expect(await gate.releaseReportGate(id, "paid_media")).toBe("wait")
    expect(await gate.releaseReportGate(id, gate.PAGES_PART)).toBe("open")
    expect(await gate.releaseReportGate(id, gate.PAGES_PART)).toBe("none")
  })

  it("no API checks → no gate, pages finalize as before", async () => {
    const id = run()
    await gate.armReportGate(id, [])
    expect(await gate.releaseReportGate(id, gate.PAGES_PART)).toBe("none")
  })
})
