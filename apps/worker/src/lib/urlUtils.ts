import { URL } from 'url';

const IGNORED_EXTENSIONS = [
  '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico',
  '.css', '.js', '.json', '.xml', '.txt', '.zip', '.rar', '.exe',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.doc', '.docx', '.xls', '.xlsx'
];

/**
 * Normalizes a URL: resolves relative URLs, removes trailing slashes, removes utm_ params
 */
export function normalizeUrl(urlStr: string, baseUrl: string): string {
  try {
    const url = new URL(urlStr, baseUrl);
    url.hash = ''; // Remove fragments

    // Remove UTM and other common tracking parameters
    const paramsToDelete: string[] = [];
    url.searchParams.forEach((value, key) => {
      if (key.startsWith('utm_') || key === 'fbclid' || key === 'gclid') {
        paramsToDelete.push(key);
      }
    });
    paramsToDelete.forEach(key => url.searchParams.delete(key));

    let normalized = url.toString();
    
    // Remove trailing slash for consistency (unless it's just the root)
    if (normalized.endsWith('/') && url.pathname !== '/') {
      normalized = normalized.slice(0, -1);
    }

    return normalized;
  } catch {
    return urlStr;
  }
}

/**
 * Checks if the URL belongs to the same domain as the baseUrl
 */
export function isSameDomain(urlStr: string, baseUrl: string): boolean {
  try {
    const url = new URL(urlStr, baseUrl);
    const base = new URL(baseUrl);
    return url.hostname === base.hostname;
  } catch {
    return false;
  }
}

/**
 * Filters out common non-page URLs (images, pdfs, admin pages)
 */
export function isValidPageUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    const pathname = url.pathname.toLowerCase();

    // Filter out file extensions
    if (IGNORED_EXTENSIONS.some(ext => pathname.endsWith(ext))) return false;

    // Filter out admin URLs
    if (pathname.includes('/wp-admin') || pathname.includes('/admin/')) return false;

    // Filter out common non-content query patterns (like search)
    if (url.searchParams.has('s')) return false;

    return true;
  } catch {
    return false;
  }
}

/**
 * Applies all filters and normalizations to an array of URLs
 */
export function filterUrls(urls: string[], baseUrl: string): string[] {
  const result = new Set<string>();
  
  for (const rawUrl of urls) {
    if (isSameDomain(rawUrl, baseUrl)) {
      const normalized = normalizeUrl(rawUrl, baseUrl);
      if (isValidPageUrl(normalized)) {
        result.add(normalized);
      }
    }
  }

  return Array.from(result).sort();
}
