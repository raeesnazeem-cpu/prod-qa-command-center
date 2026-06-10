import { Page as PlaywrightPage } from 'playwright';
import { Finding } from '@qacc/shared';
import { analyzeScreenshot } from '@qacc/ai';
import { supabase } from '../lib/supabase';

export async function checkImageCompliance(page: PlaywrightPage, pageRecord: any): Promise<Finding[]> {
  const imageResults = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img'));
    return imgs.map((img: any) => ({
      src: img.src,
      alt: img.getAttribute('alt'),
      width: img.getAttribute('width'),
      height: img.getAttribute('height'),
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      outerHTML: img.outerHTML.substring(0, 500)
    }));
  });

  const findings: Finding[] = [];

  for (const img of imageResults) {
    const { src, alt, width, height, naturalWidth, naturalHeight, outerHTML } = img;
    const lowerSrc = src.toLowerCase();

    // 1. Missing or empty alt attribute (low severity)
    if (alt === null || alt.trim() === '') {
      findings.push({
        check_factor: 'image_compliance',
        severity: 'low',
        title: 'Missing or empty alt attribute',
        description: 'Image is missing an alt attribute or it is empty. This impacts accessibility.',
        context_text: `Element: ${outerHTML}`,
        screenshot_url: pageRecord.desktopUrl,
        status: 'open',
        ai_generated: false
      });
    }

    // 2. Placeholder/Stock/Dummy images (medium severity)
    const placeholderKeywords = ['stock', 'placeholder', 'dummy', 'sample'];
    const foundKeyword = placeholderKeywords.find(kw => lowerSrc.includes(kw));
    if (foundKeyword) {
      findings.push({
        check_factor: 'image_compliance',
        severity: 'medium',
        title: `Placeholder image detected (${foundKeyword})`,
        description: `Image source contains "${foundKeyword}", suggesting it might be temporary or stock content.`,
        context_text: `Source: ${src}\nElement: ${outerHTML}`,
        screenshot_url: pageRecord.desktopUrl,
        status: 'open',
        ai_generated: false
      });
    }

    // 3. Small dimensions (potential tracking pixel) (low severity)
    // We check natural dimensions if available, otherwise skip if 0 (not loaded yet)
    if (naturalWidth > 0 && naturalHeight > 0 && naturalWidth < 50 && naturalHeight < 50) {
      findings.push({
        check_factor: 'image_compliance',
        severity: 'low',
        title: 'Small image dimensions (potential tracking pixel)',
        description: `Image natural dimensions are ${naturalWidth}x${naturalHeight}px. Small images are often used for tracking or might be layout spacers.`,
        context_text: `Source: ${src}\nDimensions: ${naturalWidth}x${naturalHeight}`,
        screenshot_url: pageRecord.desktopUrl,
        status: 'open',
        ai_generated: false
      });
    }

    // 4. Missing width/height attributes (low severity - CLS risk)
    if (!width || !height) {
      findings.push({
        check_factor: 'image_compliance',
        severity: 'low',
        title: 'Missing width or height attributes',
        description: 'Image lacks explicit width or height attributes, which can cause Cumulative Layout Shift (CLS).',
        context_text: `Element: ${outerHTML}`,
        screenshot_url: pageRecord.desktopUrl,
        status: 'open',
        ai_generated: false
      });
    }
  }

  // 5. AI-Vision Check (Check Factor 7 - Part 2)
  if (pageRecord.desktopUrl) {
    try {
      // Extract path from URL (e.g., https://.../storage/v1/object/public/screenshots/run_id/page_id.png)
      const url = new URL(pageRecord.desktopUrl);
      const pathParts = url.pathname.split('/public/screenshots/');
      if (pathParts.length === 2) {
        const filePath = pathParts[1];
        
        // Download from Supabase Storage
        const { data, error } = await supabase.storage
          .from('screenshots')
          .download(filePath);

        if (!error && data) {
          const buffer = Buffer.from(await data.arrayBuffer());
          const aiIssues = await analyzeScreenshot(buffer);
          
          for (const issue of aiIssues) {
            findings.push({
              check_factor: 'image_compliance',
              severity: issue.severity,
              title: `AI Vision: ${issue.issue}`,
              description: `AI detected a visual issue: ${issue.issue}. Affected area: ${issue.area}`,
              context_text: `AI-Vision analysis of desktop screenshot.`,
              screenshot_url: pageRecord.desktopUrl,
              status: 'open',
              ai_generated: true
            });
          }
        }
      }
    } catch (err) {
      console.error('Error in AI Vision check:', err);
    }
  }

  return findings;
}
