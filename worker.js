// ─────────────────────────────────────────────────────────────────────────────
//  Bunkr Dumb Proxy Worker
//
//  A tiny whitelist-guarded passthrough that fetches Bunkr-related upstream
//  URLs with realistic browser headers and adds CORS. ALL search / racing /
//  scoring logic lives in the frontend (bunkr-search.html), so this worker is
//  deployed ONCE and never needs editing again — future improvements to the
//  search engine happen in the HTML file only.
//
//  Why this is needed
//  ──────────────────
//  Bunkr search mirrors either have no CORS headers or block non-browser User
//  Agents. A Cloudflare Worker sits on the edge, sets browser-like headers,
//  adds CORS, and returns raw upstream responses to the HTML.
//
//  Security
//  ────────
//  Only hostnames containing "bunkr" are proxied — this prevents the worker
//  from being used as a generic open proxy.
// ─────────────────────────────────────────────────────────────────────────────

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age':       '86400',
};
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json' };

// Only Bunkr-related hosts are allowed — stops the worker being abused as an
// open proxy. Broad match ("contains bunkr") is intentional so new mirrors
// work without redeploying.
function isAllowed(hostname) {
  return hostname.toLowerCase().includes('bunkr');
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const u      = new URL(request.url);
    const target = u.searchParams.get('url');

    if (!target) {
      return new Response(
        JSON.stringify({ error: 'Missing ?url= parameter' }),
        { status: 400, headers: JSON_CORS }
      );
    }

    let targetUrl;
    try { targetUrl = new URL(target); }
    catch {
      return new Response(
        JSON.stringify({ error: 'Invalid ?url= value' }),
        { status: 400, headers: JSON_CORS }
      );
    }

    if (!isAllowed(targetUrl.hostname)) {
      return new Response(
        JSON.stringify({ error: `Host not allowed: ${targetUrl.hostname}` }),
        { status: 403, headers: JSON_CORS }
      );
    }

    try {
      const upstream = await fetch(targetUrl.toString(), {
        headers: { ...BROWSER_HEADERS, Referer: targetUrl.origin + '/' },
        cf:      { cacheTtl: 300, cacheEverything: true },
      });
      const body = await upstream.arrayBuffer();
      return new Response(body, {
        status: upstream.status,
        headers: {
          ...CORS,
          'Content-Type':      upstream.headers.get('content-type') || 'application/octet-stream',
          'X-Upstream-Status': String(upstream.status),
        },
      });
    } catch (e) {
      return new Response(
        JSON.stringify({ error: e?.message || 'Upstream fetch failed' }),
        { status: 502, headers: JSON_CORS }
      );
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
//  DEPLOY / UPDATE STEPS  (one-time, ~3 minutes)
//  ─────────────────────────────────────────────
//  First time:
//    1. Go to https://workers.cloudflare.com → sign up (no credit card needed)
//    2. Click "Create" → "Hello World" template → "Deploy"
//    3. Click "Edit code", delete everything, paste THIS entire file
//    4. Click "Deploy" (top right)
//    5. Copy the worker URL → paste it into the app's setup wizard
//
//  Already have a worker? Open it in the Cloudflare dashboard, click
//  "Edit code", replace the contents with this file, and click "Deploy".
//
//  After this you never need to touch Cloudflare again — every future fix
//  to the Bunkr search engine happens in the HTML file only.
// ─────────────────────────────────────────────────────────────────────────────
