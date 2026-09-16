import {
  isCleanPassFinding,
  isInformationalFinding,
  isRealDefect,
  isToolLapseFinding,
} from "../findingVerdict"

/**
 * These four decide, for every check on every run, whether QACC tells the client
 * their site has a problem. They are regex over free text a check happened to
 * write, and three callers depend on them agreeing — the TED report renderer,
 * the per-check results the worker persists, and the video-recording barrier.
 * A wrong verdict here either reports a defect that isn't there or hides one
 * that is, so the phrasings that must keep working are pinned.
 */

const f = (title: string, description = "", check_factor = "spelling") => ({
  check_factor,
  title,
  description,
})

describe("isToolLapseFinding", () => {
  it.each([
    ["an errored check", f("Spelling check failed")],
    ["a timeout", f("Grammar check error", "the check encountered a timeout")],
    ["a skipped check", f("Backend check skipped")],
    ["a missing credential", f("Backend", "no password was provided for the WP admin")],
    ["an unconfigured API key", f("GBP", "GOOGLE_PLACES_API_KEY is not configured")],
    ["an upstream HTTP failure", f("Page speed", "request failed with status code 500")],
  ])("reads %s as a QACC-side lapse", (_label, finding) => {
    expect(isToolLapseFinding(finding)).toBe(true)
    // A lapse establishes nothing about the site, so it must never be a defect.
    expect(isRealDefect(finding)).toBe(false)
  })

  it("does not claim a genuine site failure as its own lapse", () => {
    // "failed to load" is about the page, not about QACC.
    const finding = f("Hero video failed to load on mobile")
    expect(isToolLapseFinding(finding)).toBe(false)
    expect(isRealDefect(finding)).toBe(true)
  })
})

describe("isCleanPassFinding", () => {
  it.each([
    ["no issues found", f("No accessibility issues found")],
    ["none detected", f("Dead links", "None found across 42 links")],
    ["a verb-trailing phrasing", f("Console", "No console errors were triggered")],
    ["a title stating absence", f("Functionality: no interaction errors or breaks")],
  ])("reads %s as a clean pass", (_label, finding) => {
    expect(isCleanPassFinding(finding)).toBe(true)
    expect(isRealDefect(finding)).toBe(false)
  })

  it("does not swallow a real defect that merely mentions a count", () => {
    const finding = f("3 spelling issues found on the homepage")
    expect(isCleanPassFinding(finding)).toBe(false)
    expect(isRealDefect(finding)).toBe(true)
  })
})

describe("isInformationalFinding", () => {
  it("treats an always-reported row as informational, not a defect", () => {
    const finding = f("Detected 24 plugins", "", "plugin_number")
    expect(isInformationalFinding(finding)).toBe(true)
    expect(isRealDefect(finding)).toBe(false)
  })

  it("is scoped to the checks that always report — the same words elsewhere are a defect", () => {
    const finding = f("Detected 24 plugins", "", "backend_check")
    expect(isInformationalFinding(finding)).toBe(false)
    expect(isRealDefect(finding)).toBe(true)
  })

  it("does not call a failed informational check informational", () => {
    const finding = f("Plugin count check failed", "encountered an error", "plugin_number")
    expect(isInformationalFinding(finding)).toBe(false)
    expect(isToolLapseFinding(finding)).toBe(true)
  })
})

describe("isRealDefect", () => {
  it("is what the fix pass and the report both act on", () => {
    expect(isRealDefect(f("Misspelling: 'recieve' in the hero heading"))).toBe(true)
  })

  it("is false for every non-defect kind", () => {
    expect(isRealDefect(f("No grammar issues found"))).toBe(false)
    expect(isRealDefect(f("Check skipped"))).toBe(false)
    expect(isRealDefect(f("Detected 24 plugins", "", "plugin_number"))).toBe(false)
  })

  it("survives findings with no description at all", () => {
    expect(isRealDefect({ check_factor: "favicon", title: "Favicon missing" })).toBe(true)
    expect(isRealDefect({})).toBe(true)
  })
})
