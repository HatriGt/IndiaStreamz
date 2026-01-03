const fileCache = require('../cache/file-cache');
const logger = require('../utils/logger');
const constants = require('../utils/constants');

/**
 * Handle catalog requests by language
 * READ-ONLY from cache - no on-demand scraping
 */
async function handleCatalog({ type, id, extra }) {
  try {
    // Validate type - support both movie and series
    if (type !== 'movie' && type !== 'series') {
      logger.warn(`Invalid catalog type requested: ${type}`);
      return { metas: [] };
    }

    // For series, check if it's a language-specific series catalog
    let language = id;
    if (type === 'series' && id.endsWith('-series')) {
      language = id.replace('-series', '');
    }
    
    // Validate language
    if (!Object.values(constants.LANGUAGES).includes(language)) {
      logger.warn(`Invalid language requested: ${language}`);
      return { metas: [] };
    }

    // Load catalog from cache
    const catalog = await fileCache.getCatalog(language);
    
    if (!catalog || !Array.isArray(catalog)) {
      logger.debug(`No catalog found in cache for language: ${language}`);
      return { metas: [] };
    }

    // Filter by type (movie or series)
    let metas = catalog.filter(item => item.type === type);

    // Handle search if provided
    if (extra && extra.search) {
      const searchTerm = extra.search.toLowerCase();
      metas = metas.filter(meta => 
        meta.name && meta.name.toLowerCase().includes(searchTerm)
      );
      logger.debug(`Filtered catalog by search "${extra.search}": ${metas.length} results`);
    }

    // Handle skip for pagination
    const skip = extra && extra.skip ? parseInt(extra.skip) : 0;
    if (skip > 0) {
      metas = metas.slice(skip);
    }

    logger.debug(`Returning catalog for ${language} (${type}): ${metas.length} items`);
    return { metas };
  } catch (error) {
    logger.error(`Error in catalog handler:`, error);
    return { metas: [] };
  }
}

module.exports = handleCatalog;

