// Token-based configuration manager
// Generates unique tokens and stores encrypted API keys

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');

const TOKENS_FILE = path.join(__dirname, '../../cache/tokens.json');
// Use fixed key for persistence across server restarts
// If ENCRYPTION_KEY env var is set, use it; otherwise use a fixed key
// Fixed key ensures tokens can be decrypted after server restart
// Must be exactly 64 hex characters (32 bytes) for AES-256
const ENCRYPTION_KEY_HEX = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
// Convert hex string to Buffer (32 bytes = 64 hex chars)
const ENCRYPTION_KEY = Buffer.from(ENCRYPTION_KEY_HEX, 'hex');
const ALGORITHM = 'aes-256-cbc';

// Validate key length
if (ENCRYPTION_KEY.length !== 32) {
  throw new Error(`Invalid encryption key length: expected 32 bytes, got ${ENCRYPTION_KEY.length}`);
}

// In-memory cache
let tokensCache = {};

/**
 * Encrypt text using AES-256-CBC
 */
function encrypt(text) {
  const iv = crypto.randomBytes(16);
  // ENCRYPTION_KEY is already a 32-byte Buffer
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return {
    iv: iv.toString('base64'),
    encrypted: encrypted
  };
}

/**
 * Decrypt text using AES-256-CBC
 */
function decrypt(encryptedData) {
  const iv = Buffer.from(encryptedData.iv, 'base64');
  // ENCRYPTION_KEY is already a 32-byte Buffer
  const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encryptedData.encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Generate a unique token
 */
function generateToken() {
  return crypto.randomUUID();
}

/**
 * Create a token and store the encrypted API key
 * @param {string} torboxApiKey - Torbox API key
 * @param {string} torboxApiUrl - Torbox API URL
 * @param {string[]} [visibleCatalogs] - Array of catalog IDs to show (e.g. ['tamil','telugu']). Empty/undefined = show all
 */
async function createToken(torboxApiKey, torboxApiUrl, visibleCatalogs) {
  const token = generateToken();
  const encrypted = encrypt(torboxApiKey);
  
  // Store token -> config mapping
  tokensCache[token] = {
    torboxApiKey: torboxApiKey, // Store plaintext in memory for quick access
    torboxApiUrl: torboxApiUrl,
    visibleCatalogs: Array.isArray(visibleCatalogs) ? visibleCatalogs : undefined,
    encrypted: encrypted, // Store encrypted for persistence
    createdAt: new Date().toISOString()
  };
  
  // Save to file
  await saveTokens();
  
  logger.info(`[TOKEN] Created token: ${token.substring(0, 8)}...`);
  return { token, encrypted };
}

/**
 * Update catalog visibility for an existing token
 */
async function updateTokenCatalogs(token, visibleCatalogs) {
  if (!tokensCache[token]) {
    return false;
  }
  tokensCache[token].visibleCatalogs = Array.isArray(visibleCatalogs) ? visibleCatalogs : undefined;
  await saveTokens();
  logger.info(`[TOKEN] Updated catalogs for token: ${token.substring(0, 8)}...`);
  return true;
}

/**
 * Get config for a token
 */
function getConfigForToken(token) {
  if (tokensCache[token]) {
    return {
      torboxApiKey: tokensCache[token].torboxApiKey,
      torboxApiUrl: tokensCache[token].torboxApiUrl,
      visibleCatalogs: tokensCache[token].visibleCatalogs
    };
  }
  return null;
}

/**
 * Save tokens to file
 */
async function saveTokens() {
  try {
    await fs.mkdir(path.dirname(TOKENS_FILE), { recursive: true });
    // Only save encrypted data to file (for security)
    const fileData = {};
    for (const [token, config] of Object.entries(tokensCache)) {
      fileData[token] = {
        encrypted: config.encrypted,
        torboxApiUrl: config.torboxApiUrl,
        visibleCatalogs: config.visibleCatalogs,
        createdAt: config.createdAt
      };
    }
    await fs.writeFile(TOKENS_FILE, JSON.stringify(fileData, null, 2));
  } catch (error) {
    logger.error(`[TOKEN] Failed to save tokens:`, error.message);
  }
}

/**
 * Load tokens from file
 */
async function loadTokens() {
  try {
    const data = await fs.readFile(TOKENS_FILE, 'utf8');
    const fileData = JSON.parse(data);
    
    let loadedCount = 0;
    let failedCount = 0;
    
    // Decrypt and load into memory
    for (const [token, config] of Object.entries(fileData)) {
      try {
        const decryptedKey = decrypt(config.encrypted);
        tokensCache[token] = {
          torboxApiKey: decryptedKey,
          torboxApiUrl: config.torboxApiUrl,
          visibleCatalogs: config.visibleCatalogs,
          encrypted: config.encrypted,
          createdAt: config.createdAt
        };
        loadedCount++;
      } catch (error) {
        failedCount++;
        // Old tokens encrypted with different key are expected - just skip them
        logger.debug(`[TOKEN] Skipped token ${token.substring(0, 8)} (encrypted with different key)`);
      }
    }
    
    if (loadedCount > 0) {
      logger.info(`[TOKEN] Loaded ${loadedCount} token(s) from file`);
    }
    if (failedCount > 0) {
      logger.info(`[TOKEN] Skipped ${failedCount} old token(s) that couldn't be decrypted (will need to regenerate)`);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.error(`[TOKEN] Failed to load tokens:`, error.message);
    }
  }
}

/**
 * Extract token from URL path
 * Expected format: /stremio/{token}/{encrypted}/manifest.json or /stremio/{token}/{encrypted}/stream/...
 */
function extractTokenFromPath(path) {
  const match = path.match(/^\/stremio\/([^\/]+)\//);
  return match ? match[1] : null;
}

// Load tokens on module initialization
loadTokens().catch(err => {
  logger.debug(`[TOKEN] No existing tokens file to load`);
});

module.exports = {
  createToken,
  getConfigForToken,
  updateTokenCatalogs,
  extractTokenFromPath,
  loadTokens
};

