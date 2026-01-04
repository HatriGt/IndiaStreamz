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
   * Find best match from search results using fuzzy matching
   * @param {Array} searchResults - TMDB search results
   * @param {string} originalTitle - Original movie title from scraper
   * @param {number|null} year - Release year
   * @returns {Object|null} - Best matching result or null
   */
  findBestMatch(searchResults, originalTitle, year = null) {
    if (!searchResults || searchResults.length === 0) {
      return null;
    }

    // Normalize titles for comparison
    const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');

    const originalNormalized = normalize(originalTitle);

    // Score each result
    const scoredResults = searchResults.map(result => {
      let score = 0;

      // Title similarity (exact match = 100, partial = 50)
      const resultTitle = normalize(result.title || '');
      if (resultTitle === originalNormalized) {
        score += 100;
      } else if (resultTitle.includes(originalNormalized) || originalNormalized.includes(resultTitle)) {
        score += 50;
      } else {
        // Calculate similarity percentage
        const similarity = this.calculateSimilarity(resultTitle, originalNormalized);
        score += similarity * 30; // Max 30 points for similarity
      }

      // Year match bonus
      if (year && result.release_date) {
        const resultYear = parseInt(result.release_date.substring(0, 4));
        if (resultYear === year) {
          score += 20;
        } else if (Math.abs(resultYear - year) <= 1) {
          score += 10; // Close year match
        }
      }

      // Popularity bonus (more popular = more likely correct)
      if (result.popularity) {
        score += Math.min(result.popularity / 100, 10); // Max 10 points
      }

      return { result, score };
    });

    // Sort by score (highest first)
    scoredResults.sort((a, b) => b.score - a.score);

    // Return best match if score is reasonable (at least 30 points)
    const bestMatch = scoredResults[0];
    if (bestMatch && bestMatch.score >= 30) {
      return bestMatch.result;
    }

    // If no good match, return first result anyway (user can verify)
    return searchResults[0];
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
      imdbRating: tmdbData.vote_average ? (tmdbData.vote_average / 10).toFixed(1) : null,
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
}

module.exports = TMDBClient;

