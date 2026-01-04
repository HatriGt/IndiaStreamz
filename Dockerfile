FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Create cache directory with write permissions
RUN mkdir -p cache/catalogs cache/movies cache/streams && \
    chmod -R 777 cache

# Expose port (should match PORT env var)
EXPOSE 3005

# Set environment variable
ENV PORT=3005
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3005/manifest.json', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Run the server
CMD ["node", "src/server.js"]