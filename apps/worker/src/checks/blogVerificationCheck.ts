import { Finding } from "@qacc/shared"

/**
 * Blog Verification check (placeholder).
 * --------------------------------------
 * The real check compares the beta site's blogs against the LIVE site's blogs
 * (all live blogs present on beta, sidebar widget on each, matching URLs). That
 * comparison needs the client's LIVE site URL, which QACC does not yet resolve
 * for this flow. Until that's wired, this check is a deliberate, honest
 * placeholder: it always reports FAILED with the reason, so the Blog
 * Verification subtask reflects "not yet verifiable" rather than silently
 * passing. Hardcoded on purpose — replace with the live↔beta diff when the live
 * URL is available.
 *
 * check_factor: "blog_verification"
 */
const CHECK_FACTOR = "blog_verification"

export async function checkBlogVerification(
  pageUrl: string,
  runId: string,
): Promise<Finding[]> {
  return [
    {
      check_factor: CHECK_FACTOR,
      title: "Blog verification — no live site URL to compare against",
      description:
        "Blog verification compares the beta site's blogs against the client's LIVE site (all live blogs present on beta, sidebar widget on each, matching URLs). No live site URL is available to compare against yet, so this cannot be verified automatically. Marked FAILED pending the live↔beta blog comparison.",
      context_text: `Page: ${pageUrl}\nStatus: placeholder — live-site comparison not yet implemented`,
      screenshot_url: null,
      status: "open",
      ai_generated: false,
    } as Finding,
  ]
}
