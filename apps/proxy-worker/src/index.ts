/**
 * Cloudflare Worker for Proxy Browser
 * Handles CORS and rewrites HTML links to pass through the proxy
 */

const WHITELISTED_DOMAINS = [
  "bosthetics.com",
  "auriacademy.gogroth.com",
  "ruma.com",
  "growth99.com",
  "example.com",
  "elitederma.gogroth.com",
]

// Reusable CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // Or "https://qacc.raees.dev"
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, x-impersonate-user",
}

export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    // 1. Handle CORS Preflight (OPTIONS) request
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders })
    }

    // 2. Extract the target URL from the query string
    const url = new URL(request.url)
    const targetUrlStr = url.searchParams.get("url")

    if (!targetUrlStr) {
      return new Response(
        JSON.stringify({ error: "Missing 'url' query parameter" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      )
    }

    // Proxy Origin is our Worker's URL (e.g. http://localhost:8787 or https://proxy-worker.workers.dev)
    const proxyOrigin = url.origin

    try {
      const targetUrl = new URL(targetUrlStr)

      // Clean headers before forwarding (preventing Cloudflare/Host mismatch errors)
      const fetchHeaders = new Headers(request.headers)
      fetchHeaders.delete("Host")
      fetchHeaders.delete("Origin")
      fetchHeaders.delete("Referer")
      fetchHeaders.delete("Accept-Encoding")
      fetchHeaders.delete("Cookie")
      fetchHeaders.delete("Connection")
      fetchHeaders.set(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      )

      // 3. Fetch the target URL
      const response = await fetch(targetUrl.toString(), {
        method: request.method,
        headers: fetchHeaders,
        // Only include body if it's not a GET/HEAD request
        body: ["GET", "HEAD"].includes(request.method)
          ? undefined
          : request.body,
        redirect: "follow",
      })

      const contentType = response.headers.get("content-type") || ""

      // 4. If it's not HTML, just return the response directly (e.g. images, css)
      if (!contentType.includes("text/html")) {
        const newResponse = new Response(response.body, response)
        newResponse.headers.set("Access-Control-Allow-Origin", "*")
        return newResponse
      }

      // 5. If it is HTML, we rewrite it using Cloudflare's HTMLRewriter
      const baseHref = `${targetUrl.protocol}//${targetUrl.host}/`

      const interceptorScript = `
        <script>
          (function() {
            const proxyPrefix = '${proxyOrigin}/?url=';
            
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

      // Helper function for rewriting paths
      const rewriteAttribute = (path: string | null) => {
        if (
          !path ||
          path.startsWith("#") ||
          path.startsWith("javascript:") ||
          path.startsWith("mailto:")
        ) {
          return path
        }

        try {
          const resolvedUrl = new URL(path, targetUrl.href)
          const resolvedHostname = resolvedUrl.hostname

          const isWhitelisted = WHITELISTED_DOMAINS.some(
            (d) => resolvedHostname === d || resolvedHostname.endsWith("." + d),
          )

          if (isWhitelisted) {
            return `${proxyOrigin}/?url=${encodeURIComponent(resolvedUrl.href)}`
          }
        } catch (e) {
          // Ignore parsing errors
        }
        return path
      }

      const rewriter = new HTMLRewriter()
        .on("head", {
          element(element) {
            // Inject <base> tag and interceptor script at the start of <head>
            element.prepend(`<base href="${baseHref}">\n${interceptorScript}`, {
              html: true,
            })
          },
        })
        .on("a", {
          element(element) {
            const href = element.getAttribute("href")
            const newHref = rewriteAttribute(href)
            if (newHref !== href && newHref) {
              element.setAttribute("href", newHref)
            }
          },
        })
        .on("form", {
          element(element) {
            const action = element.getAttribute("action")
            const newAction = rewriteAttribute(action)
            if (newAction !== action && newAction) {
              element.setAttribute("action", newAction)
            }
          },
        })

      // Pass the HTML stream through the rewriter
      let rewrittenResponse = rewriter.transform(response)

      // We must copy the response to modify headers
      rewrittenResponse = new Response(
        rewrittenResponse.body,
        rewrittenResponse,
      )

      // Apply CORS and security headers
      rewrittenResponse.headers.set("Access-Control-Allow-Origin", "*")
      rewrittenResponse.headers.set("X-Frame-Options", "ALLOWALL")
      rewrittenResponse.headers.set(
        "Content-Security-Policy",
        "frame-ancestors *",
      )

      return rewrittenResponse
    } catch (error: any) {
      return new Response(
        JSON.stringify({
          error: "Failed to load page",
          details: error.message,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      )
    }

    return new Response("Unexpected Error", { status: 500 })
  },
}
