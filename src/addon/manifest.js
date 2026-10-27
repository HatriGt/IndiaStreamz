const constants = require('../utils/constants');

/**
 * Build a movie catalog definition for a language with search/genre/skip filters.
 */
function buildCatalog(language) {
  return {
    type: 'movie',
    id: language,
    name: `${constants.LANGUAGE_NAMES[language]} Movies`,
    extra: [
      { name: 'search', isRequired: false },
      { name: 'genre', isRequired: false, options: constants.CATALOG_GENRES },
      { name: 'skip', isRequired: false }
    ]
  };
}

/**
 * Single consolidated series catalog across all languages. The `language`
 * filter renders as a dropdown; 'All' (default) shows every series.
 */
const seriesCatalog = {
  type: 'series',
  id: 'series',
  name: 'Series',
  extra: [
    { name: 'search', isRequired: false },
    { name: 'language', isRequired: false, options: constants.CATALOG_LANGUAGE_OPTIONS },
    { name: 'genre', isRequired: false, options: constants.CATALOG_GENRES },
    { name: 'skip', isRequired: false }
  ]
};

const INTERNAL_ID_PREFIXES = ['tamil-', 'telugu-', 'hindi-', 'malayalam-', 'kannada-', 'english-', 'multi-'];

const manifest = {
  id: constants.ADDON_ID,
  version: constants.ADDON_VERSION,
  name: constants.ADDON_NAME,
  description: constants.ADDON_DESCRIPTION,
  // Catalog items use IMDb ids (tt...) when TMDB matched one, so clients like
  // Nuvio pull their own metadata, Trakt and subtitles. Meta for tt ids comes
  // from the client's metadata provider (Cinemeta/TMDB); we only serve meta for
  // our own ids, but answer stream requests for both.
  resources: [
    'catalog',
    { name: 'meta', types: ['movie', 'series'], idPrefixes: INTERNAL_ID_PREFIXES },
    { name: 'stream', types: ['movie', 'series'], idPrefixes: [...INTERNAL_ID_PREFIXES, 'tt'] }
  ],
  types: ['movie', 'series'],
  catalogs: [...Object.values(constants.LANGUAGES).map(buildCatalog), seriesCatalog],
  idPrefixes: [...INTERNAL_ID_PREFIXES, 'tt']
};

/**
 * Get manifest filtered by visible catalogs.
 * @param {string[]} [visibleCatalogs] - Catalog IDs to show. Empty/undefined = show all
 * @returns {object} Manifest with filtered catalogs
 *
 * Note: the series catalog's `language` dropdown always offers the full option
 * list. Per-token `seriesLanguages` limits the CONTENT of the series row (the
 * default any-match set) in the catalog handler, not the dropdown here.
 */
function getManifestForCatalogs(visibleCatalogs) {
  if (!Array.isArray(visibleCatalogs) || visibleCatalogs.length === 0) {
    return manifest;
  }
  const visibleSet = new Set(visibleCatalogs);
  return {
    ...manifest,
    catalogs: manifest.catalogs.filter((cat) => visibleSet.has(cat.id))
  };
}

module.exports = manifest;
module.exports.getManifestForCatalogs = getManifestForCatalogs;

