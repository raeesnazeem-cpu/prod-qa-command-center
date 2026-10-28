import { jobEnded, jobStarted, _resetTaskProtection } from "../ecsTaskProtection"

const fetchMock = jest.fn(async () => ({ ok: true, status: 200 }))

const bodies = () => fetchMock.mock.calls.map((c: any[]) => JSON.parse(c[1].body))

describe("ecsTaskProtection", () => {
  beforeEach(() => {
    jest.useFakeTimers()
    fetchMock.mockClear()
    ;(global as any).fetch = fetchMock
    process.env.ECS_TASK_PROTECTION = "true"
    process.env.ECS_AGENT_URI = "http://agent"
    _resetTaskProtection()
  })
  afterEach(() => {
    _resetTaskProtection()
    jest.useRealTimers()
    delete process.env.ECS_TASK_PROTECTION
    delete process.env.ECS_AGENT_URI
  })

  it("protects the task while a job runs and releases it after the idle grace", async () => {
    jobStarted()
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledWith(
      "http://agent/task-protection/v1/state",
      expect.objectContaining({ method: "PUT" }),
    )
    expect(bodies()[0]).toEqual({ ProtectionEnabled: true, ExpiresInMinutes: 60 })

    jobEnded()
    jest.advanceTimersByTime(119_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(2_000)
    expect(bodies()[1]).toEqual({ ProtectionEnabled: false })
  })

  it("keeps protection when the next job starts within the grace period", async () => {
    jobStarted()
    await Promise.resolve()
    jobEnded()
    jest.advanceTimersByTime(60_000)
    jobStarted()
    jest.advanceTimersByTime(200_000)
    expect(bodies().some((b) => b.ProtectionEnabled === false)).toBe(false)
  })

  it("does nothing outside ECS", () => {
    delete process.env.ECS_AGENT_URI
    jobStarted()
    jobEnded()
    jest.advanceTimersByTime(300_000)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
