jest.mock("playwright", () => ({ chromium: {} }))

import { BrowserUnavailableError, isBrowserMissingError } from "../browserCheck"

describe("isBrowserMissingError", () => {
  it("matches the prod error from a worker without browsers", () => {
    const msg =
      "browserType.launch: Executable doesn't exist at /Users/apple/Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell"
    expect(isBrowserMissingError(new Error(msg))).toBe(true)
  })
  it("does not match a page timeout or a site error", () => {
    expect(isBrowserMissingError(new Error("Page timed out after 180s"))).toBe(false)
    expect(isBrowserMissingError(new Error("net::ERR_NAME_NOT_RESOLVED"))).toBe(false)
  })
})

describe("BrowserUnavailableError", () => {
  it("has a stable name the worker uses to stop itself", () => {
    expect(new BrowserUnavailableError("x").name).toBe("BrowserUnavailableError")
  })
})
