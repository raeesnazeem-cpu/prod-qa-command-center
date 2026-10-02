// NON-GROWTH99 FULL SCAN. When the TED client has no GitHub repo (or the scan has
// no TED client at all), the site is not a Growth99 build. These checks only make
// sense on a Growth99 site (G99 widgets, plugins, TED/Basecamp data), so they are
// left out of the run entirely — they are not run and do not appear in the QACC
// or TED report.
export const GROWTH99_ONLY_CHECKS = new Set([
  "plugin_number",
  "paid_media",
  "review_reputation_check",
  "url_matching",
  "callnow_links",
  "logo_chatbot",
  "footer_logo",
  "blog_verification",
  "image_relevance",
  "learn_more_buttons",
  "single_script",
  "blog_sidebar",
  "chatbot_consultation",
  "project_plan",
  "privacy_policy",
])

// The full-scan suite for a non-Growth99 site: drop GROWTH99_ONLY_CHECKS, and
// swap accessibility_check (the Growth99 UserWay widget check) for
// accessibility_features (real accessibility rules: alt text, labels, lang, ...).
export function nonGrowth99Checks(checks: string[]): string[] {
  return checks
    .filter((c) => !GROWTH99_ONLY_CHECKS.has(c))
    .map((c) => (c === "accessibility_check" ? "accessibility_features" : c))
}
