const fileCache = require('../cache/file-cache');
const logger = require('../utils/logger');
const constants = require('../utils/constants');
const imdbIndex = require('../cache/imdb-index');

/**
 * Handle metadata requests for individual movies and series
 * READ-ONLY from cache - no on-demand scraping.
 * Meta is sanitized once at cache write-time (see file-cache.setAll), so this
 * handler is a pure echo of the cached object.
 */
/**
 * Re-key a cached meta (and its episode ids) from our internal id to the
 * IMDb id the client asked for, so follow-up stream requests use tt ids.
 */
function withImdbIds(meta, internalId, imdbId) {
  const rekey = (videoId) => (typeof videoId === 'string' && videoId.startsWith(`${internalId}:`)
    ? imdbId + videoId.slice(internalId.length)
    : videoId);
  const videos = Array.isArray(meta.videos)
    ? meta.videos.map((v) => ({ ...v, id: rekey(v.id) }))
    : meta.videos;
  return { ...meta, id: imdbId, videos };
}

async function handleMeta({ type, id }) {
  try {
    logger.debug(`[META] Request received: type=${type}, id=${id}`);
    
    // Validate type
    if (type !== 'movie' && type !== 'series') {
      logger.warn(`[META] Invalid meta type requested: ${type}`);
      return { meta: null };
    }

    // Load metadata from cache - check correct directory based on type
    // IMDb ids (tt...) resolve to our internal id via the catalog index.
    const isImdb = /^tt\d+$/.test(id);
    const contentId = isImdb ? await imdbIndex.resolveContentId(type, id) : id;

    let content = null;
    if (!contentId) {
      content = null;
    } else if (type === 'movie') {
      content = await fileCache.getMovie(contentId);
    } else if (type === 'series') {
      content = await fileCache.getSeries(contentId);
    }
    
    if (!content) {
      logger.warn(`[META] ${type} not found in cache: ${id}`);
      return { meta: null };
    }

    // Verify type matches
    if (content.type !== type) {
      logger.warn(`[META] Type mismatch: requested ${type}, found ${content.type}`);
      return { meta: null };
    }

    logger.debug(`[META] Returning metadata for ${type}: ${id} (name: ${content.name})`);
    // Already sanitized at write-time; echo directly.
    if (isImdb) {
      content = withImdbIds(content, contentId, id);
    }
    return {
      meta: content,
      cacheMaxAge: constants.META_CACHE_MAX_AGE
    };
  } catch (error) {
    logger.error(`[META] Error in meta handler:`, error);
    return { meta: null };
  }
}

module.exports = handleMeta;

