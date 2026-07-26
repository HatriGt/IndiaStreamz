const fileCache = require('../cache/file-cache');
const logger = require('../utils/logger');

// Regex to strip zero-width and other invisible chars that break Stremio parsing
const INVISIBLE_CHARS = /[\u200B-\u200D\uFEFF\u00AD]/g;

/**
 * Sanitize string - remove invisible Unicode chars that cause "Failed to parse meta"
 */
function sanitizeString(str) {
  if (typeof str !== 'string') return str;
  return str.replace(INVISIBLE_CHARS, '').trim();
}

/**
 * Recursively sanitize meta object strings
 */
function sanitizeMeta(meta) {
  if (!meta) return meta;
  const sanitized = { ...meta };
  for (const key of Object.keys(sanitized)) {
    const val = sanitized[key];
    if (key === 'id') continue; // Don't modify id - required for stream requests
    if (typeof val === 'string') {
      sanitized[key] = sanitizeString(val);
    } else if (Array.isArray(val)) {
      sanitized[key] = val.map(item =>
        typeof item === 'string' ? sanitizeString(item) : (item && typeof item === 'object' ? sanitizeMeta(item) : item)
      );
    } else if (val && typeof val === 'object' && !Array.isArray(val) && key !== 'id') {
      sanitized[key] = sanitizeMeta(val);
    }
  }
  return sanitized;
}

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
    // Sanitize to remove invisible chars that cause Stremio "Failed to parse meta"
    return { meta: sanitizeMeta(content) };
  } catch (error) {
    logger.error(`[META] Error in meta handler:`, error);
    return { meta: null };
  }
}

module.exports = handleMeta;

