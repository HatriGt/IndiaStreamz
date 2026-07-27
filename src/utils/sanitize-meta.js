// Strip zero-width and other invisible chars that break Stremio meta parsing
// ("Failed to parse meta"). Applied once at cache write-time so meta reads stay
// a pure echo.
const INVISIBLE_CHARS = /[\u200B-\u200D\uFEFF\u00AD]/g;

/**
 * Sanitize a string - remove invisible Unicode chars.
 */
function sanitizeString(str) {
  if (typeof str !== 'string') return str;
  return str.replace(INVISIBLE_CHARS, '').trim();
}

/**
 * Recursively sanitize a meta object's string values. `id` is left untouched
 * since it must match exactly for subsequent stream requests.
 */
function sanitizeMeta(meta) {
  if (!meta) return meta;
  const sanitized = { ...meta };
  for (const key of Object.keys(sanitized)) {
    const val = sanitized[key];
    if (key === 'id') continue;
    if (typeof val === 'string') {
      sanitized[key] = sanitizeString(val);
    } else if (Array.isArray(val)) {
      sanitized[key] = val.map(item =>
        typeof item === 'string' ? sanitizeString(item) : (item && typeof item === 'object' ? sanitizeMeta(item) : item)
      );
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      sanitized[key] = sanitizeMeta(val);
    }
  }
  return sanitized;
}

module.exports = { sanitizeMeta, sanitizeString };
