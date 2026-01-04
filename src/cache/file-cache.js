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
   * Get catalog for a language
   */
  async getCatalog(language) {
    try {
      const filePath = path.join(this.catalogsDir, `${language}.json`);
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      logger.error(`Error reading catalog for ${language}:`, error);
      return null;
    }
  }

  /**
   * Get movie metadata
   */
  async getMovie(movieId) {
    try {
      const filePath = path.join(this.moviesDir, `${movieId}.json`);
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      logger.error(`Error reading movie ${movieId}:`, error);
      return null;
    }
  }

  /**
   * Get streams for a movie
   */
  async getStreams(movieId) {
    try {
      const filePath = path.join(this.streamsDir, `${movieId}.json`);
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data);
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
   * Atomic write all cache data
   * Structure: { catalogs: { language: [...content] }, movies: { id: {...} }, series: { id: {...} }, streams: { id: [...] } }
   */
  async setAll(data) {
    const tempFiles = [];
    const finalFiles = [];

    try {
      // Write catalogs
      if (data.catalogs) {
        for (const [language, content] of Object.entries(data.catalogs)) {
          const tempPath = path.join(this.catalogsDir, `${language}.json.tmp`);
          const finalPath = path.join(this.catalogsDir, `${language}.json`);
          
          await fs.writeFile(tempPath, JSON.stringify(content, null, 2), 'utf8');
          tempFiles.push(tempPath);
          finalFiles.push({ temp: tempPath, final: finalPath });
        }
      }

      // Write movies
      if (data.movies) {
        for (const [movieId, movieData] of Object.entries(data.movies)) {
          const tempPath = path.join(this.moviesDir, `${movieId}.json.tmp`);
          const finalPath = path.join(this.moviesDir, `${movieId}.json`);
          
          await fs.writeFile(tempPath, JSON.stringify(movieData, null, 2), 'utf8');
          tempFiles.push(tempPath);
          finalFiles.push({ temp: tempPath, final: finalPath });
        }
      }

      // Write series (store in movies directory for now, or create series directory)
      if (data.series) {
        for (const [seriesId, seriesData] of Object.entries(data.series)) {
          const tempPath = path.join(this.moviesDir, `${seriesId}.json.tmp`);
          const finalPath = path.join(this.moviesDir, `${seriesId}.json`);
          
          await fs.writeFile(tempPath, JSON.stringify(seriesData, null, 2), 'utf8');
          tempFiles.push(tempPath);
          finalFiles.push({ temp: tempPath, final: finalPath });
        }
      }

      // Write streams (for both movies and series episodes)
      if (data.streams) {
        for (const [contentId, streamData] of Object.entries(data.streams)) {
          const tempPath = path.join(this.streamsDir, `${contentId}.json.tmp`);
          const finalPath = path.join(this.streamsDir, `${contentId}.json`);
          
          await fs.writeFile(tempPath, JSON.stringify(streamData, null, 2), 'utf8');
          tempFiles.push(tempPath);
          finalFiles.push({ temp: tempPath, final: finalPath });
        }
      }

      // Atomically rename all temp files to final files
      for (const { temp, final } of finalFiles) {
        await fs.rename(temp, final);
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
      logger.info('Cache cleared');
      return true;
    } catch (error) {
      logger.error('Error clearing cache:', error);
      return false;
    }
  }
}

module.exports = new FileCache();

