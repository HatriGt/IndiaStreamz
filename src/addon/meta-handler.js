const fileCache = require('../cache/file-cache');
const logger = require('../utils/logger');
const constants = require('../utils/constants');

/**
 * Handle metadata requests for individual movies and series
 * READ-ONLY from cache - no on-demand scraping.
 * Meta is sanitized once at cache write-time (see file-cache.setAll), so this
 * handler is a pure echo of the cached object.
 */
async function handleMeta({ type, id }) {
  try {
    logger.info(`[META] Request received: type=${type}, id=${id}`);
    
    // Validate type
    if (type !== 'movie' && type !== 'series') {
      logger.warn(`[META] Invalid meta type requested: ${type}`);
      return { meta: null };
    }

    // Load metadata from cache - check correct directory based on type
    let content = null;
    if (type === 'movie') {
      content = await fileCache.getMovie(id);
    } else if (type === 'series') {
      content = await fileCache.getSeries(id);
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

    logger.info(`[META] Returning metadata for ${type}: ${id} (name: ${content.name})`);
    // Already sanitized at write-time; echo directly.
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

