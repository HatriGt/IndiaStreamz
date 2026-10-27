const fileCache = require('./file-cache');
const constants = require('../utils/constants');

/**
 * Maps IMDb ids (tt...) to our internal content ids so clients that key
 * everything on IMDb ids (Nuvio, Trakt, subtitle addons) can resolve streams.
 *
 * Built from the language catalogs. getCatalog() returns the same array
 * instance until a catalog file changes, so the index is rebuilt only when
 * one of those arrays is replaced.
 */
let lastCatalogs = [];
let index = new Map(); // imdbId -> [{ id, type, season }]

function sameCatalogs(catalogs) {
  return catalogs.length === lastCatalogs.length &&
    catalogs.every((c, i) => c === lastCatalogs[i]);
}

async function getIndex() {
  const catalogs = await Promise.all(
    Object.values(constants.LANGUAGES).map((lang) => fileCache.getCatalog(lang))
  );
  if (sameCatalogs(catalogs)) return index;

  const next = new Map();
  const seen = new Set();
  for (const catalog of catalogs) {
    if (!Array.isArray(catalog)) continue;
    for (const item of catalog) {
      if (!item || !item.imdb_id || seen.has(item.id)) continue;
      seen.add(item.id);
      if (!next.has(item.imdb_id)) next.set(item.imdb_id, []);
      next.get(item.imdb_id).push({ id: item.id, type: item.type, season: item.season || null });
    }
  }
  index = next;
  lastCatalogs = catalogs;
  return index;
}

/**
 * Resolve a Stremio IMDb id (`tt123` or `tt123:season:episode`) to the
 * internal stream-cache ids that hold its streams.
 * @returns {Promise<string[]>}
 */
async function resolveStreamIds(type, id) {
  const [imdbId, seasonStr, episodeStr] = String(id).split(':');
  const entries = ((await getIndex()).get(imdbId) || []).filter((e) => e.type === type);

  if (type === 'movie') {
    return entries.map((e) => e.id);
  }

  const season = parseInt(seasonStr, 10);
  const episode = parseInt(episodeStr, 10);
  if (!Number.isFinite(season) || !Number.isFinite(episode)) return [];
  return entries
    .filter((e) => e.season == null || Number(e.season) === season)
    .map((e) => `${e.id}:${season}:${episode}`);
}

/**
 * Look up the first internal id for an IMDb id (used by the meta handler).
 */
async function resolveContentId(type, imdbId) {
  const entries = ((await getIndex()).get(imdbId) || []).filter((e) => e.type === type);
  return entries.length > 0 ? entries[0].id : null;
}

module.exports = { getIndex, resolveStreamIds, resolveContentId };
