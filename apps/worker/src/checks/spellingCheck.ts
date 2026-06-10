import { Page as PlaywrightPage } from 'playwright';
import { Finding } from '@qacc/shared';

export async function checkSpelling(page: PlaywrightPage, pageRecord: any): Promise<Finding[]> {
  // Use eval('import()') hack for ESM-only packages in CJS environment
  const nspellModule = await eval('import("nspell")');
  const dictionaryEnModule = await eval('import("dictionary-en")');
  
  const nspell = nspellModule.default;
  const dictionaryEn = dictionaryEnModule.default;

  const spell = nspell(dictionaryEn);
  
  // Tech-specific allowlist
  const techAllowlist = ['WordPress', 'Elementor', 'plugin', 'monorepo', 'QACC', 'Vite'];
  techAllowlist.forEach(word => spell.add(word));

  const allowlistSet = new Set([
    'wordpress', 'elementor', 'plugin', 'plugins', 'woocommerce', 'shopify',
    'backend', 'frontend', 'api', 'seo', 'js', 'css', 'html', 'react', 'vue',
    'angular', 'node', 'app', 'online', 'website', 'startup', 'web', 'login',
    'signup', 'dashboard', 'ecommerce', 'blog', 'vlog', 'cdn', 'ssl', 'http',
    'https', 'localhost', 'dev', 'prod', 'admin', 'ui', 'ux', 'qa', 'saas'
  ]);

  const rawTexts = await page.evaluate(() => {
    const texts: { text: string; extract: string }[] = [];
    const elements = Array.from(document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, td, span, div'));

    const isHidden = (el: Element) => {
      const style = window.getComputedStyle(el);
      return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
    };

    const isInsideSkippedNode = (el: Element) => {
      return el.closest('nav, footer, script, style, noscript, svg') !== null;
    };

    // Keep track to avoid duplicating text that has already been extracted
    const wordsSet = new Set<string>();

    for (const el of elements) {
      if (isHidden(el) || isInsideSkippedNode(el)) continue;

      let directText = '';
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE && child.textContent) {
          directText += child.textContent;
        }
      }

      const trimmedText = directText.trim();
      if (trimmedText && !wordsSet.has(trimmedText)) {
        wordsSet.add(trimmedText);
        texts.push({
          text: trimmedText,
          extract: trimmedText
        });
      }
    }
    return texts;
  });

  const findings: Finding[] = [];
  
  // Strip simple URLs out of block.text before tokenizing
  const urlRegex = /https?:\/\/[^\s]+|www\.[^\s]+/g;
  const wordRegex = /[a-zA-Z]+/g;

  // Track added words to deduplicate findings
  const dedupWords = new Set<string>();

  for (const block of rawTexts) {
    if (findings.length >= 50) break;
    
    // Remove URLs to avoid tokenizing parts of them
    const textWithoutUrls = block.text.replace(urlRegex, ' ');
    const words = textWithoutUrls.match(wordRegex) || [];
    
    for (const word of words) {
      if (findings.length >= 50) break;

      if (dedupWords.has(word.toLowerCase())) continue;

      // Rule: skip words < 3 characters
      if (word.length < 3) continue;

      // Rule: skip capitalized words (proper nouns)
      if (word[0] === word[0].toUpperCase()) continue;

      // Rule: skip words in custom allowlist
      if (allowlistSet.has(word.toLowerCase())) continue;

      const isMispelled = !spell.spell(word);
      if (isMispelled) {
        dedupWords.add(word.toLowerCase());
        const suggestions = spell.suggest(word);
        
        let contextText = block.extract;
        if (contextText.length > 200) {
          const index = contextText.indexOf(word);
          const start = Math.max(0, index - 50);
          const end = Math.min(contextText.length, index + word.length + 50);
          contextText = (start > 0 ? '...' : '') + contextText.substring(start, end) + (end < contextText.length ? '...' : '');
        }

        findings.push({
          check_factor: 'spelling',
          severity: 'low',
          title: `Misspelled: ${word}`,
          description: suggestions.length > 0 ? `Suggestion: ${suggestions[0]}` : `No suggestions found for ${word}`,
          context_text: contextText,
          screenshot_url: pageRecord.desktopUrl,
        } as Finding);
      }
    }
  }

  return findings;
}
