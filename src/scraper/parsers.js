const cheerio = require('cheerio');
const logger = require('../utils/logger');

/**
 * Parse HTML to extract movie listings from forum
 */
function parseMovieListings(html) {
  const $ = cheerio.load(html);
  const movies = [];

  // Try multiple selectors for movie/topic listings
  // Based on Invision Power Board (IPB) forum structure
  
  logger.debug(`Parsing HTML, body length: ${$('body').html().length} chars`);
  
  // Method 0: Find ALL links with /topic/ in href (most comprehensive)
  // Based on browser analysis: 1253 links exist, most are in <strong> tags
  let totalLinksFound = 0;
  let skippedInvalid = 0;
  let skippedEmptyTitle = 0;
  let skippedDuplicate = 0;
  
  // Find all topic links and extract titles from parent <strong> tags
  $('a[href*="/topic/"]').each((i, elem) => {
    const $link = $(elem);
    let href = $link.attr('href');
    
    totalLinksFound++;
    
    // Skip if no href
    if (!href) {
      skippedInvalid++;
      return;
    }
    
    // Skip only truly invalid URLs (ending in -0/ or /topic/0/)
    // Don't skip URLs that just contain -0 in the middle (like /topic/195456-0)
    if (href.endsWith('/topic/') || 
        href.match(/\/topic\/\d+-0\/?$/) ||  // Ends with /topic/123-0 or /topic/123-0/
        href.includes('/topic/0/')) {        // Contains /topic/0/
      skippedInvalid++;
      return;
    }
    
    // Get title from parent <strong> tag (most links are inside <strong>)
    let title = '';
    const $strong = $link.closest('strong');
    if ($strong.length) {
      title = $strong.text().trim();
    } else {
      // Fallback: try parent element
      const $parent = $link.parent();
      title = $parent.text().trim();
    }
    
    // If still empty, use link text
    if (!title || title.length < 5) {
      title = $link.text().trim();
    }
    
    // Clean up title
    title = title.replace(/\s+/g, ' ').trim();
    title = title.replace(/^(Re:|RE:)\s*/i, '').trim();
    
    // Validate - must have title and valid URL
    // Accept titles as short as 10 chars (some quality-only links might be valid)
    if (href && title && title.length >= 10) {
      // Make URL absolute
      let fullUrl = href.startsWith('http') ? href : `https://www.1tamilmv.lc${href}`;
      
      // For this site, the query string IS the path (e.g., /index.php?/forums/topic/195489-...)
      // Extract topic ID for normalization, or use full URL without hash
      const topicIdMatch = fullUrl.match(/\/topic\/(\d+)/);
      const topicId = topicIdMatch ? topicIdMatch[1] : null;
      
      // Normalize: use topic ID if available, otherwise use full URL without hash
      const normalizedUrl = topicId ? `topic-${topicId}` : fullUrl.split('#')[0];
      
      // Check if we already have this URL
      const exists = movies.some(m => {
        const mTopicId = m.url.match(/\/topic\/(\d+)/)?.[1];
        const mNormalized = mTopicId ? `topic-${mTopicId}` : m.url.split('#')[0];
        return mNormalized === normalizedUrl;
      });
      
      if (!exists) {
        movies.push({
          title: title,
          url: fullUrl,
          href: href
        });
      } else {
        skippedDuplicate++;
      }
    } else {
      skippedEmptyTitle++;
    }
  });
  
  logger.debug(`Method 0: Found ${totalLinksFound} total /topic/ links, ${skippedInvalid} invalid URLs, ${skippedEmptyTitle} empty/short titles, ${skippedDuplicate} duplicates, ${movies.length} added`);
  
  // Method 1: Forum topic rows (IPB structure) - most reliable
  $('[data-topicid], .ipsDataItem[data-rowid], .cTopicRow, tr[data-rowid]').each((i, elem) => {
    const $item = $(elem);
    const topicId = $item.attr('data-topicid') || $item.attr('data-rowid');
    
    // Find the main topic link
    const $link = $item.find('a[href*="/topic/"]').first();
    
    if ($link.length) {
      let href = $link.attr('href');
      let title = $link.text().trim();
      
      // If title is empty, try to get from various elements
      if (!title || title.length < 5) {
        title = $item.find('.ipsType_break, .cTopicTitle, h3, h4, .ipsDataItem_title a, [data-role="title"]').first().text().trim();
      }
      
      // Clean up title
      title = title.replace(/\s+/g, ' ').trim();
      
      // Validate URL - must be a proper topic URL, not ending in -0/
      if (href && title && title.length > 5) {
        // Fix malformed URLs (remove -0/ at the end)
        href = href.replace(/-0\/$/, '/').replace(/-0$/, '');
        
        // Skip if URL looks invalid
        if (href.includes('/topic/0') || href.endsWith('/topic/') || href.match(/\/topic\/\d+-0/)) {
          return; // Skip this invalid URL
        }
        
        // Make URL absolute
        const fullUrl = href.startsWith('http') ? href : `https://www.1tamilmv.lc${href}`;
        const normalizedUrl = fullUrl.split('?')[0].split('#')[0];
        
        // Check if already exists
        const exists = movies.some(m => {
          const normalized = m.url.split('?')[0].split('#')[0];
          return normalized === normalizedUrl;
        });
        
        if (!exists) {
          movies.push({
            title: title,
            url: fullUrl,
            href: href
          });
        }
      }
    }
  });

  // Method 2: Direct topic links in main content area (fallback)
  $('.ipsDataList, .ipsList_reset, .cForumTopicTable').find('a[href*="/topic/"]').each((i, elem) => {
    const $link = $(elem);
    let href = $link.attr('href');
    let title = $link.text().trim();
    
    // Skip if already found or invalid
    if (!href || !title || title.length < 5) return;
    
    // Fix malformed URLs
    href = href.replace(/-0\/$/, '/').replace(/-0$/, '');
    
    // Skip invalid URLs - filter out malformed topic URLs
    if (href.includes('/topic/0') || 
        href.endsWith('/topic/') || 
        href.match(/\/topic\/\d+-0/) ||
        href.endsWith('-0/') ||
        href.endsWith('-0')) {
      return;
    }
    
    const fullUrl = href.startsWith('http') ? href : `https://www.1tamilmv.lc${href}`;
    
    // Check if we already have this URL
    const exists = movies.some(m => {
      const normalized = m.url.split('?')[0].split('#')[0];
      const normalizedNew = fullUrl.split('?')[0].split('#')[0];
      return normalized === normalizedNew;
    });
    
    if (!exists) {
      movies.push({
        title: title,
        url: fullUrl,
        href: href
      });
    }
  });

  // Method 3: Look in topic list containers
  $('.ipsTopicList, .topicList, [class*="TopicList"]').find('a[href*="/topic/"]').each((i, elem) => {
    const $link = $(elem);
    let href = $link.attr('href');
    let title = $link.text().trim();
    
    if (!href || !title || title.length < 5) return;
    
    // Fix malformed URLs
    href = href.replace(/-0\/$/, '/').replace(/-0$/, '');
    
    // Skip invalid URLs - filter out malformed topic URLs
    if (href.includes('/topic/0') || 
        href.endsWith('/topic/') || 
        href.match(/\/topic\/\d+-0/) ||
        href.endsWith('-0/') ||
        href.endsWith('-0')) {
      return;
    }
    
    const fullUrl = href.startsWith('http') ? href : `https://www.1tamilmv.lc${href}`;
    
    // Check if already exists
    const exists = movies.some(m => {
      const normalized = m.url.split('?')[0].split('#')[0];
      const normalizedNew = fullUrl.split('?')[0].split('#')[0];
      return normalized === normalizedNew;
    });
    
    if (!exists) {
      movies.push({
        title: title,
        url: fullUrl,
        href: href
      });
    }
  });

  // Remove duplicates and filter invalid URLs
  const uniqueMovies = [];
  const seenUrls = new Set();
  
  logger.debug(`Found ${movies.length} total movie links before final filtering`);
  
  const beforeFilter = movies.length;
  const finalMovies = [];
  
  for (const movie of movies) {
    // Normalize URL using topic ID (since query string IS the path)
    const topicIdMatch = movie.url.match(/\/topic\/(\d+)/);
    const topicId = topicIdMatch ? topicIdMatch[1] : null;
    
    // Skip if no topic ID found or invalid topic ID
    if (!topicId || topicId === '0' || movie.url.match(/\/topic\/\d+-0/)) {
      logger.debug(`Skipping invalid URL (no topic ID): ${movie.url.substring(0, 100)}`);
      continue;
    }
    
    // Use topic ID for normalization
    const normalizedUrl = `topic-${topicId}`;
    
    if (!seenUrls.has(normalizedUrl)) {
      seenUrls.add(normalizedUrl);
      finalMovies.push(movie);
    }
  }

  logger.debug(`After final filtering: ${beforeFilter} -> ${finalMovies.length} unique movies`);
  return finalMovies;
}

/**
 * Extract language from URL or page content
 */
function extractLanguage(url, html) {
  const $ = cheerio.load(html);
  
  // Check URL for language indicators
  const urlLower = url.toLowerCase();
  if (urlLower.includes('/tamil/') || urlLower.includes('tamil')) return 'tamil';
  if (urlLower.includes('/telugu/') || urlLower.includes('telugu')) return 'telugu';
  if (urlLower.includes('/hindi/') || urlLower.includes('hindi')) return 'hindi';
  if (urlLower.includes('/malayalam/') || urlLower.includes('malayalam')) return 'malayalam';
  if (urlLower.includes('/kannada/') || urlLower.includes('kannada')) return 'kannada';
  if (urlLower.includes('/english/') || urlLower.includes('english')) return 'english';
  
  // Check page content for language indicators
  const pageText = $('body').text().toLowerCase();
  if (pageText.includes('tamil movies')) return 'tamil';
  if (pageText.includes('telugu movies')) return 'telugu';
  if (pageText.includes('hindi movies')) return 'hindi';
  if (pageText.includes('malayalam movies')) return 'malayalam';
  if (pageText.includes('kannada movies')) return 'kannada';
  if (pageText.includes('english movies')) return 'english';
  
  return null;
}

/**
 * Extract quality indicators from text
 */
function extractQualities(text) {
  const qualities = [];
  const qualityPatterns = [
    /4K/gi,
    /2160p/gi,
    /1080p/gi,
    /720p/gi,
    /480p/gi,
    /UHD/gi,
    /HD/gi
  ];
  
  const qualityMap = {
    '4k': '4K',
    '2160p': '4K',
    '1080p': '1080p',
    '720p': '720p',
    '480p': '480p',
    'uhd': '4K',
    'hd': '1080p'
  };
  
  for (const pattern of qualityPatterns) {
    const match = text.match(pattern);
    if (match) {
      const quality = qualityMap[match[0].toLowerCase()] || match[0].toUpperCase();
      if (!qualities.includes(quality)) {
        qualities.push(quality);
      }
    }
  }
  
  return qualities;
}

/**
 * Find magnet links in HTML content
 */
function findMagnetLinks(html) {
  const $ = cheerio.load(html);
  const magnets = [];
  
  // Method 1: Find all links that are magnet links (including buttons)
  $('a[href^="magnet:"], button[data-magnet], [data-href^="magnet:"]').each((i, elem) => {
    const $elem = $(elem);
    let href = $elem.attr('href') || $elem.attr('data-href') || $elem.attr('data-magnet');
    
    if (href && href.startsWith('magnet:')) {
      // Clean up the magnet link
      href = href.trim();
      if (!magnets.includes(href)) {
        magnets.push(href);
      }
    }
  });
  
  // Method 2: Look for MAGNET buttons and extract from onclick or data attributes
  $('a:contains("MAGNET"), button:contains("MAGNET"), [class*="magnet"], [id*="magnet"]').each((i, elem) => {
    const $elem = $(elem);
    const onclick = $elem.attr('onclick') || '';
    const dataHref = $elem.attr('data-href') || '';
    const href = $elem.attr('href') || '';
    
    // Extract magnet from onclick
    const onclickMatch = onclick.match(/magnet:\?[^\s"'<>]+/i);
    if (onclickMatch) {
      const magnet = onclickMatch[0].trim();
      if (!magnets.includes(magnet)) {
        magnets.push(magnet);
      }
    }
    
    // Check data-href
    if (dataHref.startsWith('magnet:')) {
      if (!magnets.includes(dataHref)) {
        magnets.push(dataHref);
      }
    }
    
    // Check href
    if (href.startsWith('magnet:')) {
      if (!magnets.includes(href)) {
        magnets.push(href);
      }
    }
  });
  
  // Method 3: Check for magnet links in text content (more thorough)
  const bodyText = $('body').html() || '';
  const magnetRegex = /magnet:\?[^\s<>"']+/gi;
  const matches = bodyText.match(magnetRegex);
  
  if (matches) {
    for (const match of matches) {
      const cleaned = match.trim();
      if (cleaned.startsWith('magnet:') && !magnets.includes(cleaned)) {
        magnets.push(cleaned);
      }
    }
  }
  
  // Method 4: Look in code blocks or pre tags
  $('code, pre, .code').each((i, elem) => {
    const text = $(elem).text();
    const codeMatches = text.match(/magnet:\?[^\s]+/gi);
    if (codeMatches) {
      for (const match of codeMatches) {
        const cleaned = match.trim();
        if (!magnets.includes(cleaned)) {
          magnets.push(cleaned);
        }
      }
    }
  });
  
  return magnets;
}

/**
 * Extract movie title from page
 */
function extractMovieTitle(html) {
  const $ = cheerio.load(html);
  
  // Try various selectors for title
  const titleSelectors = [
    'h1',
    '.ipsType_pageTitle',
    '.topic-title',
    '[data-role="title"]',
    'title'
  ];
  
  for (const selector of titleSelectors) {
    const title = $(selector).first().text().trim();
    if (title && title.length > 0) {
      return title;
    }
  }
  
  return null;
}

/**
 * Detect languages from movie/series title
 * Examples:
 * - "(Tamil + Telugu + Hindi)"
 * - "(TAM + TEL + HIN + MAL + KAN + ENG)"
 * - "[TAM+ TEL + HIN + ENG]"
 */
function detectLanguagesFromTitle(title) {
  const detectedLanguages = [];
  const titleUpper = title.toUpperCase();
  
  // Language mapping
  const languageMap = {
    // Full names
    'TAMIL': 'tamil',
    'TELUGU': 'telugu',
    'HINDI': 'hindi',
    'MALAYALAM': 'malayalam',
    'KANNADA': 'kannada',
    'ENGLISH': 'english',
    'ENG': 'english',
    // Abbreviations
    'TAM': 'tamil',
    'TEL': 'telugu',
    'HIN': 'hindi',
    'MAL': 'malayalam',
    'KAN': 'kannada',
    // Alternative names
    'CHI': 'hindi', // Sometimes used for Chinese, but in Indian context usually Hindi
    'CHINESE': 'hindi'
  };
  
  // Look for language patterns in parentheses or brackets
  // Pattern: (Tamil + Telugu) or (TAM + TEL) or [TAM+ TEL + HIN]
  const patterns = [
    /\(([^)]+)\)/g,  // (Tamil + Telugu)
    /\[([^\]]+)\]/g, // [TAM + TEL]
    /\(([^)]+)\)/g   // Also check for language mentions outside brackets
  ];
  
  const foundPatterns = new Set();
  
  // Extract text from parentheses/brackets
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(title)) !== null) {
      const content = match[1];
      // Check if this looks like a language list
      if (content.includes('+') || content.match(/\b(TAM|TEL|HIN|MAL|KAN|ENG|Tamil|Telugu|Hindi|Malayalam|Kannada|English)\b/i)) {
        foundPatterns.add(content);
      }
    }
  }
  
  // Parse languages from found patterns
  for (const pattern of foundPatterns) {
    // Split by + and check each part
    const parts = pattern.split(/\+/).map(p => p.trim().toUpperCase());
    for (const part of parts) {
      if (languageMap[part]) {
        const lang = languageMap[part];
        if (!detectedLanguages.includes(lang)) {
          detectedLanguages.push(lang);
        }
      }
    }
  }
  
  // Also check for standalone language mentions in title
  for (const [key, lang] of Object.entries(languageMap)) {
    if (titleUpper.includes(key) && !detectedLanguages.includes(lang)) {
      // Make sure it's not part of another word
      const regex = new RegExp(`\\b${key}\\b`, 'i');
      if (regex.test(title)) {
        detectedLanguages.push(lang);
      }
    }
  }
  
  return detectedLanguages;
}

/**
 * Detect if title is a series and extract season/episode info
 * Examples:
 * - "Run Away (2025) S01 EP(01-08)"
 * - "Stranger Things (2025) S05 EP(01-08)"
 * - "LBW - Love Beyond Wicket (2025) S01 EP (01-04)"
 */
function detectSeriesFromTitle(title) {
  const result = {
    isSeries: false,
    season: null,
    episodes: []
  };
  
  // Pattern 1: S01, S05, etc.
  const seasonMatch = title.match(/S(\d+)/i);
  if (seasonMatch) {
    result.isSeries = true;
    result.season = parseInt(seasonMatch[1], 10);
  }
  
  // Pattern 2: Season 1, Season 5, etc.
  if (!result.isSeries) {
    const seasonMatch2 = title.match(/Season\s+(\d+)/i);
    if (seasonMatch2) {
      result.isSeries = true;
      result.season = parseInt(seasonMatch2[1], 10);
    }
  }
  
  // Extract episode range: EP(01-08), EP 01-08, EP(1-8)
  const episodeMatch = title.match(/EP\s*\(?\s*(\d+)\s*-\s*(\d+)\s*\)?/i);
  if (episodeMatch) {
    result.isSeries = true;
    const startEp = parseInt(episodeMatch[1], 10);
    const endEp = parseInt(episodeMatch[2], 10);
    
    // Generate episode list
    for (let ep = startEp; ep <= endEp; ep++) {
      result.episodes.push(ep);
    }
  } else {
    // Try alternative: Episode 1-8, Episode 1 to 8
    const episodeMatch2 = title.match(/Episode\s+(\d+)\s*(?:-|to)\s*(\d+)/i);
    if (episodeMatch2) {
      result.isSeries = true;
      const startEp = parseInt(episodeMatch2[1], 10);
      const endEp = parseInt(episodeMatch2[2], 10);
      for (let ep = startEp; ep <= endEp; ep++) {
        result.episodes.push(ep);
      }
    }
  }
  
  // If we detected season but no episodes, try to infer
  if (result.isSeries && result.season && result.episodes.length === 0) {
    // Look for single episode number
    const singleEpMatch = title.match(/EP\s*\(?\s*(\d+)\s*\)?/i);
    if (singleEpMatch) {
      result.episodes.push(parseInt(singleEpMatch[1], 10));
    }
  }
  
  return result;
}

/**
 * Extract quality from magnet link description text
 */
function extractQualityFromMagnetText(text) {
  const textUpper = text.toUpperCase();
  
  // Quality patterns in order of preference
  if (textUpper.includes('4K') || textUpper.includes('2160P') || textUpper.includes('UHD')) {
    return '4K';
  }
  if (textUpper.includes('1080P') || textUpper.includes('FULL HD')) {
    return '1080p';
  }
  if (textUpper.includes('720P') || textUpper.includes('HD')) {
    return '720p';
  }
  if (textUpper.includes('480P')) {
    return '480p';
  }
  
  // Default
  return '1080p';
}

module.exports = {
  parseMovieListings,
  extractLanguage,
  extractQualities,
  findMagnetLinks,
  extractMovieTitle,
  detectLanguagesFromTitle,
  detectSeriesFromTitle,
  extractQualityFromMagnetText
};

