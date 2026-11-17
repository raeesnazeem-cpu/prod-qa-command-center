import { chromium } from "playwright"

// A worker without a working Playwright browser must never take scan jobs.
//
// Prod 2026-11-06..16: a worker on a developer Mac ("/Users/apple/...") was
// connected to the prod queue without Playwright's browsers installed. Every
// page it picked up failed at once with "browserType.launch: Executable doesn't
// exist", and those pages were recorded as failed — 71 of 200 pages in one run.
//
// Two guards:
//   • browserSelfCheck() at start-up: no browser → the worker never starts.
//   • BrowserUnavailableError at page time: the page is NOT marked failed or
//     counted; the job is handed back to the queue and this worker stops.

export class BrowserUnavailableError extends Error {
  constructor(cause: string) {
    super(`No working browser on this worker: ${cause}`)
    this.name = "BrowserUnavailableError"
  }
}

/** True for a launch error that means "this machine has no usable browser". */
export function isBrowserMissingError(err: unknown): boolean {
  const msg = String((err as any)?.message || err || "")
  return (
    /Executable doesn't exist/i.test(msg) ||
    /browserType\.launch/i.test(msg) ||
    /Looks like Playwright .* was just installed or updated/i.test(msg) ||
    /please run the following command to download new browsers/i.test(msg)
  )
}

/** Launch and close a headless browser. Returns null when it works, else the reason. */
export async function browserSelfCheck(timeoutMs = 60_000): Promise<string | null> {
  let browser: any = null
  try {
    browser = await chromium.launch({
      headless: true,
      timeout: timeoutMs,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    })
    return null
  } catch (e: any) {
    return String(e?.message || e).split("\n")[0]
  } finally {
    await browser?.close().catch(() => {})
  }
}
