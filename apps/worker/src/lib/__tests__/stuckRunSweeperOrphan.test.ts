/**
 * Orphaned runs: pages left unfinished with no queue job to finish them (BullMQ
 * gave up on the batch). The sweeper fails the leftover pages and completes the
 * run so the TED report still goes out — but never touches a run that is still
 * live (recent update, or a job still queued for it).
 */
const MIN = 60_000

let run: any
let doneCount: number
let queueJobs: any[]
const ops: string[] = []

jest.mock("../queue", () => ({
  qaQueue: { getJobs: jest.fn(async () => queueJobs) },
}))
jest.mock("../supabase", () => {
  const from = (table: string) => {
    const q: any = { table, isUpdate: false }
    q.select = (_c?: string, opts?: any) => ((q.count = !!opts?.count), q)
    q.update = () => ((q.isUpdate = true), ops.push(`update ${table}`), q)
    q.eq = q.gt = q.lt = q.in = q.not = q.limit = () => q
    q.then = (res: any) => {
      if (table === "qa_runs") return res({ data: [run], error: null })
      if (q.isUpdate) {
        doneCount = run.pages_total
        return res({ data: [{ id: "p1" }, { id: "p2" }], error: null })
      }
      return res({ count: doneCount, error: null })
    }
    return q
  }
  return {
    supabase: {
      from,
      rpc: jest.fn(async (name: string) => {
        ops.push(`rpc ${name}`)
        return { data: doneCount >= run.pages_total, error: null }
      }),
    },
  }
})
jest.mock("../tedSync", () => ({
  postFinalReportToTED: jest.fn(async () => ops.push("ted report")),
}))
jest.mock("../runResults", () => ({ persistScanCheckResults: jest.fn(async () => {}) }))
jest.mock("../runSlot", () => ({ releaseRunSlot: jest.fn(async () => {}) }))
jest.mock("pino", () => () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }))

import { sweepOnce } from "../stuckRunSweeper"

const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

beforeEach(() => {
  ops.length = 0
  doneCount = 77
  queueJobs = []
  run = {
    id: "run-1",
    ted_task_id: "13549",
    run_type: "full_scan",
    pages_total: 79,
    pages_processed: 77,
    started_at: ago(60 * MIN),
    updated_at: ago(20 * MIN),
  }
})

test("orphaned run: leftover pages failed, run completed, TED report posted", async () => {
  await sweepOnce()
  expect(ops).toEqual(["update pages", "rpc reconcile_run_completion", "ted report"])
})

test("a job still queued for the run → left alone", async () => {
  queueJobs = [{ data: { runId: "run-1" } }]
  await sweepOnce()
  expect(ops).toEqual([])
})

test("recently updated run → left alone even with no queue job", async () => {
  run.updated_at = ago(5 * MIN)
  await sweepOnce()
  expect(ops).toEqual([])
})

test("jobs for other runs don't protect this one", async () => {
  queueJobs = [{ data: { runId: "other-run" } }]
  await sweepOnce()
  expect(ops[0]).toBe("update pages")
})
