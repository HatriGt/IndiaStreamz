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
   * Check if magnet is already cached in Torbox
   * @param {string} magnetLink - Magnet link to check
   * @returns {Promise<Object|null>} - Returns cache status or null on failure
   */
  async checkCached(magnetLink) {
    try {
      // Torbox API expects multipart/form-data for POST, or query params for GET
      // Try POST first with multipart/form-data
      const formData = new FormData();
      formData.append('magnet', magnetLink);
      
      try {
        const response = await this.client.post('/api/torrents/checkcached', formData, {
          headers: formData.getHeaders()
        });
        logger.debug(`Torbox: Checked cache, response:`, response.data);
        return response.data;
      } catch (postErr) {
        // If POST fails, try GET with query parameter
        try {
          const response = await this.client.get('/api/torrents/checkcached', {
            params: { magnet: magnetLink }
          });
          logger.debug(`Torbox: Checked cache (GET), response:`, response.data);
          return response.data;
        } catch (getErr) {
          logger.error(`Torbox: Error checking cache:`, postErr.response?.data || postErr.message);
          return null;
        }
      }
    } catch (error) {
      logger.error(`Torbox: Error checking cache:`, error.response?.data || error.message);
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
   * @returns {Promise<{streamingUrl: string|null, isCached: boolean}>} - Returns streaming URL and cache status
   */
  async convertMagnetToStreamingUrl(magnetLink) {
    try {
      // Add magnet to Torbox first
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
        
        // Last resort: The constructed URL format might be wrong
        // Based on Torbox API, the streaming URL might need to be accessed differently
        // Let's try using torrent_id in the URL path instead of hash
        const hash = addResult.data?.hash || addResult.hash;
        
        // Last resort: Construct URL - but this format might be wrong
        // The Torbox API endpoints are all failing, so we're guessing the URL format
        // TODO: Verify the correct Torbox streaming URL format from their API docs
        if (torrentId) {
          // Try different URL formats that might work
          // Option 1: /v1/stream/{torrent_id}
          // Option 2: /v1/torrents/{torrent_id}/stream
          // Option 3: /v1/torrents/{torrent_id}/download
          const constructedUrl = `${this.apiUrl}/v1/stream/${torrentId}`;
          logger.debug(`Torbox: Trying constructed URL with torrent_id:`, constructedUrl);
          logger.warn(`Torbox: All API endpoints failed. Using constructed URL format: ${constructedUrl}`);
          logger.warn(`Torbox: This URL may not work. Please verify the correct Torbox streaming URL format.`);
          return { streamingUrl: constructedUrl, isCached: true };
        } else if (hash) {
          // Fallback to hash if torrent_id not available
          const constructedUrl = `${this.apiUrl}/v1/stream/${hash}`;
          logger.debug(`Torbox: Trying constructed URL with hash:`, constructedUrl);
          logger.warn(`Torbox: All API endpoints failed. Using constructed URL format: ${constructedUrl}`);
          logger.warn(`Torbox: This URL may not work. Please verify the correct Torbox streaming URL format.`);
          return { streamingUrl: constructedUrl, isCached: true };
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

