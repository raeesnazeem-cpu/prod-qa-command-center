import { resultForCheck, rollupChecks } from "../findingVerdict"

const f = (check_factor: string, title: string, description = "") => ({
  check_factor,
  title,
  description,
})

describe("resultForCheck", () => {
  it("is notRun while the scan is still going and the check has produced nothing", () => {
    expect(resultForCheck("spelling", [], false)).toBe("notRun")
  })

  it("is a pass once the run has ended with nothing found", () => {
    expect(resultForCheck("spelling", [], true)).toBe("pass")
  })

  it("never calls an empty vision check a pass — it verified nothing", () => {
    expect(resultForCheck("footer_logo", [], true)).toBe("lapsed")
  })

  it("fails when a real defect is present, even alongside a lapse", () => {
    const findings = [
      f("spelling", "Misspelling: 'recieve'"),
      f("spelling", "Check failed", "encountered a timeout"),
    ]
    expect(resultForCheck("spelling", findings, true)).toBe("fail")
  })

  it("is lapsed when every finding is a lapse — a check that could not run is not a pass", () => {
    const findings = [f("gbp_check", "GBP check failed", "encountered an error")]
    expect(resultForCheck("gbp_check", findings, true)).toBe("lapsed")
  })
})

describe("rollupChecks", () => {
  it("counts every enabled check, including ones that have produced nothing yet", () => {
    const { summary, list } = rollupChecks(
      ["spelling", "favicon", "grammar"],
      [f("spelling", "Misspelling: 'recieve'")],
      false,
    )
    expect(summary).toEqual({ total: 3, passed: 0, failed: 1, lapsed: 0, notRun: 2 })
    expect(list).toHaveLength(3)
  })

  it("counts only real defects as issues, not sentinels or lapses", () => {
    const { list } = rollupChecks(
      ["spelling"],
      [
        f("spelling", "Misspelling: 'recieve'"),
        f("spelling", "Misspelling: 'seperate'"),
        f("spelling", "Check skipped"),
      ],
      true,
    )
    expect(list[0]).toEqual({ check: "spelling", result: "fail", issues: 2 })
  })

  it("keeps findings whose check is not in enabled_checks rather than dropping results", () => {
    const { summary, list } = rollupChecks(
      ["spelling"],
      [f("hamburger_menu", "Menu does not open on tablet")],
      true,
    )
    expect(summary.total).toBe(2)
    expect(list.map((c) => c.check).sort()).toEqual(["hamburger_menu", "spelling"])
  })

  it("holds the total steady as a scan progresses, so the board does not grow under the reader", () => {
    const enabled = ["spelling", "favicon", "grammar"]
    const early = rollupChecks(enabled, [], false)
    const later = rollupChecks(enabled, [f("spelling", "Misspelling: 'recieve'")], false)
    expect(early.summary.total).toBe(later.summary.total)
  })
})
