const constants = require('./constants');

/**
 * Build a Cache-Control header value from Stremio-style cache directives.
 * Mirrors what the stremio-addon-sdk sets when handlers return these fields,
 * so our explicit Express routes cache identically.
 *
 * @param {object} [directives]
 * @param {number} [directives.cacheMaxAge] seconds -> max-age
 * @param {number} [directives.staleRevalidate] seconds -> stale-while-revalidate
 * @param {number} [directives.staleError] seconds -> stale-if-error
 * @returns {string|null} Cache-Control value, or null if nothing to set
 */
function buildCacheControl({ cacheMaxAge, staleRevalidate, staleError } = {}) {
  const parts = [];
  if (Number.isFinite(cacheMaxAge) && cacheMaxAge > 0) {
    parts.push(`max-age=${Math.floor(cacheMaxAge)}`);
  }
  if (Number.isFinite(staleRevalidate) && staleRevalidate > 0) {
    parts.push(`stale-while-revalidate=${Math.floor(staleRevalidate)}`);
  }
  if (Number.isFinite(staleError) && staleError > 0) {
    parts.push(`stale-if-error=${Math.floor(staleError)}`);
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * Apply cache directives from a handler result onto an Express response.
 * If the result carries no cache fields, no header is set.
 */
function applyCacheHeaders(res, result) {
  if (!result || typeof result !== 'object') return;
  const value = buildCacheControl(result);
  if (value) {
    res.setHeader('Cache-Control', value);
  }
}

/**
 * Cache headers for stream responses.
 * Streams containing per-user TorBox URLs must not be shared-cached, so we only
 * set a short cache when the payload is generic (infoHash/magnet only).
 */
function applyStreamCacheHeaders(res, result) {
  const streams = (result && Array.isArray(result.streams)) ? result.streams : [];
  const hasUserSpecificUrl = streams.some((s) => typeof s.url === 'string' && s.url.length > 0);
  if (hasUserSpecificUrl) {
    res.setHeader('Cache-Control', 'no-store');
    return;
  }
  const value = buildCacheControl({ cacheMaxAge: constants.STREAM_CACHE_MAX_AGE });
  if (value) {
    res.setHeader('Cache-Control', value);
  }
}

module.exports = {
  buildCacheControl,
  applyCacheHeaders,
  applyStreamCacheHeaders
};
