import { Page as PlaywrightPage } from 'playwright';
import { Finding } from '@qacc/shared';

export async function checkExternalLinks(page: PlaywrightPage, pageRecord: any): Promise<Finding[]> {
  const pageUrl = new URL(page.url());
  const domain = pageUrl.hostname;

  const externalLinks = await page.$$eval('a[href^="http"]', (els, domain) => {
    return els.map(el => {
      const anchor = el as HTMLAnchorElement;
      return {
        href: anchor.href,
        hostname: new URL(anchor.href).hostname,
        target: anchor.target,
        rel: anchor.rel,
        text: anchor.textContent?.trim() || 'No text'
      };
    }).filter(link => link.hostname !== domain);
  }, domain);

  const findings: Finding[] = [];

  for (const link of externalLinks) {
    if (link.target === '_blank') {
      const hasNoopener = link.rel.toLowerCase().includes('noopener');
      const hasNoreferrer = link.rel.toLowerCase().includes('noreferrer');

      if (!hasNoopener && !hasNoreferrer) {
        findings.push({
          check_factor: 'external_links',
          severity: 'low',
          title: 'External link missing noopener',
          description: `The external link to "${link.href}" opens in a new tab but missing "noopener" or "noreferrer" rel attribute. This is a security risk (tabnabbing).`,
          context_text: `Link Text: "${link.text}" | URL: ${link.href} | rel: "${link.rel}"`,
          screenshot_url: pageRecord.desktopUrl,
          status: 'open',
          ai_generated: false
        });
      }
    }
  }

  // Group findings or keep them individual as needed

  return findings;
}
