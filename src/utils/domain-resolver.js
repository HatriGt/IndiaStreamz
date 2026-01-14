const axios = require('axios');
const logger = require('./logger');

/**
 * Resolve the latest TamilMV domain by following redirects from www.1tamilmv.fi
 * @returns {Promise<string>} The latest domain URL (with trailing slash)
 */
async function resolveLatestDomain() {
  const resolverUrl = 'https://www.1tamilmv.fi';
  
  try {
    logger.info(`Resolving latest TamilMV domain from ${resolverUrl}...`);
    
    // Follow redirects to get the final domain
    const response = await axios.get(resolverUrl, {
      maxRedirects: 10,
      validateStatus: (status) => status < 400, // Accept redirects
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    // Extract the base URL from the final response URL
    // axios follows redirects automatically, the final URL is in response.request.res.responseUrl
    let finalUrl = resolverUrl;
    if (response.request?.res?.responseUrl) {
      finalUrl = response.request.res.responseUrl;
    } else if (response.request?.path) {
      // If responseUrl not available, construct from request path
      const protocol = response.request.protocol || 'https:';
      const host = response.request.host || response.request.getHeader('host');
      if (host) {
        finalUrl = `${protocol}//${host}`;
      }
    }
    
    const urlObj = new URL(finalUrl);
    const baseUrl = `${urlObj.protocol}//${urlObj.host}/`;
    
    logger.success(`Resolved latest TamilMV domain: ${baseUrl}`);
    return baseUrl;
  } catch (error) {
    logger.error(`Failed to resolve latest domain from ${resolverUrl}:`, error.message);
    // Fallback to the default domain
    const fallbackUrl = 'https://www.1tamilmv.lc/';
    logger.warn(`Using fallback domain: ${fallbackUrl}`);
    return fallbackUrl;
  }
}

module.exports = {
  resolveLatestDomain
};
