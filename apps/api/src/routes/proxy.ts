import { Router, Request, Response } from "express"
import axios from "axios"
import { clerkAuth } from "../middleware/clerkAuth"
import { qaQueue, qaQueueEvents } from "../lib/queue"
import { uploadScreenshot } from "../lib/supabaseStorage"

const router: Router = Router()

// Whitelisted domains allowed to be proxied
const WHITELISTED_DOMAINS = [
  "bosthetics.com",
  "auriacademy.gogroth.com",
  "ruma.com",
  "growth99.com",
  "example.com",
  "elitederma.gogroth.com",
]

/**
 * POST /proxy-browser/capture
 * Triggers a screenshot capture of a URL via the worker and returns the URL.
 * Registered BEFORE the general proxy route to avoid shadowing.
 */
router.post(
  "/proxy-browser/capture",
  clerkAuth,
  async (req: Request, res: Response) => {
    const {
      url,
      scrollX,
      scrollY,
      width,
      height,
      fullPage,
      viewportWidth,
      viewportHeight,
    } = req.body
    const userId = (req as any).auth?.userId

    if (!url) {
      return res.status(400).json({ error: "URL is required" })
    }

    try {
      const sanitizedWidth =
        Math.floor(Number(viewportWidth)) || Math.floor(Number(width)) || 1280
      const sanitizedHeight =
        Math.floor(Number(viewportHeight)) || Math.floor(Number(height)) || 720

      const job = await qaQueue.add(
        "capture_screenshot",
        {
          url,
          userId,
          scrollX: Math.floor(Number(scrollX)) || 0,
          scrollY: Math.floor(Number(scrollY)) || 0,
          width: sanitizedWidth,
          height: sanitizedHeight,
          fullPage: !!fullPage,
          viewportWidth: sanitizedWidth,
          viewportHeight: sanitizedHeight,
        },
        {
          removeOnComplete: true,
        },
      )

      const result = await job.waitUntilFinished(qaQueueEvents)

      return res.json(result)
    } catch (error: any) {
      console.error("[Capture Proxy Error]:", error.message)
      return res.status(500).json({
        error: "Failed to capture screenshot",
        details: error.message,
      })
    }
  },
)

/**
 * POST /proxy-browser/upload-clip
 * Uploads a base64 encoded clip to Supabase storage.
 */
router.post(
  "/proxy-browser/upload-clip",
  clerkAuth,
  async (req: Request, res: Response) => {
    const { base64, findingId } = req.body
    const userId = (req as any).auth?.userId

    if (!base64) {
      return res.status(400).json({ error: "Base64 data is required" })
    }

    try {
      // Remove data:image/jpeg;base64, prefix
      const base64Data = base64.replace(/^data:image\/\w+;base64,/, "")
      const buffer = Buffer.from(base64Data, "base64")

      const timestamp = Date.now()
      const storagePath = `capture/${userId || "manual"}/${findingId || "clip"}_${timestamp}.jpg`

      const publicUrl = await uploadScreenshot(buffer, storagePath, {
        bucket: "evidence",
        isPublic: true,
      })

      return res.json({ imageUrl: publicUrl })
    } catch (error: any) {
      console.error("[Upload Clip Error]:", error.message, error.stack)
      return res.status(500).json({
        error: "Failed to upload clip",
        details: error.message,
      })
    }
  },
)

/**
 * POST /proxy-browser/capture-multiview
 * Triggers multiple screenshot captures (Desktop, Laptop, Tablet, Mobile) of a URL.
 */
router.post(
  "/proxy-browser/capture-multiview",
  clerkAuth,
  async (req: Request, res: Response) => {
    const { url, type } = req.body
    const userId = (req as any).auth?.userId

    if (!url) {
      return res.status(400).json({ error: "URL is required" })
    }

    try {
      const job = await qaQueue.add(
        "capture_multiview_screenshots",
        {
          url,
          userId,
          type: type || "screenshots",
        },
        {
          removeOnComplete: true,
        },
      )

      const result = await job.waitUntilFinished(qaQueueEvents)

      return res.json(result)
    } catch (error: any) {
      console.error("[Capture Multiview Error]:", error.message)
      return res.status(500).json({
        error: "Failed to capture multiview screenshots",
        details: error.message,
      })
    }
  },
)

/**
 * Helper to resolve relative URLs and rewrite them to go through the proxy
 */
function rewriteLinks(
  html: string,
  baseUrl: string,
  proxyOrigin: string,
): string {
  const urlObj = new URL(baseUrl)
  const baseHref = `${urlObj.protocol}//${urlObj.host}/`

  // Inject <base> tag and Global Proxy Interceptor to fix CORS for dynamic fetch/XHR
  const baseTag = `<base href="${baseHref}">`
  const interceptorScript = `
    <script>
      (function() {
                const proxyPrefix = '${proxyOrigin}/api/proxy-browser?url=';
        
        function getProxiedUrl(url) {
          try {
            const u = new URL(url, document.baseURI);
            if (u.protocol.startsWith('http') && !u.host.includes(window.location.host)) {
              return proxyPrefix + encodeURIComponent(u.href);
            }
          } catch(e) {}
          return url;
        }

        const originalFetch = window.fetch;
        window.fetch = function(input, init) {
          if (typeof input === 'string') {
            input = getProxiedUrl(input);
          } else if (input instanceof Request) {
            const newUrl = getProxiedUrl(input.url);
            if (newUrl !== input.url) return originalFetch(newUrl, init);
          }
          return originalFetch(input, init);
        };

        const originalOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url) {
          if (typeof url === 'string') url = getProxiedUrl(url);
          return originalOpen.apply(this, arguments);
        };
      })();
    </script>
  `

  const headContent = `\n  ${baseTag}\n  ${interceptorScript}`
  if (/<head>/i.test(html)) {
    html = html.replace(/<head>/i, `<head>${headContent}`)
  } else {
    html = `<head>${headContent}</head>\n` + html
  }

  // Resolve URL using native URL API
  const resolveUrl = (path: string) => {
    try {
      return new URL(path, baseUrl).href
    } catch (e) {
      return path
    }
  }

  const rewriteAttribute = (
    match: string,
    before: string,
    path: string,
    after: string,
    attr: string,
  ) => {
    if (
      !path ||
      path.startsWith("#") ||
      path.startsWith("javascript:") ||
      path.startsWith("mailto:")
    )
      return match

    const resolved = resolveUrl(path)
    try {
      const resolvedUrlObj = new URL(resolved)
      const resolvedHostname = resolvedUrlObj.hostname

      // Proxy if it's a whitelisted domain or a subdomain of one
      const isWhitelisted = WHITELISTED_DOMAINS.some(
        (d) => resolvedHostname === d || resolvedHostname.endsWith("." + d),
      )

      if (isWhitelisted) {
        const tagName = match.trim().toLowerCase().startsWith("<a")
          ? "a"
          : "form"
        return `<${tagName}${before}${attr}="${proxyOrigin}/api/proxy-browser?url=${encodeURIComponent(resolved)}"${after}>`
      }
    } catch (e) {}

    return match
  }

  // Rewrite <a> hrefs
  html = html.replace(
    /<a\b([^>]*)href=["'](.*?)["']([^>]*)>/gi,
    (match, before, path, after) =>
      rewriteAttribute(match, before, path, after, "href"),
  )

  // Rewrite <form> actions
  html = html.replace(
    /<form\b([^>]*)action=["'](.*?)["']([^>]*)>/gi,
    (match, before, path, after) =>
      rewriteAttribute(match, before, path, after, "action"),
  )

  return html
}

/**
 * ALL /proxy-browser
 * Proxies a URL and rewrites links to support internal navigation
 */
router.all(
  "/proxy-browser",
  (req, res, next) => {
    // Bypass clerkAuth for GET requests so the iframe can load without auth headers
    if (req.method === "GET") {
      return next()
    }
    // Require auth for POST loads
    // return clerkAuth(req, res, next)
    return next()
  },
  async (req: Request, res: Response) => {
    // const url = req.method === "POST" ? req.body.url : (req.query.url as string)
    const url =
      (req.query.url as string) ||
      (req.method === "POST" ? req.body?.url : undefined)

    const protocol = req.protocol
    const host = req.get("host")
    const proxyOrigin = `${protocol}://${host}`

    if (!url || typeof url !== "string" || !url.startsWith("http")) {
      return res.status(400).json({ error: "Invalid URL" })
    }

    try {
      const parsedUrl = new URL(url)
      const hostname = parsedUrl.hostname

      // // Improved whitelisting: check if hostname is or ends with a whitelisted domain
      // const isWhitelisted = WHITELISTED_DOMAINS.some(
      //   (d) => hostname === d || hostname.endsWith("." + d),
      // )

      // if (!isWhitelisted) {
      //   return res.status(403).json({ error: "Domain not whitelisted" })
      // }

      // const response = await axios.get(url, {
      //   timeout: 15000, // Increased timeout for heavy assets
      //   headers: {
      //     "User-Agent":
      //       "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      //     Accept: "*/*",
      //   },
      //   responseType: "arraybuffer", // Handle both text and binary data
      // })
      const response = await axios({
        method: req.method,
        url: url,
        data:
          req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
        timeout: 15000, // Increased timeout for heavy assets

        headers: {
          ...Object.fromEntries(
            Object.entries(req.headers).filter(
              ([k]) =>
                ![
                  "host",
                  "connection",
                  "content-length",
                  "transfer-encoding",
                  "cookie",
                  "origin",
                  "referer",
                  "accept-encoding",
                ].includes(k),
            ),
          ),
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "*/*",
        },
        responseType: "arraybuffer", // Handle both text and binary data
      })

      const contentType =
        (response.headers["content-type"] as string) ||
        "application/octet-stream"
      let data = response.data

      // Only rewrite if it's an HTML page
      if (contentType.includes("text/html")) {
        const html = data.toString("utf8")
        const rewrittenHtml = rewriteLinks(html, url, proxyOrigin)
        data = Buffer.from(rewrittenHtml, "utf8")
      }

      // Preserve original content-type
      res.setHeader("Content-Type", contentType)

      // Security headers for iframe compatibility
      res.setHeader("X-Frame-Options", "ALLOWALL")
      res.setHeader("Content-Security-Policy", "frame-ancestors *")

      // Optional: Forward caching headers for performance
      if (response.headers["cache-control"]) {
        res.setHeader(
          "Cache-Control",
          response.headers["cache-control"] as string,
        )
      }
      return res.send(data)
    } catch (error: any) {
      console.error("[Proxy Error]:", error.message)
      return res.status(500).json({
        error: "Failed to load page",
        details: error.message,
      })
    }
  },
)

export { router as proxyRouter }
