const fileCache = require('../cache/file-cache');
const logger = require('../utils/logger');
const constants = require('../utils/constants');

/**
 * Build the consolidated series list across all languages, deduped by id.
 *
 * Filtering precedence:
 *   1. An explicit `language` dropdown value (not 'All') always wins — the user
 *      is deliberately overriding, so show exactly that language.
 *   2. Otherwise, if the token was configured with a subset of series languages
 *      (`extra.configuredSeriesLanguages`), the single Series row defaults to an
 *      any-match over those languages.
 *   3. Otherwise ('All'/absent + no config) show every series.
 *
 * @param {object} extra - request extra props. May include `language` (dropdown)
 *   and `configuredSeriesLanguages` (lowercase ids from the token config).
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

  const selected = extra && extra.language;
  const configured = extra && Array.isArray(extra.configuredSeriesLanguages)
    ? extra.configuredSeriesLanguages.map(l => String(l).toLowerCase())
    : [];

  if (selected && selected !== 'All') {
    // Explicit dropdown pick overrides the configured default.
    const wanted = String(selected).toLowerCase();
    series = series.filter(item =>
      Array.isArray(item.languages) && item.languages.includes(wanted)
    );
    logger.debug(`Filtered series catalog by language "${selected}": ${series.length} results`);
  } else if (configured.length > 0) {
    // Default view limited to the configured languages (any-match).
    const wanted = new Set(configured);
    series = series.filter(item =>
      Array.isArray(item.languages) && item.languages.some(l => wanted.has(l))
    );
    logger.debug(`Filtered series catalog by configured languages [${configured.join(', ')}]: ${series.length} results`);
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

