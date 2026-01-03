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
      logger.info('=== Starting scheduled scrape ===');
      
      // Scrape all languages and movies
      const scrapedData = await this.scraper.scrapeAll();
      
      // Validate data structure
      if (!scrapedData || typeof scrapedData !== 'object') {
        throw new Error('Invalid scraped data structure');
      }

      // Check if we have any data
      const hasData = scrapedData.catalogs && Object.keys(scrapedData.catalogs).length > 0;
      
      if (!hasData) {
        throw new Error('No data scraped');
      }

      // Update cache atomically
      const success = await fileCache.setAll(scrapedData);
      
      if (success) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        const languageCount = Object.keys(scrapedData.catalogs).length;
        const totalMovies = Object.keys(scrapedData.movies).length;
        
        logger.success(`=== Scrape completed successfully in ${duration}s ===`);
        logger.info(`Languages: ${languageCount}, Total Movies: ${totalMovies}`);
      } else {
        throw new Error('Failed to update cache');
      }
    } catch (error) {
      logger.error('=== Scrape failed ===');
      logger.error('Error details:', error.message);
      logger.error('Stack:', error.stack);
      logger.warn('Keeping existing cache intact');
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

