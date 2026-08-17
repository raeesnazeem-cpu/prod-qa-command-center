// Some legacy project records have a mangled site_url where a whole HTML
// anchor tag got pasted into the field, e.g.
//   example.com/">https://example.com/</a><br>GitHub
// Take only the first token before any quote, angle bracket or whitespace so
// the href is safe and the displayed text is clean.
export function cleanSiteUrl(raw: string | null | undefined): string {
  if (!raw) return ""
  // stop at the first char that cannot be part of a bare URL
  const cut = raw.trim().split(/["'<>\s]/)[0]
  if (!cut) return ""
  return /^https?:\/\//i.test(cut) ? cut : `https://${cut}`
}

// Clean + strip protocol / www / trailing slash for display.
export function displaySiteUrl(raw: string | null | undefined): string {
  return cleanSiteUrl(raw)
    .replace(/^https?:\/\/(www\.)?/i, "")
    .replace(/\/$/, "")
}
