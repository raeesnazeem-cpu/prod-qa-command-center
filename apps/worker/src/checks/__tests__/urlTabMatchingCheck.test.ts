jest.mock("../../lib/aiFallback", () => ({ completeText: jest.fn() }))

import { completeText } from "../../lib/aiFallback"
import { isCleanPassFinding, isToolLapseFinding, isRealDefect } from "@qacc/shared"
import {
  checkUrlTabMatching,
  matchSlugToTitle,
  slugFromUrl,
  stripBrand,
} from "../urlTabMatchingCheck"

const ai = completeText as jest.Mock
const BASE = "https://nuvoaestheticsclinic.gogroth.com"
const BRAND = ["Nuvo Aesthetics Clinic"]

beforeEach(() => ai.mockReset())

describe("slugFromUrl", () => {
  it("takes the last meaningful segment", () => {
    expect(slugFromUrl(`${BASE}/services/lip-filler/`)).toBe("lip-filler")
    expect(slugFromUrl(`${BASE}/blog/page/2`)).toBe("blog")
    expect(slugFromUrl(`${BASE}/`)).toBe("")
  })
})

describe("stripBrand", () => {
  it("drops brand segments by name or hostname", () => {
    expect(stripBrand("Lip Fillers | Nuvo Aesthetics Clinic", BRAND, "nuvoaestheticsclinic.gogroth.com")).toBe("Lip Fillers")
    expect(stripBrand("Botox - Nuvo Aesthetics Clinic", [], "nuvoaestheticsclinic.gogroth.com")).toBe("Botox")
    expect(stripBrand("Anti-Aging Treatments", BRAND, "x.com")).toBe("Anti-Aging Treatments")
  })
})

describe("matchSlugToTitle", () => {
  it("passes on plurals / word forms", () => {
    expect(matchSlugToTitle("lip-filler", "Lip Fillers").verdict).toBe("pass")
    expect(matchSlugToTitle("injectables", "Injectable Treatments").verdict).toBe("pass")
  })
  it("defers to AI when words don't line up", () => {
    expect(matchSlugToTitle("botox", "Contact Us").verdict).toBe("ask_ai")
    expect(matchSlugToTitle("lip-filler", "Botox Treatment").verdict).toBe("ask_ai")
  })
})

describe("checkUrlTabMatching", () => {
  it("clean pass without AI when slug and title match", async () => {
    const [f] = await checkUrlTabMatching(`${BASE}/lip-filler`, "Lip Fillers | Nuvo Aesthetics Clinic", BRAND)
    expect(isCleanPassFinding(f)).toBe(true)
    expect(ai).not.toHaveBeenCalled()
  })

  it("fails a placeholder title", async () => {
    const [f] = await checkUrlTabMatching(`${BASE}/botox`, "Untitled", BRAND)
    expect(isRealDefect(f)).toBe(true)
  })

  it("fails a brand-only title", async () => {
    const [f] = await checkUrlTabMatching(`${BASE}/botox`, "Nuvo Aesthetics Clinic", BRAND)
    expect(isRealDefect(f)).toBe(true)
    expect(f.title).toMatch(/only the brand/)
  })

  it("AI mismatch → real defect", async () => {
    ai.mockResolvedValue({ text: '{"match":false,"reason":"Botox is a service, Contact Us is the contact page."}' })
    const [f] = await checkUrlTabMatching(`${BASE}/botox`, "Contact Us | Nuvo Aesthetics Clinic", BRAND)
    expect(isRealDefect(f)).toBe(true)
    expect(f.title).toMatch(/don't match/)
  })

  it("AI synonym match → clean pass", async () => {
    ai.mockResolvedValue({ text: '{"match":true,"reason":"About us and meet the team are the same page."}' })
    const [f] = await checkUrlTabMatching(`${BASE}/about-us`, "Meet Our Team | Nuvo Aesthetics Clinic", BRAND)
    expect(isCleanPassFinding(f)).toBe(true)
  })

  it("AI down → tool lapse, never a pass", async () => {
    ai.mockRejectedValue(new Error("provider 503"))
    const [f] = await checkUrlTabMatching(`${BASE}/botox`, "Contact Us", BRAND)
    expect(isToolLapseFinding(f)).toBe(true)
    expect(isCleanPassFinding(f)).toBe(false)
  })
})
