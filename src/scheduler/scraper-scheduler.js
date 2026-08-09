const cron = require('node-cron');
const logger = require('../utils/logger');
const constants = require('../utils/constants');
const TamilMVScraper = require('../scraper/tamilmv-scraper');
const fileCache = require('../cache/file-cache');

class ScraperScheduler {
  constructor() {
    this.scraper = new TamilMVScraper();
    this.isRunning = false;
    this.cronJob = null;
  }

  /**
   * Start the scheduler
   */
  start() {
    // Schedule job to run every 4 hours
    this.cronJob = cron.schedule(constants.SCRAPE_INTERVAL, async () => {
      await this.runScrape();
    }, {
      scheduled: true,
      timezone: 'UTC'
    });

    logger.info(`Scheduler started. Will run every 4 hours (cron: ${constants.SCRAPE_INTERVAL})`);
    
    // Run initial scrape if cache is empty
    this.runInitialScrape();
  }

  /**
   * Run initial scrape if cache is empty
   */
  async runInitialScrape() {
    try {
      // Check if any catalog exists
      const hasAnyCache = await fileCache.hasCatalog(constants.LANGUAGES.TAMIL) ||
                         await fileCache.hasCatalog(constants.LANGUAGES.TELUGU) ||
                         await fileCache.hasCatalog(constants.LANGUAGES.HINDI);
      
      if (!hasAnyCache) {
        logger.info('Cache is empty, running initial scrape...');
        await this.runScrape();
      } else {
        logger.info('Cache exists, skipping initial scrape');
      }
    } catch (error) {
      logger.error('Error checking cache for initial scrape:', error);
      // Run scrape anyway to be safe
      await this.runScrape();
    }
  }

  /**
   * Run the scrape job
   */
  async runScrape() {
    if (this.isRunning) {
      logger.warn('Scrape job already running, skipping...');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      logger.info('=== Starting scheduled scrape (existing cache retained until scrape succeeds) ===');

      // Scrape all languages and movies FIRST. The existing cache is left intact
      // so that a failed or empty scrape can never wipe the live catalog.
      // Use skipCacheCheck=true so the scrape rebuilds the FULL catalog (matching
      // the previous clear-then-scrape-everything behaviour); otherwise already
      // cached items would be skipped and the atomic replace below would drop them.
      const scrapedData = await this.scraper.scrapeAll(true);
      
      // Validate data structure
      if (!scrapedData || typeof scrapedData !== 'object') {
        throw new Error('Invalid scraped data structure');
      }

      // Check if we have any new data
      const hasNewMovies = scrapedData.movies && Object.keys(scrapedData.movies).length > 0;
      const hasNewSeries = scrapedData.series && Object.keys(scrapedData.series).length > 0;
      const hasNewData = hasNewMovies || hasNewSeries;
      
      // Check if catalogs have content (might be empty if all items were skipped)
      const hasCatalogData = scrapedData.catalogs && Object.values(scrapedData.catalogs).some(catalog => Array.isArray(catalog) && catalog.length > 0);
      
      if (!hasNewData && !hasCatalogData) {
        // Nothing scraped (e.g. dead source domain / network block). Keep the
        // existing cache rather than clearing it and blanking the whole addon.
        logger.warn('No data scraped - keeping existing cache to avoid a blank catalog');
        return;
      }

      // Replace cache atomically: setAllReplace clears then writes, so the old
      // cache is only removed once we have fresh data ready to write.
      const success = await fileCache.setAllReplace(scrapedData);
      
      if (success) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        const languageCount = Object.keys(scrapedData.catalogs || {}).length;
        const totalMovies = Object.keys(scrapedData.movies || {}).length;
        const totalSeries = Object.keys(scrapedData.series || {}).length;
        
        logger.success(`=== Scrape completed successfully in ${duration}s ===`);
        logger.info(`Languages: ${languageCount}, Movies: ${totalMovies}, Series: ${totalSeries}`);
      } else {
        throw new Error('Failed to update cache');
      }
    } catch (error) {
      logger.error('=== Scrape failed ===');
      logger.error('Error details:', error.message);
      logger.error('Stack:', error.stack);
      logger.warn('Scrape failed - existing cache left untouched; catalog stays live until next successful scrape');
    } finally {
      this.isRunning = false;
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.info(`Total scrape duration: ${duration}s`);
    }
  }

  /**
   * Manually trigger a scrape (for testing or admin)
   */
  async triggerManual() {
    logger.info('Manual scrape triggered');
    await this.runScrape();
  }

  /**
   * Trigger a full replacement scrape (clears cache and rescrapes everything)
   */
  async triggerFullReplacement() {
    if (this.isRunning) {
      logger.warn('Scrape job already running, cannot start full replacement');
      throw new Error('Scrape job already running');
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      logger.info('=== Starting FULL REPLACEMENT scrape (cache will be cleared) ===');
      
      // Scrape all languages and movies without checking cache
      const scrapedData = await this.scraper.scrapeAll(true); // skipCacheCheck = true
      
      // Validate data structure
      if (!scrapedData || typeof scrapedData !== 'object') {
        throw new Error('Invalid scraped data structure');
      }

      // Check if we have any data
      const hasMovies = scrapedData.movies && Object.keys(scrapedData.movies).length > 0;
      const hasSeries = scrapedData.series && Object.keys(scrapedData.series).length > 0;
      const hasCatalogData = scrapedData.catalogs && Object.values(scrapedData.catalogs).some(catalog => Array.isArray(catalog) && catalog.length > 0);
      
      if (!hasMovies && !hasSeries && !hasCatalogData) {
        logger.warn('No data scraped - cache will be empty');
      }

      // Replace cache completely (clears old cache first)
      const success = await fileCache.setAllReplace(scrapedData);
      
      if (success) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        const languageCount = Object.keys(scrapedData.catalogs || {}).length;
        const totalMovies = Object.keys(scrapedData.movies || {}).length;
        const totalSeries = Object.keys(scrapedData.series || {}).length;
        
        logger.success(`=== Full replacement scrape completed successfully in ${duration}s ===`);
        logger.info(`Languages: ${languageCount}, Movies: ${totalMovies}, Series: ${totalSeries}`);
      } else {
        throw new Error('Failed to replace cache');
      }
    } catch (error) {
      logger.error('=== Full replacement scrape failed ===');
      logger.error('Error details:', error.message);
      logger.error('Stack:', error.stack);
      throw error; // Re-throw so caller can handle it
    } finally {
      this.isRunning = false;
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.info(`Total scrape duration: ${duration}s`);
    }
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      logger.info('Scheduler stopped');
    }
  }
}

module.exports = ScraperScheduler;

