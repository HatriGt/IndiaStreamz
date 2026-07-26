const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');
const constants = require('../utils/constants');
const cacheKeys = require('./cache-keys');

class FileCache {
  constructor() {
    this.catalogsDir = constants.CACHE_CATALOGS_DIR;
    this.moviesDir = constants.CACHE_MOVIES_DIR;
    this.streamsDir = constants.CACHE_STREAMS_DIR;
    
    // In-memory cache for catalogs, movies, and streams
    // Structure: Map<key, { data, mtime }>
    this.catalogCache = new Map(); // language -> { data, mtime }
    this.movieCache = new Map(); // movieId -> { data, mtime }
    this.streamCache = new Map(); // contentId -> { data, mtime }
    
    this.ensureDirectories();
  }

  async ensureDirectories() {
    try {
      await fs.mkdir(this.catalogsDir, { recursive: true });
      await fs.mkdir(this.moviesDir, { recursive: true });
      await fs.mkdir(this.streamsDir, { recursive: true });
    } catch (error) {
      logger.error('Failed to create cache directories:', error);
    }
  }

  /**
   * Get catalog for a language (with in-memory caching)
   */
  async getCatalog(language) {
    try {
      const filePath = path.join(this.catalogsDir, `${language}.json`);
      
      // Check if we have it in cache
      const cached = this.catalogCache.get(language);
      if (cached) {
        try {
          // Check file modification time to see if cache is still valid
          const stats = await fs.stat(filePath);
          if (stats.mtimeMs === cached.mtime) {
            // Cache is valid, return cached data
            return cached.data;
          }
          // File was modified, need to reload
        } catch (error) {
          // File might not exist, but we have cache - return it anyway
          if (error.code === 'ENOENT') {
            return cached.data;
          }
        }
      }
      
      // Load from disk
      const data = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(data);
      
      // Get file stats for cache invalidation
      const stats = await fs.stat(filePath);
      
      // Update cache
      this.catalogCache.set(language, {
        data: parsed,
        mtime: stats.mtimeMs
      });
      
      return parsed;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      logger.error(`Error reading catalog for ${language}:`, error);
      return null;
    }
  }

  /**
   * Get movie metadata (with in-memory caching)
   */
  async getMovie(movieId) {
    try {
      const filePath = path.join(this.moviesDir, `${movieId}.json`);
      
      // Check cache
      const cached = this.movieCache.get(movieId);
      if (cached) {
        try {
          const stats = await fs.stat(filePath);
          if (stats.mtimeMs === cached.mtime) {
            return cached.data;
          }
        } catch (error) {
          if (error.code === 'ENOENT' && cached) {
            return cached.data;
          }
        }
      }
      
      // Load from disk
      const data = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(data);
      
      const stats = await fs.stat(filePath);
      this.movieCache.set(movieId, {
        data: parsed,
        mtime: stats.mtimeMs
      });
      
      return parsed;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      logger.error(`Error reading movie ${movieId}:`, error);
      return null;
    }
  }

  /**
   * Get series metadata (with in-memory caching)
   * Series are stored in the movies directory
   */
  async getSeries(seriesId) {
    // Series are stored in the movies directory, so use getMovie
    return this.getMovie(seriesId);
  }

  /**
   * Get streams for a movie (with in-memory caching)
   */
  async getStreams(movieId) {
    try {
      const filePath = path.join(this.streamsDir, `${movieId}.json`);
      
      // Check cache
      const cached = this.streamCache.get(movieId);
      if (cached) {
        try {
          const stats = await fs.stat(filePath);
          if (stats.mtimeMs === cached.mtime) {
            return cached.data;
          }
        } catch (error) {
          if (error.code === 'ENOENT' && cached) {
            return cached.data;
          }
        }
      }
      
      // Load from disk
      const data = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(data);
      
      const stats = await fs.stat(filePath);
      this.streamCache.set(movieId, {
        data: parsed,
        mtime: stats.mtimeMs
      });
      
      return parsed;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      logger.error(`Error reading streams for ${movieId}:`, error);
      return null;
    }
  }

  /**
   * Check if catalog exists
   */
  async hasCatalog(language) {
    const filePath = path.join(this.catalogsDir, `${language}.json`);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if movie exists
   */
  async hasMovie(movieId) {
    const filePath = path.join(this.moviesDir, `${movieId}.json`);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clear in-memory cache for a specific language catalog
   */
  clearCatalogCache(language) {
    this.catalogCache.delete(language);
  }

  /**
   * Clear in-memory cache for a specific movie
   */
  clearMovieCache(movieId) {
    this.movieCache.delete(movieId);
    this.streamCache.delete(movieId);
  }

  /**
   * Clear all in-memory caches
   */
  clearAllCaches() {
    this.catalogCache.clear();
    this.movieCache.clear();
    this.streamCache.clear();
  }

  /**
   * Atomic write all cache data
   * Structure: { catalogs: { language: [...content] }, movies: { id: {...} }, series: { id: {...} }, streams: { id: [...] } }
   */
  async setAll(data) {
    const tempFiles = [];
    const finalFiles = [];

    try {
      // Write catalogs (only if they have content - don't overwrite with empty arrays)
      if (data.catalogs) {
        for (const [language, content] of Object.entries(data.catalogs)) {
          // Skip writing empty catalogs to avoid overwriting existing data
          if (!Array.isArray(content) || content.length === 0) {
            logger.debug(`Skipping empty catalog for language: ${language}`);
            continue;
          }
          
          const tempPath = path.join(this.catalogsDir, `${language}.json.tmp`);
          const finalPath = path.join(this.catalogsDir, `${language}.json`);
          
          await fs.writeFile(tempPath, JSON.stringify(content, null, 2), 'utf8');
          tempFiles.push(tempPath);
          finalFiles.push({ temp: tempPath, final: finalPath, language });
        }
      }

      // Write movies
      if (data.movies) {
        for (const [movieId, movieData] of Object.entries(data.movies)) {
          const tempPath = path.join(this.moviesDir, `${movieId}.json.tmp`);
          const finalPath = path.join(this.moviesDir, `${movieId}.json`);
          
          await fs.writeFile(tempPath, JSON.stringify(movieData, null, 2), 'utf8');
          tempFiles.push(tempPath);
          finalFiles.push({ temp: tempPath, final: finalPath, movieId });
        }
      }

      // Write series (store in movies directory for now, or create series directory)
      if (data.series) {
        for (const [seriesId, seriesData] of Object.entries(data.series)) {
          const tempPath = path.join(this.moviesDir, `${seriesId}.json.tmp`);
          const finalPath = path.join(this.moviesDir, `${seriesId}.json`);
          
          await fs.writeFile(tempPath, JSON.stringify(seriesData, null, 2), 'utf8');
          tempFiles.push(tempPath);
          finalFiles.push({ temp: tempPath, final: finalPath, movieId: seriesId });
        }
      }

      // Write streams (for both movies and series episodes)
      if (data.streams) {
        for (const [contentId, streamData] of Object.entries(data.streams)) {
          const tempPath = path.join(this.streamsDir, `${contentId}.json.tmp`);
          const finalPath = path.join(this.streamsDir, `${contentId}.json`);
          
          await fs.writeFile(tempPath, JSON.stringify(streamData, null, 2), 'utf8');
          tempFiles.push(tempPath);
          finalFiles.push({ temp: tempPath, final: finalPath, contentId });
        }
      }

      // Atomically rename all temp files to final files and invalidate cache
      for (const { temp, final, language, movieId, contentId } of finalFiles) {
        await fs.rename(temp, final);
        
        // Invalidate cache for updated items
        if (language) {
          this.clearCatalogCache(language);
        }
        if (movieId) {
          this.clearMovieCache(movieId);
        }
        if (contentId) {
          this.streamCache.delete(contentId);
        }
      }

      logger.success(`Cache updated: ${finalFiles.length} files written`);
      return true;
    } catch (error) {
      logger.error('Error writing cache, cleaning up temp files:', error);
      
      // Clean up temp files on error
      for (const tempPath of tempFiles) {
        try {
          await fs.unlink(tempPath);
        } catch (unlinkError) {
          logger.warn(`Failed to clean up temp file ${tempPath}:`, unlinkError);
        }
      }
      
      return false;
    }
  }

  /**
   * Atomic write all cache data with full replacement
   * Clears existing cache first, then writes new data
   * Structure: { catalogs: { language: [...content] }, movies: { id: {...} }, series: { id: {...} }, streams: { id: [...] } }
   */
  async setAllReplace(data) {
    try {
      // First, clear all existing cache
      logger.info('Clearing existing cache for full replacement...');
      await this.clear();
      
      // Then write new data
      return await this.setAll(data);
    } catch (error) {
      logger.error('Error in setAllReplace:', error);
      return false;
    }
  }

  /**
   * Get all movies and series from all catalogs
   * Returns an object with movies and series arrays
   */
  async getAllCachedContent() {
    try {
      const movies = [];
      const series = [];
      const languages = Object.values(constants.LANGUAGES);
      
      // Read all catalog files
      for (const language of languages) {
        const catalog = await this.getCatalog(language);
        if (catalog && Array.isArray(catalog)) {
          // Separate movies and series
          for (const item of catalog) {
            if (item.type === 'movie') {
              movies.push(item);
            } else if (item.type === 'series') {
              series.push(item);
            }
          }
        }
      }
      
      // Remove duplicates based on id
      const uniqueMovies = Array.from(
        new Map(movies.map(item => [item.id, item])).values()
      );
      const uniqueSeries = Array.from(
        new Map(series.map(item => [item.id, item])).values()
      );
      
      return {
        movies: uniqueMovies,
        series: uniqueSeries,
        total: uniqueMovies.length + uniqueSeries.length,
        movieCount: uniqueMovies.length,
        seriesCount: uniqueSeries.length
      };
    } catch (error) {
      logger.error('Error getting all cached content:', error);
      return {
        movies: [],
        series: [],
        total: 0,
        movieCount: 0,
        seriesCount: 0
      };
    }
  }

  /**
   * Clear all cache
   */
  async clear() {
    try {
      const dirs = [this.catalogsDir, this.moviesDir, this.streamsDir];
      for (const dir of dirs) {
        const files = await fs.readdir(dir);
        for (const file of files) {
          if (!file.endsWith('.tmp')) {
            await fs.unlink(path.join(dir, file));
          }
        }
      }
      
      // Clear in-memory caches
      this.clearAllCaches();
      
      logger.info('Cache cleared');
      return true;
    } catch (error) {
      logger.error('Error clearing cache:', error);
      return false;
    }
  }
}

module.exports = new FileCache();

