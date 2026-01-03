module.exports = {
  BASE_URL: 'https://www.1tamilmv.lc/',
  
  LANGUAGES: {
    TAMIL: 'tamil',
    TELUGU: 'telugu',
    HINDI: 'hindi',
    MALAYALAM: 'malayalam',
    KANNADA: 'kannada',
    ENGLISH: 'english'
  },
  
  LANGUAGE_NAMES: {
    tamil: 'Tamil',
    telugu: 'Telugu',
    hindi: 'Hindi',
    malayalam: 'Malayalam',
    kannada: 'Kannada',
    english: 'English'
  },
  
  QUALITIES: {
    '4K': '4K',
    '2160p': '4K',
    '1080p': '1080p',
    '720p': '720p',
    '480p': '480p'
  },
  
  SCRAPE_INTERVAL: '0 */4 * * *', // Every 4 hours
  
  CACHE_DIR: 'cache',
  CACHE_CATALOGS_DIR: 'cache/catalogs',
  CACHE_MOVIES_DIR: 'cache/movies',
  CACHE_STREAMS_DIR: 'cache/streams',
  
  PORT: process.env.PORT || 3005,
  
  ADDON_ID: 'com.indiastreamz.tamilmv',
  ADDON_NAME: 'IndiaStreamz',
  ADDON_DESCRIPTION: 'TamilMV movies by language and quality',
  ADDON_VERSION: '1.0.0',
  
  TORBOX_API_URL: 'https://api.torbox.app',
  TORBOX_TIMEOUT: 30000, // 30 seconds
  TORBOX_POLL_INTERVAL: 2000 // 2 seconds
};

