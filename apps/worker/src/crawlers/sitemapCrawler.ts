import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { chromium } from 'playwright';
import { URL } from 'url';

const MAX_URLS = 200;
const FALLBACK_MAX_PAGES = 100;
const FALLBACK_MAX_DEPTH = 3;

const IGNORED_EXTENSIONS = [
  '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico',
  '.css', '.js', '.json', '.xml', '.txt', '.zip', '.rar', '.exe',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.doc', '.docx', '.xls', '.xlsx'
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
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/xml,text/xml,*/*'
      }
    });
    
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_"
    });
    const jsonObj = parser.parse(response.data);

    let urls: string[] = [];

    // Handle sitemapindex
    if (jsonObj.sitemapindex && jsonObj.sitemapindex.sitemap) {
      const sitemaps = Array.isArray(jsonObj.sitemapindex.sitemap) 
        ? jsonObj.sitemapindex.sitemap 
        : [jsonObj.sitemapindex.sitemap];
      
      for (const s of sitemaps) {
        if (s.loc) {
          const nestedUrls = await fetchSitemapUrls(s.loc, visited);
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
        if (entry.loc) {
          urls.push(entry.loc);
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
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const foundUrls = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: siteUrl, depth: 0 }];
  const visited = new Set<string>();

  const baseDomain = new URL(siteUrl).hostname;

  try {
    while (queue.length > 0 && foundUrls.size < FALLBACK_MAX_PAGES) {
      const { url, depth } = queue.shift()!;
      
      const normalized = normalizeUrl(url, siteUrl);
      if (visited.has(normalized)) continue;
      visited.add(normalized);

      if (depth > FALLBACK_MAX_DEPTH) continue;

      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        
        if (isValidUrl(url, siteUrl)) {
          foundUrls.add(normalized);
        }

        if (depth < FALLBACK_MAX_DEPTH) {
          const links = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a[href]'))
              .map(a => (a as HTMLAnchorElement).href);
          });

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
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  return Array.from(foundUrls);
}

/**
 * Main Crawler Function
 */
export async function crawlSitemap(siteUrl: string): Promise<string[]> {
  const baseUrl = siteUrl.endsWith('/') ? siteUrl.slice(0, -1) : siteUrl;
  const potentialSitemaps = [
    `${baseUrl}/sitemap.xml`,
    `${baseUrl}/sitemap_index.xml`,
    `${baseUrl}/wp-sitemap.xml`
  ];

  let discoveredUrls: string[] = [];

  // Try sitemaps first
  for (const sitemapUrl of potentialSitemaps) {
    const urls = await fetchSitemapUrls(sitemapUrl);
    if (urls.length > 0) {
      discoveredUrls = [...discoveredUrls, ...urls];
    }
  }

  // Fallback to Playwright link crawling
  if (discoveredUrls.length === 0) {
    console.log(`No sitemap found for ${siteUrl}, falling back to Playwright crawl...`);
    discoveredUrls = await crawlWithPlaywright(siteUrl);
  }

  // Filter, deduplicate, and sort
  const cleanUrls = Array.from(new Set(
    discoveredUrls
      .filter(url => isValidUrl(url, siteUrl))
      .map(url => normalizeUrl(url, siteUrl))
  )).sort();

  return cleanUrls.slice(0, MAX_URLS);
}
