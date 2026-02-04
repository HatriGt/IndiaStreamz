// Load environment variables from .env file if it exists
try {
  require('dotenv').config();
} catch (e) {
  // dotenv not installed, continue without it
}

const express = require('express');
const rateLimit = require('express-rate-limit');
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const logger = require('./utils/logger');
const constants = require('./utils/constants');
const manifest = require('./addon/manifest');
const { getManifestForCatalogs } = require('./addon/manifest');
const catalogHandler = require('./addon/catalog-handler');
const metaHandler = require('./addon/meta-handler');
const streamHandler = require('./addon/stream-handler');
const ScraperScheduler = require('./scheduler/scraper-scheduler');
const torboxConfig = require('./utils/torbox-config');
const tokenManager = require('./utils/token-manager');
const proxyStreamHandler = require('./routes/proxy-stream');
const fileCache = require('./cache/file-cache');

const app = express();

// Trust proxy (for HTTPS detection behind reverse proxy)
app.set('trust proxy', true);

// Helper function to get base URL with HTTPS
function getBaseUrl(req) {
  // Check X-Forwarded-Proto header first (set by reverse proxy like Dokploy/Traefik)
  const forwardedProto = req.get('X-Forwarded-Proto');
  const protocol = forwardedProto || req.protocol;
  // In production (behind reverse proxy), always use HTTPS
  // Check if we're behind a proxy (has X-Forwarded-Proto) or in production
  const isProduction = process.env.NODE_ENV === 'production' || forwardedProto;
  const secureProtocol = (isProduction || protocol === 'https' || req.secure) ? 'https' : protocol;
  const host = req.get('X-Forwarded-Host') || req.get('host') || 'localhost:3005';
  return `${secureProtocol}://${host}`;
}

// Parse JSON bodies for API endpoints
app.use(express.json());

// CORS middleware for Stremio clients
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Log all requests to debug routing issues
app.use((req, res, next) => {
  // Only log Stremio-related requests to avoid spam
  if (req.path.includes('/catalog') || req.path.includes('/meta') || req.path.includes('/stream') || req.path.includes('/stremio') || req.path.includes('/manifest')) {
    logger.info(`[REQUEST] ${req.method} ${req.path} - Query: ${JSON.stringify(req.query)}`);
  }
  next();
});

// IMPORTANT: Register custom routes BEFORE serveHTTP
// These routes must be registered early to ensure they're not overridden

// Endpoint to set Torbox config manually (for testing/debugging)
// Usage: GET /api/torbox-config?torboxApiKey=xxx
app.get('/api/torbox-config', async (req, res) => {
  if (req.query.torboxApiKey) {
    let host = req.query.host || req.get('host') || 'localhost:3005';
    host = torboxConfig.normalizeHost(host);
    
    const config = {
      torboxApiKey: req.query.torboxApiKey,
      torboxApiUrl: req.query.torboxApiUrl || constants.TORBOX_API_URL
    };
    
    await torboxConfig.setConfig(host, config);
    logger.info(`[CONFIG] ✅ Manually set Torbox config for host: ${host}`);
    res.json({ success: true, message: `Torbox config saved for ${host}` });
  } else {
    // Return current config
    const hosts = torboxConfig.getHosts();
    const configs = {};
    for (const host of hosts) {
      configs[host] = await torboxConfig.getConfig(host);
    }
    res.json({ configs });
  }
});

// Root route - redirect to configure page
app.get('/', (req, res) => {
  res.redirect('/configure');
});

// API endpoint to create token and generate addon URL
app.post('/api/create-token', async (req, res) => {
  try {
    let { torboxApiKey, torboxApiUrl, visibleCatalogs } = req.body;
    
    if (!torboxApiKey) {
      return res.status(400).json({ success: false, error: 'Torbox API key is required' });
    }
    
    // Clean API key: trim whitespace and remove control characters
    torboxApiKey = torboxApiKey.trim().replace(/[\r\n\t]/g, '');
    
    if (!torboxApiKey) {
      return res.status(400).json({ success: false, error: 'Torbox API key cannot be empty' });
    }
    
    // Create token (with encryption and persistence)
    const { token, encrypted } = await tokenManager.createToken(
      torboxApiKey,
      torboxApiUrl || constants.TORBOX_API_URL,
      visibleCatalogs
    );
    
    // Generate unique addon URL with token
    const baseUrl = getBaseUrl(req);
    const encryptedToken = Buffer.from(JSON.stringify(encrypted)).toString('base64');
    const addonUrl = `${baseUrl}/stremio/${token}/${encryptedToken}/manifest.json`;
    
    logger.info(`[TOKEN] Generated addon URL for token: ${token.substring(0, 8)}...`);
    
    res.json({
      success: true,
      token: token,
      addonUrl: addonUrl
    });
  } catch (error) {
    logger.error(`[TOKEN] Failed to create token:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API endpoint to update catalog visibility for existing token
app.post('/api/update-token-catalogs', async (req, res) => {
  try {
    const { token, visibleCatalogs } = req.body;
    
    if (!token) {
      return res.status(400).json({ success: false, error: 'Token is required' });
    }
    
    const updated = await tokenManager.updateTokenCatalogs(token, visibleCatalogs);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Invalid token' });
    }
    
    res.json({ success: true, message: 'Catalog preferences updated' });
  } catch (error) {
    logger.error(`[TOKEN] Failed to update catalogs:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API endpoint to get token config (for configure page - catalog preferences only, no API key)
app.get('/api/token-config', async (req, res) => {
  try {
    const { token } = req.query;
    
    if (!token) {
      return res.status(400).json({ success: false, error: 'Token is required' });
    }
    
    const config = tokenManager.getConfigForToken(token);
    if (!config) {
      return res.status(404).json({ success: false, error: 'Invalid token' });
    }
    
    // Return only non-sensitive config (catalog preferences)
    res.json({
      success: true,
      visibleCatalogs: config.visibleCatalogs || []
    });
  } catch (error) {
    logger.error(`[TOKEN] Failed to get token config:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Initialize scheduler
const scheduler = new ScraperScheduler();
scheduler.start();

// Secret route to trigger rescrape
// Usage: GET /api/rescrape?secret=YOUR_SECRET_TOKEN
app.get('/api/rescrape', async (req, res) => {
  try {
    const secretToken = process.env.RESCRAPE_SECRET_TOKEN || 'changeme';
    const providedSecret = req.query.secret;
    
    if (!providedSecret) {
      return res.status(401).json({ 
        success: false, 
        error: 'Secret token required. Use ?secret=YOUR_TOKEN' 
      });
    }
    
    if (providedSecret !== secretToken) {
      logger.warn('[RESCRAPE] Invalid secret token attempt');
      return res.status(403).json({ 
        success: false, 
        error: 'Invalid secret token' 
      });
    }
    
    // Check if scrape is already running
    if (scheduler.isRunning) {
      return res.json({ 
        success: false, 
        message: 'Scrape is already running',
        isRunning: true
      });
    }
    
    // Trigger manual scrape (non-blocking)
    logger.info('[RESCRAPE] Manual rescrape triggered via API');
    scheduler.triggerManual().catch(error => {
      logger.error('[RESCRAPE] Error during manual scrape:', error);
    });
    
    res.json({ 
      success: true, 
      message: 'Rescrape triggered successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('[RESCRAPE] Error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Create rate limiter for proxy route
const proxyRateLimiter = rateLimit({
  windowMs: constants.PROXY_RATE_LIMIT_WINDOW,
  max: constants.PROXY_RATE_LIMIT_MAX,
  message: { error: 'Too many requests', message: 'Rate limit exceeded. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  // Fix trust proxy validation issue
  validate: {
    trustProxy: false
  },
  // Use request IP directly
  keyGenerator: (req) => {
    return req.ip || req.connection.remoteAddress || 'unknown';
  }
});

// Register proxy route BEFORE serveHTTP to ensure it takes precedence
// Route: /stremio/:token/:encrypted/proxy/:magnetHash
app.get('/stremio/:token/:encrypted/proxy/:magnetHash', proxyRateLimiter, proxyStreamHandler);
logger.info('Proxy route registered: /stremio/:token/:encrypted/proxy/:magnetHash');

// API key is extracted by middleware and set in query params
// The stream handler will get it from there

// Middleware to extract token from path and attach to request
// Handles token-based URLs: /stremio/{token}/{encrypted}/manifest.json or /stremio/{token}/{encrypted}/stream/...
app.use((req, res, next) => {
  // Extract token from path if it's a token-based URL
  const token = tokenManager.extractTokenFromPath(req.path);
  if (token) {
    // Attach token to request for handlers to use
    req.token = token;
    logger.debug(`[TOKEN] Extracted token from path: ${token.substring(0, 8)}...`);
  }
  
  // For stream requests with token, set it in the handler's query params
  const streamMatch = req.path.match(/\/stremio\/[^\/]+\/[^\/]+\/stream\/([^\/]+)\/([^\/]+)\.json/);
  if (streamMatch && token) {
    const id = streamMatch[2];
    const tokenConfig = tokenManager.getConfigForToken(token);
    if (tokenConfig) {
      streamHandler.setQueryParams(id, { ...tokenConfig, token: token });
      logger.info(`[TOKEN] Set config from token for ${id}`);
    }
  }
  
  next();
});

// Register token-based routes BEFORE serveHTTP to ensure they take precedence
// Token-based manifest route - validates token and returns manifest
app.get('/stremio/:token/:encrypted/manifest.json', async (req, res) => {
  const { token } = req.params;
  logger.info(`[TOKEN] Manifest request with token: ${token.substring(0, 8)}...`);
  
  // Verify token exists (will load from file if needed)
  const config = tokenManager.getConfigForToken(token);
  if (!config) {
    logger.warn(`[TOKEN] Invalid token: ${token.substring(0, 8)}...`);
    return res.status(404).json({ error: 'Invalid token' });
  }
  
  // Filter catalogs based on user preference
  const manifestToServe = getManifestForCatalogs(config.visibleCatalogs);
  res.json(manifestToServe);
});

// Token-based routes for catalog and meta - directly call handlers
// IMPORTANT: Register these BEFORE serveHTTP so they take precedence
// Handle catalog routes with flexible ID matching (to support search in path)
// Use wildcard to capture everything after /catalog/:type/
app.get('/stremio/:token/:encrypted/catalog/:type/*', async (req, res) => {
  const { type } = req.params;
  const wildcard = req.params[0] || ''; // Everything after /catalog/:type/
  
  // Parse the wildcard path to extract catalog ID and search parameter
  // Format: telugu/search=akhandha%202.json or just telugu.json
  let id = wildcard;
  let extra = { ...req.query };
  
  // Remove .json extension if present
  if (id.endsWith('.json')) {
    id = id.slice(0, -5);
  }
  
  // Check if search parameter is in the path
  const searchMatch = id.match(/^(.+?)\/search=(.+)$/);
  if (searchMatch) {
    id = searchMatch[1]; // Extract the actual catalog ID
    extra.search = decodeURIComponent(searchMatch[2]); // Extract and decode search term
    logger.info(`[TOKEN CATALOG] Extracted search from path: "${extra.search}" for catalog ${id}`);
  }
  
  logger.info(`[TOKEN CATALOG] Request for ${type}/${id} - Query: ${JSON.stringify(extra)}`);
  try {
    const catalogData = await catalogHandler({ type, id, extra });
    logger.info(`[TOKEN CATALOG] Returning ${catalogData.metas?.length || 0} items for ${type}/${id}`);
    res.json(catalogData);
  } catch (error) {
    logger.error('[CATALOG] Error getting catalog:', error);
    res.status(500).json({ error: 'Failed to get catalog' });
  }
});

// Create Stremio addon using addonBuilder
// Note: streamHandler will access query params via the global storage set by middleware
const addonInterface = addonBuilder(manifest)
  .defineCatalogHandler(catalogHandler)
  .defineMetaHandler(metaHandler)
  .defineStreamHandler(streamHandler)
  .getInterface();

app.get('/stremio/:token/:encrypted/meta/:type/:id.json', async (req, res) => {
  const { type, id } = req.params;
  try {
    const metaData = await metaHandler({ type, id });
    res.json(metaData);
  } catch (error) {
    logger.error('[META] Error getting meta:', error);
    res.status(500).json({ error: 'Failed to get meta' });
  }
});

app.get('/stremio/:token/:encrypted/stream/:type/:id.json', async (req, res) => {
  const { token, type, id } = req.params;
  logger.debug(`[TOKEN] Stream request with token: ${token.substring(0, 8)}... for ${type}/${id}`);
  
  // Verify token and set config for handler (will load from file if needed)
  const config = tokenManager.getConfigForToken(token);
  if (config) {
    streamHandler.setQueryParams(id, { ...config, token: token });
    logger.info(`[TOKEN] Set config from token for ${id}`);
  } else {
    logger.warn(`[TOKEN] Invalid token for stream: ${token.substring(0, 8)}...`);
  }
  
  try {
    // Get base URL for proxy URLs
    const baseUrl = getBaseUrl(req);
    const encrypted = req.params.encrypted; // Get encrypted part from URL path
    const streamData = await streamHandler({ 
      type, 
      id, 
      extra: { ...req.query, token: token, encrypted: encrypted, baseUrl: baseUrl } 
    });
    res.json(streamData);
  } catch (error) {
    logger.error('[STREAM] Error getting streams:', error);
    res.status(500).json({ error: 'Failed to get streams' });
  }
});

// IMPORTANT: Register a test route to verify Express routing works
app.get('/test', (req, res) => {
  res.json({ message: 'Express routes are working!', routes: ['/configure', '/test'] });
});

// Health check endpoint (for Dokploy/reverse proxy)
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    port: constants.PORT 
  });
});

// API endpoint to list all movies and series in cache
app.get('/api/cache/list', async (req, res) => {
  try {
    const cachedContent = await fileCache.getAllCachedContent();
    
    logger.info(`[CACHE] Listing cached content: ${cachedContent.movieCount} movies, ${cachedContent.seriesCount} series`);
    
    res.json({
      success: true,
      ...cachedContent,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('[CACHE] Error listing cached content:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// API endpoint to trigger full replacement scrape (clears cache and rescrapes everything)
// Usage: GET /api/cache/full-replace?secret=YOUR_SECRET_TOKEN
app.get('/api/cache/full-replace', async (req, res) => {
  try {
    const secretToken = process.env.RESCRAPE_SECRET_TOKEN || 'changeme';
    const providedSecret = req.query.secret;
    
    if (!providedSecret) {
      return res.status(401).json({ 
        success: false, 
        error: 'Secret token required. Use ?secret=YOUR_TOKEN' 
      });
    }
    
    if (providedSecret !== secretToken) {
      logger.warn('[FULL-REPLACE] Invalid secret token attempt');
      return res.status(403).json({ 
        success: false, 
        error: 'Invalid secret token' 
      });
    }
    
    // Check if scrape is already running
    if (scheduler.isRunning) {
      return res.status(409).json({ 
        success: false, 
        message: 'Scrape is already running',
        isRunning: true
      });
    }
    
    // Trigger full replacement scrape (non-blocking)
    logger.info('[FULL-REPLACE] Full replacement scrape triggered via API');
    scheduler.triggerFullReplacement().catch(error => {
      logger.error('[FULL-REPLACE] Error during full replacement scrape:', error);
    });
    
    res.json({ 
      success: true, 
      message: 'Full replacement scrape triggered successfully. Cache will be cleared and replaced.',
      timestamp: new Date().toISOString(),
      warning: 'This will clear all existing cache and replace it with newly scraped data'
    });
  } catch (error) {
    logger.error('[FULL-REPLACE] Error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Call serveHTTP to mount Stremio addon routes on our Express app
// Don't pass port - this only mounts routes, doesn't start a server
serveHTTP(addonInterface, {
  app: app
});

// Add explicit standard catalog routes as fallback (serveHTTP should create these, but ensure they work)
// These routes are needed for Stremio Discover/search functionality
// Handle catalog routes with flexible ID matching (to support search in path)
// Use wildcard to capture everything after /catalog/:type/
app.get('/catalog/:type/*', async (req, res) => {
  const { type } = req.params;
  const wildcard = req.params[0] || ''; // Everything after /catalog/:type/
  
  // Parse the wildcard path to extract catalog ID and search parameter
  // Format: telugu/search=akhandha%202.json or just telugu.json
  let id = wildcard;
  let extra = { ...req.query };
  
  // Remove .json extension if present
  if (id.endsWith('.json')) {
    id = id.slice(0, -5);
  }
  
  // Check if search parameter is in the path
  const searchMatch = id.match(/^(.+?)\/search=(.+)$/);
  if (searchMatch) {
    id = searchMatch[1]; // Extract the actual catalog ID
    extra.search = decodeURIComponent(searchMatch[2]); // Extract and decode search term
    logger.info(`[STANDARD CATALOG] Extracted search from path: "${extra.search}" for catalog ${id}`);
  }
  
  logger.info(`[STANDARD CATALOG] Request for ${type}/${id} - Query: ${JSON.stringify(extra)}`);
  try {
    const catalogData = await catalogHandler({ type, id, extra });
    logger.info(`[STANDARD CATALOG] Returning ${catalogData.metas?.length || 0} items for ${type}/${id}`);
    res.json(catalogData);
  } catch (error) {
    logger.error('[CATALOG] Error getting catalog:', error);
    res.status(500).json({ error: 'Failed to get catalog' });
  }
});

// Add explicit standard meta route as fallback
app.get('/meta/:type/:id.json', async (req, res) => {
  const { type, id } = req.params;
  logger.info(`[STANDARD META] Request for ${type}/${id}`);
  try {
    const metaData = await metaHandler({ type, id });
    res.json(metaData);
  } catch (error) {
    logger.error('[META] Error getting meta:', error);
    res.status(500).json({ error: 'Failed to get meta' });
  }
});

// Add explicit standard manifest route (for non-token installations)
app.get('/manifest.json', (req, res) => {
  logger.info('[STANDARD MANIFEST] Request for manifest.json');
  res.json(manifest);
});

// 404 handler to catch unmatched requests and log them (must be last, before server starts)
app.use((req, res) => {
  // Only log Stremio-related 404s
  if (req.path.includes('/catalog') || req.path.includes('/meta') || req.path.includes('/stream') || req.path.includes('/stremio') || req.path.includes('/manifest')) {
    logger.error(`[404] Unmatched request: ${req.method} ${req.path} - Query: ${JSON.stringify(req.query)}`);
    logger.error(`[404] Full URL: ${req.protocol}://${req.get('host')}${req.originalUrl}`);
  }
  res.status(404).json({ error: 'Not found' });
});

// Start our own HTTP server using Express app
const http = require('http');
const server = http.createServer((req, res) => {
  app(req, res);
});

// Bind to 0.0.0.0 to accept connections from outside the container
server.listen(constants.PORT, '0.0.0.0', () => {
  logger.info(`Express HTTP server started on port ${constants.PORT}`);
  logger.info(`Server listening on 0.0.0.0:${constants.PORT}`);
  logger.info(`Custom routes should now work: http://localhost:${constants.PORT}/configure`);
});

// Re-register /configure route AFTER serveHTTP to ensure it takes precedence
try {
  const configureHandler = require('./routes/configure');
  app.get('/configure', configureHandler);
} catch (error) {
  logger.error('Failed to load configure handler:', error);
}

// Note: Token-based routes are already registered BEFORE serveHTTP above
// No need to re-register them here

app.get('/stremio/:token/:encrypted/stream/:type/:id.json', async (req, res) => {
  const { token, type, id } = req.params;
  logger.debug(`[TOKEN] Stream request with token: ${token.substring(0, 8)}... for ${type}/${id}`);

  const config = tokenManager.getConfigForToken(token);
  if (config) {
    streamHandler.setQueryParams(id, { ...config, token: token });
    logger.info(`[TOKEN] Set config from token for ${id}`);
  } else {
    logger.warn(`[TOKEN] Invalid token for stream: ${token.substring(0, 8)}...`);
  }

  try {
    // Get base URL for proxy URLs
    const baseUrl = getBaseUrl(req);
    const encrypted = req.params.encrypted; // Get encrypted part from URL path
    const streamData = await streamHandler({ 
      type, 
      id, 
      extra: { ...req.query, token: token, encrypted: encrypted, baseUrl: baseUrl } 
    });
    res.json(streamData);
  } catch (error) {
    logger.error('[STREAM] Error getting stream:', error);
    res.status(500).json({ error: 'Failed to get stream' });
  }
});

logger.info('Custom routes registered: /configure, /api/create-token, /test, /stremio/:token/:encrypted/*');
logger.info(`Server should be accessible at: http://localhost:${constants.PORT}/configure`);
logger.info(`Server should be accessible at: http://localhost:${constants.PORT}/configure`);

// Error handling middleware (after routes)
app.use((err, req, res, next) => {
  logger.error('Request error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

logger.info(`Stremio addon server started on port ${constants.PORT}`);
logger.info(`Addon ID: ${constants.ADDON_ID}`);
logger.info(`Addon URL: http://localhost:${constants.PORT}/manifest.json`);

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  scheduler.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully...');
  scheduler.stop();
  process.exit(0);
});

