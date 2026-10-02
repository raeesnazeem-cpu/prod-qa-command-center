import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { chromium } from 'playwright';
import { URL } from 'url';
import { DESKTOP_UA, gotoResilient, newRealContext } from '../lib/browserContext';

const MAX_URLS = 200;
const FALLBACK_MAX_PAGES = 100;
const FALLBACK_MAX_DEPTH = 3;

const IGNORED_EXTENSIONS = [
  '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico',
  '.css', '.js', '.json', '.xml', '.txt', '.zip', '.rar', '.exe',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.doc', '.docx', '.xls', '.xlsx', '.md', '.rss', '.atom', '.gz'
];

/**
 * Filter and clean a URL
 */
function isValidUrl(urlStr: string, baseUrl: string): boolean {
  try {
    const url = new URL(urlStr, baseUrl);
    const base = new URL(baseUrl);

    // Normalize hostnames for comparison (remove www. for loose domain matching)
    const normalizeHostname = (host: string) => host.replace(/^www\./, '').toLowerCase();
    
    if (normalizeHostname(url.hostname) !== normalizeHostname(base.hostname)) return false;

    // Filter out file extensions
    const pathname = url.pathname.toLowerCase();
    if (IGNORED_EXTENSIONS.some(ext => pathname.endsWith(ext))) return false;

    // Filter out admin URLs
    if (pathname.includes('/wp-admin')) return false;

    // Filter out search URLs
    if (url.searchParams.has('s')) return false;

    // Filter out fragment-only or empty
    if (!url.pathname || url.pathname === '/' && url.hash) return false;

    return true;
  } catch {
    return false;
  }
}

/**
 * Normalize URL (remove trailing slash, fragments, etc.)
 */
function normalizeUrl(urlStr: string, baseUrl: string): string {
  const url = new URL(urlStr, baseUrl);
  url.hash = ''; // Remove fragments
  // Remove trailing slash for consistency
  let normalized = url.toString();
  if (normalized.endsWith('/') && url.pathname !== '/') {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

/**
 * Crawl sitemaps recursively
 */
async function fetchSitemapUrls(sitemapUrl: string, visited: Set<string> = new Set()): Promise<string[]> {
  if (visited.has(sitemapUrl)) return [];
  visited.add(sitemapUrl);

  try {
    const response = await axios.get(sitemapUrl, {
      timeout: 15000,
      maxRedirects: 5,
      responseType: 'text',
      headers: {
        'User-Agent': DESKTOP_UA,
        'Accept': 'application/xml,text/xml,*/*'
      }
    });

    // Many sites answer /sitemap.xml with their HTML 404 or SPA shell (200).
    // Only parse real XML.
    const body = typeof response.data === 'string' ? response.data : String(response.data ?? '');
    if (!/<(urlset|sitemapindex)[\s>]/i.test(body)) return [];

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_"
    });
    const jsonObj = parser.parse(body);

    let urls: string[] = [];

    // Handle sitemapindex
    if (jsonObj.sitemapindex && jsonObj.sitemapindex.sitemap) {
      const sitemaps = Array.isArray(jsonObj.sitemapindex.sitemap) 
        ? jsonObj.sitemapindex.sitemap 
        : [jsonObj.sitemapindex.sitemap];
      
      for (const s of sitemaps) {
        const loc = typeof s.loc === 'string' ? s.loc.trim() : s.loc?.['#text'];
        if (loc) {
          const nestedUrls = await fetchSitemapUrls(loc, visited);
          urls = [...urls, ...nestedUrls];
        }
      }
    }

    // Handle urlset
    if (jsonObj.urlset && jsonObj.urlset.url) {
      const urlEntries = Array.isArray(jsonObj.urlset.url) 
        ? jsonObj.urlset.url 
        : [jsonObj.urlset.url];
      
      for (const entry of urlEntries) {
        const loc = typeof entry.loc === 'string' ? entry.loc.trim() : entry.loc?.['#text'];
        if (loc) {
          urls.push(loc);
        }
      }
    }

    return urls;
  } catch (error) {
    console.warn(`Failed to fetch sitemap: ${sitemapUrl}`);
    return [];
  }
}

/**
 * Fallback Playwright crawler
 */
async function crawlWithPlaywright(siteUrl: string): Promise<string[]> {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  // Real UA: a bare context sends "HeadlessChrome", which bot filters block.
  const context = await newRealContext(browser);
  const foundUrls = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: siteUrl, depth: 0 }];
  const visited = new Set<string>();

  try {
    while (queue.length > 0 && foundUrls.size < FALLBACK_MAX_PAGES) {
      const { url, depth } = queue.shift()!;
      
      const normalized = normalizeUrl(url, siteUrl);
      if (visited.has(normalized)) continue;
      visited.add(normalized);

      if (depth > FALLBACK_MAX_DEPTH) continue;

      const page = await context.newPage();
      try {
        // networkidle never settles on sites with chat widgets / beacons, so
        // use load (gotoResilient never throws) and give SPAs a moment to
        // render their links.
        await gotoResilient(page, url, { timeout: 30000 });
        await page.waitForTimeout(1500).catch(() => {});

        if (isValidUrl(url, siteUrl)) {
          foundUrls.add(normalized);
        }

        if (depth < FALLBACK_MAX_DEPTH) {
          const links: string[] = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a[href]'))
              .map(a => (a as HTMLAnchorElement).href);
          }).catch(() => []);

          for (const link of links) {
            if (isValidUrl(link, siteUrl)) {
              const normLink = normalizeUrl(link, siteUrl);
              if (!visited.has(normLink)) {
                queue.push({ url: link, depth: depth + 1 });
              }
            }
          }
        }
      } catch (e) {
        console.error(`Error crawling ${url}:`, e);
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  return Array.from(foundUrls);
}

/**
 * Follow redirects on the entered URL (http→https, bare→www, /→/en/) so the
 * sitemap lookup and link filtering use the host the site actually serves.
 */
async function resolveFinalUrl(siteUrl: string): Promise<string> {
  try {
    const res = await axios.get(siteUrl, {
      timeout: 15000,
      maxRedirects: 5,
      responseType: 'text',
      headers: { 'User-Agent': DESKTOP_UA, 'Accept': 'text/html,*/*' },
      validateStatus: () => true,
    });
    const final = (res.request as any)?.res?.responseUrl;
    return typeof final === 'string' && /^https?:\/\//i.test(final) ? final : siteUrl;
  } catch {
    return siteUrl;
  }
}

/** Sitemap URLs listed in robots.txt ("Sitemap: ..." lines). */
async function sitemapsFromRobots(origin: string): Promise<string[]> {
  try {
    const res = await axios.get(`${origin}/robots.txt`, {
      timeout: 10000,
      responseType: 'text',
      headers: { 'User-Agent': DESKTOP_UA },
      validateStatus: () => true,
    });
    if (res.status !== 200 || typeof res.data !== 'string') return [];
    return res.data
      .split(/\r?\n/)
      .map((l: string) => l.match(/^\s*sitemap:\s*(\S+)/i)?.[1])
      .filter((u: string | undefined): u is string => !!u);
  } catch {
    return [];
  }
}

/**
 * Main Crawler Function
 *
 * Works on any site, not just WordPress: robots.txt sitemaps first, then the
 * common sitemap paths (WordPress, Yoast/RankMath, Shopify, Squarespace, Wix
 * and Webflow all serve one of these), then a link crawl. Never throws — the
 * caller falls back to the homepage when nothing is found.
 */
export async function crawlSitemap(siteUrl: string): Promise<string[]> {
  const entered = siteUrl.endsWith('/') ? siteUrl.slice(0, -1) : siteUrl;
  const finalUrl = await resolveFinalUrl(entered);
  let origin = entered;
  try {
    origin = new URL(finalUrl).origin;
  } catch {}

  const robotsSitemaps = await sitemapsFromRobots(origin);
  const commonSitemaps = [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/wp-sitemap.xml`,
    `${origin}/sitemap-index.xml`,
  ];

  let discoveredUrls: string[] = [];
  const visited = new Set<string>();

  // robots.txt may list several sitemaps (pages, posts, products) — take all.
  for (const sitemapUrl of robotsSitemaps) {
    discoveredUrls.push(...(await fetchSitemapUrls(sitemapUrl, visited)));
  }

  // Otherwise the common paths. Stop at the first one that yields URLs — the
  // others are usually the same list under another name.
  if (discoveredUrls.length === 0) {
    for (const sitemapUrl of commonSitemaps) {
      const urls = await fetchSitemapUrls(sitemapUrl, visited);
      if (urls.length > 0) {
        discoveredUrls = urls;
        break;
      }
    }
  }

  // Fallback to Playwright link crawling
  if (discoveredUrls.length === 0) {
    console.log(`No sitemap found for ${siteUrl}, falling back to Playwright crawl...`);
    discoveredUrls = await crawlWithPlaywright(finalUrl).catch((e) => {
      console.warn(`Playwright crawl failed for ${siteUrl}:`, e?.message || e);
      return [] as string[];
    });
  }

  // Filter against the served host (www/bare are treated as one), dedupe, sort.
  const cleanUrls = Array.from(new Set(
    discoveredUrls
      .filter(url => isValidUrl(url, finalUrl))
      .map(url => normalizeUrl(url, finalUrl))
  )).sort();

  return cleanUrls.slice(0, MAX_URLS);
}
