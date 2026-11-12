import { renderTestCaseSummary, type TestCaseRow } from "../resultSummary"

const rows: TestCaseRow[] = [
  { factor: "logo_chatbot", label: "Logo on Chatbot", status: "failed", reason: "No chatbot logo found" },
  { factor: "contact_form", label: "Contact Form", status: "failed", reason: "Contact form <b>not</b> found" },
  { factor: "image_text_cutoff", label: "Text Inside Images Cut Off (Mobile)", status: "errored", couldNotRunHtml: "Could not complete: AI limit exhausted" },
  { factor: "favicon", label: "Favicon", status: "passed" },
  { factor: "dead_links", label: "Dead Links & Broken Anchors", status: "passed" },
]

describe("renderTestCaseSummary", () => {
  const html = renderTestCaseSummary(rows)
  const [short, full] = html.split("<details>")

  it("opens with the verdict and the counts", () => {
    expect(short).toContain("❌ 2 of 5 checks failed")
    expect(short).toContain("❌ 2 failed")
    expect(short).toContain("✅ 2 passed")
    expect(short).toContain("⚠️ 1 could not run")
  })

  it("names the failed and could-not-run checks before the toggle, never the passed ones", () => {
    expect(short).toContain("Logo on Chatbot, Contact Form")
    expect(short).toContain("Could not run:</span></strong> Text Inside Images Cut Off (Mobile)")
    expect(short).not.toContain("Favicon")
  })

  it("puts the full tables behind Show full summary, failed rows numbered and grouped by area", () => {
    expect(full.startsWith("<summary>Show full summary (5 checks)</summary>")).toBe(true)
    // Forms & links comes before Chatbot & widgets, so Contact Form is row 1.
    expect(full).toContain('<tr><td colspan="3"><strong>Forms &amp; links</strong></td></tr><tr><td>❌ 1</td><td>Contact Form</td><td>Contact form &lt;b&gt;not&lt;/b&gt; found</td></tr>')
    expect(full).toContain('<tr><td colspan="3"><strong>Chatbot &amp; widgets</strong></td></tr><tr><td>❌ 2</td><td>Logo on Chatbot</td>')
    expect(full).toContain('<tr><td colspan="3"><strong>Images &amp; logos</strong></td></tr><tr><td>⚠️ 3</td><td>Text Inside Images Cut Off (Mobile)</td><td>Could not complete: AI limit exhausted</td></tr>')
    expect(full).toContain("<td>Forms &amp; links</td><td>Dead Links &amp; Broken Anchors</td>")
    expect(full).toContain("<td>Images &amp; logos</td><td>Favicon</td>")
    expect(full.endsWith("</details>")).toBe(true)
  })

  it("says all passed when nothing failed", () => {
    const ok = renderTestCaseSummary(rows.filter((r) => r.status === "passed"))
    expect(ok).toContain("✅ All 2 checks passed")
    expect(ok).not.toContain("Failed:")
    expect(ok).toContain("Show full summary (2 checks)")
  })

  it("returns nothing when there are no checks", () => {
    expect(renderTestCaseSummary([])).toBe("")
  })
})
