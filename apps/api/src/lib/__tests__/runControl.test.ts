// A cancelled run must free the global run slot; otherwise the next run waits
// until the slot goes stale (RUN_SLOT_STALE_SECONDS, 30 min by default).
const rpc = jest.fn(async () => ({ data: null, error: null }))
let currentStatus = "running"

jest.mock("../supabase", () => {
  const chain: any = {
    select: () => chain,
    update: () => chain,
    eq: () => chain,
    single: async () => ({ data: { id: "run-1", status: currentStatus }, error: null }),
  }
  return { supabase: { from: () => chain, rpc } }
})
jest.mock("../queue", () => ({ qaQueue: { add: jest.fn() }, addRunJob: jest.fn() }))

import { transitionRunStatus } from "../runControl"

describe("transitionRunStatus", () => {
  beforeEach(() => {
    rpc.mockClear()
    currentStatus = "running"
  })

  it("releases the run slot when a run is cancelled", async () => {
    const res = await transitionRunStatus("run-1", "cancelled")
    expect(res.ok).toBe(true)
    expect(rpc).toHaveBeenCalledWith("release_run_slot", { p_run_id: "run-1" })
  })

  it("keeps the slot when a run is paused", async () => {
    const res = await transitionRunStatus("run-1", "paused")
    expect(res.ok).toBe(true)
    expect(rpc).not.toHaveBeenCalled()
  })
})
