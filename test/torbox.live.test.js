const os = require('node:os');
const path = require('node:path');
// Isolate cache + load .env for local secrets
process.env.CACHE_DIR = path.join(os.tmpdir(), `indiastreamz-live-${process.pid}-${Date.now()}`);
try { require('dotenv').config(); } catch { /* dotenv optional */ }

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const constants = require('../src/utils/constants');
const TorboxClient = require('../src/integrations/torbox-client');
const TamilMVScraper = require('../src/scraper/tamilmv-scraper');
const fileCache = require('../src/cache/file-cache');
const streamHandler = require('../src/addon/stream-handler');

const API_KEY = (process.env.TORBOX_API_KEY_TEST || '').trim();
const HAS_KEY = API_KEY.length > 0;

// Entire suite is skipped when no key is configured, so `npm test` stays green
// for anyone without a TorBox key.
test('TorBox live integration', { skip: !HAS_KEY && 'TORBOX_API_KEY_TEST not set in .env' }, async (t) => {
  const torbox = new TorboxClient(API_KEY, constants.TORBOX_API_URL);

  await t.test('getMyTorrents returns an array (auth works)', async () => {
    const list = await torbox.getMyTorrents();
    assert.ok(Array.isArray(list), 'mylist should be an array');
    t.diagnostic(`mylist has ${list.length} torrents`);
  });

  // Scrape one real magnet from TamilMV for the full add -> stream path
  let magnet = null;
  let movieId = null;

  await t.test('scrape one real magnet from TamilMV', async () => {
    const scraper = new TamilMVScraper();
    if (process.env.LIVE_SCRAPE_BASE_URL) {
      scraper.baseUrl = process.env.LIVE_SCRAPE_BASE_URL;
    } else {
      await scraper.resolveDomain();
    }
    const homepage = await scraper.fetchWithRetry(scraper.baseUrl);
    const { parseMovieListings } = require('../src/scraper/parsers');
    const listings = parseMovieListings(homepage, scraper.baseUrl);
    assert.ok(listings.length > 0, 'expected at least one listing on homepage');

    // Walk listings until we find one with magnets
    for (let i = 0; i < Math.min(listings.length, 10); i++) {
      const details = await scraper.scrapeContentDetails(listings[i].url, listings[i].title);
      if (details && Array.isArray(details.streams) && details.streams.length > 0) {
        magnet = details.streams[0].externalUrl;
        break;
      }
    }
    assert.ok(magnet && magnet.startsWith('magnet:'), 'expected to scrape a magnet link');
    t.diagnostic(`scraped magnet: ${magnet.substring(0, 60)}...`);
  });

  await t.test('checkCached returns a status for the scraped magnet', async () => {
    const status = await torbox.checkCached(magnet);
    assert.ok(status && typeof status.cached === 'boolean', 'checkCached should return { cached }');
    t.diagnostic(`cached in TorBox: ${status.cached}`);
  });

  await t.test('full stream-handler path returns a playable stream (adds torrent)', async () => {
    // Seed a streams cache entry so the handler has something to convert
    movieId = 'tamil-live-test';
    const streamsDir = path.resolve(constants.CACHE_STREAMS_DIR);
    fs.mkdirSync(streamsDir, { recursive: true });
    const infoHash = torbox.extractInfoHash(magnet);
    fs.writeFileSync(path.join(streamsDir, `${movieId}.json`), JSON.stringify([
      { name: '1080p', title: '1080p live', infoHash, externalUrl: magnet, behaviorHints: {} }
    ]), 'utf8');
    fileCache.clearAllCaches();

    const res = await streamHandler({
      type: 'movie',
      id: movieId,
      extra: {
        torboxApiKey: API_KEY,
        torboxApiUrl: constants.TORBOX_API_URL,
        token: 'live-test-token',
        encrypted: 'live-test-enc',
        baseUrl: 'http://localhost:3005'
      }
    });

    assert.ok(Array.isArray(res.streams) && res.streams.length > 0, 'expected streams back');
    const s = res.streams[0];
    // A converted stream must be playable: either a direct/streaming url, a proxy url, or infoHash fallback
    const playable = !!(s.url || s.infoHash);
    assert.ok(playable, 'stream must have a url or infoHash to be playable');
    t.diagnostic(`stream[0]: name="${s.name}" url=${s.url ? s.url.substring(0, 60) + '...' : '(none)'} infoHash=${s.infoHash || '(none)'}`);
  });
});
