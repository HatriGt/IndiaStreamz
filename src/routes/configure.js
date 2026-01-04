// Configure route handler
const logger = require('../utils/logger');

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
        // Call server to create encrypted token
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
};

