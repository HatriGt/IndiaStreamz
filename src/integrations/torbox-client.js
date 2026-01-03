const axios = require('axios');
const FormData = require('form-data');
const logger = require('../utils/logger');
const constants = require('../utils/constants');

/**
 * Torbox API Client
 * Handles interaction with Torbox API to convert magnet links to streaming URLs
 */
class TorboxClient {
  constructor(apiKey, apiUrl) {
    // Clean API key: trim whitespace and remove control characters
    this.apiKey = (apiKey || '').trim().replace(/[\r\n\t]/g, '');
    this.apiUrl = apiUrl || constants.TORBOX_API_URL;
    // Base URL should be just /v1 (not /v1/api) since endpoints already include /api/
    this.baseUrl = `${this.apiUrl}/v1`;
    
    if (!this.apiKey) {
      throw new Error('Torbox API key is required');
    }
    
    // Create axios instance with default config
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000, // 10 seconds for individual requests
      headers: {
        'Authorization': `Bearer ${this.apiKey}`
        // Note: Don't set Content-Type for multipart/form-data - axios will set it with boundary
      }
    });
  }

  /**
   * Add magnet link to Torbox
   * @param {string} magnetLink - Magnet link to add
   * @returns {Promise<Object|null>} - Returns torrent info or null on failure
   */
  async addMagnet(magnetLink) {
    try {
      // Torbox API expects multipart/form-data, not JSON
      const formData = new FormData();
      formData.append('magnet', magnetLink);
      
      try {
        // Try the correct API path structure with multipart/form-data
        const response = await this.client.post('/api/torrents/createtorrent', formData, {
          headers: formData.getHeaders()
        });
        logger.debug(`Torbox: Added magnet, response:`, response.data);
        return response.data;
      } catch (err) {
        logger.debug(`Torbox: createtorrent failed, trying asynccreatetorrent:`, err.response?.data || err.message);
        
        // Try async endpoint
        try {
          const asyncFormData = new FormData();
          asyncFormData.append('magnet', magnetLink);
          const response = await this.client.post('/api/torrents/asynccreatetorrent', asyncFormData, {
            headers: asyncFormData.getHeaders()
          });
          logger.debug(`Torbox: Added magnet (async), response:`, response.data);
          return response.data;
        } catch (asyncErr) {
          logger.error(`Torbox: Both endpoints failed. createtorrent:`, err.response?.data || err.message);
          logger.error(`Torbox: asynccreatetorrent:`, asyncErr.response?.data || asyncErr.message);
          return null;
        }
      }
    } catch (error) {
      logger.error(`Torbox: Error adding magnet:`, error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Extract infoHash from magnet link
   * @param {string} magnetLink - Magnet link
   * @returns {string|null} - InfoHash or null
   */
  extractInfoHash(magnetLink) {
    if (!magnetLink) return null;
    const match = magnetLink.match(/btih:([a-f0-9]{40})/i);
    return match ? match[1].toLowerCase() : null;
  }

  /**
   * Get all torrents from mylist (cached for reuse)
   * @returns {Promise<Array>} - Returns array of torrents
   */
  async getMyTorrents() {
    try {
      const response = await this.client.get('/api/torrents/mylist');
      const torrents = response.data?.data || response.data?.torrents || response.data || [];
      return Array.isArray(torrents) ? torrents : [];
    } catch (error) {
      logger.error(`Torbox: Error getting my torrents:`, error.response?.data || error.message);
      return [];
    }
  }

  /**
   * Check if magnet is already cached in Torbox by checking mylist (most reliable method)
   * According to Torbox API docs: GET /api/torrents/mylist returns is_cached field for each torrent
   * @param {string} magnetLink - Magnet link to check
   * @param {Array} torrentList - Optional: pre-fetched torrent list to avoid multiple API calls
   * @returns {Promise<Object|null>} - Returns cache status with torrent info or null on failure
   */
  async checkCached(magnetLink, torrentList = null) {
    try {
      // Extract infoHash from magnet link
      const infoHash = this.extractInfoHash(magnetLink);
      if (!infoHash) {
        logger.debug(`Torbox: Could not extract infoHash from magnet link`);
        return null;
      }

      // Use provided list or fetch mylist
      let torrents = torrentList;
      if (!torrents) {
        torrents = await this.getMyTorrents();
      }
      
      // Find torrent by hash (check multiple hash field names)
      const torrent = torrents.find(t => {
        const torrentHash = (t.hash || t.info_hash || t.infoHash || '').toLowerCase();
        return torrentHash === infoHash;
      });

      if (torrent) {
        // Check is_cached field directly (from API docs)
        // Also check if hls_url or stream_url exists - that means it's ready to stream
        // Also check status - if status is 'completed' or 'ready', it might be cached
        const hasStreamUrl = !!(torrent.hls_url || torrent.stream_url);
        const status = (torrent.status || torrent.state || '').toLowerCase();
        const isCompleted = status === 'completed' || status === 'ready' || status === 'cached' || status === 'downloaded';
        
        const isCached = torrent.is_cached === true || 
                        torrent.is_cached === 1 || 
                        torrent.cached === true ||
                        torrent.cached === 1 ||
                        (hasStreamUrl && isCompleted);
        
        if (isCached) {
          logger.debug(`Torbox: Found CACHED torrent in mylist (hash: ${infoHash.substring(0, 8)}...), is_cached: ${torrent.is_cached}, hasStreamUrl: ${hasStreamUrl}, status: ${status}`);
        } else {
          logger.debug(`Torbox: Found torrent in mylist (hash: ${infoHash.substring(0, 8)}...), is_cached: ${torrent.is_cached}, hasStreamUrl: ${hasStreamUrl}, status: ${status}`);
        }
        
        return {
          cached: isCached,
          data: {
            torrent_id: torrent.torrent_id || torrent.id,
            hash: torrent.hash || torrent.info_hash || torrent.infoHash,
            is_cached: torrent.is_cached,
            cached: torrent.cached,
            status: torrent.status || torrent.state,
            hls_url: torrent.hls_url,
            stream_url: torrent.stream_url
          },
          detail: isCached ? 'Found cached torrent in mylist' : 'Torrent found but not cached'
        };
      }
      
      logger.debug(`Torbox: Torrent not found in mylist (hash: ${infoHash.substring(0, 8)}...)`);
      return null;
    } catch (error) {
      logger.error(`Torbox: Error checking cache via mylist:`, error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Get streaming URL for a torrent
   * @param {string} torrentId - Torrent ID from Torbox
   * @param {number} fileIndex - File index (default: 0)
   * @returns {Promise<string|null>} - Returns streaming URL or null on failure
   */
  async getStreamingUrl(torrentId, fileIndex = 0) {
    try {
      // Ensure torrentId is a number
      const numericTorrentId = typeof torrentId === 'string' ? parseInt(torrentId, 10) : torrentId;
      const numericFileIndex = typeof fileIndex === 'string' ? parseInt(fileIndex, 10) : fileIndex;
      
      // Try method 1: requestdl endpoint with POST and form data (as number)
      try {
        const formData = new FormData();
        formData.append('torrent_id', numericTorrentId);
        if (numericFileIndex !== undefined && numericFileIndex !== null) {
          formData.append('file_index', numericFileIndex);
        }
        
        logger.debug(`Torbox: Requesting streaming URL for torrent_id: ${numericTorrentId}, file_index: ${numericFileIndex}`);
        const response = await this.client.post('/api/torrents/requestdl', formData, {
          headers: formData.getHeaders()
        });
        
        logger.debug(`Torbox: requestdl response:`, JSON.stringify(response.data, null, 2));
        
        if (response.data && response.data.url) {
          logger.debug(`Torbox: Got streaming URL from requestdl:`, response.data.url);
          return response.data.url;
        }
        
        // Also try with data.url nested
        if (response.data && response.data.data && response.data.data.url) {
          logger.debug(`Torbox: Got streaming URL from requestdl (nested):`, response.data.data.url);
          return response.data.data.url;
        }
        
        // Try data.stream_url
        if (response.data && response.data.stream_url) {
          logger.debug(`Torbox: Got streaming URL from requestdl (stream_url):`, response.data.stream_url);
          return response.data.stream_url;
        }
      } catch (error) {
        logger.debug(`Torbox: requestdl POST failed:`, error.response?.data || error.message);
      }
      
      // Try method 1b: requestdl with string values
      try {
        const formData = new FormData();
        formData.append('torrent_id', String(torrentId));
        if (fileIndex !== undefined && fileIndex !== null) {
          formData.append('file_index', String(fileIndex));
        }
        
        const response = await this.client.post('/api/torrents/requestdl', formData, {
          headers: formData.getHeaders()
        });
        
        if (response.data && response.data.url) {
          logger.debug(`Torbox: Got streaming URL from requestdl (string):`, response.data.url);
          return response.data.url;
        }
      } catch (error) {
        logger.debug(`Torbox: requestdl POST (string) failed:`, error.response?.data || error.message);
      }

      // Method 2: stream endpoints - CORRECTED based on Torbox API docs
      // According to docs: /v1/api/stream/createstream
      // Method: GET (not POST!)
      // Parameters: Query parameters (not form data!)
      // - id (required, integer) - this is the torrent_id
      // - file_id (integer, default: 0)
      // - type (string, default: "torrent")
      // Response: JSON object with data.hls_url containing the streaming URL
      try {
        logger.debug(`Torbox: Creating stream for id: ${numericTorrentId}, file_id: ${numericFileIndex}`);
        const streamResponse = await this.client.get('/api/stream/createstream', {
          params: {
            id: numericTorrentId,  // Required parameter (not torrent_id!)
            file_id: numericFileIndex,
            type: 'torrent'
          }
        });
        
        logger.debug(`Torbox: createstream response:`, streamResponse.data);
        
        // Response is a JSON object with structure:
        // { success: true, data: { hls_url: 'https://...', ... } }
        if (streamResponse.data && streamResponse.data.data) {
          const hlsUrl = streamResponse.data.data.hls_url;
          if (hlsUrl && typeof hlsUrl === 'string') {
            logger.debug(`Torbox: Got HLS URL from createstream:`, hlsUrl);
            return hlsUrl;
          }
          
          // Also check for other URL fields
          const streamUrl = streamResponse.data.data.url || 
                          streamResponse.data.data.stream_url ||
                          streamResponse.data.data.streaming_url;
          if (streamUrl && typeof streamUrl === 'string') {
            logger.debug(`Torbox: Got streaming URL from createstream (alternative field):`, streamUrl);
            return streamUrl;
          }
        }
        
        // Fallback: if response is a string (direct URL)
        if (streamResponse.data && typeof streamResponse.data === 'string') {
          logger.debug(`Torbox: Got streaming URL from createstream (direct string):`, streamResponse.data);
          return streamResponse.data;
        }
      } catch (error) {
        logger.error(`Torbox: Stream endpoint failed:`, error.response?.data || error.message);
      }

      // Try method 3: GET with query params (fallback)
      try {
        const response = await this.client.get('/api/torrents/requestdl', {
          params: {
            torrent_id: torrentId,
            file_index: fileIndex
          }
        });
        
        if (response.data && response.data.url) {
          logger.debug(`Torbox: Got streaming URL from requestdl (GET):`, response.data.url);
          return response.data.url;
        }
      } catch (error) {
        logger.debug(`Torbox: GET requestdl also failed:`, error.response?.data || error.message);
      }

      return null;
    } catch (error) {
      logger.error(`Torbox: Error getting streaming URL:`, error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Wait for torrent to be ready (downloaded/cached)
   * @param {string} torrentId - Torrent ID from Torbox
   * @param {number} maxWaitTime - Maximum time to wait in ms (default: 30s)
   * @returns {Promise<string|null>} - Returns streaming URL when ready, or null on timeout/failure
   */
  async waitForReady(torrentId, maxWaitTime = constants.TORBOX_TIMEOUT) {
    const startTime = Date.now();
    const pollInterval = constants.TORBOX_POLL_INTERVAL;

    while (Date.now() - startTime < maxWaitTime) {
      try {
        // Check torrent status via mylist (correct path with /api/)
        // Note: mylist returns all torrents, so we filter by torrent_id
        const response = await this.client.get('/api/torrents/mylist');

        const torrents = response.data?.torrents || response.data?.data || response.data || [];
        const torrentList = Array.isArray(torrents) ? torrents : [];
        const torrent = torrentList.find(t => 
          t.id == torrentId || 
          t.torrent_id == torrentId || 
          String(t.id) === String(torrentId) ||
          String(t.torrent_id) === String(torrentId)
        );

        if (torrent) {
          const status = torrent.status || torrent.state;
          
          // Check if completed/ready
          if (status === 'completed' || status === 'ready' || status === 'downloaded') {
            logger.debug(`Torbox: Torrent ${torrentId} is ready, getting streaming URL`);
            return await this.getStreamingUrl(torrentId);
          }
          
          // Check if failed
          if (status === 'failed' || status === 'error') {
            logger.warn(`Torbox: Torrent ${torrentId} failed with status: ${status}`);
            return null;
          }
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      } catch (error) {
        logger.error(`Torbox: Error checking status:`, error.response?.data || error.message);
        // Continue polling despite errors
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }

    logger.warn(`Torbox: Timeout waiting for torrent ${torrentId} to be ready`);
    return null;
  }

  /**
   * Convert magnet link to streaming URL (complete flow)
   * @param {string} magnetLink - Magnet link to convert
   * @param {Array} torrentList - Optional: pre-fetched torrent list to check for cached torrents
   * @returns {Promise<{streamingUrl: string|null, isCached: boolean}>} - Returns streaming URL and cache status
   */
  async convertMagnetToStreamingUrl(magnetLink, torrentList = null) {
    try {
      // First, check if torrent is already in mylist and has streaming URLs
      const infoHash = this.extractInfoHash(magnetLink);
      if (infoHash) {
        let torrents = torrentList;
        if (!torrents) {
          torrents = await this.getMyTorrents();
        }
        
        const torrent = torrents.find(t => {
          const torrentHash = (t.hash || t.info_hash || t.infoHash || '').toLowerCase();
          return torrentHash === infoHash;
        });

        if (torrent) {
          // Torrent is in mylist - check if it has streaming URLs
          if (torrent.hls_url || torrent.stream_url) {
            // Has streaming URLs - use them directly!
            const streamingUrl = torrent.hls_url || torrent.stream_url;
            const isCached = torrent.is_cached === true || torrent.is_cached === 1 || torrent.cached === true;
            
            logger.debug(`Torbox: Found torrent in mylist with streaming URL (hash: ${infoHash.substring(0, 8)}...), using: ${streamingUrl.substring(0, 50)}...`);
            return { streamingUrl, isCached: isCached || true }; // Mark as cached if it has streaming URL
          }
          
          // Torrent is in mylist but no streaming URL - try to get it using torrent_id
          const torrentId = torrent.torrent_id || torrent.id;
          if (torrentId) {
            logger.debug(`Torbox: Found torrent in mylist (hash: ${infoHash.substring(0, 8)}...), getting streaming URL for torrent_id: ${torrentId}`);
            const streamingUrl = await this.getStreamingUrl(torrentId);
            if (streamingUrl) {
              const isCached = torrent.is_cached === true || torrent.is_cached === 1 || torrent.cached === true;
              return { streamingUrl, isCached: isCached || true };
            }
          }
        }
      }

      // Not found in mylist or couldn't get URL from mylist - try adding magnet
      const addResult = await this.addMagnet(magnetLink);
      if (!addResult) {
        logger.error(`Torbox: Failed to add magnet`);
        return { streamingUrl: null, isCached: false };
      }

      // Extract torrent_id from data object (Torbox API returns it nested)
      const torrentId = addResult.data?.torrent_id || addResult.data?.id || addResult.data?.hash || 
                        addResult.torrent_id || addResult.id || addResult.hash;
      if (!torrentId) {
        logger.error(`Torbox: No torrent ID in add response:`, addResult);
        return { streamingUrl: null, isCached: false };
      }

      logger.debug(`Torbox: Extracted torrent_id: ${torrentId}`);

      // Check if it's already cached (from addMagnet response detail)
      const isCached = addResult.detail && (
        addResult.detail.includes('Found Cached Torrent') || 
        addResult.detail.includes('Cached Torrent') ||
        addResult.detail.includes('Using Cached')
      );

      if (isCached) {
        // Cached torrents are ready immediately - get URL right away
        logger.debug(`Torbox: Torrent ${torrentId} is cached, getting streaming URL immediately`);
        
        // Try to get URL from addResult first (sometimes it's already there)
        if (addResult.data?.url || addResult.data?.stream_url || addResult.url || addResult.stream_url) {
          const url = addResult.data?.url || addResult.data?.stream_url || addResult.url || addResult.stream_url;
          logger.debug(`Torbox: Got streaming URL from addMagnet response:`, url);
          return { streamingUrl: url, isCached: true };
        }
        
        // Otherwise, call getStreamingUrl
        const streamingUrl = await this.getStreamingUrl(torrentId);
        if (streamingUrl) {
          return { streamingUrl, isCached: true };
        }
        
        return { streamingUrl: null, isCached: true };
      }

      // Not cached - wait for it to be ready
      logger.debug(`Torbox: Torrent ${torrentId} is not cached, waiting for it to be ready`);
      const streamingUrl = await this.waitForReady(torrentId);
      return { streamingUrl, isCached: false };
    } catch (error) {
      logger.error(`Torbox: Error converting magnet to streaming URL:`, error.message);
      return { streamingUrl: null, isCached: false };
    }
  }
}

module.exports = TorboxClient;

