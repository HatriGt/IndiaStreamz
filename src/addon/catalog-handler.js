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

    // Handle genre filter if provided (case-insensitive match against meta.genres)
    if (extra && extra.genre) {
      const genre = extra.genre.toLowerCase();
      metas = metas.filter(meta =>
        Array.isArray(meta.genres) &&
        meta.genres.some(g => typeof g === 'string' && g.toLowerCase() === genre)
      );
      logger.debug(`Filtered catalog by genre "${extra.genre}": ${metas.length} results`);
    }

    // Handle pagination: Stremio requests pages of PAGE_SIZE (default 100) via skip.
    // Returning fewer than a full page signals the end of the catalog.
    const skip = extra && extra.skip ? parseInt(extra.skip, 10) || 0 : 0;
    metas = metas.slice(skip, skip + constants.PAGE_SIZE);

    logger.debug(`Returning catalog for ${language} (${type}): ${metas.length} items (skip=${skip})`);
    return {
      metas,
      cacheMaxAge: constants.CATALOG_CACHE_MAX_AGE,
      staleRevalidate: constants.CATALOG_STALE_REVALIDATE,
      staleError: constants.CATALOG_STALE_ERROR
    };
  } catch (error) {
    logger.error(`Error in catalog handler:`, error);
    return { metas: [] };
  }
}

module.exports = handleCatalog;

