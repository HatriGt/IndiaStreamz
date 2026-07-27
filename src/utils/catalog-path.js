const querystring = require('querystring');

/**
 * Parse a catalog wildcard path segment into { id, extra }.
 *
 * Stremio sends catalog filters as a querystring stringified into the LAST
 * path segment, e.g. `catalog/series/series/language=Tamil&skip=100.json`.
 * We strip the trailing `.json`, then treat everything after the first `/`
 * as that querystring. Any real request query params are merged in first.
 *
 * Simple case `tamil.json` -> { id: 'tamil', extra: {...query} }.
 *
 * @param {string} wildcard - the path captured after `/catalog/:type/`
 * @param {object} [query] - Express req.query to merge in
 * @returns {{ id: string, extra: object }}
 */
function parseCatalogWildcard(wildcard, query = {}) {
  let raw = wildcard || '';
  const extra = { ...query };

  if (raw.endsWith('.json')) {
    raw = raw.slice(0, -5);
  }

  const slash = raw.indexOf('/');
  let id = raw;
  if (slash !== -1) {
    id = raw.slice(0, slash);
    const extraSegment = raw.slice(slash + 1);
    if (extraSegment) {
      const parsed = querystring.parse(extraSegment);
      for (const [k, v] of Object.entries(parsed)) {
        extra[k] = Array.isArray(v) ? v[0] : v;
      }
    }
  }

  return { id, extra };
}

module.exports = { parseCatalogWildcard };
