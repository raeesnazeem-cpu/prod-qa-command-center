import { GROWTH99_ONLY_CHECKS, nonGrowth99Checks } from "../fullScanChecks"

describe("nonGrowth99Checks", () => {
  const suite = ["project_plan", "spelling", "accessibility_check", "privacy_policy", "page_speed", "plugin_number"]

  it("drops every Growth99-only check", () => {
    const out = nonGrowth99Checks(suite)
    for (const c of out) expect(GROWTH99_ONLY_CHECKS.has(c)).toBe(false)
    expect(out).toEqual(["spelling", "accessibility_features", "page_speed"])
  })

  it("swaps the UserWay accessibility check for the generic one", () => {
    const out = nonGrowth99Checks(suite)
    expect(out).not.toContain("accessibility_check")
    expect(out).toContain("accessibility_features")
  })

  it("covers all 15 skipped checks", () => {
    expect(GROWTH99_ONLY_CHECKS.size).toBe(15)
  })
})
