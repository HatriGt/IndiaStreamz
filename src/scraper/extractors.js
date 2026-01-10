const { extractQualities, findMagnetLinks, extractQualityFromMagnetText } = require('./parsers');
const crypto = require('crypto');

/**
 * Generate a unique movie ID from title (language-agnostic for multi-language movies)
 */
function generateMovieId(title, languages = []) {
  // Use first language or 'multi' if multiple languages
  const langPrefix = languages.length === 1 ? languages[0] : (languages.length > 1 ? 'multi' : 'unknown');
  const normalized = `${langPrefix}-${title}`.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  
  // Create hash for uniqueness
  const hash = crypto.createHash('md5').update(normalized).digest('hex').substring(0, 8);
  return `${normalized}-${hash}`;
}

/**
 * Generate a unique series ID from title and season
 */
function generateSeriesId(title, season, languages = []) {
  const langPrefix = languages.length === 1 ? languages[0] : (languages.length > 1 ? 'multi' : 'unknown');
  const normalized = `${langPrefix}-${title}`.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  
  const hash = crypto.createHash('md5').update(`${normalized}-s${season}`).digest('hex').substring(0, 8);
  return `${normalized}-s${season}-${hash}`;
}

/**
 * Generate episode stream ID (Stremio format: series-id:season:episode)
 */
function generateEpisodeStreamId(seriesId, season, episode) {
  return `${seriesId}:${season}:${episode}`;
}

/**
 * Extract infoHash from magnet link
 */
function extractInfoHash(magnetLink) {
  const match = magnetLink.match(/btih:([a-f0-9]{40})/i);
  return match ? match[1] : null;
}

/**
 * Structure movie data for Stremio catalog format
 */
function structureMovieForCatalog(movieData) {
  // Prioritize TMDB title if available, else use scraped title
  // Priority: tmdbTitle > title (scraped) > name (from meta) > id
  const title = movieData.tmdbTitle || movieData.title || movieData.name || '';
  const displayName = title ? (movieData.tmdbTitle ? title : cleanTitleForDisplay(title)) : '';
  
  return {
    id: movieData.id,
    type: 'movie',
    name: displayName || movieData.id, // Fallback to ID if name is empty
    poster: movieData.poster || null,
    description: movieData.description || `${displayName} - ${movieData.languages ? movieData.languages.join(', ') : ''}`,
    genres: movieData.genres || [],
    releaseInfo: movieData.releaseInfo || null,
    director: movieData.director || [],
    cast: movieData.cast || [],
    imdbRating: movieData.imdbRating || null,
    background: movieData.background || null,
    logo: movieData.logo || null,
    runtime: movieData.runtime || null
  };
}

/**
 * Structure movie metadata for Stremio meta format
 */
function structureMovieForMeta(movieData) {
  // Prioritize TMDB title if available, else use scraped title
  // Priority: tmdbTitle > title (scraped) > name (from meta)
  const title = movieData.tmdbTitle || movieData.title || movieData.name || '';
  const displayName = title ? (movieData.tmdbTitle ? title : cleanTitleForDisplay(title)) : '';
  
  return {
    id: movieData.id,
    type: 'movie',
    name: displayName || movieData.id, // Fallback to ID if name is empty
    poster: movieData.poster || null,
    posterShape: 'regular',
    background: movieData.background || null,
    logo: movieData.logo || null,
    description: movieData.description || `${displayName} - ${movieData.languages ? movieData.languages.join(', ') : ''}`,
    releaseInfo: movieData.releaseInfo || null,
    released: movieData.released || null, // ISO 8601 date
    imdbRating: movieData.imdbRating || null,
    genres: movieData.genres || [],
    director: movieData.director || [],
    writer: movieData.writer || [],
    cast: movieData.cast || [],
    runtime: movieData.runtime || null,
    language: movieData.languages ? movieData.languages.join(', ') : null,
    originalLanguage: movieData.originalLanguage || null,
    country: movieData.country || null,
    tagline: movieData.tagline || null,
    trailers: movieData.trailers || null,
    popularity: movieData.popularity || null,
    voteCount: movieData.voteCount || null,
    productionCompanies: movieData.productionCompanies || null,
    spokenLanguages: movieData.spokenLanguages || null,
    website: movieData.url || movieData.website || null
  };
}

/**
 * Extract detailed stream info from magnet link display name
 * Format: Quality - Codec - Audio - Size (similar to aiostream)
 * Example: "4K - HEVC - DD+5.1 640Kbps - 17.8GB"
 */
function extractStreamDetailsFromMagnet(magnetLink) {
  if (!magnetLink || !magnetLink.includes('dn=')) {
    return null;
  }

  try {
    // Extract display name from magnet link
    const dnMatch = magnetLink.match(/dn=([^&]+)/);
    if (!dnMatch) return null;
    
    const displayName = decodeURIComponent(dnMatch[1]);
    
    // Parse components
    const details = {
      quality: null,
      codec: null,
      audio: null,
      audioBitrate: null,
      size: null,
      source: null,
      languages: []
    };
    
    const upper = displayName.toUpperCase();
    
    // Extract quality (4K, 1080p, 720p, etc.)
    if (upper.includes('4K') || upper.includes('2160P') || upper.includes('UHD')) {
      details.quality = '4K';
    } else if (upper.includes('1080P') || upper.includes('FULL HD')) {
      details.quality = '1080p';
    } else if (upper.includes('720P') || upper.includes('HD')) {
      details.quality = '720p';
    } else if (upper.includes('480P')) {
      details.quality = '480p';
    } else {
      details.quality = '1080p'; // Default
    }
    
    // Extract codec (HEVC, AVC, x264, x265, H.264, H.265)
    if (upper.includes('HEVC') || upper.includes('H.265') || upper.includes('X265')) {
      details.codec = 'HEVC';
    } else if (upper.includes('AVC') || upper.includes('H.264') || upper.includes('X264')) {
      details.codec = 'AVC';
    } else if (upper.includes('X265')) {
      details.codec = 'x265';
    } else if (upper.includes('X264')) {
      details.codec = 'x264';
    }
    
    // Extract source (WEB-DL, HDRip, BluRay, etc.)
    if (upper.includes('TRUE WEB-DL') || upper.includes('TRUE WEBDL')) {
      details.source = 'WEB-DL';
    } else if (upper.includes('WEB-DL') || upper.includes('WEBDL')) {
      details.source = 'WEB-DL';
    } else if (upper.includes('HDRIP') || upper.includes('HD RIP')) {
      details.source = 'HDRip';
    } else if (upper.includes('BLURAY') || upper.includes('BLU-RAY')) {
      details.source = 'BluRay';
    } else if (upper.includes('DVDRIP')) {
      details.source = 'DVDRip';
    }
    
    // Extract audio info (DD+5.1, AAC, DTS, etc.)
    const audioMatch = displayName.match(/\(([^)]*audio[^)]*|DD\+?[^)]*|AAC[^)]*|DTS[^)]*)\)/i);
    if (audioMatch) {
      const audioText = audioMatch[1];
      if (audioText.includes('DD+5.1') || audioText.includes('DD 5.1')) {
        details.audio = 'DD+5.1';
      } else if (audioText.includes('DD+') || audioText.includes('Dolby Digital')) {
        details.audio = 'DD+';
      } else if (audioText.includes('AAC')) {
        details.audio = 'AAC';
      } else if (audioText.includes('DTS')) {
        details.audio = 'DTS';
      }
      
      // Extract audio bitrate
      const bitrateMatch = audioText.match(/(\d+)\s*KBPS/i) || audioText.match(/(\d+)\s*KB/i);
      if (bitrateMatch) {
        details.audioBitrate = `${bitrateMatch[1]}Kbps`;
      }
    }
    
    // Extract file size
    const sizeMatch = displayName.match(/(\d+\.?\d*)\s*(GB|MB|TB)/i);
    if (sizeMatch) {
      const size = parseFloat(sizeMatch[1]);
      const unit = sizeMatch[2].toUpperCase();
      if (unit === 'GB') {
        details.size = size >= 1 ? `${size.toFixed(1)}GB` : `${(size * 1024).toFixed(0)}MB`;
      } else if (unit === 'MB') {
        details.size = size >= 1024 ? `${(size / 1024).toFixed(1)}GB` : `${size.toFixed(0)}MB`;
      } else {
        details.size = `${sizeMatch[0]}`;
      }
    }
    
    return details;
  } catch (error) {
    return null;
  }
}

/**
 * Format stream name in aiostream style
 * Format: Quality - Codec - Audio - Size
 * Example: "4K - HEVC - DD+5.1 640Kbps - 17.8GB"
 */
function formatStreamName(details) {
  if (!details) return '1080p';
  
  const parts = [];
  
  // Quality
  if (details.quality) {
    parts.push(details.quality);
  }
  
  // Codec
  if (details.codec) {
    parts.push(details.codec);
  }
  
  // Audio
  if (details.audio) {
    let audioStr = details.audio;
    if (details.audioBitrate) {
      audioStr += ` ${details.audioBitrate}`;
    }
    parts.push(audioStr);
  }
  
  // Size
  if (details.size) {
    parts.push(details.size);
  }
  
  // Source (optional, add at end if present)
  if (details.source && parts.length < 4) {
    parts.push(details.source);
  }
  
  return parts.length > 0 ? parts.join(' - ') : '1080p';
}

/**
 * Structure streams for Stremio stream format
 * Improved to extract detailed quality info from magnet links (aiostream style)
 */
function structureStreamsForStremio(magnetLinks, magnetDescriptions = [], qualities = []) {
  const streams = [];
  
  // Group magnets by quality
  for (let i = 0; i < magnetLinks.length; i++) {
    const magnet = magnetLinks[i];
    const infoHash = extractInfoHash(magnet);
    
    if (!infoHash) continue;
    
    // Extract detailed info from magnet link
    let streamName = '1080p'; // Default
    const details = extractStreamDetailsFromMagnet(magnet);
    
    if (details) {
      // Use detailed formatting (aiostream style)
      streamName = formatStreamName(details);
    } else {
      // Fallback: try to extract quality from magnet description
      if (magnetDescriptions && magnetDescriptions[i]) {
        streamName = extractQualityFromMagnetText(magnetDescriptions[i]);
      } else if (qualities && qualities.length > 0) {
        const qualityIndex = i % qualities.length;
        streamName = qualities[qualityIndex];
      }
    }
    
    // For torrents, Stremio requires infoHash (works in desktop app)
    // Note: Web player doesn't support torrents - users need desktop app
    // We include externalUrl as fallback for web users to download manually
    streams.push({
      name: streamName, // Detailed formatted name (aiostream style)
      infoHash: infoHash, // Stremio desktop will handle the torrent using this
      externalUrl: magnet, // Fallback: magnet link for manual download (web users)
      behaviorHints: {
        bingeGroup: `tamilmv-${infoHash.substring(0, 8)}`
      }
    });
  }
  
  // If no magnets, return empty
  if (streams.length === 0) {
    return [];
  }
  
  return streams;
}

/**
 * Structure series data for Stremio catalog format
 */
function structureSeriesForCatalog(seriesData) {
  // Prioritize TMDB name if available (TMDB uses 'name' for TV shows), else use scraped title
  // Priority: tmdbName > name (from meta) > title (scraped) > id
  const title = seriesData.tmdbName || seriesData.name || seriesData.title || '';
  const displayName = title ? (seriesData.tmdbName ? title : cleanTitleForDisplay(title)) : '';
  
  return {
    id: seriesData.id,
    type: 'series',
    name: displayName || seriesData.id, // Fallback to ID if name is empty
    poster: seriesData.poster || null,
    description: seriesData.description || `${displayName} - Season ${seriesData.season} (${seriesData.languages ? seriesData.languages.join(', ') : ''})`,
    genres: seriesData.genres || [],
    releaseInfo: seriesData.releaseInfo || null,
    director: seriesData.director || [],
    cast: seriesData.cast || [],
    imdbRating: seriesData.imdbRating || null,
    background: seriesData.background || null,
    logo: seriesData.logo || null,
    runtime: seriesData.runtime || null
  };
}

/**
 * Structure series metadata for Stremio meta format
 */
function structureSeriesForMeta(seriesData) {
  // Build seasons array in Stremio format
  const seasons = [];
  if (seriesData.season && seriesData.episodes && seriesData.episodes.length > 0) {
    const episodes = seriesData.episodes.map(ep => ({
      id: `${seriesData.id}:${seriesData.season}:${ep}`, // Stremio format
      title: `Episode ${ep}`,
      season: seriesData.season,
      episode: ep
    }));
    
    seasons.push({
      id: `${seriesData.id}:${seriesData.season}`, // Stremio format
      season: seriesData.season,
      title: `Season ${seriesData.season}`,
      episodes: episodes
    });
  }
  
  // Prioritize TMDB name if available (TMDB uses 'name' for TV shows), else use scraped title
  // Priority: tmdbName > name (from meta) > title (scraped) > id
  const title = seriesData.tmdbName || seriesData.name || seriesData.title || '';
  const displayName = title ? (seriesData.tmdbName ? title : cleanTitleForDisplay(title)) : '';
  
  return {
    id: seriesData.id,
    type: 'series',
    name: displayName || seriesData.id, // Fallback to ID if name is empty
    poster: seriesData.poster || null,
    posterShape: 'regular',
    background: seriesData.background || null,
    logo: seriesData.logo || null,
    description: seriesData.description || `${displayName} - Season ${seriesData.season} (${seriesData.languages ? seriesData.languages.join(', ') : ''})`,
    releaseInfo: seriesData.releaseInfo || null,
    released: seriesData.released || null, // ISO 8601 date
    imdbRating: seriesData.imdbRating || null,
    genres: seriesData.genres || [],
    director: seriesData.director || [],
    writer: seriesData.writer || [],
    cast: seriesData.cast || [],
    runtime: seriesData.runtime || null,
    language: seriesData.languages ? seriesData.languages.join(', ') : null,
    originalLanguage: seriesData.originalLanguage || null,
    country: seriesData.country || null,
    tagline: seriesData.tagline || null,
    trailers: seriesData.trailers || null,
    popularity: seriesData.popularity || null,
    voteCount: seriesData.voteCount || null,
    productionCompanies: seriesData.productionCompanies || null,
    spokenLanguages: seriesData.spokenLanguages || null,
    website: seriesData.url || seriesData.website || null,
    seasons: seasons
  };
}

/**
 * Structure episode streams for Stremio
 */
function structureEpisodeStreamsForStremio(magnetLinks, magnetDescriptions = [], qualities = [], season, episode) {
  const streams = structureStreamsForStremio(magnetLinks, magnetDescriptions, qualities);
  
  // Add season/episode info to stream names
  return streams.map(stream => ({
    ...stream,
    name: `S${season}E${episode} - ${stream.name}`
  }));
}

/**
 * Clean title for display - extracts just the movie/series name (no year, no language)
 */
function cleanTitleForDisplay(title) {
  if (!title) return '';
  
  // Remove common technical suffixes and patterns
  let cleaned = title
    .trim()
    .replace(/\s+/g, ' ')
    // Remove quality indicators
    .replace(/\s*-\s*\[.*?\]/g, '') // Remove [1080p & 720p...]
    .replace(/\s*-\s*\(.*?\)/g, '') // Remove (DD+5.1...)
    // Remove common technical terms
    .replace(/\s*(TRUE|WEB-DL|HDRip|PreDVD|HQ|UHD|ESub|HC-ESub|Org Auds|Original Audios|HQ Clean Audio|HQ Clean Audios)\s*/gi, ' ')
    .replace(/\s*-\s*-\s*/g, ' ') // Remove multiple dashes
    .replace(/\s+/g, ' ')
    .trim();
  
  // Remove year completely (no extraction, no re-addition)
  let nameOnly = cleaned.replace(/\s*\(\d{4}\)\s*/g, ' ').trim();
  nameOnly = nameOnly.replace(/\b(19|20)\d{2}\b/g, '').trim();
  
  // Remove language names (check anywhere in title, not just end)
  const languages = ['Tamil', 'Telugu', 'Hindi', 'Malayalam', 'Kannada', 'English', 'TAM', 'TEL', 'HIN', 'MAL', 'KAN', 'ENG'];
  for (const lang of languages) {
    // Remove from end
    const regexEnd = new RegExp(`\\s+${lang}\\s*$`, 'i');
    nameOnly = nameOnly.replace(regexEnd, '').trim();
    // Remove from beginning
    const regexStart = new RegExp(`^${lang}\\s+`, 'i');
    nameOnly = nameOnly.replace(regexStart, '').trim();
    // Remove standalone (with word boundaries)
    const regexStandalone = new RegExp(`\\b${lang}\\b`, 'gi');
    nameOnly = nameOnly.replace(regexStandalone, '').trim();
  }
  
  // Clean up multiple spaces and dashes
  nameOnly = nameOnly.replace(/\s+/g, ' ').replace(/\s*-\s*-\s*/g, ' ').trim();
  
  // Remove trailing dashes and spaces
  nameOnly = nameOnly.replace(/[-\s]+$/, '').trim();
  
  return nameOnly || cleaned; // Fallback to cleaned if empty
}

/**
 * Clean title for TMDB search - removes technical terms but keeps year for better matching
 * @param {string} title - Original title
 * @returns {Object} - { cleanTitle: string, year: number | null }
 */
function cleanTitleForTMDB(title) {
  if (!title) return { cleanTitle: '', year: null };
  
  // Extract year first (before cleaning)
  const yearMatch = title.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? parseInt(yearMatch[0]) : null;
  
  // Remove common technical suffixes and patterns
  let cleaned = title
    .trim()
    .replace(/\s+/g, ' ')
    // Remove quality indicators
    .replace(/\s*-\s*\[.*?\]/g, '') // Remove [1080p & 720p...]
    .replace(/\s*-\s*\(.*?\)/g, '') // Remove (DD+5.1...)
    // Remove "Clean Audio" as a suffix (with dash) - do this first
    .replace(/\s*-\s*Clean\s+Audio\s*$/gi, '')
    // Remove common technical terms (including standalone "Clean Audio")
    .replace(/\s*(TRUE|WEB-DL|HDRip|PreDVD|HQ|UHD|ESub|HC-ESub|Org Auds|Original Audios|HQ Clean Audio|HQ Clean Audios|Clean Audio)\s*/gi, ' ')
    .replace(/\s*-\s*-\s*/g, ' ') // Remove multiple dashes
    .replace(/\s+/g, ' ')
    .trim();
  
  // Remove year from title (we'll use it separately for search)
  let nameOnly = cleaned.replace(/\s*\(\d{4}\)\s*/g, ' ').trim();
  nameOnly = nameOnly.replace(/\b(19|20)\d{2}\b/g, '').trim();
  
  // Remove language names (check anywhere in title)
  const languages = ['Tamil', 'Telugu', 'Hindi', 'Malayalam', 'Kannada', 'English', 'TAM', 'TEL', 'HIN', 'MAL', 'KAN', 'ENG'];
  for (const lang of languages) {
    // Remove from end
    const regexEnd = new RegExp(`\\s+${lang}\\s*$`, 'i');
    nameOnly = nameOnly.replace(regexEnd, '').trim();
    // Remove from beginning
    const regexStart = new RegExp(`^${lang}\\s+`, 'i');
    nameOnly = nameOnly.replace(regexStart, '').trim();
    // Remove standalone (with word boundaries)
    const regexStandalone = new RegExp(`\\b${lang}\\b`, 'gi');
    nameOnly = nameOnly.replace(regexStandalone, '').trim();
  }
  
  // Clean up multiple spaces and dashes
  nameOnly = nameOnly.replace(/\s+/g, ' ').replace(/\s*-\s*-\s*/g, ' ').trim();
  
  return {
    cleanTitle: nameOnly || cleaned,
    year: year
  };
}

/**
 * Normalize movie title (for ID generation, keeps technical details)
 */
function normalizeTitle(title) {
  if (!title) return '';
  
  return title
    .trim()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract year from title
 */
function extractYear(title) {
  const match = title.match(/\b(19|20)\d{2}\b/);
  return match ? parseInt(match[0]) : null;
}

/**
 * Parse quality from text and return standardized quality
 */
function parseQuality(text) {
  const textLower = text.toLowerCase();
  
  if (textLower.includes('4k') || textLower.includes('2160p') || textLower.includes('uhd')) {
    return '4K';
  }
  if (textLower.includes('1080p') || textLower.includes('full hd')) {
    return '1080p';
  }
  if (textLower.includes('720p') || textLower.includes('hd')) {
    return '720p';
  }
  if (textLower.includes('480p')) {
    return '480p';
  }
  
  return '1080p'; // Default
}

module.exports = {
  generateMovieId,
  generateSeriesId,
  generateEpisodeStreamId,
  extractInfoHash,
  structureMovieForCatalog,
  structureMovieForMeta,
  structureSeriesForCatalog,
  structureSeriesForMeta,
  structureStreamsForStremio,
  structureEpisodeStreamsForStremio,
  cleanTitleForDisplay,
  cleanTitleForTMDB,
  normalizeTitle,
  extractYear,
  parseQuality,
  extractStreamDetailsFromMagnet,
  formatStreamName
};

