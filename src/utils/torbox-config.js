// Shared Torbox configuration store
// Uses file-based storage as fallback since Express middleware may not intercept serveHTTP routes

const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');

const CONFIG_FILE = path.join(__dirname, '../../cache/torbox-config.json');
const torboxConfigs = new Map(); // In-memory cache (Map of host -> config)

/**
 * Store Torbox config for a host (both in-memory and file)
 */
async function setConfig(host, config) {
  torboxConfigs.set(host, config);
  
  // Also save to file for persistence
  try {
    let fileConfig = {};
    try {
      const data = await fs.readFile(CONFIG_FILE, 'utf8');
      fileConfig = JSON.parse(data);
    } catch (e) {
      // File doesn't exist yet, that's okay
    }
    
    fileConfig[host] = config;
    await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
    await fs.writeFile(CONFIG_FILE, JSON.stringify(fileConfig, null, 2));
    logger.info(`[CONFIG] Saved Torbox config to file for host: ${host}`);
  } catch (error) {
    logger.error(`[CONFIG] Failed to save config to file:`, error.message);
  }
}

/**
 * Get Torbox config for a host (from memory or file)
 */
async function getConfig(host) {
  // First try in-memory
  if (torboxConfigs.has(host)) {
    return torboxConfigs.get(host);
  }
  
  // Fallback to file
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf8');
    const fileConfig = JSON.parse(data);
    if (fileConfig[host]) {
      // Load into memory for next time
      torboxConfigs.set(host, fileConfig[host]);
      return fileConfig[host];
    }
  } catch (e) {
    // File doesn't exist or can't be read
  }
  
  return null;
}

/**
 * Get config synchronously (for use in handlers that can't be async)
 * Tries memory first, then file (synchronously)
 */
function getConfigSync(host) {
  // First try in-memory
  if (torboxConfigs.has(host)) {
    return torboxConfigs.get(host);
  }
  
  // Fallback to file (synchronous read)
  try {
    const fsSync = require('fs');
    if (fsSync.existsSync(CONFIG_FILE)) {
      const data = fsSync.readFileSync(CONFIG_FILE, 'utf8');
      const fileConfig = JSON.parse(data);
      if (fileConfig[host]) {
        // Load into memory for next time
        torboxConfigs.set(host, fileConfig[host]);
        return fileConfig[host];
      }
    }
  } catch (e) {
    // File doesn't exist or can't be read
  }
  
  return null;
}

/**
 * Get all stored hosts
 */
function getHosts() {
  return Array.from(torboxConfigs.keys());
}

/**
 * Normalize host (handles localhost vs 127.0.0.1)
 */
function normalizeHost(host) {
  if (host && host.includes('127.0.0.1')) {
    return host.replace('127.0.0.1', 'localhost');
  }
  return host;
}

/**
 * Load config from file on startup
 */
async function loadFromFile() {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf8');
    const fileConfig = JSON.parse(data);
    for (const [host, config] of Object.entries(fileConfig)) {
      torboxConfigs.set(host, config);
    }
    logger.info(`[CONFIG] Loaded ${Object.keys(fileConfig).length} config(s) from file`);
  } catch (e) {
    // File doesn't exist yet, that's okay
  }
}

// Load config on module load
loadFromFile().catch(err => {
  logger.debug(`[CONFIG] No existing config file to load`);
});

module.exports = {
  setConfig,
  getConfig,
  getConfigSync,
  getHosts,
  normalizeHost,
  loadFromFile
};

