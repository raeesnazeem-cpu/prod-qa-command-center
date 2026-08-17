import fs from "fs"
import path from "path"
import { describeImageResult } from "./aiFallback"

/**
 * Footer-logo vision verifier — recognizes the Growth99 logo in the footer and
 * flags any tagline / wrong variant.
 *
 * The Growth99 footer logo is a stylized SUNRISE mark (radiating rays rising
 * over a horizontal horizon line) to the LEFT of the "Growth99" wordmark, in
 * exactly two approved, tagline-free variants:
 *   • WHITE  — mark + text all white  → for DARK footer backgrounds
 *   • COLOR  — sage/green mark + BLACK text → for LIGHT footer backgrounds
 *
 * If the two reference PNGs are present on disk they are sent alongside the
 * footer screenshot so the model matches the exact mark (any size/recolor);
 * otherwise it works from the textual description alone. Vision failure returns
 * null so the caller can fall back to a manual "verify" finding.
 */

export interface FooterLogoVerdict {
  logoFound: boolean
  matchesApproved: boolean
  hasTagline: boolean
  variant: "white" | "color" | "other"
  backgroundIsDark: boolean
  legibleOnBackground: boolean
  notes: string
}

// Where the two approved reference logos live. Drop the files here:
//   growth99-white.png  (white variant)
//   growth99-color.png  (green mark + black text)
const REF_FILES = ["growth99-white.png", "growth99-color.png"]

function refDirCandidates(): string[] {
  const dirs = [
    process.env.FOOTER_LOGO_REF_DIR,
    path.resolve(process.cwd(), "assets/footer-logo"),
    path.resolve(process.cwd(), "apps/worker/assets/footer-logo"),
    path.resolve(__dirname, "../../assets/footer-logo"),
    path.resolve(__dirname, "../assets/footer-logo"),
  ].filter(Boolean) as string[]
  return dirs
}

/** Load the reference logo buffers if the files exist (else empty). */
function loadReferenceLogos(): Buffer[] {
  for (const dir of refDirCandidates()) {
    try {
      if (!fs.existsSync(dir)) continue
      const bufs = REF_FILES.map((f) => path.join(dir, f))
        .filter((p) => fs.existsSync(p))
        .map((p) => fs.readFileSync(p))
      if (bufs.length > 0) return bufs
    } catch {}
  }
  return []
}

const PROMPT_BASE = `You are verifying a website FOOTER logo for the brand "Growth99".

The approved Growth99 logo is a stylized SUNRISE mark — radiating rays rising over a horizontal horizon line — placed to the LEFT of the wordmark "Growth99". It has exactly two approved, TAGLINE-FREE variants:
  (A) WHITE: the mark AND the "Growth99" text are all white (used on DARK backgrounds).
  (B) COLOR: the mark is sage/muted GREEN and the "Growth99" text is BLACK (used on LIGHT backgrounds).
There is NO tagline, slogan, or extra text under or beside the wordmark.

Inspect the FOOTER screenshot (the LAST image) and decide:
- logoFound: is a Growth99 sunrise-mark + "Growth99" wordmark visible in the footer?
- matchesApproved: does it match ONE of the two approved variants (not an old/different logo, not a competitor mark)?
- hasTagline: is there any tagline/slogan text attached to the logo?
- variant: "white" | "color" | "other"
- backgroundIsDark: is the footer background dark?
- legibleOnBackground: is the logo clearly visible/contrasting (a white logo on a light bg or a dark logo on a dark bg is NOT legible)?
- notes: one short sentence.

Return STRICT JSON only, no markdown:
{"logoFound":bool,"matchesApproved":bool,"hasTagline":bool,"variant":"white|color|other","backgroundIsDark":bool,"legibleOnBackground":bool,"notes":"..."}`

// Returns the parsed verdict, or `verdict: null` with an `error` describing why
// (vision unavailable, or an unparseable reply). The error is meant for the
// worker log + the internal QACC report copy, never the client-facing copy.
export async function verifyFooterLogo(
  footerScreenshot: Buffer,
): Promise<{ verdict: FooterLogoVerdict | null; error?: string }> {
  const refs = loadReferenceLogos()
  const prompt =
    refs.length > 0
      ? `The first ${refs.length} image(s) are the APPROVED reference logo(s). ${PROMPT_BASE}`
      : PROMPT_BASE
  const images = [...refs, footerScreenshot]

  const res = await describeImageResult(images, prompt)
  if (!res.ok) return { verdict: null, error: res.error || "vision unavailable" }
  try {
    const m = res.text.match(/\{[\s\S]*\}/)
    if (!m) return { verdict: null, error: "vision returned an unparseable reply (no JSON)" }
    const j = JSON.parse(m[0])
    return {
      verdict: {
        logoFound: !!j.logoFound,
        matchesApproved: !!j.matchesApproved,
        hasTagline: !!j.hasTagline,
        variant: j.variant === "white" || j.variant === "color" ? j.variant : "other",
        backgroundIsDark: !!j.backgroundIsDark,
        legibleOnBackground: j.legibleOnBackground !== false,
        notes: String(j.notes || ""),
      },
    }
  } catch {
    return { verdict: null, error: "vision returned an unparseable reply (bad JSON)" }
  }
}

/** Turn a verdict into pass + a human reason. */
export function evaluateFooterLogo(v: FooterLogoVerdict): { pass: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (!v.logoFound) reasons.push("the Growth99 logo was not found in the footer")
  else {
    if (!v.matchesApproved) reasons.push("the footer logo does not match either approved Growth99 variant (old/incorrect logo)")
    if (v.hasTagline) reasons.push("the logo includes a tagline (the approved footer logo has none)")
    if (!v.legibleOnBackground)
      reasons.push(`the ${v.variant} logo is not legible on this ${v.backgroundIsDark ? "dark" : "light"} background (wrong colour variant)`)
  }
  return { pass: reasons.length === 0, reasons }
}
