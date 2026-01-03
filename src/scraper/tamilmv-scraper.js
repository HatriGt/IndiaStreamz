const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../utils/logger');
const constants = require('../utils/constants');
const { 
  parseMovieListings, 
  extractLanguage, 
  findMagnetLinks, 
  extractMovieTitle,
  detectLanguagesFromTitle,
  detectSeriesFromTitle,
  extractQualityFromMagnetText
} = require('./parsers');
const {
  generateMovieId,
  generateSeriesId,
  generateEpisodeStreamId,
  structureMovieForCatalog,
  structureMovieForMeta,
  structureSeriesForCatalog,
  structureSeriesForMeta,
  structureStreamsForStremio,
  structureEpisodeStreamsForStremio,
  normalizeTitle,
  extractYear,
  parseQuality
} = require('./extractors');

class TamilMVScraper {
  constructor() {
    this.baseUrl = constants.BASE_URL;
    this.languages = Object.values(constants.LANGUAGES);
    this.requestDelay = 1000; // 1 second delay between requests
  }

  /**
   * Get all supported languages
   */
  getAllLanguages() {
    return this.languages;
  }

  /**
   * Make HTTP request with retry logic
   */
  async fetchWithRetry(url, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await axios.get(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5'
          },
          timeout: 30000
        });
        return response.data;
      } catch (error) {
        if (i === retries - 1) throw error;
        logger.warn(`Request failed, retrying (${i + 1}/${retries}):`, url);
        await this.delay(this.requestDelay * (i + 1));
      }
    }
  }

  /**
   * Delay helper
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Scrape all movies and series from homepage
   */
  async scrapeAll() {
    logger.info('Starting full scrape from homepage...');
    const result = {
      catalogs: {},
      movies: {},
      series: {},
      streams: {}
    };

    // Initialize catalogs for all languages
    for (const language of this.languages) {
      result.catalogs[language] = [];
    }

    // Step 1: Fetch homepage
    logger.info('Fetching homepage...');
    const homepageHtml = await this.fetchWithRetry(this.baseUrl);
    
    // Debug: Count all /topic/ links in HTML
    const $debug = cheerio.load(homepageHtml);
    const allTopicLinks = $debug('a[href*="/topic/"]').length;
    logger.debug(`Total links with /topic/ in HTML: ${allTopicLinks}`);
    
    // Step 2: Extract all movie/series links from homepage
    logger.info('Extracting movie/series links from homepage...');
    const listings = parseMovieListings(homepageHtml);
    logger.info(`Found ${listings.length} content items on homepage`);
    
    if (listings.length === 0) {
      logger.warn('No content found on homepage');
      return result;
    }

    // Step 3: Process each content item
    const limit = Math.min(listings.length, 20); // Limit to first 20 for faster testing
    let processed = 0;
    let skipped = 0;

    for (let i = 0; i < limit; i++) {
      try {
        const listing = listings[i];
        logger.debug(`Processing ${i + 1}/${limit}: ${listing.title.substring(0, 50)}...`);
        
        const contentData = await this.scrapeContentDetails(listing.url, listing.title);
        
        if (!contentData) {
          skipped++;
          continue;
        }

        // Detect languages from original title (before normalization, which removes brackets/parentheses)
        // Use originalTitle from detail page, or fallback to listing title
        const titleForDetection = contentData.originalTitle || contentData.title || listing.title;
        const detectedLanguages = detectLanguagesFromTitle(titleForDetection);
        if (detectedLanguages.length === 0) {
          // Also try the original listing title as fallback
          const fallbackLanguages = detectLanguagesFromTitle(listing.title);
          if (fallbackLanguages.length > 0) {
            detectedLanguages.push(...fallbackLanguages);
          } else {
            logger.warn(`No languages detected for: ${titleForDetection.substring(0, 100)}`);
            skipped++;
            continue;
          }
        }

        // Check if it's a series (use original title for detection)
        const seriesInfo = detectSeriesFromTitle(titleForDetection);
        
        if (seriesInfo.isSeries) {
          // Handle series
          const seriesId = generateSeriesId(contentData.title, seriesInfo.season, detectedLanguages);
          contentData.id = seriesId;
          contentData.season = seriesInfo.season;
          contentData.episodes = seriesInfo.episodes;
          contentData.languages = detectedLanguages;
          contentData.type = 'series';
          
          // Store series metadata
          result.series[seriesId] = structureSeriesForMeta(contentData);
          
          // Store episode streams
          for (const episode of seriesInfo.episodes) {
            const episodeStreamId = generateEpisodeStreamId(seriesId, seriesInfo.season, episode);
            // For now, use same streams for all episodes (can be improved later)
            result.streams[episodeStreamId] = contentData.streams || [];
          }
          
          // Add to language catalogs
          for (const lang of detectedLanguages) {
            if (result.catalogs[lang]) {
              result.catalogs[lang].push(structureSeriesForCatalog(contentData));
            }
          }
          
          logger.success(`Added series: ${contentData.title} (S${seriesInfo.season}, ${seriesInfo.episodes.length} episodes) to ${detectedLanguages.length} languages`);
        } else {
          // Handle movie
          const movieId = generateMovieId(contentData.title, detectedLanguages);
          contentData.id = movieId;
          contentData.languages = detectedLanguages;
          contentData.type = 'movie';
          
          // Store movie metadata
          result.movies[movieId] = structureMovieForMeta(contentData);
          
          // Store streams
          result.streams[movieId] = contentData.streams || [];
          
          // Add to language catalogs
          for (const lang of detectedLanguages) {
            if (result.catalogs[lang]) {
              result.catalogs[lang].push(structureMovieForCatalog(contentData));
            }
          }
          
          logger.success(`Added movie: ${contentData.title} to ${detectedLanguages.length} languages`);
        }
        
        processed++;
        
        // Delay between requests
        await this.delay(this.requestDelay);
      } catch (error) {
        logger.error(`Error processing content item ${i + 1}:`, error.message);
        skipped++;
        // Continue with next item
      }
    }

    logger.success(`Scrape completed: ${processed} processed, ${skipped} skipped`);
    logger.info(`Movies: ${Object.keys(result.movies).length}, Series: ${Object.keys(result.series).length}`);
    
    // Log catalog stats
    for (const [lang, items] of Object.entries(result.catalogs)) {
      if (items.length > 0) {
        logger.info(`${lang} catalog: ${items.length} items`);
      }
    }

    return result;
  }


  /**
   * Scrape content details (movie or series) including magnet links
   */
  async scrapeContentDetails(contentUrl, originalTitle) {
    try {
      const html = await this.fetchWithRetry(contentUrl);
      const $ = cheerio.load(html);
      
      // Extract title (keep original for language detection)
      const extractedTitle = extractMovieTitle(html) || originalTitle || $('title').text().trim();
      const normalizedTitle = normalizeTitle(extractedTitle);
      
      if (!normalizedTitle) {
        logger.warn(`Could not extract title from: ${contentUrl}`);
        return null;
      }
      
      // Extract magnet links with their descriptions
      const magnetData = this.extractMagnetsWithDescriptions(html, $);
      const magnetLinks = magnetData.magnets;
      const magnetDescriptions = magnetData.descriptions;
      
      if (magnetLinks.length === 0) {
        logger.debug(`No magnet links found for: ${normalizedTitle}`);
        return null; // Don't return if no magnets
      }
      
      logger.debug(`Found ${magnetLinks.length} magnet links for: ${normalizedTitle}`);
      
      // Extract quality information from page and magnet descriptions
      const pageText = $('body').text();
      const qualities = [];
      const qualityPatterns = [
        { pattern: /4K|2160p|UHD/gi, quality: '4K' },
        { pattern: /1080p/gi, quality: '1080p' },
        { pattern: /720p/gi, quality: '720p' },
        { pattern: /480p/gi, quality: '480p' }
      ];
      
      for (const { pattern, quality } of qualityPatterns) {
        if (pattern.test(pageText) && !qualities.includes(quality)) {
          qualities.push(quality);
        }
      }
      
      // Also extract from magnet descriptions
      for (const desc of magnetDescriptions) {
        const quality = extractQualityFromMagnetText(desc);
        if (quality && !qualities.includes(quality)) {
          qualities.push(quality);
        }
      }
      
      // Extract year
      const year = extractYear(normalizedTitle) || extractYear(pageText);
      
      // Structure streams with quality information
      const streams = structureStreamsForStremio(
        magnetLinks, 
        magnetDescriptions, 
        qualities.length > 0 ? qualities : ['1080p']
      );
      
      // Build content data
      const contentData = {
        title: normalizedTitle,
        originalTitle: extractedTitle, // Keep original for language/series detection
        url: contentUrl,
        year: year,
        description: $('.ipsType_richText, .post-content').first().text().trim().substring(0, 500) || null,
        streams: streams,
        qualities: qualities.length > 0 ? qualities : ['1080p']
      };
      
      return contentData;
    } catch (error) {
      logger.error(`Error scraping content details from ${contentUrl}:`, error.message);
      return null;
    }
  }

  /**
   * Extract magnet links with their descriptions from HTML
   */
  extractMagnetsWithDescriptions(html, $) {
    const magnets = [];
    const descriptions = [];
    
    // Find all magnet links
    const magnetLinks = findMagnetLinks(html);
    
    // Try to find descriptions for each magnet
    // Look for text near MAGNET buttons
    $('a:contains("MAGNET"), button:contains("MAGNET"), [class*="magnet"], [id*="magnet"]').each((i, elem) => {
      const $elem = $(elem);
      const $parent = $elem.parent();
      const $row = $elem.closest('tr, div, li, p');
      
      // Get text from parent/row that might describe the quality
      let description = '';
      
      // Try to get text from the row
      if ($row.length) {
        description = $row.text().trim();
      } else if ($parent.length) {
        description = $parent.text().trim();
      }
      
      // Get the magnet link
      const href = $elem.attr('href') || $elem.attr('data-href') || $elem.attr('data-magnet');
      const onclick = $elem.attr('onclick') || '';
      const onclickMatch = onclick.match(/magnet:\?[^\s"'<>]+/i);
      
      if (href && href.startsWith('magnet:')) {
        magnets.push(href);
        descriptions.push(description);
      } else if (onclickMatch) {
        magnets.push(onclickMatch[0]);
        descriptions.push(description);
      }
    });
    
    // Also get magnets from direct links (without descriptions)
    const directMagnets = findMagnetLinks(html);
    for (const magnet of directMagnets) {
      if (!magnets.includes(magnet)) {
        magnets.push(magnet);
        descriptions.push(''); // No description available
      }
    }
    
    return { magnets, descriptions };
  }
}

module.exports = TamilMVScraper;

