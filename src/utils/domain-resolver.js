const axios = require('axios');
const logger = require('./logger');
const constants = require('./constants');

// Markers that indicate a page is the real forum rather than a parked/redirect
// placeholder (e.g. a "Google Search" landing page seen on dead mirror domains).
const FORUM_MARKERS = ['/topic/', 'index.php?/forums', 'ipsType', '1TamilMV'];

function looksLikeForum(html) {
  if (!html || typeof html !== 'string') return false;
  return FORUM_MARKERS.some((m) => html.includes(m));
}

/**
 * Resolve the latest TamilMV source domain.
 *
 * The mirror rotates domains often and old resolver URLs turn into parked pages,
 * so we treat the configured BASE_URL (overridable via SOURCE_BASE_URL) as the
 * source of truth. We only follow a redirect resolver when one is explicitly
 * provided via SOURCE_RESOLVER_URL, and we verify the landing page is actually
 * the forum before trusting it; otherwise we fall back to the configured domain.
 *
 * @returns {Promise<string>} The domain URL (with trailing slash)
 */
async function resolveLatestDomain() {
  const configuredUrl = constants.BASE_URL;
  const resolverUrl = process.env.SOURCE_RESOLVER_URL;

  // No dynamic resolver configured: use the configured/live domain directly.
  if (!resolverUrl) {
    logger.info(`Using configured TamilMV domain: ${configuredUrl}`);
    return configuredUrl;
  }

  try {
    logger.info(`Resolving latest TamilMV domain from ${resolverUrl}...`);

    const response = await axios.get(resolverUrl, {
      maxRedirects: 10,
      validateStatus: (status) => status < 400,
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    // Only trust the resolved domain if the landing page is really the forum.
    if (!looksLikeForum(response.data)) {
      logger.warn(`Resolver ${resolverUrl} did not return a forum page; using configured domain: ${configuredUrl}`);
      return configuredUrl;
    }

    let finalUrl = resolverUrl;
    if (response.request?.res?.responseUrl) {
      finalUrl = response.request.res.responseUrl;
    } else if (response.request?.path) {
      const protocol = response.request.protocol || 'https:';
      const host = response.request.host || response.request.getHeader('host');
      if (host) finalUrl = `${protocol}//${host}`;
    }

    const urlObj = new URL(finalUrl);
    const baseUrl = `${urlObj.protocol}//${urlObj.host}/`;
    logger.success(`Resolved latest TamilMV domain: ${baseUrl}`);
    return baseUrl;
  } catch (error) {
    logger.error(`Failed to resolve latest domain from ${resolverUrl}:`, error.message);
    logger.warn(`Using configured domain: ${configuredUrl}`);
    return configuredUrl;
  }
}

module.exports = {
  resolveLatestDomain,
  looksLikeForum
};
