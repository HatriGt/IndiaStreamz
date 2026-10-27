const fileCache = require('../cache/file-cache');
const logger = require('../utils/logger');
const constants = require('../utils/constants');
const TorboxClient = require('../integrations/torbox-client');
const torboxConfig = require('../utils/torbox-config');
const tokenManager = require('../utils/token-manager');
const { encodeMagnet } = require('../utils/magnet-encoder');
const imdbIndex = require('../cache/imdb-index');

/**
 * Load cached streams for a request id. IMDb ids (`tt123` / `tt123:S:E`) are
 * resolved through the catalog index and may map to several internal titles
 * (e.g. separate language releases); their streams are merged by infoHash.
 */
async function loadCachedStreams(type, id) {
  const ids = /^tt\d+/.test(id) ? await imdbIndex.resolveStreamIds(type, id) : [id];
  const lists = await Promise.all(ids.map((cid) => fileCache.getStreams(cid)));
  const seen = new Set();
  const merged = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const stream of list) {
      const key = stream && (stream.infoHash || stream.externalUrl);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      merged.push(stream);
    }
  }
  return merged;
}

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
  let cachedStreams = [];
  try {
    logger.debug(`[STREAM] Request received: type=${type}, id=${id}`);
    
    // Validate type
    if (type !== 'movie' && type !== 'series') {
      logger.warn(`Invalid stream type requested: ${type}`);
      return { streams: [] };
    }

    // For series, the id is episode-specific (<id>:<season>:<episode>)
    cachedStreams = await loadCachedStreams(type, id);
    
    if (cachedStreams.length === 0) {
      logger.debug(`[STREAM] No streams found in cache for ${type}: ${id}`);
      return { streams: [] };
    }

    // Extract Torbox config - passed per-request via `extra` by the token route.
    let torboxApiKey = extra?.torboxApiKey;
    let torboxApiUrl = extra?.torboxApiUrl || constants.TORBOX_API_URL;
    let token = extra?.token;

    // Clean API key: trim whitespace and remove control characters
    if (torboxApiKey) {
      torboxApiKey = torboxApiKey.trim().replace(/[\r\n\t]/g, '');
    }

    // No Torbox config: plain torrent streams for the client's own engine
    if (!torboxApiKey) {
      return { streams: sortStreams(cachedStreams).map(toTorrentStream) };
    }

    const torbox = new TorboxClient(torboxApiKey, torboxApiUrl);
    const baseUrl = extra?.baseUrl || 'http://localhost:3005';
    const encrypted = extra?.encrypted;
    
    const convertedStreams = await convertStreams(cachedStreams, torbox, token, encrypted, baseUrl);
    return { streams: convertedStreams };
  } catch (error) {
    logger.error(`Error in stream handler:`, error);
    return { streams: sortStreams(cachedStreams).map(toTorrentStream) };
  }
}

/**
 * Parse trackers out of a magnet link into Stremio `sources` entries.
 */
function magnetSources(magnet, infoHash) {
  const sources = [];
  if (typeof magnet === 'string') {
    const query = magnet.split('?')[1] || '';
    for (const part of query.split('&')) {
      const [key, value] = part.split('=');
      if (key === 'tr' && value) {
        try {
          sources.push(`tracker:${decodeURIComponent(value)}`);
        } catch {
          // skip malformed tracker
        }
      }
    }
  }
  if (infoHash) sources.push(`dht:${infoHash}`);
  return sources;
}

/**
 * Plain torrent stream: exactly one playable source (infoHash). Clients that
 * see both infoHash and externalUrl may open the magnet externally instead of
 * playing it, so externalUrl is only kept when there is no infoHash.
 */
function toTorrentStream(stream) {
  if (!stream || !stream.infoHash) return stream;
  const { externalUrl, isCached, ...rest } = stream;
  const sources = magnetSources(sanitizeMagnet(externalUrl), stream.infoHash);
  return sources.length > 0 ? { ...rest, sources } : rest;
}

/**
 * Numeric resolution from a stream name ("✅ 2160p", "S1E2 - 4K", ...).
 */
function qualityRank(name) {
  const text = String(name || '');
  if (/\b(4k|2160p|uhd)\b/i.test(text)) return 2160;
  const match = text.match(/(\d{3,4})p/i);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Cached streams first, then highest resolution first.
 */
function sortStreams(streams) {
  return [...streams].sort((a, b) =>
    ((b.isCached ? 1 : 0) - (a.isCached ? 1 : 0)) ||
    (qualityRank(b.name) - qualityRank(a.name))
  );
}

/**
 * Resolve a promise, or the fallback once `ms` elapses, so a slow TorBox API
 * never holds the stream list hostage.
 */
function withTimeout(promise, ms, fallback) {
  let timer;
  return Promise.race([
    promise.catch(() => fallback),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    })
  ]).finally(() => clearTimeout(timer));
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

  // Get API key for proxyHeaders (needed for authenticated streaming URLs)
  const apiKey = torbox.apiKey;

  // mylist and the batch infrastructure cache check are independent: run them
  // together, each capped by the stream time budget. Both are TTL-memoized in
  // the client, so repeat requests hit no network at all.
  const allMagnets = cachedStreams
    .map((s) => s.externalUrl)
    .filter((m) => typeof m === 'string' && m.startsWith('magnet:'));
  const budget = constants.STREAM_TORBOX_BUDGET_MS;
  const [myTorrents, infraCacheMap] = await Promise.all([
    withTimeout(torbox.getMyTorrents(), budget, null),
    withTimeout(torbox.checkCachedBatch(allMagnets), budget, new Map())
  ]);

  // Index mylist by infoHash once (O(1) lookups instead of scanning per stream).
  const torrentsByHash = new Map();
  for (const t of (myTorrents || [])) {
    const h = (t.hash || t.info_hash || t.infoHash || '').toLowerCase();
    if (h) torrentsByHash.set(h, t);
  }

  // Process all streams in parallel - ONLY CHECK CACHE STATUS, DON'T ADD TORRENTS
  const conversionPromises = cachedStreams.map(async (stream) => {
    try {
      // Get magnet link from externalUrl
      const magnetLink = stream.externalUrl;
      
      if (!magnetLink || !magnetLink.startsWith('magnet:')) {
        // No magnet link, keep original stream
        return { ...toTorrentStream(stream), isCached: false };
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
        // No ready URL yet: the proxy resolves it on play (adding the torrent
        // to TorBox when it isn't cached). Without a proxy URL fall back to a
        // plain torrent stream.
        const proxyUrl = token && encrypted && baseUrl ? generateProxyUrl(magnetLink, token, encrypted, baseUrl) : null;
        if (!proxyUrl) {
          return { ...toTorrentStream({ ...stream, name: streamName }), isCached };
        }
        const notCachedNote = 'Not cached on TorBox - starts downloading on play';
        return {
          name: isCached ? streamName : `⏳ ${streamName}`,
          description: isCached
            ? stream.description
            : (stream.description ? `${stream.description}\n${notCachedNote}` : notCachedNote),
          url: proxyUrl,
          isCached,
          behaviorHints: { ...(stream.behaviorHints || {}), notWebReady: true }
        };
      }
    } catch (error) {
      // Error checking cache: fall back to a plain torrent stream
      logger.error(`Error checking cache for stream:`, error.message);
      return { ...toTorrentStream(stream), name: formatStreamNameWithEmoji(stream.name, false), isCached: false };
    }
  });
  
  // Wait for all conversions in parallel
  const convertedResults = await Promise.allSettled(conversionPromises);
  const convertedStreams = convertedResults.map((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    logger.error(`Stream conversion failed:`, result.reason);
    return { ...toTorrentStream(cachedStreams[index]), isCached: false };
  });

  // isCached is internal only (not part of the Stremio stream format)
  return sortStreams(convertedStreams).map(({ isCached, ...stream }) => stream);
}

module.exports = handleStream;
module.exports.qualityRank = qualityRank;
module.exports.toTorrentStream = toTorrentStream;

