// Load environment variables from .env file if it exists
try {
  require('dotenv').config();
} catch (e) {
  // dotenv not installed, continue without it
}

const express = require('express');
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const logger = require('./utils/logger');
const constants = require('./utils/constants');
const manifest = require('./addon/manifest');
const catalogHandler = require('./addon/catalog-handler');
const metaHandler = require('./addon/meta-handler');
const streamHandler = require('./addon/stream-handler');
const ScraperScheduler = require('./scheduler/scraper-scheduler');
const torboxConfig = require('./utils/torbox-config');
const tokenManager = require('./utils/token-manager');

const app = express();

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

// Configuration page endpoint (register before serveHTTP to ensure it's accessible)
app.get('/configure', (req, res) => {
  try {
    logger.info('[CONFIGURE] Route handler called - page accessed');
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    
    const html = `<!DOCTYPE html>
<html>
<head>
  <title>IndiaStreamz Configuration</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; background: #f5f5f5; }
    .container { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .form-group { margin-bottom: 20px; }
    label { display: block; margin-bottom: 8px; font-weight: bold; color: #333; }
    input { width: 100%; padding: 10px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; }
    input:focus { outline: none; border-color: #4CAF50; }
    button { background: #4CAF50; color: white; padding: 12px 24px; border: none; cursor: pointer; border-radius: 4px; font-size: 16px; }
    button:hover { background: #45a049; }
    .result { margin-top: 25px; padding: 20px; background: #f0f0f0; border-radius: 5px; }
    .url { word-break: break-all; background: white; padding: 12px; border-radius: 3px; font-family: monospace; font-size: 12px; border: 1px solid #ddd; }
    .copy-btn { margin-top: 10px; background: #2196F3; }
    .copy-btn:hover { background: #1976D2; }
    .info { color: #666; font-size: 14px; margin-top: 5px; }
    .loading { display: none; color: #4CAF50; }
  </style>
</head>
<body>
  <div class="container">
    <h1>IndiaStreamz Configuration</h1>
    <p>Enter your Torbox API key to generate a unique addon URL:</p>
    
    <form id="configForm">
      <div class="form-group">
        <label for="torboxApiKey">Torbox API Key *</label>
        <input type="text" id="torboxApiKey" name="torboxApiKey" placeholder="Enter your Torbox API key" required>
        <div class="info">Get your API key from your Torbox account settings</div>
      </div>
      
      <button type="submit">Generate Addon URL</button>
      <div class="loading" id="loading">Generating unique URL...</div>
    </form>
    
    <div id="result" class="result" style="display: none;">
      <h3>Your Unique Addon URL:</h3>
      <div class="url" id="addonUrl"></div>
      <button class="copy-btn" onclick="copyUrl()">Copy URL</button>
      <p style="margin-top: 15px;"><strong>Instructions:</strong></p>
      <ol>
        <li>Copy the URL above</li>
        <li>Open Stremio</li>
        <li>Go to Addons → Add Addon</li>
        <li>Paste the URL and click "Add"</li>
      </ol>
      <p style="margin-top: 15px; color: #666; font-size: 12px;">
        <strong>Note:</strong> This URL contains an encrypted token. Keep it private and don't share it with others.
      </p>
    </div>
  </div>
  
  <script>
    document.getElementById('configForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      const apiKey = document.getElementById('torboxApiKey').value.trim();
      
      if (!apiKey) {
        alert('Please enter your Torbox API key');
        return;
      }
      
      const loadingEl = document.getElementById('loading');
      const resultEl = document.getElementById('result');
      const submitBtn = e.target.querySelector('button[type="submit"]');
      
      loadingEl.style.display = 'block';
      submitBtn.disabled = true;
      resultEl.style.display = 'none';
      
      try {
        // Create token and get unique URL
        const response = await fetch('/api/create-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ torboxApiKey: apiKey })
        });
        
        const data = await response.json();
        
        if (data.success && data.addonUrl) {
          document.getElementById('addonUrl').textContent = data.addonUrl;
          resultEl.style.display = 'block';
        } else {
          alert('Failed to generate URL: ' + (data.error || 'Unknown error'));
        }
      } catch (error) {
        alert('Error: ' + error.message);
      } finally {
        loadingEl.style.display = 'none';
        submitBtn.disabled = false;
      }
    });
    
    function copyUrl() {
      const url = document.getElementById('addonUrl').textContent;
      navigator.clipboard.writeText(url).then(() => {
        alert('URL copied to clipboard!');
      }).catch(() => {
        const textArea = document.createElement('textarea');
        textArea.value = url;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        alert('URL copied to clipboard!');
      });
    }
  </script>
</body>
</html>`;
    
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    logger.error('[CONFIGURE] Error serving page:', error);
    res.status(500).send('Error loading configuration page: ' + error.message);
  }
});

// API endpoint to create token and generate addon URL
app.post('/api/create-token', async (req, res) => {
  try {
    let { torboxApiKey, torboxApiUrl } = req.body;
    
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
      torboxApiUrl || constants.TORBOX_API_URL
    );
    
    // Generate unique addon URL with token
    const baseUrl = `${req.protocol}://${req.get('host')}`;
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

// Initialize scheduler
const scheduler = new ScraperScheduler();
scheduler.start();

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

// Create Stremio addon using addonBuilder
// Note: streamHandler will access query params via the global storage set by middleware
const addonInterface = addonBuilder(manifest)
  .defineCatalogHandler(catalogHandler)
  .defineMetaHandler(metaHandler)
  .defineStreamHandler(streamHandler)
  .getInterface();

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
  
  res.json(manifest);
});

// Token-based routes for catalog and meta - directly call handlers
app.get('/stremio/:token/:encrypted/catalog/:type/:id.json', async (req, res) => {
  const { type, id } = req.params;
  try {
    const catalogData = await catalogHandler({ type, id, extra: req.query });
    res.json(catalogData);
  } catch (error) {
    logger.error('[CATALOG] Error getting catalog:', error);
    res.status(500).json({ error: 'Failed to get catalog' });
  }
});

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
    const streamData = await streamHandler({ type, id, extra: req.query });
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

// Call serveHTTP to mount Stremio addon routes on our Express app
// Don't pass port - this only mounts routes, doesn't start a server
serveHTTP(addonInterface, {
  app: app
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

// Re-register token-based routes AFTER serveHTTP to ensure they take precedence
app.get('/stremio/:token/:encrypted/manifest.json', async (req, res) => {
  const { token } = req.params;
  const config = tokenManager.getConfigForToken(token);
  if (!config) {
    return res.status(404).json({ error: 'Invalid token' });
  }
  res.json(manifest);
});

app.get('/stremio/:token/:encrypted/catalog/:type/:id.json', async (req, res) => {
  const { type, id } = req.params;
  try {
    const catalogData = await catalogHandler({ type, id, extra: req.query });
    res.json(catalogData);
  } catch (error) {
    logger.error('[CATALOG] Error getting catalog:', error);
    res.status(500).json({ error: 'Failed to get catalog' });
  }
});

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

  const config = tokenManager.getConfigForToken(token);
  if (config) {
    streamHandler.setQueryParams(id, { ...config, token: token });
    logger.info(`[TOKEN] Set config from token for ${id}`);
  } else {
    logger.warn(`[TOKEN] Invalid token for stream: ${token.substring(0, 8)}...`);
  }

  try {
    const streamData = await streamHandler({ type, id, extra: req.query });
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

