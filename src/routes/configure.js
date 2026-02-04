// Configure route handler
const logger = require('../utils/logger');
const constants = require('../utils/constants');

const CATALOG_OPTIONS = [
  { id: constants.LANGUAGES.TAMIL, name: constants.LANGUAGE_NAMES.tamil },
  { id: constants.LANGUAGES.TELUGU, name: constants.LANGUAGE_NAMES.telugu },
  { id: constants.LANGUAGES.HINDI, name: constants.LANGUAGE_NAMES.hindi },
  { id: constants.LANGUAGES.MALAYALAM, name: constants.LANGUAGE_NAMES.malayalam },
  { id: constants.LANGUAGES.KANNADA, name: constants.LANGUAGE_NAMES.kannada },
  { id: constants.LANGUAGES.ENGLISH, name: constants.LANGUAGE_NAMES.english }
];

const catalogCheckboxesHtml = CATALOG_OPTIONS.map(c =>
  `<label class="checkbox-label"><input type="checkbox" name="catalog" value="${c.id}" checked> ${c.name} Movies</label>`
).join('');

module.exports = (req, res) => {
  try {
    logger.info('[CONFIGURE] Route handler called');
    // Helper to get base URL with HTTPS
    const protocol = req.get('X-Forwarded-Proto') || req.protocol;
    const secureProtocol = protocol === 'https' || req.secure ? 'https' : 'https';
    const host = req.get('host') || req.get('X-Forwarded-Host') || 'localhost:3005';
    const baseUrl = `${secureProtocol}://${host}`;
    
    const html = `<!DOCTYPE html>
<html>
<head>
  <title>IndiaStreamz Configuration</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; background: #f5f5f5; }
    .container { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .form-group { margin-bottom: 20px; }
    label { display: block; margin-bottom: 8px; font-weight: bold; color: #333; }
    input[type="text"] { width: 100%; padding: 10px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; }
    input:focus { outline: none; border-color: #4CAF50; }
    button { background: #4CAF50; color: white; padding: 12px 24px; border: none; cursor: pointer; border-radius: 4px; font-size: 16px; }
    button:hover { background: #45a049; }
    .result { margin-top: 25px; padding: 20px; background: #f0f0f0; border-radius: 5px; }
    .url { word-break: break-all; background: white; padding: 12px; border-radius: 3px; font-family: monospace; font-size: 12px; border: 1px solid #ddd; }
    .copy-btn { margin-top: 10px; background: #2196F3; }
    .copy-btn:hover { background: #1976D2; }
    .info { color: #666; font-size: 14px; margin-top: 5px; }
    .loading { display: none; color: #4CAF50; }
    .catalog-group { margin: 15px 0; }
    .catalog-group .section-label { font-weight: bold; margin-bottom: 10px; }
    .checkbox-label { display: inline-block; margin-right: 15px; margin-bottom: 8px; font-weight: normal; }
    .checkbox-label input { margin-right: 5px; }
    .divider { border-top: 1px solid #ddd; margin: 30px 0; padding-top: 15px; }
    .load-btn { margin-top: 8px; background: #757575; padding: 8px 16px; font-size: 14px; }
    .load-btn:hover { background: #616161; }
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
      
      <div class="form-group catalog-group">
        <div class="section-label">Catalogs to display (uncheck to hide):</div>
        <div id="catalogCheckboxes">${catalogCheckboxesHtml}</div>
        <div class="info">Only checked catalogs will appear in Stremio. Leave all checked to show everything.</div>
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
    
    <div class="divider">
      <h3>Update catalog preferences</h3>
      <p>Already have an addon URL? Paste it below to change which catalogs are visible:</p>
      <form id="updateForm">
        <div class="form-group">
          <label for="addonUrlInput">Your Addon URL</label>
          <input type="text" id="addonUrlInput" name="addonUrl" placeholder="https://.../stremio/.../manifest.json">
          <button type="button" id="loadPrefsBtn" class="load-btn">Load current preferences</button>
        </div>
        <div class="form-group catalog-group">
          <div class="section-label">Catalogs to display:</div>
          <div id="updateCatalogCheckboxes">${catalogCheckboxesHtml}</div>
        </div>
        <button type="submit">Update Preferences</button>
        <div class="loading" id="updateLoading">Updating...</div>
      </form>
      <div id="updateResult" class="result" style="display: none; margin-top: 15px;">
        <p style="color: #4CAF50; font-weight: bold;">Catalog preferences updated successfully!</p>
        <p class="info">Restart Stremio or refresh the addon to see changes.</p>
      </div>
    </div>
  </div>
  
  <script>
    const allCatalogIds = ${JSON.stringify(CATALOG_OPTIONS.map(c => c.id))};
    
    document.getElementById('configForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      const apiKey = document.getElementById('torboxApiKey').value.trim();
      
      if (!apiKey) {
        alert('Please enter your Torbox API key');
        return;
      }
      
      const checkboxes = document.querySelectorAll('#catalogCheckboxes input[name="catalog"]:checked');
      const checked = Array.from(checkboxes).map(cb => cb.value);
      const visibleCatalogs = (checked.length === allCatalogIds.length || checked.length === 0) ? [] : checked;
      
      const loadingEl = document.getElementById('loading');
      const resultEl = document.getElementById('result');
      const submitBtn = e.target.querySelector('button[type="submit"]');
      
      loadingEl.style.display = 'block';
      submitBtn.disabled = true;
      resultEl.style.display = 'none';
      
      try {
        const response = await fetch('/api/create-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ torboxApiKey: apiKey, visibleCatalogs: visibleCatalogs })
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
    
    function extractTokenFromUrl(url) {
      const match = url.match(/\\/stremio\\/([^\\/]+)\\//);
      return match ? match[1] : null;
    }
    
    function setUpdateCheckboxes(visibleCatalogs) {
      const checkboxes = document.querySelectorAll('#updateCatalogCheckboxes input[name="catalog"]');
      if (!visibleCatalogs || visibleCatalogs.length === 0) {
        checkboxes.forEach(cb => cb.checked = true);
      } else {
        const set = new Set(visibleCatalogs);
        checkboxes.forEach(cb => { cb.checked = set.has(cb.value); });
      }
    }
    
    document.getElementById('loadPrefsBtn').addEventListener('click', async function() {
      const addonUrl = document.getElementById('addonUrlInput').value.trim();
      const token = extractTokenFromUrl(addonUrl);
      if (!token) {
        alert('Please paste your addon URL first');
        return;
      }
      try {
        const res = await fetch('/api/token-config?token=' + encodeURIComponent(token));
        const data = await res.json();
        if (data.success) {
          setUpdateCheckboxes(data.visibleCatalogs);
        } else {
          alert('Could not load: ' + (data.error || 'Invalid token'));
        }
      } catch (e) {
        alert('Error loading preferences');
      }
    });
    
    document.getElementById('updateForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      const addonUrl = document.getElementById('addonUrlInput').value.trim();
      const token = extractTokenFromUrl(addonUrl);
      
      if (!token) {
        alert('Invalid addon URL. Please paste your full addon URL (e.g. https://.../stremio/.../manifest.json)');
        return;
      }
      
      const checkboxes = document.querySelectorAll('#updateCatalogCheckboxes input[name="catalog"]:checked');
      const checked = Array.from(checkboxes).map(cb => cb.value);
      const visibleCatalogs = (checked.length === allCatalogIds.length || checked.length === 0) ? [] : checked;
      
      const loadingEl = document.getElementById('updateLoading');
      const resultEl = document.getElementById('updateResult');
      const submitBtn = e.target.querySelector('button[type="submit"]');
      
      loadingEl.style.display = 'block';
      submitBtn.disabled = true;
      resultEl.style.display = 'none';
      
      try {
        const response = await fetch('/api/update-token-catalogs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token, visibleCatalogs: visibleCatalogs })
        });
        
        const data = await response.json();
        
        if (data.success) {
          resultEl.style.display = 'block';
        } else {
          alert('Failed to update: ' + (data.error || 'Unknown error'));
        }
      } catch (error) {
        alert('Error: ' + error.message);
      } finally {
        loadingEl.style.display = 'none';
        submitBtn.disabled = false;
      }
    });
  </script>
</body>
</html>`;
    
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    logger.error('[CONFIGURE] Error serving page:', error);
    res.status(500).send('Error loading configuration page: ' + error.message);
  }
};

