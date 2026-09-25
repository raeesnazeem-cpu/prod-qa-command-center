import { FixProgress, throttleTrailing } from "../fixProgress"

describe("FixProgress", () => {
  it("keeps moving through triage, never goes back, ends at total", () => {
    // 50 findings: 10 decided in loop 1, 40 go through LLM triage (batches of 4).
    const p = new FixProgress(50)
    const seen: number[] = []
    for (let i = 0; i <= 10; i++) {
      p.setDecided(i)
      seen.push(p.processed())
    }
    const afterLoop1 = p.processed()
    for (let b = 0; b < 10; b++) {
      p.markTriaged(4)
      seen.push(p.processed())
    }
    const afterTriage = p.processed()
    for (let i = 0; i < 40; i++) {
      p.markApplied()
      seen.push(p.processed())
    }
    expect(afterLoop1).toBe(10)
    expect(afterTriage).toBe(38) // 10 + 40*0.7 — bar moved during triage
    expect(p.processed()).toBe(50)
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1])
  })

  it("clamps to total and ignores a lower setDecided", () => {
    const p = new FixProgress(3)
    p.setDecided(2)
    p.setDecided(1)
    expect(p.processed()).toBe(2)
    p.setDecided(9)
    expect(p.processed()).toBe(3)
  })
})

describe("throttleTrailing", () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it("runs at most once per window, with one trailing run", () => {
    const fn = jest.fn()
    const t = throttleTrailing(fn, 2000)
    t()
    t()
    t()
    expect(fn).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(2000)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("cancel drops the pending trailing run", () => {
    const fn = jest.fn()
    const t = throttleTrailing(fn, 2000)
    t()
    t()
    t.cancel()
    jest.advanceTimersByTime(5000)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
