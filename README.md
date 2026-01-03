# IndiaStreamz - Stremio Addon for TamilMV

A Stremio addon that provides language-wise movie catalogs from 1TamilMV with quality-specific torrent magnet links.

## Features

- **Scheduled Background Scraping**: Automatically scrapes all movies every 4 hours
- **Language-wise Catalogs**: Supports Tamil, Telugu, Hindi, Malayalam, Kannada, and English movies
- **Quality-specific Streams**: Provides 4K, 1080p, 720p, and 480p torrent magnet links
- **File-based Caching**: Persistent cache that survives restarts
- **Atomic Cache Updates**: Cache only updates on successful scrape completion
- **Read-Only Handlers**: HTTP handlers only read from cache, ensuring fast responses

## Architecture

The addon uses a scheduled background scraper that runs every 4 hours to pre-scrape all movies from 1TamilMV. All data is stored in file cache, and Stremio HTTP requests only read from cache. Cache is only updated on successful scrape completion.

## Installation

### Prerequisites

- Node.js 18 or higher
- npm or yarn

### Local Development

1. Clone the repository:
```bash
git clone <repository-url>
cd IndiaStreamz
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. The addon will be available at:
```
http://localhost:7000/manifest.json
```

### Production Deployment

#### Using Docker

1. Build the Docker image:
```bash
docker build -t indiastreamz .
```

2. Run the container:
```bash
docker run -d \
  -p 7000:7000 \
  -v $(pwd)/cache:/app/cache \
  --name indiastreamz \
  indiastreamz
```

#### Using Dokploy

1. Push your code to a Git repository
2. In Dokploy, create a new app
3. Connect your Git repository
4. Dokploy will automatically detect the Dockerfile and deploy
5. Set environment variable `PORT=7000` if needed
6. Ensure the `cache/` directory has write permissions

## Configuration

### Environment Variables

- `PORT`: Server port (default: 7000)
- `NODE_ENV`: Environment (production/development)

### Cache Structure

The cache is stored in the `cache/` directory with the following structure:

```
cache/
├── catalogs/
│   ├── tamil.json
│   ├── telugu.json
│   ├── hindi.json
│   ├── malayalam.json
│   ├── kannada.json
│   └── english.json
├── movies/
│   └── {movieId}.json
└── streams/
    └── {movieId}.json
```

## Usage

### Adding to Stremio

1. Open Stremio
2. Go to Addons
3. Click "Add Addon"
4. Enter the addon URL:
```
http://your-server:7000/manifest.json
```

**Important Note**: This addon provides torrent magnet links. Torrent playback only works in **Stremio Desktop App**, not in the web player. The web player requires direct video URLs (MP4 over HTTPS), which we don't have access to. For torrent playback, please use the Stremio Desktop application.

### Supported Languages

- Tamil
- Telugu
- Hindi
- Malayalam
- Kannada
- English

## API Endpoints

The addon follows the Stremio Addon Protocol:

- `GET /manifest.json` - Addon manifest
- `GET /catalog/movie/{language}.json` - Catalog by language
- `GET /meta/movie/{movieId}.json` - Movie metadata
- `GET /stream/movie/{movieId}.json` - Stream sources (magnet links)

## How It Works

1. **Background Scraping**: A scheduler runs every 4 hours (cron: `0 */4 * * *`)
2. **Scraping Process**: 
   - Fetches all languages from 1TamilMV
   - Extracts movie listings and details
   - Parses magnet links and quality information
3. **Cache Update**: On successful scrape, data is written atomically to cache files
4. **Serving Requests**: Stremio requests are served from cache (read-only)

## Development

### Project Structure

```
IndiaStreamz/
├── src/
│   ├── scraper/          # Web scraping logic
│   ├── scheduler/        # Background job scheduler
│   ├── addon/            # Stremio addon handlers
│   ├── cache/            # File-based cache manager
│   ├── utils/            # Utilities (logger, constants)
│   └── server.js         # Main server
├── cache/                # Cache directory (gitignored)
└── package.json
```

### Running Tests

Currently, manual testing is recommended. Test the addon by:

1. Starting the server
2. Waiting for initial scrape (or trigger manually)
3. Testing endpoints with curl or Stremio client

## Troubleshooting

### Cache Not Updating

- Check logs for scrape errors
- Verify network connectivity to 1TamilMV
- Ensure cache directory has write permissions

### No Movies Showing

- Wait for initial scrape to complete (may take several minutes)
- Check cache directory for generated files
- Review logs for scraping errors

### Scraper Failing

- Website structure may have changed
- Check if 1TamilMV is accessible
- Review error logs for specific issues

## License

MIT

## Disclaimer

This addon is for educational purposes. Ensure compliance with local laws and website terms of service when using this addon.

