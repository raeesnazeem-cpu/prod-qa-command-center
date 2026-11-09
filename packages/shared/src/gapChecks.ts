/**
 * QA-gap checks — the issue types the QA team keeps raising (see the
 * "QA Issues Audit", 40 sites / 96 issue types) that no older QACC check
 * covered. One registry, shared by:
 *   • apps/api   — which TED subtask each check reports into (section homes)
 *                  and the default / full-scan check lists
 *   • apps/worker — the report label, the "not fixed" note, and where the check
 *                  runs (every page, mobile/tablet pass, homepage, run end)
 *   • apps/web   — the label in the run screens
 *
 * Scopes:
 *   page        one DOM read of the crawled page (desktop), every page
 *   responsive  own browser context, every page, at tablet + mobile widths
 *   homepage    homepage only
 *   run         once at the end of the run, across every page's collected data
 *   vision      own browser context, every page, judged by AI vision (needs a vision key)
 *
 * Section homes name a TED subtask section by its FIRST title matcher in the
 * matching *_SECTIONS table in apps/api/src/routes/webhooks.ts. A check with
 * no specific home goes to the functionality-testing section.
 */

export type GapScope = "page" | "responsive" | "homepage" | "run" | "vision"

export interface GapCheckDef {
  key: string
  label: string
  /** Shown on a failed TED subtask that was not auto-fixed. */
  notFixed: string
  scope: GapScope
  /** First matcher of the owning PRE_RELEASE_SECTIONS entry(ies). */
  pre: string[]
  /** First matcher of the owning INTERNAL_QA_SECTIONS entry(ies). */
  internal: string[]
  /** First matcher of the owning POST_RELEASE_SECTIONS entry(ies); [] = not a post-release check. */
  post: string[]
}

const FN_PRE = "functionalitytesting"
const FN_INT = "functionaluitesting"
const FN_POST = "testthelive"

export const GAP_CHECKS: GapCheckDef[] = [
  // ---------------- every page, desktop DOM ----------------
  {
    key: "link_targets",
    label: "Links Open in the Right Tab",
    notFixed: "Mention to open internal links, phone and email links in the same tab, and third-party booking links in a new tab",
    scope: "page",
    pre: [FN_PRE],
    internal: [FN_INT],
    post: [FN_POST],
  },
  {
    key: "clickable_contact",
    label: "Phone, Email, Address & Logo Clickable",
    notFixed: "Mention to link every phone number (tel:), email (mailto:), address (Google Maps) and the header logo (home page)",
    scope: "page",
    pre: ["contactdetails"],
    internal: [FN_INT],
    post: [FN_POST],
  },
  {
    key: "empty_clickable",
    label: "Empty Clickable Areas",
    notFixed: "Mention to remove empty links and limit link areas to the actual logo, text or button",
    scope: "page",
    pre: [FN_PRE],
    internal: [FN_INT],
    post: [FN_POST],
  },
  {
    key: "trademark_symbols",
    label: "Trademark (™ / ®) Symbols",
    notFixed: "Mention to add the ™ / ® symbol after each listed brand name and show it as superscript",
    scope: "page",
    pre: [FN_PRE],
    internal: [FN_INT],
    post: [],
  },
  {
    key: "duplicate_content",
    label: "Duplicate Content, Titles & Headers",
    notFixed: "Mention to remove the repeated text, map, title or header from the listed pages",
    scope: "page",
    pre: [FN_PRE],
    internal: [FN_INT],
    post: [],
  },
  {
    key: "text_styling",
    label: "Font, Colour, Contrast & List Styles",
    notFixed: "Mention to use the theme font and text colour on the listed paragraphs, fix unreadable text, and use one bullet style",
    scope: "page",
    pre: [FN_PRE],
    internal: [FN_INT],
    post: [],
  },
  {
    key: "form_quality",
    label: "Form Consent, Fields & Scroll Bars",
    notFixed: "Mention to add the standard consent checkbox to every form, keep consent links on this site, and fix the listed form field problems",
    scope: "page",
    pre: ["contactform"],
    internal: [FN_INT],
    post: ["chatbot"],
  },
  {
    key: "page_errors",
    label: "Page Errors & Visible Code",
    notFixed: "Mention to fix the database/PHP errors and remove the raw code or shortcodes showing on the listed pages",
    scope: "page",
    pre: [FN_PRE],
    internal: [FN_INT],
    post: [FN_POST],
  },
  {
    key: "active_menu",
    label: "Active Page Highlighted in Menu",
    notFixed: "Mention to style the current page's menu item so it stands out",
    scope: "page",
    pre: [FN_PRE],
    internal: [FN_INT],
    post: [],
  },
  {
    key: "blog_content",
    label: "Blog Internal Links, TOC & Formatting",
    notFixed: "Mention to add at least 3 same-tab internal links per blog, fix the table of contents, remove duplicate titles and add Previous/Next post links",
    scope: "page",
    pre: ["blogverification"],
    internal: ["blogverification"],
    post: [],
  },
  {
    key: "outdated_content",
    label: "Outdated Offers & Dates",
    notFixed: "Mention to remove or update the expired specials and offers",
    scope: "page",
    pre: [FN_PRE],
    internal: [FN_INT],
    post: [FN_POST],
  },
  {
    key: "social_links",
    label: "Social Media Links",
    notFixed: "Mention to point every social icon at the client's own profile page",
    scope: "page",
    pre: ["contactdetails"],
    internal: [FN_INT],
    post: [FN_POST],
  },
  {
    key: "image_display",
    label: "Stretched, Broken & Missing Images",
    notFixed: "Mention to fix the stretched images (object-fit: cover / fixed ratio), re-upload the broken ones and fill the empty image spots",
    scope: "page",
    pre: ["watermark"],
    internal: [FN_INT],
    post: [FN_POST],
  },
  // ---------------- every page, tablet + mobile ----------------
  {
    key: "spacing_alignment",
    label: "Spacing & Alignment (Tablet / Mobile)",
    notFixed: "Mention to add side padding where text touches the screen edge and line up the listed buttons",
    scope: "responsive",
    pre: [FN_PRE],
    internal: [FN_INT],
    post: [],
  },
  {
    key: "text_wrapping",
    label: "Text Wrapping (Tablet / Mobile)",
    notFixed: "Mention to adjust font size or width so headings don't leave one word on the last line and buttons stay on one line",
    scope: "responsive",
    pre: [FN_PRE],
    internal: [FN_INT],
    post: [],
  },
  {
    key: "font_sizes",
    label: "Font Size per Device",
    notFixed: "Mention to set responsive font sizes in the theme for the listed headings and text",
    scope: "responsive",
    pre: [FN_PRE],
    internal: [FN_INT],
    post: [],
  },
  {
    key: "equal_sizes",
    label: "Equal Card & Image Sizes",
    notFixed: "Mention to use equal-height cards and fixed image ratios in the listed rows",
    scope: "responsive",
    pre: [FN_PRE],
    internal: [FN_INT],
    post: [],
  },
  {
    key: "inner_scrollbars",
    label: "Scroll Bars Inside Sections & Forms",
    notFixed: "Mention to increase the height of the listed forms/sections so no inner scroll bar shows",
    scope: "responsive",
    pre: ["contactform"],
    internal: [FN_INT],
    post: [],
  },
  {
    key: "narrow_content",
    label: "Content Width on Mobile",
    notFixed: "Mention to reduce side padding on mobile so text uses most of the screen width",
    scope: "responsive",
    pre: [FN_PRE],
    internal: [FN_INT],
    post: [],
  },
  {
    key: "sticky_header_mobile",
    label: "Sticky / Transparent Header per Device",
    notFixed: "Mention to make the header sticky and transparent the same way on desktop, tablet and mobile, and stop content sliding over it",
    scope: "responsive",
    pre: ["topbar"],
    internal: ["headerbreakpoints"],
    post: [],
  },
  {
    key: "widget_overlap",
    label: "Floating Widgets Overlapping",
    notFixed: "Mention to move the chatbot / ADA / call / single-script buttons so they don't cover each other, the logo or the Growth99 footer logo",
    scope: "responsive",
    pre: [FN_PRE],
    internal: [FN_INT],
    post: [FN_POST],
  },
  {
    key: "tablet_layout",
    label: "Tablet Layout Matches Desktop",
    notFixed: "Mention to keep the listed side-by-side sections side by side on tablet (1024px), as on desktop",
    scope: "responsive",
    pre: [FN_PRE],
    internal: ["browserdeviceview"],
    post: [],
  },
  // ---------------- homepage only ----------------
  {
    key: "footer_copyright",
    label: "Footer Copyright Bar",
    notFixed: "Mention to use the standard footer bar: © year, business name, 'All rights reserved', shown once",
    scope: "homepage",
    pre: ["footerlogo"],
    internal: [FN_INT],
    post: [],
  },
  {
    key: "header_breakpoints",
    label: "Header at Laptop & Tablet Widths",
    notFixed: "Mention to set the hamburger switch point where the menu stops fitting, so the header never wraps or overlaps between 1024px and 1470px",
    scope: "homepage",
    pre: ["smallerresolution", "breakingpoint"],
    internal: ["headerbreakpoints"],
    post: [],
  },
  {
    key: "safari_check",
    label: "Safari (WebKit) Check",
    notFixed: "Mention to fix the Safari-only problems listed (favicon, hero video, layout, script errors)",
    scope: "homepage",
    pre: [FN_PRE],
    internal: ["browserdeviceview"],
    post: [FN_POST],
  },
  {
    key: "page_404",
    label: "404 Page Search & Home Button",
    notFixed: "Mention to use the standard 404 template with a search bar and a Home button, returning a real 404 status",
    scope: "homepage",
    pre: ["backend"],
    internal: [FN_INT],
    post: [],
  },
  {
    key: "menu_parity",
    label: "Hamburger vs Desktop Menu & Footer Tabs",
    notFixed: "Mention to build the hamburger and footer menus from the same menu as the desktop header (same items, names, order and links)",
    scope: "homepage",
    pre: ["hamburger"],
    internal: [FN_INT],
    post: [],
  },
  {
    key: "cta_wording",
    label: "Booking Button Wording",
    notFixed: "Mention to use the same booking button wording in the header, hamburger menu and single script",
    scope: "homepage",
    pre: ["singlescript"],
    internal: [FN_INT],
    post: [],
  },
  {
    key: "widget_style",
    label: "Widget Colours Match Theme",
    notFixed: "Mention to use the site's brand colours for the listed floating widgets",
    scope: "homepage",
    pre: [FN_PRE],
    internal: [FN_INT],
    post: [],
  },
  {
    key: "cart_mobile",
    label: "Shop Cart on Mobile",
    notFixed: "Mention to show the cart icon once in the mobile header / hamburger menu",
    scope: "homepage",
    pre: [FN_PRE],
    internal: [FN_INT],
    post: [],
  },
  {
    // Test phase only: guest cart, never checks out, never on post-release.
    key: "cart_add_to_cart",
    label: "Add to Cart on Mobile",
    notFixed: "Mention to fix Add to Cart on mobile so 'View cart' appears, the header cart count goes up and the cart page lists the product",
    scope: "homepage",
    pre: [FN_PRE],
    internal: [FN_INT],
    post: [],
  },
  // ---------------- every page, AI vision ----------------
  {
    key: "hero_readability",
    label: "Hero Text Readable",
    notFixed: "Mention to add an overlay or change the text colour so the hero text is readable on its image / video (desktop and mobile)",
    scope: "vision",
    pre: ["herosection"],
    internal: ["herosection"],
    post: [FN_POST],
  },
  {
    key: "hero_video_quality",
    label: "Hero Video Quality",
    notFixed: "Mention to upload a sharper, compressed hero video that plays smoothly without stopping",
    scope: "vision",
    pre: ["herosection"],
    internal: ["herosection"],
    post: [FN_POST],
  },
  {
    key: "image_text_cutoff",
    label: "Text Inside Images Cut Off (Mobile)",
    notFixed: "Mention to set the focus point or use a mobile version of the listed images so their text is not cut off on phones",
    scope: "vision",
    pre: ["watermark"],
    internal: [FN_INT],
    post: [FN_POST],
  },
  {
    key: "logo_visibility",
    label: "Header Logo Clearly Visible",
    notFixed: "Mention to use the right logo version (colour / white) and size so the header logo is clear on its background",
    scope: "vision",
    pre: [FN_PRE],
    internal: [FN_INT],
    post: [FN_POST],
  },
  // ---------------- whole site, at run end ----------------
  {
    key: "booking_links",
    label: "Booking Links Consistent",
    notFixed: "Mention to confirm one booking link with the PM and use it on every Book Now button (header, hamburger, pages)",
    scope: "run",
    pre: [FN_PRE],
    internal: [FN_INT],
    post: [FN_POST],
  },
  {
    key: "business_info",
    label: "Phone & Email Consistent",
    notFixed: "Mention to use one confirmed phone number and email on every page, footer, CTA and policy page",
    scope: "run",
    pre: ["contactdetails"],
    internal: [FN_INT],
    post: [FN_POST],
  },
  {
    key: "map_links",
    label: "Map Links Match the Address",
    notFixed: "Mention to copy each location's map link from its Google Business Profile",
    scope: "run",
    pre: ["mapaddress"],
    internal: ["mapaddress"],
    post: [],
  },
  {
    key: "service_names",
    label: "Service Names Match (Menu, Page, URL)",
    notFixed: "Mention to use one master service name in the dropdown, page heading and URL",
    scope: "run",
    pre: ["tabname"],
    internal: ["urlmetadatasharing"],
    post: [],
  },
  {
    key: "service_order",
    label: "Service Order Matches the Dropdown",
    notFixed: "Mention to order the services landing page exactly like the dropdown and list every dropdown service on it",
    scope: "run",
    pre: [FN_PRE],
    internal: [FN_INT],
    post: [],
  },
  {
    key: "menu_coverage",
    label: "Pages Missing From the Menu",
    notFixed: "Mention to add the listed pages to the header / dropdown menu, or remove them if not needed",
    scope: "run",
    pre: [FN_PRE],
    internal: [FN_INT],
    post: [],
  },
  {
    key: "image_reuse",
    label: "Same Image Reused",
    notFixed: "Mention to give each service, blog and gallery item its own image",
    scope: "run",
    pre: ["watermark"],
    internal: [FN_INT],
    post: [],
  },
  {
    key: "service_image_match",
    label: "Service Image Matches Its Page",
    notFixed: "Mention to use the same image for a service on the home page, services page and the service's own page",
    scope: "run",
    pre: ["watermark"],
    internal: [FN_INT],
    post: [],
  },
  {
    key: "logo_consistency",
    label: "Same Logo on Every Page",
    notFixed: "Mention to use the same header logo on every page",
    scope: "run",
    pre: [FN_PRE],
    internal: [FN_INT],
    post: [],
  },
  {
    key: "case_consistency",
    label: "Heading Case Consistent",
    notFixed: "Mention to set one heading case (caps or normal) in the theme styles for every service page",
    scope: "run",
    pre: [FN_PRE],
    internal: [FN_INT],
    post: [],
  },
  {
    key: "mobile_order",
    label: "Image / Text Order on Mobile",
    notFixed: "Mention to stack two-column sections the same way on mobile (image first, then text)",
    scope: "run",
    pre: [FN_PRE],
    internal: [FN_INT],
    post: [],
  },
  {
    key: "location_content",
    label: "Location Pages Mention the Right City",
    notFixed: "Mention to correct the city named on the listed location pages",
    scope: "run",
    pre: [FN_PRE],
    internal: [FN_INT],
    post: [],
  },
  {
    key: "url_problems",
    label: "URL Problems (test / gogroth / copy / city)",
    notFixed: "Mention to fix the listed page URLs against the approved sitemap and redirect the old ones",
    scope: "run",
    pre: ["tabname"],
    internal: ["urlmetadatasharing"],
    post: [],
  },
  {
    key: "legal_pages",
    label: "Terms & Conditions Details",
    notFixed: "Mention to fill the Terms & Conditions page with this business's name, email and address from the info sheet",
    scope: "run",
    pre: ["privacypolicy"],
    internal: [FN_INT],
    post: [],
  },
  {
    key: "html_sitemap",
    label: "HTML Sitemap Page",
    notFixed: "Mention to remove the duplicate entries from the HTML sitemap page",
    scope: "run",
    pre: [FN_PRE],
    internal: [FN_INT],
    post: [],
  },
  {
    key: "live_pages_parity",
    label: "Live-Site Pages Present on Beta",
    notFixed: "Mention to add the listed live-site pages to beta, or redirect their old URLs to the new pages",
    scope: "run",
    pre: [FN_PRE],
    internal: [FN_INT],
    post: [],
  },
  {
    key: "backend_extras",
    label: "Backend Leftovers (Duplicates & Dummy Media)",
    notFixed: "Mention to delete the duplicate pages and dummy media listed from the WordPress backend",
    scope: "run",
    pre: ["backend"],
    internal: [FN_INT],
    post: [],
  },
]

export const GAP_CHECK_KEYS = GAP_CHECKS.map((c) => c.key)
export const GAP_CHECK_BY_KEY: Record<string, GapCheckDef> = Object.fromEntries(GAP_CHECKS.map((c) => [c.key, c]))
export const gapKeysByScope = (scope: GapScope): string[] =>
  GAP_CHECKS.filter((c) => c.scope === scope).map((c) => c.key)
export const GAP_LABELS: Record<string, string> = Object.fromEntries(GAP_CHECKS.map((c) => [c.key, c.label]))
export const GAP_NOT_FIXED: Record<string, string> = Object.fromEntries(GAP_CHECKS.map((c) => [c.key, c.notFixed]))

/**
 * Add the gap checks to a TED subtask section table, in place of hand-editing
 * every section: a section whose FIRST matcher is a check's home gets that check.
 * Returns a new table; the input is not changed.
 */
export function withGapChecks(
  sections: { matchers: string[]; checks: string[] }[],
  suite: "pre" | "internal" | "post",
): { matchers: string[]; checks: string[] }[] {
  return sections.map((s) => {
    const home = s.matchers[0]
    const extra = GAP_CHECKS.filter((c) => c[suite].includes(home)).map((c) => c.key)
    return extra.length ? { ...s, checks: [...s.checks, ...extra.filter((k) => !s.checks.includes(k))] } : s
  })
}

/** Gap checks that belong to a suite at all (have at least one home there). */
export const gapKeysForSuite = (suite: "pre" | "internal" | "post"): string[] =>
  GAP_CHECKS.filter((c) => c[suite].length > 0).map((c) => c.key)
