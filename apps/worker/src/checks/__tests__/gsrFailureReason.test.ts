import { describeGsrFailure } from "../gsrCheck"

const D = "nuvoaestheticsclinic.gogroth.com"

describe("describeGsrFailure — states the real cause, never the tool's name", () => {
  it("ScraperAPI credits exhausted (real 403 body)", () => {
    const r = describeGsrFailure(
      403,
      "You have exhausted the API Credits available in this monthly cycle. You can upgrade your subscription or enable overages from your dashboard.",
      D,
    )
    expect(r).toMatch(/used up its monthly request credits/)
    expect(r).toMatch(/not a problem with the website/)
  })
  it("bad key", () => expect(describeGsrFailure(401, "Invalid API key", D)).toMatch(/rejected the API key/))
  it("rate limit", () => expect(describeGsrFailure(429, "", D)).toMatch(/rate limit/))
  it("Google CAPTCHA", () =>
    expect(describeGsrFailure(200, "Our systems have detected unusual traffic from your computer network", D)).toMatch(/Google blocked/))
  it("site not indexed", () =>
    expect(describeGsrFailure(200, `Your search - site:${D} - did not match any documents.`, D)).toMatch(/no indexed results/))
  it("service 5xx", () => expect(describeGsrFailure(500, "Request failed.", D)).toMatch(/HTTP 500/))
  it("normal page → no failure reason", () => expect(describeGsrFailure(200, "Botox | Nuvo …", D)).toBe(""))
  it("never names the internal tool", () => {
    for (const [st, b] of [[403, "exhausted the api credits"], [401, ""], [429, ""], [500, ""], [200, "unusual traffic"]] as const)
      expect(describeGsrFailure(st, b, D)).not.toMatch(/qacc/i)
  })
})
