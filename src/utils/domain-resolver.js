const axios = require('axios');
const logger = require('./logger');
const constants = require('./constants');

// The mirror publishes its current domain through a stable "resolver" host.
// Historically this redirected straight to the live forum; it now 301s to a
// Google search of the form `google.com/search?q=site:<live-domain>`. We support
// both shapes. Override via SOURCE_RESOLVER_URL if the resolver host ever changes.
const DEFAULT_RESOLVER_URL = 'https://www.1tamilmv.fi/';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
};

// Markers that indicate a page is the real forum rather than a parked/redirect
// placeholder (e.g. a "Google Search" landing page seen on dead mirror domains).
const FORUM_MARKERS = ['/topic/', 'index.php?/forums', 'ipsType', '1TamilMV'];

function looksLikeForum(html) {
  if (!html || typeof html !== 'string') return false;
  return FORUM_MARKERS.some((m) => html.includes(m));
}

/**
 * Extract the live mirror domain from a resolver's final URL / redirect target.
 *
 * Handles two shapes:
 *   1. A Google search redirect: `.../search?q=site:1tamilmv.pizza` (URL-encoded
 *      as `site%3A...`) -> returns `1tamilmv.pizza`.
 *   2. A direct forum URL: `https://www.1tamilmv.pizza/...` -> returns the host.
 *
 * @param {string} finalUrl
 * @returns {string|null} bare host (e.g. `www.1tamilmv.pizza`) or null
 */
function extractDomainFromResolver(finalUrl) {
  if (!finalUrl || typeof finalUrl !== 'string') return null;

  // Shape 1: a `site:<domain>` query (possibly URL-encoded as `site%3A`).
  const siteMatch = finalUrl.match(/site(?::|%3A)([a-z0-9.-]+\.[a-z]{2,})/i);
  if (siteMatch) {
    return siteMatch[1].replace(/^www\./i, '');
  }

  // Shape 2: a direct URL to the mirror itself (not a search engine).
  try {
    const host = new URL(finalUrl).host;
    if (host && !/google\.|bing\.|duckduckgo\./i.test(host)) {
      return host.replace(/^www\./i, '');
    }
  } catch (_) {
    // not a parseable URL
  }
  return null;
}

/**
 * Fetch a candidate domain and confirm it serves the real forum.
 * @param {string} domain bare host, e.g. `1tamilmv.pizza`
 * @returns {Promise<string|null>} normalized base URL (trailing slash) or null
 */
async function verifyForumDomain(domain) {
  const baseUrl = `https://www.${domain}/`;
  try {
    const res = await axios.get(baseUrl, {
      maxRedirects: 5,
      timeout: 15000,
      validateStatus: (s) => s < 400,
      headers: BROWSER_HEADERS
    });
    if (looksLikeForum(res.data)) return baseUrl;
    logger.warn(`Candidate domain ${baseUrl} responded but is not the forum`);
  } catch (error) {
    logger.warn(`Candidate domain ${baseUrl} not reachable: ${error.message}`);
  }
  return null;
}

/**
 * Resolve the latest TamilMV source domain automatically.
 *
 * Strategy:
 *   1. Hit the resolver host (SOURCE_RESOLVER_URL or the default `.fi`) and
 *      follow redirects.
 *   2. If the landing page is already the forum, use it.
 *   3. Otherwise extract the live domain from the redirect target
 *      (e.g. a `site:<domain>` Google search) and verify it is the forum.
 *   4. If discovery fails at every step, fall back to the configured BASE_URL
 *      (overridable via SOURCE_BASE_URL) so scraping still has a chance.
 *
 * @returns {Promise<string>} The domain URL (with trailing slash)
 */
async function resolveLatestDomain() {
  const configuredUrl = constants.BASE_URL;
  const resolverUrl = process.env.SOURCE_RESOLVER_URL || DEFAULT_RESOLVER_URL;

  try {
    logger.info(`Resolving latest TamilMV domain via ${resolverUrl}...`);

    const response = await axios.get(resolverUrl, {
      maxRedirects: 10,
      timeout: 15000,
      validateStatus: (status) => status < 400,
      headers: BROWSER_HEADERS
    });

    // Case A: resolver landed directly on the forum.
    if (looksLikeForum(response.data)) {
      const finalUrl = response.request?.res?.responseUrl || resolverUrl;
      const host = new URL(finalUrl).host;
      const baseUrl = `https://${host}/`;
      logger.success(`Resolved latest TamilMV domain (direct): ${baseUrl}`);
      return baseUrl;
    }

    // Case B: resolver redirected elsewhere (e.g. a `site:<domain>` search).
    const finalUrl = response.request?.res?.responseUrl || resolverUrl;
    const candidate = extractDomainFromResolver(finalUrl);
    if (candidate) {
      logger.info(`Discovered candidate domain from resolver: ${candidate}`);
      const verified = await verifyForumDomain(candidate);
      if (verified) {
        logger.success(`Resolved latest TamilMV domain: ${verified}`);
        return verified;
      }
    }

    logger.warn(`Auto-discovery failed via ${resolverUrl}; using configured domain: ${configuredUrl}`);
    return configuredUrl;
  } catch (error) {
    logger.error(`Failed to resolve latest domain from ${resolverUrl}:`, error.message);
    logger.warn(`Using configured domain: ${configuredUrl}`);
    return configuredUrl;
  }
}

module.exports = {
  resolveLatestDomain,
  looksLikeForum,
  extractDomainFromResolver
};
