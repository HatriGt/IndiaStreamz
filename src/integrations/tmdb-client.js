const axios = require('axios');
const logger = require('../utils/logger');
const constants = require('../utils/constants');

class TMDBClient {
  constructor(apiKey) {
    this.apiKey = apiKey || constants.TMDB_API_KEY;
    this.baseUrl = constants.TMDB_API_URL || 'https://api.themoviedb.org/3';
    this.posterBaseUrl = constants.TMDB_POSTER_BASE_URL || 'https://image.tmdb.org/t/p';
  }

  /**
   * Search for a movie in TMDB
   * @param {string} title - Movie title
   * @param {number|null} year - Release year (optional, helps with matching)
   * @returns {Promise<Object|null>} - Search results or null on failure
   */
  async searchMovie(title, year = null) {
    if (!this.apiKey) {
      logger.warn('TMDB: No API key provided');
      return null;
    }

    try {
      const params = {
        api_key: this.apiKey,
        query: title,
        language: 'en-US',
        page: 1
      };

      if (year) {
        params.year = year;
      }

      const response = await axios.get(`${this.baseUrl}/search/movie`, {
        params,
        timeout: 10000
      });

      if (response.data && response.data.results && response.data.results.length > 0) {
        return response.data.results;
      }

      return [];
    } catch (error) {
      logger.error(`TMDB: Error searching for movie "${title}":`, error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Get full movie details from TMDB
   * @param {number} tmdbId - TMDB movie ID
   * @returns {Promise<Object|null>} - Movie details or null on failure
   */
  async getMovieDetails(tmdbId) {
    if (!this.apiKey) {
      logger.warn('TMDB: No API key provided');
      return null;
    }

    try {
      // Fetch movie details, credits, and videos in parallel
      const [movieResponse, creditsResponse, videosResponse] = await Promise.allSettled([
        axios.get(`${this.baseUrl}/movie/${tmdbId}`, {
          params: {
            api_key: this.apiKey,
            language: 'en-US'
          },
          timeout: 10000
        }),
        axios.get(`${this.baseUrl}/movie/${tmdbId}/credits`, {
          params: {
            api_key: this.apiKey,
            language: 'en-US'
          },
          timeout: 10000
        }),
        axios.get(`${this.baseUrl}/movie/${tmdbId}/videos`, {
          params: {
            api_key: this.apiKey,
            language: 'en-US'
          },
          timeout: 10000
        })
      ]);

      const movieData = movieResponse.status === 'fulfilled' ? movieResponse.value.data : null;
      const creditsData = creditsResponse.status === 'fulfilled' ? creditsResponse.value.data : null;
      const videosData = videosResponse.status === 'fulfilled' ? videosResponse.value.data : null;

      if (!movieData) {
        logger.error(`TMDB: Failed to fetch movie details for ID ${tmdbId}`);
        return null;
      }

      // Merge credits into movie data
      if (creditsData) {
        movieData.cast = creditsData.cast || [];
        movieData.crew = creditsData.crew || [];
      }

      // Merge videos into movie data
      if (videosData) {
        movieData.videos = videosData.results || [];
      }

      return movieData;
    } catch (error) {
      logger.error(`TMDB: Error fetching movie details for ID ${tmdbId}:`, error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Get full TV series details from TMDB
   * @param {number} tmdbId - TMDB TV series ID
   * @returns {Promise<Object|null>} - TV series details or null on failure
   */
  async getTVDetails(tmdbId) {
    if (!this.apiKey) {
      logger.warn('TMDB: No API key provided');
      return null;
    }

    try {
      // Fetch TV details, credits, and videos in parallel
      const [tvResponse, creditsResponse, videosResponse] = await Promise.allSettled([
        axios.get(`${this.baseUrl}/tv/${tmdbId}`, {
          params: {
            api_key: this.apiKey,
            language: 'en-US'
          },
          timeout: 10000
        }),
        axios.get(`${this.baseUrl}/tv/${tmdbId}/credits`, {
          params: {
            api_key: this.apiKey,
            language: 'en-US'
          },
          timeout: 10000
        }),
        axios.get(`${this.baseUrl}/tv/${tmdbId}/videos`, {
          params: {
            api_key: this.apiKey,
            language: 'en-US'
          },
          timeout: 10000
        })
      ]);

      const tvData = tvResponse.status === 'fulfilled' ? tvResponse.value.data : null;
      const creditsData = creditsResponse.status === 'fulfilled' ? creditsResponse.value.data : null;
      const videosData = videosResponse.status === 'fulfilled' ? videosResponse.value.data : null;

      if (!tvData) {
        logger.error(`TMDB: Failed to fetch TV series details for ID ${tmdbId}`);
        return null;
      }

      // Merge credits into TV data
      if (creditsData) {
        tvData.cast = creditsData.cast || [];
        tvData.crew = creditsData.crew || [];
      }

      // Merge videos into TV data
      if (videosData) {
        tvData.videos = videosData.results || [];
      }

      return tvData;
    } catch (error) {
      logger.error(`TMDB: Error fetching TV series details for ID ${tmdbId}:`, error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Search for a TV series in TMDB
   * @param {string} title - TV series title
   * @param {number|null} year - First air date year (optional, helps with matching)
   * @returns {Promise<Array>} - Search results or empty array on failure
   */
  async searchTV(title, year = null) {
    if (!this.apiKey) {
      logger.warn('TMDB: No API key provided');
      return [];
    }

    try {
      const params = {
        api_key: this.apiKey,
        query: title,
        language: 'en-US',
        page: 1
      };

      if (year) {
        params.first_air_date_year = year;
      }

      const response = await axios.get(`${this.baseUrl}/search/tv`, {
        params,
        timeout: 10000
      });

      if (response.data && response.data.results && response.data.results.length > 0) {
        return response.data.results;
      }

      return [];
    } catch (error) {
      logger.error(`TMDB: Error searching for TV series "${title}":`, error.response?.data || error.message);
      return [];
    }
  }

  /**
   * Generate title variations for TV series (removes season/episode info)
   * @param {string} title - Original title
   * @returns {Array<string>} - Array of title variations
   */
  generateTVVariations(title) {
    const variations = new Set([title]); // Start with original
    
    // Remove season/episode info (e.g., "S01 EP (01-06)", "S02 EP(01-04)")
    // Enhanced: Also remove day numbers, empty parentheses, version numbers, and file sizes
    let baseTitle = title
      .replace(/\s*S\d+\s*EP?\s*\([^)]*\)/gi, '')
      .replace(/\s*EP?\s*\([^)]*\)/gi, '')
      .replace(/\s*S\d+\s*EP?\s*\d+/gi, '')
      .replace(/\s*EP?\s*\d+/gi, '')
      .replace(/\s*DAY\s+\d+/gi, '')
      .replace(/\s*\(\)\s*/g, ' ')
      // Remove version numbers (V2, V3, etc.)
      .replace(/\s*V\d+\s*/gi, ' ')
      // Remove file size patterns: "- 800MB & 400MB]", "- 3GB - 1.2GB & 600MB]"
      .replace(/\s*-\s*\d+\.?\d*\s*(GB|MB)\s*(&\s*\d+\.?\d*\s*(GB|MB))?\s*\]?/gi, '')
      .replace(/\s*-\s*\d+\.?\d*\s*(GB|MB)\s*-\s*\d+\.?\d*\s*(GB|MB)\s*(&\s*\d+\.?\d*\s*(GB|MB))?\s*\]?/gi, '')
      .replace(/\s*\d+\s*-\s*\d+\.?\d*\s*(GB|MB)\s*(&\s*\d+\.?\d*\s*(GB|MB))?\s*\]?/gi, '')
      .replace(/\s*\]\s*$/, '')
      .trim();
    
    if (baseTitle && baseTitle !== title) {
      variations.add(baseTitle);
    }
    
    // Remove "The" prefix variations
    if (baseTitle.toLowerCase().startsWith('the ')) {
      variations.add(baseTitle.substring(4).trim());
    } else {
      variations.add(`The ${baseTitle}`);
    }
    
    // Remove common suffixes (with and without dash)
    const suffixes = [
      ' - Clean Audio', ' Clean Audio', '- Clean Audio',
      ' HD', ' - HD', '- HD',
      ' HQ', ' - HQ', '- HQ',
      ' PreDVD', ' - PreDVD', '- PreDVD'
    ];
    
    for (const suffix of suffixes) {
      const lowerTitle = baseTitle.toLowerCase();
      const lowerSuffix = suffix.toLowerCase();
      if (lowerTitle.endsWith(lowerSuffix)) {
        variations.add(baseTitle.substring(0, baseTitle.length - suffix.length).trim());
      }
    }
    
    // Remove parenthetical info but keep main title
    const withoutParentheses = baseTitle.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    if (withoutParentheses && withoutParentheses !== baseTitle) {
      variations.add(withoutParentheses);
    }
    
    // Remove technical terms more aggressively
    const technicalTerms = ['TRUE', 'WEB-DL', 'HDRip', 'PreDVD', 'HQ', 'UHD', 'ESub', 'HC-ESub', 
                           'Org Auds', 'Original Audios', 'HQ Clean Audio', 'HQ Clean Audios', 
                           'Clean Audio', 'AVC', 'HEVC', 'x264', 'UNTOUCHED', 'ATMOS', 'BluRay', 'BR-Rip'];
    let cleanedTitle = baseTitle;
    for (const term of technicalTerms) {
      const regex = new RegExp(`\\s*${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'gi');
      cleanedTitle = cleanedTitle.replace(regex, ' ').trim();
    }
    if (cleanedTitle && cleanedTitle !== baseTitle) {
      variations.add(cleanedTitle);
    }
    
    // Remove trailing dashes and clean
    variations.forEach(v => {
      const cleaned = v.replace(/\s*-\s*$/, '').trim();
      if (cleaned && cleaned !== v) {
        variations.add(cleaned);
      }
    });
    
    return Array.from(variations).filter(v => v.length > 0);
  }

  /**
   * Search TV series with multiple title variations for better matching
   * @param {string} title - TV series title
   * @param {number|null} year - First air date year
   * @returns {Promise<Array>} - Combined search results from all variations
   */
  async searchTVWithVariations(title, year = null) {
    const variations = this.generateTVVariations(title);
    const allResults = [];
    
    // Try each variation
    for (const variation of variations) {
      try {
        const results = await this.searchTV(variation, year);
        if (results && results.length > 0) {
          allResults.push(...results);
        }
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        logger.debug(`TMDB TV search failed for variation "${variation}":`, error.message);
      }
    }
    
    // Remove duplicates by ID
    const uniqueResults = Array.from(
      new Map(allResults.map(r => [r.id, r])).values()
    );
    
    return uniqueResults;
  }

  /**
   * Generate title variations for better matching
   * @param {string} title - Original title
   * @returns {Array<string>} - Array of title variations
   */
  generateTitleVariations(title) {
    const variations = new Set([title]); // Start with original
    
    // Remove "The" prefix variations
    if (title.toLowerCase().startsWith('the ')) {
      variations.add(title.substring(4).trim());
    } else {
      variations.add(`The ${title}`);
    }
    
    // Remove common suffixes (with and without dash)
    const suffixes = [
      ' - Clean Audio', ' Clean Audio', '- Clean Audio',
      ' HD', ' - HD', '- HD',
      ' HQ', ' - HQ', '- HQ',
      ' PreDVD', ' - PreDVD', '- PreDVD'
    ];
    
    for (const suffix of suffixes) {
      const lowerTitle = title.toLowerCase();
      const lowerSuffix = suffix.toLowerCase();
      if (lowerTitle.endsWith(lowerSuffix)) {
        variations.add(title.substring(0, title.length - suffix.length).trim());
      }
    }
    
    // Remove parenthetical info but keep main title
    const withoutParentheses = title.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    if (withoutParentheses && withoutParentheses !== title) {
      variations.add(withoutParentheses);
    }
    
    // Remove trailing dashes and clean
    variations.forEach(v => {
      const cleaned = v.replace(/\s*-\s*$/, '').trim();
      if (cleaned && cleaned !== v) {
        variations.add(cleaned);
      }
    });
    
    return Array.from(variations).filter(v => v.length > 0);
  }

  /**
   * Search with multiple title variations for better matching
   * @param {string} title - Movie title
   * @param {number|null} year - Release year
   * @returns {Promise<Array>} - Combined search results from all variations
   */
  async searchMovieWithVariations(title, year = null) {
    const variations = this.generateTitleVariations(title);
    const allResults = [];
    
    // Try each variation
    for (const variation of variations) {
      try {
        const results = await this.searchMovie(variation, year);
        if (results && results.length > 0) {
          allResults.push(...results);
        }
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        logger.debug(`TMDB search failed for variation "${variation}":`, error.message);
      }
    }
    
    // Remove duplicates by ID
    const uniqueResults = Array.from(
      new Map(allResults.map(r => [r.id, r])).values()
    );
    
    return uniqueResults;
  }

  /**
   * Find best match from search results using fuzzy matching
   * @param {Array} searchResults - TMDB search results
   * @param {string} originalTitle - Original movie title from scraper
   * @param {number|null} year - Release year
   * @returns {Object|null} - Best matching result or null
   */
  findBestMatch(searchResults, originalTitle, year = null) {
    if (!searchResults || searchResults.length === 0) {
      logger.debug(`[TMDB] No search results for "${originalTitle}"`);
      return null;
    }

    logger.debug(`[TMDB] Matching "${originalTitle}" (year: ${year || 'none'})`);
    logger.debug(`[TMDB] Found ${searchResults.length} results`);

    // Normalize titles for comparison (more aggressive normalization)
    const normalize = (str) => {
      return str.toLowerCase()
        .replace(/[^a-z0-9]/g, '') // Remove all non-alphanumeric
        .replace(/\s+/g, ''); // Remove all spaces
    };

    const originalNormalized = normalize(originalTitle);

    // Score each result
    const scoredResults = searchResults.map(result => {
      let score = 0;

      // Title similarity
      const resultTitle = normalize(result.title || '');
      
      if (resultTitle === originalNormalized) {
        score += 100; // Exact match
      } else if (resultTitle.includes(originalNormalized) || originalNormalized.includes(resultTitle)) {
        score += 60; // One contains the other (increased from 50)
      } else {
        // Calculate similarity percentage
        const similarity = this.calculateSimilarity(resultTitle, originalNormalized);
        score += similarity * 40; // Max 40 points for similarity (increased from 30)
      }

      // Year match bonus (more important)
      if (year && result.release_date) {
        const resultYear = parseInt(result.release_date.substring(0, 4));
        if (resultYear === year) {
          score += 30; // Exact year match (increased from 20)
        } else if (Math.abs(resultYear - year) <= 1) {
          score += 15; // Close year match (increased from 10)
        }
      }

      // Popularity bonus
      if (result.popularity) {
        score += Math.min(result.popularity / 50, 15); // Max 15 points (increased from 10)
      }

      return { result, score };
    });

    // Sort by score (highest first)
    scoredResults.sort((a, b) => b.score - a.score);

    // Lower threshold from 30 to 20 for better matching
    const bestMatch = scoredResults[0];
    if (bestMatch && bestMatch.score >= 20) {
      logger.info(`[TMDB] ✓ Match: "${originalTitle}" -> "${bestMatch.result.title}" (score: ${bestMatch.score.toFixed(1)}, year: ${bestMatch.result.release_date?.substring(0,4) || 'no year'})`);
      return bestMatch.result;
    }

    // If score is low but we have results, log and return first result anyway
    if (bestMatch && bestMatch.score > 0) {
      logger.warn(`[TMDB] ✗ Weak match: "${originalTitle}" -> "${bestMatch.result.title}" (score: ${bestMatch.score.toFixed(1)}, using anyway)`);
      return bestMatch.result;
    }

    // No match found
    logger.warn(`[TMDB] ✗ No match: "${originalTitle}" (best score: ${bestMatch?.score.toFixed(1) || 0})`);
    if (searchResults.length > 0) {
      logger.debug(`[TMDB] Top result: "${searchResults[0].title}" (${searchResults[0].release_date?.substring(0,4) || 'no year'})`);
    }
    return null;
  }

  /**
   * Calculate string similarity (simple Levenshtein-based)
   * @param {string} str1
   * @param {string} str2
   * @returns {number} - Similarity score 0-1
   */
  calculateSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  levenshteinDistance(str1, str2) {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Format TMDB poster URL
   * @param {string} posterPath - Poster path from TMDB
   * @param {string} size - Size: w200, w300, w500, original (default: w500)
   * @returns {string|null} - Full poster URL or null
   */
  formatPosterUrl(posterPath, size = 'w500') {
    if (!posterPath) return null;
    return `${this.posterBaseUrl}/${size}${posterPath}`;
  }

  /**
   * Format TMDB backdrop URL
   * @param {string} backdropPath - Backdrop path from TMDB
   * @param {string} size - Size: w300, w780, w1280, original (default: original)
   * @returns {string|null} - Full backdrop URL or null
   */
  formatBackdropUrl(backdropPath, size = 'original') {
    if (!backdropPath) return null;
    return `${this.posterBaseUrl}/${size}${backdropPath}`;
  }

  /**
   * Extract and format metadata from TMDB movie data
   * @param {Object} tmdbData - Full TMDB movie data
   * @returns {Object} - Formatted metadata for Stremio
   */
  extractMetadata(tmdbData) {
    if (!tmdbData) return null;

    // Extract cast (top 10)
    const cast = (tmdbData.cast || [])
      .slice(0, 10)
      .map(actor => actor.name);

    // Extract directors
    const directors = (tmdbData.crew || [])
      .filter(person => person.job === 'Director')
      .map(person => person.name);

    // Extract writers (Screenplay, Writer, Story)
    const writers = (tmdbData.crew || [])
      .filter(person => 
        person.job === 'Writer' || 
        person.job === 'Screenplay' || 
        person.job === 'Story' ||
        person.job === 'Novel' ||
        person.job === 'Characters'
      )
      .map(person => person.name)
      .filter((name, index, self) => self.indexOf(name) === index); // Remove duplicates

    // Extract genres
    const genres = (tmdbData.genres || [])
      .map(genre => genre.name);

    // Format release date (year only for releaseInfo)
    const releaseInfo = tmdbData.release_date 
      ? new Date(tmdbData.release_date).getFullYear().toString()
      : null;

    // Format release date (ISO 8601 for released field)
    const released = tmdbData.release_date 
      ? new Date(tmdbData.release_date).toISOString()
      : null;

    // Extract trailers from videos
    // Handle both array format and object with results property
    const videosArray = Array.isArray(tmdbData.videos) 
      ? tmdbData.videos 
      : (tmdbData.videos?.results || []);
    
    const trailers = videosArray
      .filter(video => 
        video && 
        video.type === 'Trailer' && 
        video.site === 'YouTube' && 
        video.key
      )
      .map(video => ({
        youtube: video.key, // Stremio expects 'youtube' field with video ID
        thumbnail: `https://img.youtube.com/vi/${video.key}/maxresdefault.jpg`,
        title: video.name || 'Trailer'
      }))
      .slice(0, 3); // Limit to 3 trailers

    // Extract primary production country
    const country = tmdbData.production_countries && tmdbData.production_countries.length > 0
      ? tmdbData.production_countries[0].iso_3166_1
      : null;

    // Extract production companies
    const productionCompanies = (tmdbData.production_companies || [])
      .map(company => company.name)
      .slice(0, 5); // Limit to 5 companies

    // Extract spoken languages
    const spokenLanguages = (tmdbData.spoken_languages || [])
      .map(lang => lang.iso_639_1)
      .filter((lang, index, self) => self.indexOf(lang) === index); // Remove duplicates

    return {
      // Existing fields
      poster: this.formatPosterUrl(tmdbData.poster_path, 'w500'),
      background: this.formatBackdropUrl(tmdbData.backdrop_path, 'original'),
      genres: genres,
      // Note: TMDB doesn't provide IMDB ratings directly. This uses TMDB's vote_average (0-10 scale)
      // For actual IMDB ratings, would need to use external_ids endpoint + OMDB API
      imdbRating: tmdbData.vote_average ? tmdbData.vote_average.toFixed(1) : null, // TMDB rating (0-10 scale)
      description: tmdbData.overview || null,
      cast: cast,
      director: directors,
      runtime: tmdbData.runtime || null,
      releaseInfo: releaseInfo,
      tmdbId: tmdbData.id,
      tmdbTitle: tmdbData.title || null, // TMDB official title (prioritize this)
      
      // New fields from existing API response
      released: released,
      tagline: tmdbData.tagline || null,
      country: country,
      writer: writers,
      popularity: tmdbData.popularity || null,
      voteCount: tmdbData.vote_count || null,
      productionCompanies: productionCompanies.length > 0 ? productionCompanies : null,
      spokenLanguages: spokenLanguages.length > 0 ? spokenLanguages : null,
      originalLanguage: tmdbData.original_language || null,
      
      // New fields from videos API
      trailers: trailers.length > 0 ? trailers : null
    };
  }

  /**
   * Find best match from TV search results using fuzzy matching
   * @param {Array} searchResults - TMDB TV search results
   * @param {string} originalTitle - Original series title from scraper
   * @param {number|null} year - First air date year
   * @returns {Object|null} - Best matching result or null
   */
  findBestTVMatch(searchResults, originalTitle, year = null) {
    if (!searchResults || searchResults.length === 0) {
      return null;
    }

    // Normalize titles for comparison (more aggressive normalization)
    const normalize = (str) => {
      return str.toLowerCase()
        .replace(/[^a-z0-9]/g, '') // Remove all non-alphanumeric
        .replace(/\s+/g, ''); // Remove all spaces
    };

    const originalNormalized = normalize(originalTitle);

    // Score each result
    const scoredResults = searchResults.map(result => {
      let score = 0;

      // Title similarity (TV uses 'name' instead of 'title')
      const resultTitle = normalize(result.name || '');
      
      if (resultTitle === originalNormalized) {
        score += 100; // Exact match
      } else if (resultTitle.includes(originalNormalized) || originalNormalized.includes(resultTitle)) {
        score += 60; // One contains the other
      } else {
        // Calculate similarity percentage
        const similarity = this.calculateSimilarity(resultTitle, originalNormalized);
        score += similarity * 40; // Max 40 points for similarity
      }

      // Year match bonus (TV uses first_air_date)
      if (year && result.first_air_date) {
        const resultYear = parseInt(result.first_air_date.substring(0, 4));
        if (resultYear === year) {
          score += 30; // Exact year match
        } else if (Math.abs(resultYear - year) <= 1) {
          score += 15; // Close year match
        }
      }

      // Popularity bonus
      if (result.popularity) {
        score += Math.min(result.popularity / 50, 15); // Max 15 points
      }

      return { result, score };
    });

    // Sort by score (highest first)
    scoredResults.sort((a, b) => b.score - a.score);

    // Lower threshold to 15 for better series matching
    const bestMatch = scoredResults[0];
    if (bestMatch && bestMatch.score >= 15) {
      logger.debug(`TMDB TV match found: "${originalTitle}" -> "${bestMatch.result.name}" (score: ${bestMatch.score.toFixed(1)})`);
      return bestMatch.result;
    }

    // If score is low but we have results, log and return first result anyway
    if (bestMatch && bestMatch.score > 0) {
      logger.debug(`TMDB TV weak match: "${originalTitle}" -> "${bestMatch.result.name}" (score: ${bestMatch.score.toFixed(1)}, using anyway)`);
      return bestMatch.result;
    }

    // No match found
    logger.debug(`No TMDB TV match found for "${originalTitle}"`);
    return null;
  }

  /**
   * Extract and format metadata from TMDB TV series data
   * @param {Object} tmdbData - Full TMDB TV series data
   * @returns {Object} - Formatted metadata for Stremio
   */
  extractTVMetadata(tmdbData) {
    if (!tmdbData) return null;

    // Extract cast (top 10)
    const cast = (tmdbData.cast || [])
      .slice(0, 10)
      .map(actor => actor.name);

    // Extract creators (TV series have creators instead of directors)
    const creators = (tmdbData.created_by || [])
      .map(creator => creator.name);

    // Extract directors from crew (for episodes)
    const directors = (tmdbData.crew || [])
      .filter(person => person.job === 'Director')
      .map(person => person.name)
      .slice(0, 5); // Limit to 5

    // Extract writers
    const writers = (tmdbData.crew || [])
      .filter(person => 
        person.job === 'Writer' || 
        person.job === 'Screenplay' || 
        person.job === 'Story' ||
        person.job === 'Executive Producer'
      )
      .map(person => person.name)
      .filter((name, index, self) => self.indexOf(name) === index) // Remove duplicates
      .slice(0, 10); // Limit to 10

    // Extract genres
    const genres = (tmdbData.genres || [])
      .map(genre => genre.name);

    // Format first air date (year only for releaseInfo)
    const releaseInfo = tmdbData.first_air_date 
      ? new Date(tmdbData.first_air_date).getFullYear().toString()
      : null;

    // Format first air date (ISO 8601 for released field)
    const released = tmdbData.first_air_date 
      ? new Date(tmdbData.first_air_date).toISOString()
      : null;

    // Extract trailers from videos
    const videosArray = Array.isArray(tmdbData.videos) 
      ? tmdbData.videos 
      : (tmdbData.videos?.results || []);
    
    const trailers = videosArray
      .filter(video => 
        video && 
        video.type === 'Trailer' && 
        video.site === 'YouTube' && 
        video.key
      )
      .map(video => ({
        youtube: video.key,
        thumbnail: `https://img.youtube.com/vi/${video.key}/maxresdefault.jpg`,
        title: video.name || 'Trailer'
      }))
      .slice(0, 3); // Limit to 3 trailers

    // Extract primary production country
    const country = tmdbData.production_countries && tmdbData.production_countries.length > 0
      ? tmdbData.production_countries[0].iso_3166_1
      : null;

    // Extract production companies
    const productionCompanies = (tmdbData.production_companies || [])
      .map(company => company.name)
      .slice(0, 5); // Limit to 5 companies

    // Extract spoken languages
    const spokenLanguages = (tmdbData.spoken_languages || [])
      .map(lang => lang.iso_639_1)
      .filter((lang, index, self) => self.indexOf(lang) === index); // Remove duplicates

    // Extract runtime (TV series have episode_run_time array, take first)
    const runtime = tmdbData.episode_run_time && tmdbData.episode_run_time.length > 0
      ? tmdbData.episode_run_time[0]
      : null;

    return {
      // Existing fields
      poster: this.formatPosterUrl(tmdbData.poster_path, 'w500'),
      background: this.formatBackdropUrl(tmdbData.backdrop_path, 'original'),
      genres: genres,
      // Note: TMDB doesn't provide IMDB ratings directly. This uses TMDB's vote_average (0-10 scale)
      imdbRating: tmdbData.vote_average ? tmdbData.vote_average.toFixed(1) : null, // TMDB rating (0-10 scale)
      description: tmdbData.overview || null,
      cast: cast,
      director: creators.length > 0 ? creators : directors, // Use creators for TV, fallback to directors
      runtime: runtime,
      releaseInfo: releaseInfo,
      tmdbId: tmdbData.id,
      tmdbName: tmdbData.name || null, // TMDB official name (prioritize this)
      
      // New fields from existing API response
      released: released,
      tagline: tmdbData.tagline || null,
      country: country,
      writer: writers,
      popularity: tmdbData.popularity || null,
      voteCount: tmdbData.vote_count || null,
      productionCompanies: productionCompanies.length > 0 ? productionCompanies : null,
      spokenLanguages: spokenLanguages.length > 0 ? spokenLanguages : null,
      originalLanguage: tmdbData.original_language || null,
      
      // New fields from videos API
      trailers: trailers.length > 0 ? trailers : null
    };
  }
}

module.exports = TMDBClient;

