jest.mock("../supabase", () => ({ supabase: {} }))
jest.mock("../queue", () => ({ qaQueue: {}, connection: {} }))
jest.mock("@qacc/ai", () => ({}), { virtual: true })
import { renderFixLine } from "../tedSync"

const base = { applied: false, proposed: false, fix: "" }

describe("renderFixLine — ✅ Fixed only for real edits", () => {
  it("applied edit → ✅ Fixed with before → after", () => {
    const html = renderFixLine({
      ...base,
      applied: true,
      edits: [{ path: "a.json", find: "sulfites", replace: "sulfates" }],
      filesChanged: ["a.json"],
    })
    expect(html).toContain("✅ <strong>Fixed:</strong> Corrected “sulfites” to “sulfates”")
  })

  it("proposed (not applied) → suggestion, never ✅", () => {
    const html = renderFixLine({
      ...base,
      proposed: true,
      edits: [{ path: "", find: "sulfites", replace: "sulfates" }],
    })
    expect(html).not.toContain("✅")
    expect(html).toContain("Not changed — suggested fix:</strong> change “sulfites” to “sulfates”")
  })

  it("AI-generated proposal is still not labelled AI Fix", () => {
    const html = renderFixLine({ ...base, proposed: true, fix: "Reword the heading" }, true)
    expect(html).not.toContain("AI Fix")
    expect(html).not.toContain("✅")
  })

  it("GitOps miss / already set → Not changed + reason", () => {
    const html = renderFixLine({
      ...base,
      manual: true,
      manualKind: "unchanged",
      manualReason: "site_icon already set",
      fix: "site_icon already set",
    })
    expect(html).not.toContain("✅")
    expect(html).toContain("🔸 <strong>Not changed:</strong> site_icon already set")
  })
})
