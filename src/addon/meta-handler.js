const fileCache = require('../cache/file-cache');
const logger = require('../utils/logger');

/**
 * Handle metadata requests for individual movies and series
 * READ-ONLY from cache - no on-demand scraping
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
      // Try to find similar IDs (for debugging)
      if (type === 'movie') {
        const files = await require('fs').promises.readdir('cache/movies/');
        const similar = files.filter(f => f.includes(id.substring(0, 20)));
        if (similar.length > 0) {
          logger.debug(`[META] Similar files found: ${similar.slice(0, 3).join(', ')}`);
        }
      }
      return { meta: null };
    }

    // Verify type matches
    if (content.type !== type) {
      logger.warn(`[META] Type mismatch: requested ${type}, found ${content.type}`);
      return { meta: null };
    }

    logger.info(`[META] Returning metadata for ${type}: ${id} (name: ${content.name})`);
    return { meta: content };
  } catch (error) {
    logger.error(`[META] Error in meta handler:`, error);
    return { meta: null };
  }
}

module.exports = handleMeta;

