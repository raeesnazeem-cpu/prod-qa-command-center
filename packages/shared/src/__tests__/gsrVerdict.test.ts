import { gsrVerdict } from "../gsrVerdict"
import { isCleanPassFinding, isRealDefect, isToolLapseFinding, resultForCheck } from "../findingVerdict"

const row = (title: string, description: string) => ({ check_factor: "gsr_check", title, description })
const serps = (...items: { title: string; description: string }[]) =>
  JSON.stringify(items.map((s, i) => ({ ...s, url: `https://x.com/${i}` })))

describe("gsrVerdict — one verdict for report, run_check_results and issuesFound", () => {
  it("clean results → pass everywhere", () => {
    const f = row("2 Google search results checked — no issues found", serps(
      { title: "Botox | Nuvo", description: "Book today" },
      { title: "About – Nuvo", description: "Meet the team" },
    ))
    expect(gsrVerdict(f)).toBe("pass")
    expect(isCleanPassFinding(f)).toBe(true)
    expect(isRealDefect(f)).toBe(false)
    expect(resultForCheck("gsr_check", [f], true)).toBe("pass")
  })

  it("invalid characters → fail everywhere, whatever the title says", () => {
    const f = row("50 SERPs found — no issues detected", serps({ title: "Botox &amp; Fillers", description: "ok" }))
    expect(gsrVerdict(f)).toBe("fail")
    expect(isCleanPassFinding(f)).toBe(false)
    expect(isRealDefect(f)).toBe(true)
    expect(resultForCheck("gsr_check", [f], true)).toBe("fail")
  })

  it("legacy '50 SERPs Found' title with clean data → pass (was a false fail)", () => {
    expect(isRealDefect(row("50 SERPs Found", serps({ title: "Home", description: "Welcome" })))).toBe(false)
  })

  it("snippet text can't flip the verdict", () => {
    const f = row("1 Google search results checked — no issues found", serps({ title: "Setup", description: "Widget not configured yet" }))
    expect(isToolLapseFinding(f)).toBe(false)
    expect(gsrVerdict(f)).toBe("pass")
  })

  it("no readable results (blocked / out of credits / legacy Failed row) → could not run, never a defect", () => {
    for (const f of [
      row("GSR Check Skipped — could not run", "The Google search service (ScraperAPI) has used up its monthly request credits…"),
      row("Google Search Results (Failed)", "Failed to fetch Google Search results."),
    ]) {
      expect(isToolLapseFinding(f)).toBe(true)
      expect(isRealDefect(f)).toBe(false)
      expect(resultForCheck("gsr_check", [f], true)).toBe("lapsed")
    }
  })
})
