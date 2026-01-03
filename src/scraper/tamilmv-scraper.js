const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../utils/logger');
const constants = require('../utils/constants');
const TMDBClient = require('../integrations/tmdb-client');
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
  parseQuality,
  cleanTitleForTMDB
} = require('./extractors');

class TamilMVScraper {
  constructor() {
    this.baseUrl = constants.BASE_URL;
    this.languages = Object.values(constants.LANGUAGES);
    this.requestDelay = 1000; // 1 second delay between requests
    
    // Initialize TMDB client
    // Check both constants and process.env directly (Bun loads .env automatically)
    const apiKey = constants.TMDB_API_KEY || process.env.TMDB_API_KEY;
    if (apiKey && apiKey.trim().length > 0) {
      this.tmdbClient = new TMDBClient(apiKey.trim());
      logger.info(`TMDB client initialized with API key (length: ${apiKey.trim().length})`);
    } else {
      this.tmdbClient = null;
      logger.warn('TMDB API key not found. Set TMDB_API_KEY environment variable or in .env file');
      logger.debug('Checked constants.TMDB_API_KEY:', constants.TMDB_API_KEY ? 'exists' : 'null');
      logger.debug('Checked process.env.TMDB_API_KEY:', process.env.TMDB_API_KEY ? 'exists' : 'undefined');
    }
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

    // Import fileCache for checking existing movies/series
    const fileCache = require('../cache/file-cache');

    // Step 3: Process each content item
    const limit = Math.min(listings.length, 20); // Limit to first 20 for faster testing
    let processed = 0;
    let skipped = 0;
    let skippedCached = 0;

    for (let i = 0; i < limit; i++) {
      try {
        const listing = listings[i];
        logger.debug(`Processing ${i + 1}/${limit}: ${listing.title.substring(0, 50)}...`);
        
        // Pre-check: Try to detect if this content is already cached
        // Detect languages and series info from listing title
        const preDetectedLanguages = detectLanguagesFromTitle(listing.title);
        const preSeriesInfo = detectSeriesFromTitle(listing.title);
        
        let alreadyCached = false;
        if (preDetectedLanguages.length > 0) {
          if (preSeriesInfo.isSeries) {
            // Check if series exists in cache
            const potentialSeriesId = generateSeriesId(listing.title, preSeriesInfo.season, preDetectedLanguages);
            alreadyCached = await fileCache.hasMovie(potentialSeriesId); // Series are stored in moviesDir
            if (alreadyCached) {
              logger.debug(`Skipping cached series: ${listing.title.substring(0, 50)}... (ID: ${potentialSeriesId})`);
            }
          } else {
            // Check if movie exists in cache
            const potentialMovieId = generateMovieId(listing.title, preDetectedLanguages);
            alreadyCached = await fileCache.hasMovie(potentialMovieId);
            if (alreadyCached) {
              logger.debug(`Skipping cached movie: ${listing.title.substring(0, 50)}... (ID: ${potentialMovieId})`);
            }
          }
        }
        
        if (alreadyCached) {
          skippedCached++;
          continue; // Skip scraping this content
        }
        
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
          
          // Double-check: Make sure it's not already in cache (in case ID generation differs)
          if (await fileCache.hasMovie(seriesId)) {
            logger.debug(`Skipping cached series (double-check): ${contentData.title} (ID: ${seriesId})`);
            skippedCached++;
            continue;
          }
          
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
          
          // Double-check: Make sure it's not already in cache (in case ID generation differs)
          if (await fileCache.hasMovie(movieId)) {
            logger.debug(`Skipping cached movie (double-check): ${contentData.title} (ID: ${movieId})`);
            skippedCached++;
            continue;
          }
          
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

    logger.success(`Phase 1 completed: ${processed} processed, ${skipped} skipped, ${skippedCached} skipped (already cached)`);
    logger.info(`Movies: ${Object.keys(result.movies).length}, Series: ${Object.keys(result.series).length}`);
    
    // Phase 2: Batch TMDB Enrichment
    if (this.tmdbClient && Object.keys(result.movies).length > 0) {
      logger.info('Starting Phase 2: Batch TMDB enrichment...');
      await this.enrichWithTMDB(result);
    } else if (!this.tmdbClient) {
      logger.warn('TMDB client not available (no API key), skipping enrichment');
    }
    
    // Log catalog stats
    for (const [lang, items] of Object.entries(result.catalogs)) {
      if (items.length > 0) {
        logger.info(`${lang} catalog: ${items.length} items`);
      }
    }

    logger.success(`Scrape completed: ${processed} processed, ${skipped} skipped, ${skippedCached} skipped (already cached)`);
    return result;
  }

  /**
   * Phase 2: Batch enrich all movies with TMDB metadata
   * @param {Object} result - Scraped data result object
   */
  async enrichWithTMDB(result) {
    if (!this.tmdbClient) {
      logger.warn('TMDB client not available, skipping enrichment');
      return;
    }

    try {
      const movies = Object.values(result.movies);
      const movieIds = Object.keys(result.movies);
      
      if (movies.length === 0) {
        logger.debug('No movies to enrich with TMDB');
        return;
      }

      logger.info(`Enriching ${movies.length} movies with TMDB metadata...`);

      // Step 1: Prepare all movies for TMDB search
      const searchPromises = movies.map((movieData, index) => {
        const movieId = movieIds[index];
        // Get title from movieData - it might be in 'name' (from structureMovieForMeta) or 'title' (from contentData)
        const title = movieData.name || movieData.title || '';
        
        // Clean title for TMDB search (this also extracts year)
        const { cleanTitle, year: extractedYear } = cleanTitleForTMDB(title);
        // Use year from movieData if available, otherwise use extracted year
        const searchYear = movieData.year || extractedYear;

        return this.tmdbClient.searchMovie(cleanTitle, searchYear)
          .then(searchResults => ({
            movieId,
            movieData,
            searchResults,
            cleanTitle,
            searchYear
          }))
          .catch(error => {
            logger.debug(`TMDB search failed for "${cleanTitle}":`, error.message);
            return { movieId, movieData, searchResults: null, cleanTitle, searchYear };
          });
      });

      // Step 2: Batch search TMDB (all in parallel)
      logger.debug('Batch searching TMDB for all movies...');
      const searchResults = await Promise.allSettled(searchPromises);
      
      // Step 3: Find best matches and prepare detail fetches
      const detailPromises = [];
      const enrichedMovies = {};

      searchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          const { movieId, movieData, searchResults: tmdbResults, cleanTitle, searchYear } = result.value;
          
          if (!tmdbResults || tmdbResults.length === 0) {
            // No TMDB results, keep original movie data
            enrichedMovies[movieId] = movieData;
            return;
          }

          // Find best match
          const bestMatch = this.tmdbClient.findBestMatch(tmdbResults, cleanTitle, searchYear);
          
          if (!bestMatch || !bestMatch.id) {
            // No good match, keep original
            enrichedMovies[movieId] = movieData;
            return;
          }

          // Fetch movie details
          detailPromises.push(
            this.tmdbClient.getMovieDetails(bestMatch.id)
              .then(tmdbDetails => ({
                movieId,
                movieData,
                tmdbDetails,
                tmdbId: bestMatch.id
              }))
              .catch(error => {
                logger.debug(`TMDB details fetch failed for ID ${bestMatch.id}:`, error.message);
                return { movieId, movieData, tmdbDetails: null, tmdbId: bestMatch.id };
              })
          );
        } else {
          // Search failed, keep original
          const movieId = movieIds[index];
          enrichedMovies[movieId] = movies[index];
        }
      });

      // Step 4: Batch fetch details (all in parallel)
      if (detailPromises.length > 0) {
        logger.debug(`Fetching TMDB details for ${detailPromises.length} movies...`);
        const detailResults = await Promise.allSettled(detailPromises);

        // Step 5: Enrich all movies with TMDB data
        let successCount = 0;
        let failCount = 0;

        detailResults.forEach(result => {
          if (result.status === 'fulfilled') {
            const { movieId, movieData, tmdbDetails, tmdbId } = result.value;
            
            if (!tmdbDetails) {
              // Details fetch failed, keep original
              enrichedMovies[movieId] = movieData;
              failCount++;
              return;
            }

            // Extract metadata from TMDB
            const tmdbMetadata = this.tmdbClient.extractMetadata(tmdbDetails);
            
            if (tmdbMetadata) {
              // Merge TMDB metadata with existing movie data
              const enriched = {
                ...movieData,
                poster: tmdbMetadata.poster || movieData.poster,
                background: tmdbMetadata.background || movieData.background,
                genres: tmdbMetadata.genres.length > 0 ? tmdbMetadata.genres : movieData.genres,
                imdbRating: tmdbMetadata.imdbRating || movieData.imdbRating,
                description: tmdbMetadata.description || movieData.description,
                cast: tmdbMetadata.cast.length > 0 ? tmdbMetadata.cast : movieData.cast,
                director: tmdbMetadata.director.length > 0 ? tmdbMetadata.director : movieData.director,
                runtime: tmdbMetadata.runtime || movieData.runtime,
                releaseInfo: tmdbMetadata.releaseInfo || movieData.releaseInfo,
                tmdbId: tmdbMetadata.tmdbId
              };

              enrichedMovies[movieId] = enriched;
              successCount++;
            } else {
              enrichedMovies[movieId] = movieData;
              failCount++;
            }
          } else {
            // Details fetch failed, keep original
            const movieId = result.value?.movieId || movieIds[detailResults.indexOf(result)];
            enrichedMovies[movieId] = movies.find(m => m.id === movieId) || movies[detailResults.indexOf(result)];
            failCount++;
          }
        });

        // Update result.movies with enriched versions
        result.movies = enrichedMovies;

        // Update catalog entries with enriched metadata
        for (const [lang, catalogItems] of Object.entries(result.catalogs)) {
          for (let i = 0; i < catalogItems.length; i++) {
            const catalogItem = catalogItems[i];
            if (catalogItem.type === 'movie' && enrichedMovies[catalogItem.id]) {
              const enriched = enrichedMovies[catalogItem.id];
              catalogItems[i] = structureMovieForCatalog(enriched);
            }
          }
        }

        logger.success(`TMDB enrichment completed: ${successCount} successful, ${failCount} failed`);
      } else {
        // No movies matched, keep originals
        result.movies = enrichedMovies;
        logger.warn('No TMDB matches found for any movies');
      }
    } catch (error) {
      logger.error('Error during TMDB enrichment:', error.message);
      logger.warn('Continuing with unenriched data');
      // Don't throw - continue with original data
    }
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
      
      // Skip trailers, teasers, and promos
      const titleLower = normalizedTitle.toLowerCase();
      if (titleLower.includes('trailer') || 
          titleLower.includes('teaser') || 
          titleLower.includes('promo') ||
          titleLower.includes('teaser trailer') ||
          titleLower.includes('official trailer') ||
          titleLower.includes('trailer launch')) {
        logger.debug(`Skipping trailer/teaser/promo: ${normalizedTitle}`);
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

