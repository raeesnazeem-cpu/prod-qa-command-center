import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { URL } from 'url';

const IGNORED_EXTENSIONS = [
  '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico',
  '.css', '.js', '.json', '.xml', '.txt', '.zip', '.rar', '.exe',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.doc', '.docx', '.xls', '.xlsx'
];

function isValidUrl(urlStr: string, baseUrl: string): boolean {
  try {
    const url = new URL(urlStr, baseUrl);
    const base = new URL(baseUrl);
    const normalizeHostname = (host: string) => host.replace(/^www\./, '').toLowerCase();
    
    if (normalizeHostname(url.hostname) !== normalizeHostname(base.hostname)) return false;

    const pathname = url.pathname.toLowerCase();
    if (IGNORED_EXTENSIONS.some(ext => pathname.endsWith(ext))) return false;
    if (pathname.includes('/wp-admin')) return false;
    if (url.searchParams.has('s')) return false;
    if (!url.pathname || url.pathname === '/' && url.hash) return false;

    return true;
  } catch {
    return false;
  }
}

function normalizeUrl(urlStr: string, baseUrl: string): string {
  const url = new URL(urlStr, baseUrl);
  url.hash = '';
  let normalized = url.toString();
  if (normalized.endsWith('/') && url.pathname !== '/') {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

async function fetchSitemapUrls(sitemapUrl: string, visited: Set<string> = new Set()): Promise<string[]> {
  if (visited.has(sitemapUrl)) return [];
  visited.add(sitemapUrl);

  try {
    const response = await axios.get(sitemapUrl, { 
      timeout: 10000,
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
    return [];
  }
}

export async function quickFetchUrls(siteUrl: string): Promise<string[]> {
  const baseUrl = siteUrl.endsWith('/') ? siteUrl.slice(0, -1) : siteUrl;
  const potentialSitemaps = [
    `${baseUrl}/sitemap.xml`,
    `${baseUrl}/sitemap_index.xml`,
    `${baseUrl}/wp-sitemap.xml`
  ];

  let discoveredUrls: string[] = [];

  for (const sitemapUrl of potentialSitemaps) {
    const urls = await fetchSitemapUrls(sitemapUrl);
    if (urls.length > 0) {
      discoveredUrls = [...discoveredUrls, ...urls];
    }
  }

  const cleanUrls = Array.from(new Set(
    discoveredUrls
      .filter(url => isValidUrl(url, siteUrl))
      .map(url => normalizeUrl(url, siteUrl))
  )).sort();

  return cleanUrls.slice(0, 100);
}
