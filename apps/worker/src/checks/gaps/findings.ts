import { Finding, GAP_LABELS } from "@qacc/shared"

/**
 * Finding builders shared by every gap check, so all of them read the same in
 * the QACC and TED reports: the title says what is wrong, the description
 * lists each item, the context names the page.
 */

export function gapFinding(key: string, title: string, items: string[], pageUrl: string, extra = "", screenshotUrl: string | null = null): Finding {
  const list = items.map((i) => `• ${i}`).join("\n")
  return {
    check_factor: key,
    title,
    description: `${list}${extra ? `\n${extra}` : ""}`,
    context_text: `Page: ${pageUrl}\nCheck: ${GAP_LABELS[key] || key}\nItems: ${items.length}`,
    screenshot_url: screenshotUrl,
    status: "open",
    ai_generated: false,
  } as Finding
}

/** "Could not complete" row — tool lapse in the shared verdict (title "Check Failed"). */
export function lapseFinding(key: string, reason: string, pageUrl: string): Finding {
  return {
    check_factor: key,
    title: "Check Failed",
    description: `Could not complete: ${reason}. Process aborted gracefully.`,
    context_text: `Page: ${pageUrl}\nSystem Error: ${reason}`,
    screenshot_url: null,
    status: "open",
    ai_generated: false,
  } as Finding
}
