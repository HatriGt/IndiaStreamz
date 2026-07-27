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

const seriesLangCheckboxesHtml = CATALOG_OPTIONS.map(c =>
  `<label class="checkbox-label"><input type="checkbox" name="seriesLang" value="${c.id}" checked> ${c.name}</label>`
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
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <style>
    :root {
      --bg: #0b0f1a;
      --bg-elev: #141b2d;
      --bg-input: #0f1626;
      --border: #26304a;
      --border-focus: #6c8cff;
      --text: #e6ebf5;
      --text-dim: #9aa6bf;
      --brand: #6c8cff;
      --brand-2: #b46cff;
      --accent: #23d18b;
      --danger: #ff6b6b;
      --radius: 14px;
      --shadow: 0 20px 60px rgba(0,0,0,.45);
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      margin: 0; padding: 40px 18px 64px; color: var(--text);
      background:
        radial-gradient(1100px 520px at 15% -10%, rgba(108,140,255,.20), transparent 60%),
        radial-gradient(900px 480px at 100% 0%, rgba(180,108,255,.16), transparent 55%),
        var(--bg);
      min-height: 100vh; line-height: 1.55;
    }
    .wrap { max-width: 680px; margin: 0 auto; }
    .hero { text-align: center; margin-bottom: 28px; }
    .logo {
      display: inline-flex; align-items: center; gap: 10px; font-weight: 800;
      font-size: 30px; letter-spacing: -0.02em;
      background: linear-gradient(90deg, var(--brand), var(--brand-2));
      -webkit-background-clip: text; background-clip: text; color: transparent;
    }
    .logo .dot { width: 12px; height: 12px; border-radius: 50%; background: linear-gradient(135deg, var(--brand), var(--brand-2)); box-shadow: 0 0 18px rgba(108,140,255,.8); }
    .tagline { color: var(--text-dim); margin-top: 8px; font-size: 15px; }
    .features { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin: 18px 0 4px; }
    .chip { font-size: 12.5px; color: var(--text-dim); background: var(--bg-elev); border: 1px solid var(--border); padding: 6px 12px; border-radius: 999px; }
    .container { background: var(--bg-elev); padding: 28px; border-radius: var(--radius); box-shadow: var(--shadow); border: 1px solid var(--border); }
    h1 { display: none; }
    h3 { margin: 0 0 6px; font-size: 18px; letter-spacing: -0.01em; }
    p { color: var(--text-dim); margin: 0 0 18px; }
    .form-group { margin-bottom: 20px; }
    label { display: block; margin-bottom: 8px; font-weight: 600; color: var(--text); font-size: 14px; }
    input[type="text"] {
      width: 100%; padding: 13px 14px; border: 1px solid var(--border); border-radius: 10px;
      font-size: 14px; background: var(--bg-input); color: var(--text); transition: border-color .15s, box-shadow .15s;
    }
    input[type="text"]::placeholder { color: #5c6885; }
    input[type="text"]:focus { outline: none; border-color: var(--border-focus); box-shadow: 0 0 0 3px rgba(108,140,255,.18); }
    button {
      background: linear-gradient(135deg, var(--brand), var(--brand-2)); color: #fff; padding: 13px 22px;
      border: none; cursor: pointer; border-radius: 10px; font-size: 15px; font-weight: 700;
      transition: transform .08s ease, filter .15s ease; width: 100%;
    }
    button:hover { filter: brightness(1.08); }
    button:active { transform: translateY(1px); }
    button:disabled { opacity: .6; cursor: not-allowed; filter: none; }
    .result { margin-top: 22px; padding: 20px; background: var(--bg-input); border-radius: 12px; border: 1px solid var(--border); }
    .url { word-break: break-all; background: #0a1020; padding: 13px; border-radius: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; border: 1px solid var(--border); color: var(--brand); }
    .copy-btn { margin-top: 12px; background: linear-gradient(135deg, #2b3a63, #3a2b63); }
    .info { color: var(--text-dim); font-size: 13px; margin-top: 6px; }
    .loading { display: none; color: var(--brand); font-size: 14px; margin-top: 10px; }
    .catalog-group { margin: 16px 0; }
    .catalog-group .section-label { font-weight: 600; margin-bottom: 12px; font-size: 14px; }
    #catalogCheckboxes, #updateCatalogCheckboxes, #seriesLangCheckboxes, #updateSeriesLangCheckboxes { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 8px; }
    .checkbox-label {
      display: flex; align-items: center; gap: 9px; margin: 0; font-weight: 500; font-size: 14px;
      background: var(--bg-input); border: 1px solid var(--border); padding: 11px 13px; border-radius: 10px;
      cursor: pointer; transition: border-color .15s, background .15s;
    }
    .checkbox-label:hover { border-color: var(--border-focus); }
    .checkbox-label input { margin: 0; width: 17px; height: 17px; accent-color: var(--brand); cursor: pointer; }
    .divider { border-top: 1px solid var(--border); margin: 30px 0 0; padding-top: 24px; }
    .load-btn { margin-top: 10px; background: linear-gradient(135deg, #2b3a63, #3a2b63); width: auto; padding: 10px 16px; font-size: 13.5px; }
    ol { color: var(--text-dim); padding-left: 20px; }
    ol li { margin: 4px 0; }
    .footer { text-align: center; color: #55607d; font-size: 12.5px; margin-top: 26px; }
    #toast {
      position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%) translateY(20px);
      background: var(--bg-elev); color: var(--text); border: 1px solid var(--border);
      padding: 13px 18px; border-radius: 12px; box-shadow: var(--shadow); font-size: 14px; font-weight: 600;
      opacity: 0; pointer-events: none; transition: opacity .2s, transform .2s; z-index: 50; max-width: 90vw;
    }
    #toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
    #toast.ok { border-color: var(--accent); }
    #toast.err { border-color: var(--danger); }
    @media (max-width: 480px) {
      #catalogCheckboxes, #updateCatalogCheckboxes, #seriesLangCheckboxes, #updateSeriesLangCheckboxes { grid-template-columns: 1fr; }
      .logo { font-size: 26px; }
    }
  </style>
</head>
<body>
  <div class="wrap">
  <div class="hero">
    <div class="logo"><span class="dot"></span>IndiaStreamz</div>
    <div class="tagline">Tamil, Telugu, Hindi, Malayalam, Kannada &amp; English movies &mdash; streamed via TorBox, right inside Stremio.</div>
    <div class="features">
      <span class="chip">6 languages</span>
      <span class="chip">Quality-labeled streams</span>
      <span class="chip">TorBox powered</span>
      <span class="chip">Genre filtering</span>
    </div>
  </div>
  <div class="container">
    <h1>IndiaStreamz Configuration</h1>
    <h3>Generate your addon URL</h3>
    <p>Enter your Torbox API key to generate a unique addon URL:</p>
    
    <form id="configForm">
      <div class="form-group">
        <label for="torboxApiKey">Torbox API Key *</label>
        <input type="text" id="torboxApiKey" name="torboxApiKey" placeholder="Enter your Torbox API key" required>
        <div class="info">Get your API key from your Torbox account settings</div>
      </div>
      
      <div class="form-group catalog-group">
        <div class="section-label">Movie catalogs to display (uncheck to hide):</div>
        <div id="catalogCheckboxes">${catalogCheckboxesHtml}</div>
        <div class="info">Only checked movie catalogs will appear in Stremio. Leave all checked to show everything.</div>
      </div>

      <div class="form-group catalog-group">
        <div class="section-label">Series languages (shown in the Series row):</div>
        <div id="seriesLangCheckboxes">${seriesLangCheckboxesHtml}</div>
        <div class="info">The single Series row shows only series in these languages. You can still pick any language from its dropdown to see more. Leave all checked to show every language.</div>
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
          <div class="section-label">Movie catalogs to display:</div>
          <div id="updateCatalogCheckboxes">${catalogCheckboxesHtml}</div>
        </div>
        <div class="form-group catalog-group">
          <div class="section-label">Series languages (shown in the Series row):</div>
          <div id="updateSeriesLangCheckboxes">${seriesLangCheckboxesHtml}</div>
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
  <div class="footer">Your addon URL contains an encrypted token &mdash; keep it private.</div>
  </div>
  <div id="toast" role="status" aria-live="polite"></div>
  
  <script>
    function showToast(msg, kind) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.className = 'show' + (kind ? ' ' + kind : '');
      clearTimeout(window.__toastTimer);
      window.__toastTimer = setTimeout(function() { t.className = t.className.replace('show', '').trim(); }, 2600);
    }
    const allCatalogIds = ${JSON.stringify(CATALOG_OPTIONS.map(c => c.id))};
    
    document.getElementById('configForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      const apiKey = document.getElementById('torboxApiKey').value.trim();
      
      if (!apiKey) {
        showToast('Please enter your Torbox API key', 'err');
        return;
      }
      
      const checkboxes = document.querySelectorAll('#catalogCheckboxes input[name="catalog"]:checked');
      const checked = Array.from(checkboxes).map(cb => cb.value);
      const visibleCatalogs = (checked.length === allCatalogIds.length || checked.length === 0) ? [] : checked;

      const seriesChecked = Array.from(document.querySelectorAll('#seriesLangCheckboxes input[name="seriesLang"]:checked')).map(cb => cb.value);
      const seriesLanguages = (seriesChecked.length === allCatalogIds.length || seriesChecked.length === 0) ? [] : seriesChecked;
      
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
          body: JSON.stringify({ torboxApiKey: apiKey, visibleCatalogs: visibleCatalogs, seriesLanguages: seriesLanguages })
        });
        
        const data = await response.json();
        
        if (data.success && data.addonUrl) {
          document.getElementById('addonUrl').textContent = data.addonUrl;
          resultEl.style.display = 'block';
          showToast('Addon URL generated', 'ok');
        } else {
          showToast('Failed to generate URL: ' + (data.error || 'Unknown error'), 'err');
        }
      } catch (error) {
        showToast('Error: ' + error.message, 'err');
      } finally {
        loadingEl.style.display = 'none';
        submitBtn.disabled = false;
      }
    });
    
    function copyUrl() {
      const url = document.getElementById('addonUrl').textContent;
      navigator.clipboard.writeText(url).then(() => {
        showToast('URL copied to clipboard', 'ok');
      }).catch(() => {
        const textArea = document.createElement('textarea');
        textArea.value = url;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showToast('URL copied to clipboard', 'ok');
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

    function setUpdateSeriesLangCheckboxes(seriesLanguages) {
      const checkboxes = document.querySelectorAll('#updateSeriesLangCheckboxes input[name="seriesLang"]');
      if (!seriesLanguages || seriesLanguages.length === 0) {
        checkboxes.forEach(cb => cb.checked = true);
      } else {
        const set = new Set(seriesLanguages);
        checkboxes.forEach(cb => { cb.checked = set.has(cb.value); });
      }
    }
    
    document.getElementById('loadPrefsBtn').addEventListener('click', async function() {
      const addonUrl = document.getElementById('addonUrlInput').value.trim();
      const token = extractTokenFromUrl(addonUrl);
      if (!token) {
        showToast('Please paste your addon URL first', 'err');
        return;
      }
      try {
        const res = await fetch('/api/token-config?token=' + encodeURIComponent(token));
        const data = await res.json();
        if (data.success) {
          setUpdateCheckboxes(data.visibleCatalogs);
          setUpdateSeriesLangCheckboxes(data.seriesLanguages);
          showToast('Preferences loaded', 'ok');
        } else {
          showToast('Could not load: ' + (data.error || 'Invalid token'), 'err');
        }
      } catch (e) {
        showToast('Error loading preferences', 'err');
      }
    });
    
    document.getElementById('updateForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      const addonUrl = document.getElementById('addonUrlInput').value.trim();
      const token = extractTokenFromUrl(addonUrl);
      
      if (!token) {
        showToast('Invalid addon URL. Paste your full manifest URL', 'err');
        return;
      }
      
      const checkboxes = document.querySelectorAll('#updateCatalogCheckboxes input[name="catalog"]:checked');
      const checked = Array.from(checkboxes).map(cb => cb.value);
      const visibleCatalogs = (checked.length === allCatalogIds.length || checked.length === 0) ? [] : checked;

      const seriesChecked = Array.from(document.querySelectorAll('#updateSeriesLangCheckboxes input[name="seriesLang"]:checked')).map(cb => cb.value);
      const seriesLanguages = (seriesChecked.length === allCatalogIds.length || seriesChecked.length === 0) ? [] : seriesChecked;
      
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
          body: JSON.stringify({ token: token, visibleCatalogs: visibleCatalogs, seriesLanguages: seriesLanguages })
        });
        
        const data = await response.json();
        
        if (data.success) {
          resultEl.style.display = 'block';
          showToast('Preferences updated', 'ok');
        } else {
          showToast('Failed to update: ' + (data.error || 'Unknown error'), 'err');
        }
      } catch (error) {
        showToast('Error: ' + error.message, 'err');
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

