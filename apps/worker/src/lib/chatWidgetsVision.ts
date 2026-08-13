import { describeImage } from "./aiFallback"

/**
 * Vision check for the Growth99 floating widgets on a fully-loaded homepage:
 *   • a vertical stack of 3–4 circular icon buttons near the RIGHT edge
 *     (self-assessment / calendar / chat / reviews), and
 *   • a chatbot launcher bubble at the BOTTOM-RIGHT (often shows the site logo).
 */

export interface ChatWidgetsVerdict {
  buttonsVisible: boolean
  buttonCount: number
  chatbotVisible: boolean
  notes: string
}

const PROMPT = `This is a full screenshot of a medical/aesthetic clinic website homepage AFTER it has fully loaded. The site may inject a floating "Growth99" widget cluster over the page. Inspect the screenshot and report:
- buttonsVisible: is there a vertical stack of CIRCULAR icon buttons near the RIGHT edge of the page? (icons are typically: a clipboard/self-assessment, a calendar, a chat bubble, and a star/reviews)
- buttonCount: how many such circular buttons are stacked there (0 if none)
- chatbotVisible: is there a CHATBOT launcher bubble in the BOTTOM-RIGHT corner (a round button, often showing the website's own logo)?
- notes: one short sentence.

Return STRICT JSON only, no markdown:
{"buttonsVisible":bool,"buttonCount":int,"chatbotVisible":bool,"notes":"..."}`

const SELF_ASSESS_PROMPT = `A button was just clicked on a clinic website. Did a SELF-ASSESSMENT / virtual-consultation widget open? It looks like a full-screen or large panel showing a human BODY MODEL figure (front/back) with instructions such as "Start by selecting a body part on the model" or a "Self Assessment" heading and a Female/Male toggle. Return STRICT JSON only: {"opened":bool,"notes":"..."}`

/** Confirm a self-assessment (body-model) widget opened after clicking a launcher. */
export async function confirmSelfAssessmentWidget(
  screenshot: Buffer,
): Promise<{ opened: boolean; notes: string } | null> {
  const text = await describeImage(screenshot, SELF_ASSESS_PROMPT).catch(() => "")
  if (!text) return null
  try {
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return null
    const j = JSON.parse(m[0])
    return { opened: !!j.opened, notes: String(j.notes || "") }
  } catch {
    return null
  }
}

export async function analyzeChatWidgets(
  screenshot: Buffer,
): Promise<ChatWidgetsVerdict | null> {
  const text = await describeImage(screenshot, PROMPT).catch(() => "")
  if (!text) return null
  try {
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return null
    const j = JSON.parse(m[0])
    return {
      buttonsVisible: !!j.buttonsVisible,
      buttonCount: Number(j.buttonCount) || 0,
      chatbotVisible: !!j.chatbotVisible,
      notes: String(j.notes || ""),
    }
  } catch {
    return null
  }
}
