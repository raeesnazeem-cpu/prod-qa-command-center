import { genAI } from './geminiClient';

interface AuditResult {
  type: 'spelling' | 'dummy' | 'brand_voice';
  word_or_phrase: string;
  context: string;
  suggestion: string;
  severity: 'high' | 'medium' | 'low';
}

export async function auditPageText(pageText: string, pageUrl: string): Promise<any[]> {
  const truncatedText = pageText.length > 2000 ? pageText.substring(0, 2000) : pageText;
  
  if (!truncatedText.trim()) {
    return [];
  }

  const prompt = `You are a QA assistant reviewing a WordPress/Elementor marketing website. The text below is extracted from page ${pageUrl}. Identify ONLY: (1) obvious spelling errors not caught by basic spellcheck (brand names, technical terms spelled wrong), (2) dummy/placeholder content (lorem ipsum, example text), (3) clearly inconsistent brand voice (mixing formal and very casual in same section). Return a JSON array of findings: [{type: 'spelling'|'dummy'|'brand_voice', word_or_phrase: string, context: string, suggestion: string, severity: 'high'|'medium'|'low'}]. Return [] if no issues. Return ONLY valid JSON, no markdown.

Text to audit:
"""
${truncatedText}
"""`;

  try {
    const response = await genAI.models.generateContent({
      model: "gemini-1.5-flash",
      contents: [{ role: 'user', parts: [{ text: prompt }] }]
    });
    const resultText = response.text();
    
    // Attempt to strip out markdown JSON wrappers if Gemini still returns them
    let cleanJsonText = resultText.trim();
    if (cleanJsonText.startsWith('```')) {
      const lastTickIndex = cleanJsonText.lastIndexOf('```');
      const firstNewline = cleanJsonText.indexOf('\n');
      if (firstNewline !== -1 && lastTickIndex > firstNewline) {
        cleanJsonText = cleanJsonText.substring(firstNewline, lastTickIndex).trim();
      }
    }
    
    let rawFindings: AuditResult[] = [];
    if (cleanJsonText && cleanJsonText !== '[]') {
      try {
        rawFindings = JSON.parse(cleanJsonText);
      } catch (parseError) {
        console.error('Failed to parse Gemini text audit result:', parseError, 'Raw response:', resultText);
        return [];
      }
    }

    if (!Array.isArray(rawFindings)) {
      return [];
    }

    return rawFindings.map((finding) => ({
      check_factor: 'ai_content_audit',
      severity: finding.severity || 'low',
      title: `[${(finding.type || 'unknown').toUpperCase()}] ${finding.word_or_phrase || 'Issue'}`,
      description: finding.suggestion,
      context_text: finding.context,
    }));
  } catch (error) {
    console.error('Gemini text audit process failed:', error);
    return [];
  }
}
