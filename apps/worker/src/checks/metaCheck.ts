import { Page as PlaywrightPage } from 'playwright';
import { Finding } from '@qacc/shared';

export async function checkMeta(page: PlaywrightPage, pageRecord: any): Promise<Finding[]> {
  const metaData = await page.evaluate(() => {
    const titleTag = document.querySelector('title');
    const descriptionTag = document.querySelector('meta[name="description"]');
    const ogTitle = document.querySelector('meta[property="og:title"]');
    const ogDescription = document.querySelector('meta[property="og:description"]');
    const ogImage = document.querySelector('meta[property="og:image"]');
    const canonical = document.querySelector('link[rel="canonical"]');

    return {
      title: titleTag?.textContent || null,
      description: (descriptionTag as HTMLMetaElement)?.content || null,
      ogTitle: (ogTitle as HTMLMetaElement)?.content || null,
      ogDescription: (ogDescription as HTMLMetaElement)?.content || null,
      ogImage: (ogImage as HTMLMetaElement)?.content || null,
      canonical: (canonical as HTMLLinkElement)?.href || null,
    };
  });

  const findings: Finding[] = [];

  // Title Checks
  if (!metaData.title || metaData.title.trim() === '') {
    findings.push({
      check_factor: 'meta_tags',
      severity: 'medium',
      title: 'Missing page title',
      description: 'The page is missing a <title> tag or the title is empty. Titles are critical for SEO and browser tab identification.',
      screenshot_url: pageRecord.desktopUrl,
      status: 'open',
      ai_generated: false
    });
  } else {
    const titleLen = metaData.title.length;
    if (titleLen < 10 || titleLen > 60) {
      findings.push({
        check_factor: 'meta_tags',
        severity: 'low',
        title: 'Suboptimal title length',
        description: `The page title is ${titleLen} characters long. Recommended length is between 10 and 60 characters for optimal search engine display.`,
        context_text: `Current Title: "${metaData.title}"`,
        screenshot_url: pageRecord.desktopUrl,
        status: 'open',
        ai_generated: false
      });
    }
  }

  // Description Checks
  if (!metaData.description || metaData.description.trim() === '') {
    findings.push({
      check_factor: 'meta_tags',
      severity: 'medium',
      title: 'Missing meta description',
      description: 'The page is missing a <meta name="description"> tag. Meta descriptions help search engines understand page content and improve click-through rates.',
      screenshot_url: pageRecord.desktopUrl,
      status: 'open',
      ai_generated: false
    });
  } else {
    const descLen = metaData.description.length;
    if (descLen < 50 || descLen > 160) {
      findings.push({
        check_factor: 'meta_tags',
        severity: 'low',
        title: 'Suboptimal description length',
        description: `The meta description is ${descLen} characters long. Recommended length is between 50 and 160 characters.`,
        context_text: `Current Description: "${metaData.description}"`,
        screenshot_url: pageRecord.desktopUrl,
        status: 'open',
        ai_generated: false
      });
    }
  }

  // Social Meta Checks (Open Graph)
  if (!metaData.ogTitle) {
    findings.push({
      check_factor: 'meta_tags',
      severity: 'low',
      title: 'Missing Open Graph title',
      description: 'Missing <meta property="og:title">. This tag controls how your page title appears when shared on social platforms like Facebook or LinkedIn.',
      screenshot_url: pageRecord.desktopUrl,
      status: 'open',
      ai_generated: false
    });
  }
  if (!metaData.ogDescription) {
    findings.push({
      check_factor: 'meta_tags',
      severity: 'low',
      title: 'Missing Open Graph description',
      description: 'Missing <meta property="og:description">. This tag controls the summary text shown when your page is shared on social media.',
      screenshot_url: pageRecord.desktopUrl,
      status: 'open',
      ai_generated: false
    });
  }
  if (!metaData.ogImage) {
    findings.push({
      check_factor: 'meta_tags',
      severity: 'low',
      title: 'Missing Open Graph image',
      description: 'Missing <meta property="og:image">. Without this, social platforms may pick a random image from your page or show no preview at all.',
      screenshot_url: pageRecord.desktopUrl,
      status: 'open',
      ai_generated: false
    });
  }

  // Canonical Check
  if (!metaData.canonical) {
    findings.push({
      check_factor: 'meta_tags',
      severity: 'low',
      title: 'Missing canonical link tag',
      description: 'The page is missing a <link rel="canonical"> tag. Canonical tags prevent duplicate content issues by telling search engines which version of a URL is the master version.',
      screenshot_url: pageRecord.desktopUrl,
      status: 'open',
      ai_generated: false
    });
  }

  return findings;
}
