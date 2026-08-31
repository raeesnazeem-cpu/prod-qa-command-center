/**
 * UserWay accessibility widget — shared constants + plan/tier logic used by both
 * the accessibility scan and its GitOps fix.
 *
 * G99 installs ONE of two shared UserWay accounts per client, chosen by the
 * client's HubSpot "Accessibility Plan Add-On" (`accessibility_plan_add_on`):
 *   • Complete  → PRO widget   (data-account 062WMb6Yf6)
 *   • Basic     → FREE widget  (data-account y0juzG0O0x)
 * The widget is one <script> loaded site-wide (Elementor custom code, body end,
 * all pages). The scan reads which account is on the page; the fix writes the
 * account the HubSpot plan calls for.
 */

import { getClientDomain } from "./tedClient"
import { resolveHubspotClientData } from "./hubspotClient"

export type UserwayTier = "pro" | "free"

export const USERWAY_ACCOUNTS: Record<UserwayTier, string> = {
  pro: "062WMb6Yf6",
  free: "y0juzG0O0x",
}

/** The widget loader; presence of this src marks UserWay installed. */
export const USERWAY_SCRIPT_SRC = "https://cdn.userway.org/widget.js"
export const USERWAY_SCRIPT_MARK = "cdn.userway.org/widget.js"

/** Human label for a tier ("Pro" / "Basic"). */
export function tierLabel(tier: UserwayTier): string {
  return tier === "pro" ? "Pro" : "Basic"
}

/** The exact site-wide <script> to install for a tier. */
export function userwaySnippet(tier: UserwayTier): string {
  return `<script src="${USERWAY_SCRIPT_SRC}" data-account="${USERWAY_ACCOUNTS[tier]}"></script>`
}

/** Map a data-account id back to a known G99 tier (null if it's some other account). */
export function tierForAccount(account: string | null | undefined): UserwayTier | null {
  const a = (account || "").trim()
  if (a === USERWAY_ACCOUNTS.pro) return "pro"
  if (a === USERWAY_ACCOUNTS.free) return "free"
  return null
}

/** Map the HubSpot accessibility_plan_add_on value to the tier it requires. */
export function tierForPlan(plan: string | null | undefined): UserwayTier | null {
  const p = (plan || "").trim().toLowerCase()
  if (p === "complete") return "pro"
  if (p === "basic") return "free"
  return null
}

export interface InstalledUserway {
  present: boolean
  account: string | null
  tier: UserwayTier | null // null when present but on an unrecognised account
}

/** Read the installed UserWay account/tier from rendered page HTML. */
export function detectUserwayInSource(html: string): InstalledUserway {
  if (!html || !html.includes(USERWAY_SCRIPT_MARK)) {
    return { present: false, account: null, tier: null }
  }
  // Find the data-account on (or near) the widget.js script tag.
  const tag = html.match(
    /<script\b[^>]*cdn\.userway\.org\/widget\.js[^>]*>|<script\b[^>]*data-account=[^>]*cdn\.userway\.org[^>]*>/i,
  )
  const scope = tag ? tag[0] : html
  const account = (scope.match(/data-account=["']?([A-Za-z0-9]+)/i) || [null, ""])[1] || null
  return { present: true, account, tier: tierForAccount(account) }
}

/**
 * The UserWay tier the client's HubSpot plan requires, or null when HubSpot has
 * no accessibility_plan_add_on for them (can't decide a tier).
 */
export async function resolveRequiredUserwayTier(
  clientName: string | null | undefined,
): Promise<{ tier: UserwayTier | null; planRaw: string | null }> {
  if (!clientName) return { tier: null, planRaw: null }
  const domain = await getClientDomain(clientName).catch(() => null)
  const hs = await resolveHubspotClientData(domain, clientName).catch(() => null)
  const planRaw = hs?.accessibilityPlan || null
  return { tier: tierForPlan(planRaw), planRaw }
}
