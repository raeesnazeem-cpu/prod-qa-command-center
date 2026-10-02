/**
 * A page that hits the page timer is retried exactly once, with the timed-out
 * attempt's partial findings cleared first. Only the first attempt is told a
 * retry follows (retryOnTimeout), so the page is counted toward completion once.
 */
class PageTimeoutError extends Error {}

const pageJob = jest.fn()
jest.mock("../crawlPageJob", () => ({
  PageTimeoutError,
  processCrawlPageJob: (...a: any[]) => pageJob(...a),
}))

const calls: string[] = []
jest.mock("../../lib/supabase", () => {
  const chain: any = {}
  chain.select = () => chain
  chain.eq = () => chain
  chain.single = async () => ({ data: { status: "pending" } })
  chain.delete = () => (calls.push("delete findings"), chain)
  chain.update = () => (calls.push("reset progress"), chain)
  chain.then = (res: any) => res({ error: null })
  return { supabase: { from: () => chain } }
})
jest.mock("pino", () => () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }))

import { processCrawlBatchJob } from "../crawlBatchJob"

const batch = (extra: any = {}) =>
  ({ data: { runId: "r1", pages: [{ id: "p1", url: "https://x.test/a" }], ...extra } }) as any

beforeEach(() => {
  pageJob.mockReset()
  calls.length = 0
})

test("timed-out page is cleared and retried once; only the first attempt defers completion", async () => {
  pageJob.mockRejectedValueOnce(new PageTimeoutError("timed out")).mockResolvedValueOnce(undefined)

  await processCrawlBatchJob(batch())

  expect(pageJob).toHaveBeenCalledTimes(2)
  expect(pageJob.mock.calls[0][0].data.retryOnTimeout).toBe(true)
  expect(pageJob.mock.calls[1][0].data.retryOnTimeout).toBeUndefined()
  expect(calls).toEqual(["delete findings", "reset progress"])
})

test("a second timeout is not retried again", async () => {
  pageJob.mockRejectedValue(new PageTimeoutError("timed out"))

  await processCrawlBatchJob(batch())

  expect(pageJob).toHaveBeenCalledTimes(2)
})

test("ordinary errors are not retried", async () => {
  pageJob.mockRejectedValueOnce(new Error("boom"))

  await processCrawlBatchJob(batch())

  expect(pageJob).toHaveBeenCalledTimes(1)
  expect(calls).toEqual([])
})

test("single-check override runs are not retried", async () => {
  pageJob.mockRejectedValueOnce(new PageTimeoutError("timed out"))

  await processCrawlBatchJob(batch({ overrideChecks: ["dead_links"] }))

  expect(pageJob).toHaveBeenCalledTimes(1)
  expect(pageJob.mock.calls[0][0].data.retryOnTimeout).toBe(false)
})
