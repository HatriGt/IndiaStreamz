const logger = require('../utils/logger');
const constants = require('../utils/constants');
const TorboxClient = require('../integrations/torbox-client');
const tokenManager = require('../utils/token-manager');
const { decodeMagnet } = require('../utils/magnet-encoder');

// Cache streaming URLs by torrent_id to avoid regenerating them
// This prevents position loss when seeking
const streamingUrlCache = new Map(); // Map<torrentId, { url: string, timestamp: number, source: 'mylist' | 'createstream' }>

// Different TTLs based on URL source:
// - mylist URLs are more stable (from user's account) - 3 days
// - createstream URLs have tokens that may expire - 24 hours
const CACHE_TTL_MYLIST = 259200000; // 3 days (3 * 24 * 60 * 60 * 1000 ms)
const CACHE_TTL_CREATESTREAM = 86400000; // 24 hours (24 * 60 * 60 * 1000 ms)

/**
 * Get cached streaming URL or null if not cached/expired
 */
function getCachedStreamingUrl(torrentId) {
  const cached = streamingUrlCache.get(torrentId);
  if (cached) {
    const ttl = cached.source === 'mylist' ? CACHE_TTL_MYLIST : CACHE_TTL_CREATESTREAM;
    if ((Date.now() - cached.timestamp) < ttl) {
      logger.debug(`[PROXY] Using cached streaming URL for torrent_id: ${torrentId} (source: ${cached.source})`);
      return cached.url;
    } else {
      streamingUrlCache.delete(torrentId); // Remove expired entry
      logger.debug(`[PROXY] Cached streaming URL expired for torrent_id: ${torrentId}`);
    }
  }
  return null;
}

/**
 * Cache a streaming URL for a torrent_id
 */
function cacheStreamingUrl(torrentId, url, source = 'createstream') {
  streamingUrlCache.set(torrentId, {
    url: url,
    timestamp: Date.now(),
    source: source // 'mylist' or 'createstream'
  });
  logger.debug(`[PROXY] Cached streaming URL for torrent_id: ${torrentId} (source: ${source})`);
}

/**
 * Proxy stream route handler
 * Handles requests to add non-cached torrents to Torbox and redirect to streaming URL
 * Route: /stremio/:token/:encrypted/proxy/:magnetHash
 */
async function proxyStreamHandler(req, res) {
  const { token, magnetHash } = req.params;
  const startTime = Date.now();
  
  try {
    logger.info(`[PROXY] Request received: token=${token.substring(0, 8)}..., magnetHash=${magnetHash.substring(0, 16)}...`);
    
    // Validate token
    const config = tokenManager.getConfigForToken(token);
    if (!config || !config.torboxApiKey) {
      logger.warn(`[PROXY] Invalid token: ${token.substring(0, 8)}...`);
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    // Decode magnet link
    let magnetLink;
    try {
      magnetLink = decodeMagnet(magnetHash);
      if (!magnetLink || !magnetLink.startsWith('magnet:')) {
        throw new Error('Invalid magnet link format');
      }
      logger.debug(`[PROXY] Decoded magnet link: ${magnetLink.substring(0, 50)}...`);
    } catch (error) {
      logger.error(`[PROXY] Failed to decode magnet: ${error.message}`);
      return res.status(400).json({ error: 'Invalid magnet hash' });
    }
    
    // Initialize Torbox client
    const torbox = new TorboxClient(config.torboxApiKey, config.torboxApiUrl || constants.TORBOX_API_URL);
    
    // Check if torrent is already in mylist (avoid duplicate adds)
    const infoHash = torbox.extractInfoHash(magnetLink);
    let myTorrents = null;
    let existingTorrent = null;
    
    try {
      myTorrents = await torbox.getMyTorrents();
      if (infoHash) {
        existingTorrent = myTorrents.find(t => {
          const torrentHash = (t.hash || t.info_hash || t.infoHash || '').toLowerCase();
          return torrentHash === infoHash.toLowerCase();
        });
        
        if (existingTorrent) {
          logger.debug(`[PROXY] Torrent already in mylist (hash: ${infoHash.substring(0, 8)}...)`);
          
          // Check if it has streaming URL directly in mylist response (most stable - prefer this!)
          if (existingTorrent.hls_url || existingTorrent.stream_url) {
            const streamingUrl = existingTorrent.hls_url || existingTorrent.stream_url;
            logger.info(`[PROXY] Found existing torrent with streaming URL, redirecting: ${streamingUrl.substring(0, 50)}...`);
            const duration = Date.now() - startTime;
            logger.info(`[PROXY] Request completed in ${duration}ms (cached, from mylist)`);
            
            // Cache the URL for future requests (mylist URLs are more stable)
            const torrentId = existingTorrent.torrent_id || existingTorrent.id;
            if (torrentId) {
              cacheStreamingUrl(torrentId, streamingUrl, 'mylist');
            }
            
            return res.redirect(302, streamingUrl);
          }
          
          // Get streaming URL using torrent_id
          const torrentId = existingTorrent.torrent_id || existingTorrent.id;
          if (torrentId) {
            // Check cache ONLY if mylist doesn't have URL
            // But prefer to check mylist again in case URL was added
            const cachedUrl = getCachedStreamingUrl(torrentId);
            
            // If we have a cached URL, but it's from createstream, try mylist one more time
            // This ensures we use the most stable URL
            if (cachedUrl) {
              const cached = streamingUrlCache.get(torrentId);
              // If cached URL is from createstream, check mylist again (might have URL now)
              if (cached && cached.source === 'createstream') {
                logger.debug(`[PROXY] Cached URL is from createstream, checking mylist for more stable URL...`);
                // Re-fetch mylist to see if URL is now available
                try {
                  const freshTorrents = await torbox.getMyTorrents();
                  const freshTorrent = freshTorrents.find(t => {
                    const tId = t.torrent_id || t.id;
                    return tId == torrentId || String(tId) === String(torrentId);
                  });
                  
                  if (freshTorrent && (freshTorrent.hls_url || freshTorrent.stream_url)) {
                    const stableUrl = freshTorrent.hls_url || freshTorrent.stream_url;
                    logger.info(`[PROXY] Found stable URL in mylist, using instead of cached createstream URL`);
                    cacheStreamingUrl(torrentId, stableUrl, 'mylist');
                    const duration = Date.now() - startTime;
                    logger.info(`[PROXY] Request completed in ${duration}ms (cached, from mylist - upgraded)`);
                    return res.redirect(302, stableUrl);
                  }
                } catch (error) {
                  logger.debug(`[PROXY] Error re-checking mylist: ${error.message}`);
                }
              }
              
              // Use cached URL if mylist doesn't have one
              logger.info(`[PROXY] Using cached streaming URL for existing torrent, redirecting: ${cachedUrl.substring(0, 50)}...`);
              const duration = Date.now() - startTime;
              logger.info(`[PROXY] Request completed in ${duration}ms (cached, from cache)`);
              return res.redirect(302, cachedUrl);
            }
            
            logger.debug(`[PROXY] Getting streaming URL for existing torrent_id: ${torrentId}`);
            const streamingUrl = await torbox.getStreamingUrl(torrentId);
            if (streamingUrl) {
              // Cache the URL to prevent regenerating it on subsequent requests
              // Note: This is from createstream, so shorter TTL
              cacheStreamingUrl(torrentId, streamingUrl, 'createstream');
              
              logger.info(`[PROXY] Got streaming URL for existing torrent, redirecting: ${streamingUrl.substring(0, 50)}...`);
              const duration = Date.now() - startTime;
              logger.info(`[PROXY] Request completed in ${duration}ms (cached, from getStreamingUrl)`);
              return res.redirect(302, streamingUrl);
            }
          }
          
          // If torrent exists but no URL, it might still be processing
          logger.debug(`[PROXY] Torrent in mylist but no streaming URL yet, will add to trigger processing`);
        }
      }
    } catch (error) {
      logger.debug(`[PROXY] Failed to check mylist, will add torrent: ${error.message}`);
    }
    
    // Torrent not in mylist or couldn't get URL - add it
    logger.debug(`[PROXY] Adding magnet to Torbox: ${magnetLink.substring(0, 50)}...`);
    const addResult = await torbox.addMagnet(magnetLink);
    
    if (!addResult) {
      logger.error(`[PROXY] Failed to add magnet to Torbox`);
      return res.status(500).json({ error: 'Failed to add torrent to Torbox' });
    }
    
    // Extract torrent_id from response
    const torrentId = addResult.data?.torrent_id || addResult.data?.id || addResult.data?.hash || 
                      addResult.torrent_id || addResult.id || addResult.hash;
    
    if (!torrentId) {
      logger.error(`[PROXY] No torrent ID in add response:`, addResult);
      return res.status(500).json({ error: 'Failed to get torrent ID from Torbox' });
    }
    
    logger.debug(`[PROXY] Extracted torrent_id: ${torrentId}`);
    
    // Check cache first to avoid regenerating stream session
    // But if cached URL is from createstream, check mylist for more stable URL
    const cachedUrl = getCachedStreamingUrl(torrentId);
    if (cachedUrl) {
      const cached = streamingUrlCache.get(torrentId);
      // If cached URL is from createstream, check mylist for more stable URL
      if (cached && cached.source === 'createstream') {
        logger.debug(`[PROXY] Cached URL is from createstream, checking mylist for more stable URL...`);
        try {
          const freshTorrents = await torbox.getMyTorrents();
          if (infoHash) {
            const freshTorrent = freshTorrents.find(t => {
              const torrentHash = (t.hash || t.info_hash || t.infoHash || '').toLowerCase();
              return torrentHash === infoHash.toLowerCase();
            });
            
            if (freshTorrent && (freshTorrent.hls_url || freshTorrent.stream_url)) {
              const stableUrl = freshTorrent.hls_url || freshTorrent.stream_url;
              logger.info(`[PROXY] Found stable URL in mylist, using instead of cached createstream URL`);
              cacheStreamingUrl(torrentId, stableUrl, 'mylist');
              const duration = Date.now() - startTime;
              logger.info(`[PROXY] Request completed in ${duration}ms (cached, from mylist - upgraded)`);
              return res.redirect(302, stableUrl);
            }
          }
        } catch (error) {
          logger.debug(`[PROXY] Error re-checking mylist: ${error.message}`);
        }
      }
      
      logger.info(`[PROXY] Using cached streaming URL for torrent ${torrentId}, redirecting: ${cachedUrl.substring(0, 50)}...`);
      const duration = Date.now() - startTime;
      logger.info(`[PROXY] Request completed in ${duration}ms (cached)`);
      return res.redirect(302, cachedUrl);
    }
    
    // Check if it's already cached (from addMagnet response detail)
    const isCached = addResult.detail && (
      addResult.detail.includes('Found Cached Torrent') || 
      addResult.detail.includes('Cached Torrent') ||
      addResult.detail.includes('Using Cached')
    );
    
    if (isCached) {
      // Cached torrents are ready immediately - get URL right away
      logger.debug(`[PROXY] Torrent ${torrentId} is cached, getting streaming URL immediately`);
      
      // Try to get URL from addResult first (sometimes it's already there)
      if (addResult.data?.url || addResult.data?.stream_url || addResult.data?.hls_url || 
          addResult.url || addResult.stream_url || addResult.hls_url) {
        const url = addResult.data?.url || addResult.data?.stream_url || addResult.data?.hls_url || 
                   addResult.url || addResult.stream_url || addResult.hls_url;
        logger.info(`[PROXY] Got streaming URL from addMagnet response, redirecting: ${url.substring(0, 50)}...`);
        const duration = Date.now() - startTime;
        logger.info(`[PROXY] Request completed in ${duration}ms (cached)`);
        
        // Cache the URL (from addResult, likely from mylist)
        cacheStreamingUrl(torrentId, url, 'mylist');
        
        return res.redirect(302, url);
      }
      
      // For cached torrents, try getStreamingUrl directly (it will use createstream which works)
      // Cached torrents should be ready immediately, so no need to wait
      const streamingUrl = await torbox.getStreamingUrl(torrentId);
      if (streamingUrl) {
        // Cache the URL to prevent regenerating it (from createstream, shorter TTL)
        cacheStreamingUrl(torrentId, streamingUrl, 'createstream');
        
        logger.info(`[PROXY] Got streaming URL for cached torrent, redirecting: ${streamingUrl.substring(0, 50)}...`);
        const duration = Date.now() - startTime;
        logger.info(`[PROXY] Request completed in ${duration}ms (cached)`);
        return res.redirect(302, streamingUrl);
      }
      
      // If still no URL, check mylist one more time (might have been added to account)
      logger.debug(`[PROXY] Cached torrent but no URL yet, checking mylist again...`);
      try {
        const updatedTorrents = await torbox.getMyTorrents();
        if (infoHash) {
          const torrent = updatedTorrents.find(t => {
            const torrentHash = (t.hash || t.info_hash || t.infoHash || '').toLowerCase();
            return torrentHash === infoHash.toLowerCase();
          });
          
          if (torrent && (torrent.hls_url || torrent.stream_url)) {
            const url = torrent.hls_url || torrent.stream_url;
            logger.info(`[PROXY] Found streaming URL in mylist for cached torrent, redirecting: ${url.substring(0, 50)}...`);
            const duration = Date.now() - startTime;
            logger.info(`[PROXY] Request completed in ${duration}ms (cached)`);
            
            // Cache the URL (from mylist, longer TTL)
            cacheStreamingUrl(torrentId, url, 'mylist');
            
            return res.redirect(302, url);
          }
        }
      } catch (error) {
        logger.debug(`[PROXY] Error checking mylist: ${error.message}`);
      }
      
      // Last resort: try createstream directly (bypass getStreamingUrl fallbacks)
      logger.debug(`[PROXY] Trying createstream directly for cached torrent...`);
      try {
        const streamResponse = await torbox.client.get('/api/stream/createstream', {
          params: {
            id: torrentId,
            file_id: 0,
            type: 'torrent'
          }
        });
        
        if (streamResponse.data && streamResponse.data.data && streamResponse.data.data.hls_url) {
          const url = streamResponse.data.data.hls_url;
          logger.info(`[PROXY] Got streaming URL via direct createstream, redirecting: ${url.substring(0, 50)}...`);
          const duration = Date.now() - startTime;
          logger.info(`[PROXY] Request completed in ${duration}ms (cached)`);
          
          // Cache the URL (from createstream, shorter TTL)
          cacheStreamingUrl(torrentId, url, 'createstream');
          
          return res.redirect(302, url);
        }
      } catch (error) {
        logger.debug(`[PROXY] Direct createstream also failed: ${error.message}`);
      }
      
      logger.warn(`[PROXY] Cached torrent but couldn't get streaming URL after all attempts`);
      return res.status(500).json({ error: 'Failed to get streaming URL for cached torrent' });
    }
    
    // Not cached - wait for it to be ready (max 5 minutes)
    logger.debug(`[PROXY] Torrent ${torrentId} is not cached, waiting for it to be ready (max ${constants.TORBOX_PROXY_TIMEOUT / 1000}s)`);
    const streamingUrl = await torbox.waitForReady(torrentId, constants.TORBOX_PROXY_TIMEOUT);
    
    if (streamingUrl) {
      // Cache the URL (from createstream, shorter TTL)
      cacheStreamingUrl(torrentId, streamingUrl, 'createstream');
      
      logger.info(`[PROXY] Torrent ${torrentId} is ready, redirecting: ${streamingUrl.substring(0, 50)}...`);
      const duration = Date.now() - startTime;
      logger.info(`[PROXY] Request completed in ${duration}ms (non-cached)`);
      return res.redirect(302, streamingUrl);
    } else {
      // Timeout or torrent failed - check status one more time
      logger.warn(`[PROXY] Timeout waiting for torrent ${torrentId}, checking status one more time...`);
      
      // Try to get streaming URL one more time (might be ready now)
      const finalUrl = await torbox.getStreamingUrl(torrentId);
      if (finalUrl) {
        // Cache the URL (from createstream, shorter TTL)
        cacheStreamingUrl(torrentId, finalUrl, 'createstream');
        
        logger.info(`[PROXY] Torrent ${torrentId} became ready after timeout check, redirecting: ${finalUrl.substring(0, 50)}...`);
        const duration = Date.now() - startTime;
        logger.info(`[PROXY] Request completed in ${duration}ms (non-cached, retry)`);
        return res.redirect(302, finalUrl);
      }
      
      logger.warn(`[PROXY] Timeout waiting for torrent ${torrentId} to be ready`);
      const duration = Date.now() - startTime;
      return res.status(408).json({ 
        error: 'Request timeout', 
        message: 'Torrent is not ready after 5 minutes. Please try again later.',
        duration: `${Math.round(duration / 1000)}s`
      });
    }
  } catch (error) {
    logger.error(`[PROXY] Error processing proxy request:`, error);
    const duration = Date.now() - startTime;
    
    // Handle specific error types
    if (error.message && error.message.includes('timeout')) {
      return res.status(408).json({ 
        error: 'Request timeout',
        message: error.message,
        duration: `${Math.round(duration / 1000)}s`
      });
    }
    
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message,
      duration: `${Math.round(duration / 1000)}s`
    });
  }
}

module.exports = proxyStreamHandler;
