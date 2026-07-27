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

const manifest = {
  id: constants.ADDON_ID,
  version: constants.ADDON_VERSION,
  name: constants.ADDON_NAME,
  description: constants.ADDON_DESCRIPTION,
  resources: [
    'catalog',
    'meta',
    'stream'
  ],
  types: ['movie', 'series'],
  catalogs: [...Object.values(constants.LANGUAGES).map(buildCatalog), seriesCatalog],
  // Only our catalog IDs - don't include tt/tmdb so we're not asked for content from other addons
  idPrefixes: ['tamil-', 'telugu-', 'hindi-', 'malayalam-', 'kannada-', 'english-', 'multi-']
};

/**
 * Get manifest filtered by visible catalogs
 * @param {string[]} [visibleCatalogs] - Array of catalog IDs to show. Empty/undefined = show all
 * @returns {object} Manifest with filtered catalogs
 */
function getManifestForCatalogs(visibleCatalogs) {
  if (!Array.isArray(visibleCatalogs) || visibleCatalogs.length === 0) {
    return manifest;
  }
  const visibleSet = new Set(visibleCatalogs);
  const filteredCatalogs = manifest.catalogs.filter(cat => visibleSet.has(cat.id));
  return {
    ...manifest,
    catalogs: filteredCatalogs
  };
}

module.exports = manifest;
module.exports.getManifestForCatalogs = getManifestForCatalogs;

