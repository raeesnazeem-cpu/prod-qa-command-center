// ... (Keep all existing imports and code above)

  // 4. Return the final report to the UI
  if (brokenLinks.length === 0) return []

  return [
    {
      check_factor: "dead_links",
      severity: brokenLinks.length > 5 ? "critical" : "medium",
      // Updated heading to be clearer
      title: `${brokenLinks.length} broken link${brokenLinks.length === 1 ? "" : "s"} found`,
      // Formatted description with a clearer list structure that reads well even without newlines
      description: `We found ${brokenLinks.length} dead link(s): ` + brokenLinks
        .map(
          (b, index) =>
            `[${index + 1}] ${b.url} (Error: ${b.status || "Failed"}, Found on: ${b.sourceUrl})`
        )
        .join("   |   "),
      status: "open",
      ai_generated: false,
      screenshot_url: null,
    },
  ]
}
