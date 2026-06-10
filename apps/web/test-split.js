const findings = [
  {
    check_factor: "dead_links",
    description: "- **http://example.com/broken** (Status: 404 | Found on: http://example.com)\n- **http://example.com/other** (Status: 500 | Found on: http://example.com)"
  }
];

const deadLinks = findings.filter((f) => f.check_factor === "dead_links")
const violations = []
let totalDeadLinksCount = 0

deadLinks.forEach((f) => {
  const parts = f.description?.split("- **") || []
  parts.forEach((part, index) => {
    if (index === 0) return 
    const cleanPart = part.trim()
    if (cleanPart) {
      violations.push(`- **${cleanPart}`)
      totalDeadLinksCount++
    }
  })
})

if (violations.length === 0) {
  deadLinks.forEach((f) => {
    if (f.description) {
      violations.push(f.description)
    }
  })
}

console.log("totalDeadLinksCount:", totalDeadLinksCount);
console.log("violations:", violations);
