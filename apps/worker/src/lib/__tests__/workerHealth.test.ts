import {
  _resetHealth,
  healthStatus,
  markActivity,
  scanJobEnded,
  scanJobStarted,
} from "../workerHealth"

const MIN = 60_000
const later = (ms: number) => Date.now() + ms

beforeEach(() => _resetHealth())

test("idle worker is healthy no matter how long it has been quiet", () => {
  expect(healthStatus(later(120 * MIN)).ok).toBe(true)
})

test("active scan job with no progress for 10 min is unhealthy", () => {
  scanJobStarted("1", "crawl_batch")
  expect(healthStatus(later(9 * MIN)).ok).toBe(true)
  const s = healthStatus(later(11 * MIN))
  expect(s.ok).toBe(false)
  expect(s.activeJobs).toBe(1)
})

test("progress keeps an active scan healthy", () => {
  scanJobStarted("1", "crawl_batch")
  jest.useFakeTimers({ now: later(8 * MIN) })
  markActivity()
  jest.useRealTimers()
  expect(healthStatus(later(15 * MIN)).ok).toBe(true)
})

test("non-scan jobs never trip it", () => {
  scanJobStarted("2", "ai_fix_run")
  expect(healthStatus(later(60 * MIN)).ok).toBe(true)
})

test("finished scan job no longer counts", () => {
  scanJobStarted("1", "crawl_page")
  scanJobEnded("1")
  expect(healthStatus(later(60 * MIN)).ok).toBe(true)
})
