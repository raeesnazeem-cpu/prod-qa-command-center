// ... (Keep all existing imports and code above)

  // 4. Return the final report to the UI
  if (brokenLinks.length === 0) return []

  return [
    {
      check_factor: "dead_links",
      severity: brokenLinks.length > 5 ? "critical" : "medium",
      title: `${brokenLinks.length} broken link${brokenLinks.length === 1 ? "" : "s"} found`,
      // IMPORTANT: The UI's RunDetailPage.tsx expects the string "- **" to parse and count dead links!
      // Do not change the "- **" prefix, or the UI heading will say "0 dead link found".
      description: brokenLinks
        .map(
          (b) =>
            `- **${b.url}** (Status: ${b.status || "Connection Failed"} | Found on: ${b.sourceUrl})`
        )
        .join("\n"),
      status: "open",
      ai_generated: false,
      screenshot_url: null,
    },
  ]
}
