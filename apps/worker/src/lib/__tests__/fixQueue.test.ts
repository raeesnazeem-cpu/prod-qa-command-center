import { selectFixQueue } from "../fixQueue"

const pass = (factor: string, title: string, description = "") => ({ check_factor: factor, title, description })
const defect = (i: number) => ({ check_factor: "spelling", title: `Misspelled: word${i}`, description: "Suggestion: x" })
const lapse = { check_factor: "grammar", title: "Grammar Check Failed", description: "Process aborted gracefully." }

describe("selectFixQueue", () => {
  it("skips pass results so they never trigger fixes", () => {
    const q = selectFixQueue(
      [
        pass("footer_logo", "Footer Logo Verified", "No footer logo issues found. The approved logo loads."),
        pass("privacy_policy", "Privacy Policy Verified", "No privacy policy issues found."),
        pass("plugin_number", "Detected 14 plugins"),
        defect(1),
      ],
      20,
    )
    expect(q.map((f) => f.title)).toEqual(["Misspelled: word1"])
  })

  it("passes don't use up the budget", () => {
    const passes = Array.from({ length: 50 }, () => pass("functionality_check", "Functionality: no interaction errors or breaks"))
    const defects = Array.from({ length: 30 }, (_, i) => defect(i))
    const q = selectFixQueue([...passes, ...defects], 20)
    expect(q).toHaveLength(20)
    expect(q.every((f) => f.check_factor === "spelling")).toBe(true)
  })

  it("keeps lapses (recorded for the Dry-run tab) and stops at max", () => {
    const q = selectFixQueue([lapse, defect(1), defect(2), defect(3)], 2)
    expect(q).toEqual([lapse, defect(1)])
  })

  it("handles empty / null input", () => {
    expect(selectFixQueue(null, 20)).toEqual([])
    expect(selectFixQueue([defect(1)], 0)).toEqual([])
  })
})
