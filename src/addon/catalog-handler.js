const fileCache = require('../cache/file-cache');
const logger = require('../utils/logger');
const constants = require('../utils/constants');

/**
 * Build the consolidated series list across all languages, deduped by id, then
 * filtered by the `language` dropdown value ('All'/absent => every series).
 * @param {object} extra - request extra props (may include `language`)
 * @returns {Promise<Array>} series catalog items
 */
async function getConsolidatedSeries(extra) {
  const byId = new Map();
  for (const language of Object.values(constants.LANGUAGES)) {
    const catalog = await fileCache.getCatalog(language);
    if (!Array.isArray(catalog)) continue;
    for (const item of catalog) {
      if (item.type === 'series' && !byId.has(item.id)) {
        byId.set(item.id, item);
      }
    }
  }

  let series = Array.from(byId.values());

  // Language filter: 'All' or missing shows everything.
  const selected = extra && extra.language;
  if (selected && selected !== 'All') {
    const wanted = String(selected).toLowerCase();
    series = series.filter(item =>
      Array.isArray(item.languages) && item.languages.includes(wanted)
    );
    logger.debug(`Filtered series catalog by language "${selected}": ${series.length} results`);
  }

  return series;
}

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

    // Consolidated series catalog: one catalog (id 'series') holding every
    // series across languages, filtered by the `language` dropdown.
    let metas;
    if (type === 'series' && id === 'series') {
      metas = await getConsolidatedSeries(extra);
    } else {
      // Movie catalogs (and legacy '<lang>-series'): id maps directly to language.
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
      metas = catalog.filter(item => item.type === type);
    }

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

    logger.debug(`Returning catalog for ${id} (${type}): ${metas.length} items (skip=${skip})`);
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

