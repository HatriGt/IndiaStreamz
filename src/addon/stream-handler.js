const fileCache = require('../cache/file-cache');
const logger = require('../utils/logger');
const constants = require('../utils/constants');
const TorboxClient = require('../integrations/torbox-client');
const torboxConfig = require('../utils/torbox-config');
const tokenManager = require('../utils/token-manager');
const { encodeMagnet } = require('../utils/magnet-encoder');

/**
 * Handle stream requests for movies and series
 * READ-ONLY from cache - no on-demand scraping
 * If Torbox config is provided, converts magnet links to direct streaming URLs
 *
 * TorBox config is read strictly from `extra` (passed per-request by the token
 * route). No shared module-level state is used, so concurrent users cannot leak
 * each other's API keys.
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

    // Extract Torbox config - passed per-request via `extra` by the token route.
    // Only needed when the user plays a movie.
    let torboxApiKey = extra?.torboxApiKey;
    let torboxApiUrl = extra?.torboxApiUrl || constants.TORBOX_API_URL;
    let token = extra?.token;

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
    
    // Get base URL for proxy URLs (if available from extra)
    const baseUrl = extra?.baseUrl || 'http://localhost:3005';
    
    // Get encrypted token part from extra (passed from server route)
    const encrypted = extra?.encrypted;
    
    // Convert magnets to streaming URLs (check-only mode)
    logger.debug(`Checking cache status for ${cachedStreams.length} streams with Torbox`);
    const convertedStreams = await convertStreams(cachedStreams, torbox, token, encrypted, baseUrl);
    
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
 * Generate proxy URL for non-cached torrents
 * @param {string} magnetLink - The magnet link to encode
 * @param {string} token - The user's token
 * @param {string} encrypted - The encrypted token part from URL
 * @param {string} baseUrl - The base URL of the server
 * @returns {string} - The proxy URL
 */
function generateProxyUrl(magnetLink, token, encrypted, baseUrl) {
  try {
    const encodedMagnet = encodeMagnet(magnetLink);
    // Use the encrypted part from the URL path
    // Format: /stremio/:token/:encrypted/proxy/:magnetHash
    return `${baseUrl}/stremio/${token}/${encrypted}/proxy/${encodedMagnet}`;
  } catch (error) {
    logger.error(`[STREAM] Failed to generate proxy URL: ${error.message}`);
    return null;
  }
}

/**
 * Format stream name (header) - only quality and cache tick
 * streamName is now just the quality (e.g., "2160p", "1080p")
 */
function formatStreamNameWithEmoji(streamName, isCached) {
  // streamName is now just the quality (e.g., "2160p", "1080p")
  const cachedIndicator = isCached ? '✅ ' : '';
  return `${cachedIndicator}${streamName}`;
}

function sanitizeMagnet(magnet) {
  if (typeof magnet !== 'string') return magnet;
  return magnet
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&apos;/gi, "'");
}

/**
 * Look up a magnet's cache status using pre-computed signals:
 *  - infraCacheMap: infoHash -> cached bool (from ONE batch checkcached call)
 *  - torrentsByHash: infoHash -> torrent object (from the single mylist call)
 * Returns the same shape as the old per-stream `checkCached`, but with ZERO
 * additional network calls.
 */
function resolveCacheStatus(torbox, magnetLink, infraCacheMap, torrentsByHash) {
  const infoHash = torbox.extractInfoHash(magnetLink);
  if (!infoHash) return null;

  const torrent = torrentsByHash.get(infoHash) || null;
  const infraCached = infraCacheMap.get(infoHash) === true;

  // mylist-based cache signal (mirrors old checkCached logic)
  let mylistCached = false;
  if (torrent) {
    const hasStreamUrl = !!(torrent.hls_url || torrent.stream_url);
    const status = (torrent.status || torrent.state || '').toLowerCase();
    const isCompleted = status === 'completed' || status === 'ready' || status === 'cached' || status === 'downloaded';
    mylistCached = torrent.is_cached === true ||
                   torrent.is_cached === 1 ||
                   torrent.cached === true ||
                   torrent.cached === 1 ||
                   (hasStreamUrl && isCompleted);
  }

  const cached = infraCached || mylistCached;

  return {
    cached,
    data: torrent ? {
      torrent_id: torrent.torrent_id || torrent.id,
      hash: torrent.hash || torrent.info_hash || torrent.infoHash || infoHash,
      is_cached: torrent.is_cached,
      cached: torrent.cached,
      status: torrent.status || torrent.state,
      hls_url: torrent.hls_url,
      stream_url: torrent.stream_url
    } : { hash: infoHash, is_cached: infraCached, cached: infraCached }
  };
}

async function convertStreams(cachedStreams, torbox, token, encrypted, baseUrl) {
  // Defensive: fix HTML-escaped magnets (&amp;) in cached data so stremio-core
  // does not silently drop streams with malformed externalUrl magnet URIs.
  cachedStreams = cachedStreams.map((s) =>
    s && s.externalUrl ? { ...s, externalUrl: sanitizeMagnet(s.externalUrl) } : s
  );

  // Limit to first 5 streams to avoid rate limiting
  // User can still see all streams, but only top 5 will be converted
  const streamsToConvert = cachedStreams.slice(0, 5);
  const remainingStreams = cachedStreams.slice(5);
  
  // Get API key for proxyHeaders (needed for authenticated streaming URLs)
  const apiKey = torbox.apiKey;
  
  // Fetch mylist FIRST before processing streams (needed for cache checking)
  let myTorrents = null;
  try {
    myTorrents = await torbox.getMyTorrents();
    logger.debug(`Fetched ${myTorrents.length} torrents from mylist for cache checking`);
  } catch (error) {
    logger.debug(`Failed to fetch mylist, will check individually: ${error.message}`);
  }

  // Index mylist by infoHash once (O(1) lookups instead of scanning per stream).
  const torrentsByHash = new Map();
  for (const t of (myTorrents || [])) {
    const h = (t.hash || t.info_hash || t.infoHash || '').toLowerCase();
    if (h) torrentsByHash.set(h, t);
  }

  // ONE batch infrastructure cache-status call for ALL magnets, instead of a
  // separate network round-trip per stream. Results are TTL-memoized in the
  // client, so repeat stream requests hit zero network.
  const allMagnets = cachedStreams
    .map((s) => s.externalUrl)
    .filter((m) => typeof m === 'string' && m.startsWith('magnet:'));
  let infraCacheMap = new Map();
  try {
    infraCacheMap = await torbox.checkCachedBatch(allMagnets);
  } catch (error) {
    logger.debug(`Batch cache check failed, streams will show as not-cached: ${error.message}`);
  }
  
  // Process all streams in parallel - ONLY CHECK CACHE STATUS, DON'T ADD TORRENTS
  const conversionPromises = streamsToConvert.map(async (stream) => {
    try {
      // Get magnet link from externalUrl
      const magnetLink = stream.externalUrl;
      
      if (!magnetLink || !magnetLink.startsWith('magnet:')) {
        // No magnet link, keep original stream
        return { ...stream, isCached: false };
      }

      // Resolve cache status from pre-fetched batch + mylist (no network call)
      const cached = resolveCacheStatus(torbox, magnetLink, infraCacheMap, torrentsByHash);
      const isCached = cached && cached.cached === true;
      
      // Format stream name with emojis and green checkmark
      const streamName = formatStreamNameWithEmoji(stream.name, isCached);
      
      // If torrent is cached (infrastructure or mylist), check if we have immediate streaming URL
      // IMPORTANT: Don't call getStreamingUrl() here - that will be done in proxy route when user plays
      let streamingUrl = null;
      if (cached && cached.cached && cached.data) {
        // Only use streaming URL if it's already in the mylist response (no API call needed)
        // Don't call getStreamingUrl() here - that will be done in proxy route when user plays
        if (cached.data.hls_url || cached.data.stream_url) {
          streamingUrl = cached.data.hls_url || cached.data.stream_url;
          logger.debug(`Found cached torrent with streaming URL in mylist: ${streamingUrl.substring(0, 50)}...`);
        } else {
          // Torrent is cached but no URL in mylist response
          // Return proxy URL - it will get the streaming URL when user plays
          logger.debug(`Torrent cached but no URL in mylist, will use proxy URL to get streaming URL on play`);
        }
      }
      
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
            description: stream.description, // Preserve description
            url: streamingUrl,
            isCached,
            behaviorHints: {
              ...(stream.behaviorHints || {}),
              notWebReady: true, // Required when using proxyHeaders
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
            description: stream.description, // Preserve description
            url: streamingUrl,
            isCached,
            behaviorHints: {
              ...(stream.behaviorHints || {}),
              notWebReady: false // Direct MP4 over HTTPS
            }
          };
        } else {
          // Unknown format - assume not web ready
          logger.debug(`Successfully converted to streaming URL (unknown format): ${streamingUrl.substring(0, 50)}...`);
          return {
            name: streamName,
            description: stream.description, // Preserve description
            url: streamingUrl,
            isCached,
            behaviorHints: {
              ...(stream.behaviorHints || {}),
              notWebReady: true
            }
          };
        }
      } else {
        // Not in mylist or not cached - return proxy URL (will add to Torbox when user plays)
        logger.debug(`Torrent not cached, generating proxy URL (will add to Torbox when user plays)`);
        const proxyUrl = token && encrypted && baseUrl ? generateProxyUrl(magnetLink, token, encrypted, baseUrl) : null;
        
        return {
          name: streamName,
          description: stream.description, // Preserve description
          url: proxyUrl || undefined, // Use proxy URL if available
          infoHash: stream.infoHash, // Keep infoHash as fallback for desktop Stremio
          externalUrl: magnetLink,
          isCached,
          behaviorHints: stream.behaviorHints
        };
      }
    } catch (error) {
      // Error checking cache: fallback to infoHash
      logger.error(`Error checking cache for stream:`, error.message);
      return {
        name: formatStreamNameWithEmoji(stream.name, false),
        description: stream.description, // Preserve description
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
        description: stream.description, // Preserve description
        infoHash: stream.infoHash,
        externalUrl: stream.externalUrl,
        isCached: false,
        behaviorHints: stream.behaviorHints
      };
    }
  });
  
  // Cache status for remaining streams: resolved synchronously from the batch
  // + mylist signals already gathered above (no per-stream network calls).
  const remainingConverted = remainingStreams.map((stream) => {
    let isCached = false;
    if (stream.externalUrl && stream.externalUrl.startsWith('magnet:')) {
      const cached = resolveCacheStatus(torbox, stream.externalUrl, infraCacheMap, torrentsByHash);
      isCached = !!(cached && (
        cached.cached === true ||
        cached.data?.is_cached === true ||
        cached.data?.is_cached === 1 ||
        cached.data?.cached === true
      ));
    }
    return {
      ...stream,
      name: formatStreamNameWithEmoji(stream.name, isCached),
      isCached
    };
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

module.exports = handleStream;

