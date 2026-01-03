const fileCache = require('../cache/file-cache');
const logger = require('../utils/logger');
const constants = require('../utils/constants');
const TorboxClient = require('../integrations/torbox-client');
const torboxConfig = require('../utils/torbox-config');
const tokenManager = require('../utils/token-manager');

// Global storage for query parameters (set by Express middleware)
// This is a workaround since Stremio doesn't pass query params to handlers
let globalQueryParams = {};

// Function to set query params (called by Express middleware)
function setQueryParamsForId(id, params) {
  globalQueryParams[id] = params;
}

// Function to get query params for an ID
function getQueryParamsForId(id) {
  return globalQueryParams[id] || null;
}

// Export will be set at the end of the file

/**
 * Handle stream requests for movies and series
 * READ-ONLY from cache - no on-demand scraping
 * If Torbox config is provided, converts magnet links to direct streaming URLs
 */
async function handleStream({ type, id, extra }) {
  try {
    logger.info(`[STREAM] Request received: type=${type}, id=${id}`);
    
    // Validate type
    if (type !== 'movie' && type !== 'series') {
      logger.warn(`Invalid stream type requested: ${type}`);
      return { streams: [] };
    }

    // Load streams from cache
    // For series, the id might be episode-specific (series-id-s1-e1)
    const cachedStreams = await fileCache.getStreams(id);
    
    if (!cachedStreams || !Array.isArray(cachedStreams) || cachedStreams.length === 0) {
      logger.warn(`[STREAM] No streams found in cache for ${type}: ${id}`);
      return { streams: [] };
    }
    
    logger.info(`[STREAM] Found ${cachedStreams.length} streams in cache for ${type}: ${id}`);

    // Extract Torbox API key - only needed when user plays movie
    // Priority: 1. extra parameter, 2. global query params (set by stream route from token)
    let torboxApiKey = extra?.torboxApiKey;
    let torboxApiUrl = extra?.torboxApiUrl || constants.TORBOX_API_URL;
    
    // Check global query params (set by Express middleware from token)
    if (!torboxApiKey) {
      const queryParams = getQueryParamsForId(id);
      if (queryParams) {
        // Query params already contains torboxApiKey (extracted from token by route)
        torboxApiKey = queryParams.torboxApiKey;
        torboxApiUrl = queryParams.torboxApiUrl || constants.TORBOX_API_URL;
        if (torboxApiKey) {
          logger.info(`[STREAM] Got Torbox config from token for ${id}`);
        }
      }
    }
    
    // Clean API key: trim whitespace and remove control characters
    if (torboxApiKey) {
      torboxApiKey = torboxApiKey.trim().replace(/[\r\n\t]/g, '');
    }

    // If no Torbox config, return cached streams as-is (infoHash for desktop)
    if (!torboxApiKey) {
      logger.debug(`No Torbox config, returning ${cachedStreams.length} streams with infoHash`);
      return { streams: cachedStreams };
    }

    // Initialize Torbox client
    const torbox = new TorboxClient(torboxApiKey, torboxApiUrl);
    
    // Convert magnets to streaming URLs
    logger.debug(`Converting ${cachedStreams.length} streams with Torbox`);
    const convertedStreams = await convertStreams(cachedStreams, torbox);
    
    logger.debug(`Returning ${convertedStreams.length} converted streams for ${type}: ${id}`);
    return { streams: convertedStreams };
  } catch (error) {
    logger.error(`Error in stream handler:`, error);
    // Fallback to cached streams on error
    try {
      const cachedStreams = await fileCache.getStreams(id);
      return { streams: cachedStreams || [] };
    } catch (fallbackError) {
      return { streams: [] };
    }
  }
}

/**
 * Convert cached streams (with magnet links) to streaming URLs using Torbox
 * @param {Array} cachedStreams - Array of stream objects with infoHash and externalUrl
 * @param {TorboxClient} torbox - Torbox client instance
 * @returns {Promise<Array>} - Array of stream objects with direct URLs or fallback to infoHash
 */
/**
 * Format stream name with emojis and green checkmark for cached streams
 */
function formatStreamNameWithEmoji(streamName, isCached) {
  // Add quality emojis based on stream name
  let emoji = '🎬'; // Default movie emoji
  
  if (streamName.includes('4K') || streamName.includes('2160p')) {
    emoji = '🎥'; // 4K quality
  } else if (streamName.includes('1080p')) {
    emoji = '📹'; // 1080p quality
  } else if (streamName.includes('720p')) {
    emoji = '📺'; // 720p quality
  } else if (streamName.includes('480p') || streamName.includes('360p')) {
    emoji = '📱'; // Lower quality
  }
  
  // Add green checkmark if cached
  const cachedIndicator = isCached ? '✅ ' : '';
  
  return `${cachedIndicator}${emoji} ${streamName}`;
}

async function convertStreams(cachedStreams, torbox) {
  // Limit to first 5 streams to avoid rate limiting
  // User can still see all streams, but only top 5 will be converted
  const streamsToConvert = cachedStreams.slice(0, 5);
  const remainingStreams = cachedStreams.slice(5);
  
  // Get API key for proxyHeaders (needed for authenticated streaming URLs)
  const apiKey = torbox.apiKey;
  
  // Process all streams in parallel for much faster response time
  const conversionPromises = streamsToConvert.map(async (stream) => {
    try {
      // Get magnet link from externalUrl
      const magnetLink = stream.externalUrl;
      
      if (!magnetLink || !magnetLink.startsWith('magnet:')) {
        // No magnet link, keep original stream
        return { ...stream, isCached: false };
      }

      logger.debug(`Converting magnet to streaming URL: ${magnetLink.substring(0, 50)}...`);
      
      // Convert magnet to streaming URL (this also checks cache status)
      const result = await torbox.convertMagnetToStreamingUrl(magnetLink);
      const { streamingUrl, isCached } = result || { streamingUrl: null, isCached: false };
      
      // Format stream name with emojis and green checkmark
      const streamName = formatStreamNameWithEmoji(stream.name, isCached);
      
      if (streamingUrl) {
        // Check if URL is a direct video file (MP4, MKV, etc.) or a streaming endpoint
        const isDirectVideoFile = streamingUrl.match(/\.(mp4|mkv|avi|webm|m3u8)(\?|$)/i);
        const isStreamingEndpoint = streamingUrl.includes('/stream/') || 
                                    streamingUrl.includes('/play/') ||
                                    streamingUrl.includes('/video/') ||
                                    streamingUrl.includes('api.torbox.app');
        
        // For Torbox streaming endpoints, we need to use proxyHeaders with authentication
        // According to Stremio SDK: when using proxyHeaders, notWebReady must be true
        if (isStreamingEndpoint && !isDirectVideoFile) {
          // This is a streaming endpoint that likely needs authentication
          // Use proxyHeaders to pass the Bearer token
          logger.debug(`Successfully converted to streaming URL with auth headers: ${streamingUrl.substring(0, 50)}...`);
          return {
            name: streamName,
            url: streamingUrl,
            isCached,
            behaviorHints: {
              notWebReady: true, // Required when using proxyHeaders
              bingeGroup: stream.behaviorHints?.bingeGroup,
              proxyHeaders: {
                request: {
                  'Authorization': `Bearer ${apiKey || ''}`
                }
              }
            }
          };
        } else if (isDirectVideoFile) {
          // Direct video file - web ready
          logger.debug(`Successfully converted to direct video URL: ${streamingUrl.substring(0, 50)}...`);
          return {
            name: streamName,
            url: streamingUrl,
            isCached,
            behaviorHints: {
              notWebReady: false, // Direct MP4 over HTTPS
              bingeGroup: stream.behaviorHints?.bingeGroup
            }
          };
        } else {
          // Unknown format - assume not web ready
          logger.debug(`Successfully converted to streaming URL (unknown format): ${streamingUrl.substring(0, 50)}...`);
          return {
            name: streamName,
            url: streamingUrl,
            isCached,
            behaviorHints: {
              notWebReady: true,
              bingeGroup: stream.behaviorHints?.bingeGroup
            }
          };
        }
      } else {
        // Failed: fallback to infoHash (desktop only)
        logger.warn(`Failed to convert magnet, falling back to infoHash`);
        return {
          name: streamName,
          infoHash: stream.infoHash,
          externalUrl: magnetLink,
          isCached,
          behaviorHints: stream.behaviorHints
        };
      }
    } catch (error) {
      // Error converting: fallback to infoHash
      logger.error(`Error converting stream:`, error.message);
      return {
        name: formatStreamNameWithEmoji(stream.name, false),
        infoHash: stream.infoHash,
        externalUrl: stream.externalUrl,
        isCached: false,
        behaviorHints: stream.behaviorHints
      };
    }
  });
  
  // Wait for all conversions in parallel
  const convertedResults = await Promise.allSettled(conversionPromises);
  const convertedStreams = convertedResults.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      // If promise failed, return original stream with formatted name
      const stream = streamsToConvert[index];
      logger.error(`Stream conversion failed:`, result.reason);
      return {
        name: formatStreamNameWithEmoji(stream.name, false),
        infoHash: stream.infoHash,
        externalUrl: stream.externalUrl,
        isCached: false,
        behaviorHints: stream.behaviorHints
      };
    }
  });
  
  // Check cache status for remaining streams in parallel (but don't convert)
  const cacheCheckPromises = remainingStreams.map(async (stream) => {
    let streamName = stream.name;
    let isCached = false;
    
    // Check if cached (quick check without conversion)
    if (stream.externalUrl && stream.externalUrl.startsWith('magnet:')) {
      try {
        const cached = await torbox.checkCached(stream.externalUrl);
        isCached = cached && (
          cached.cached || 
          cached.data?.cached ||
          (cached.data && Object.keys(cached.data).length > 0 && cached.data.torrent_id) ||
          (cached.detail && cached.detail.includes('cached'))
        );
      } catch (error) {
        // Ignore cache check errors for non-converted streams
        logger.debug(`Cache check failed for remaining stream: ${error.message}`);
      }
    }
    
    return {
      ...stream,
      name: formatStreamNameWithEmoji(streamName, isCached),
      isCached
    };
  });
  
  // Wait for all cache checks in parallel
  const remainingResults = await Promise.allSettled(cacheCheckPromises);
  const remainingConverted = remainingResults.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      // If cache check failed, return original stream
      const stream = remainingStreams[index];
      return {
        ...stream,
        name: formatStreamNameWithEmoji(stream.name, false),
        isCached: false
      };
    }
  });
  
  // Combine all streams
  const allStreams = [...convertedStreams, ...remainingConverted];
  
  // Sort streams: cached first, then non-cached
  allStreams.sort((a, b) => {
    const aCached = a.isCached ? 1 : 0;
    const bCached = b.isCached ? 1 : 0;
    return bCached - aCached; // Cached first (1 - 0 = 1, 0 - 1 = -1)
  });
  
  // Remove isCached property before returning (not part of Stremio stream format)
  return allStreams.map(({ isCached, ...stream }) => stream);
}

// Export handler as default, and utility functions as properties
module.exports = handleStream;
module.exports.setQueryParams = setQueryParamsForId;
module.exports.getQueryParams = getQueryParamsForId;

