module.exports = {
  /**
   * Generate cache key for language catalog
   */
  catalogKey: (language) => `catalog:${language}`,
  
  /**
   * Generate cache key for movie metadata
   */
  movieKey: (movieId) => `movie:${movieId}`,
  
  /**
   * Generate cache key for movie streams
   */
  streamKey: (movieId) => `stream:${movieId}`,
  
  /**
   * Extract language from catalog key
   */
  extractLanguageFromCatalogKey: (key) => {
    const match = key.match(/^catalog:(.+)$/);
    return match ? match[1] : null;
  },
  
  /**
   * Extract movie ID from key
   */
  extractMovieIdFromKey: (key) => {
    const match = key.match(/^(movie|stream):(.+)$/);
    return match ? match[2] : null;
  }
};

