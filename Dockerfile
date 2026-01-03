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

# Expose port
EXPOSE 3005

# Set environment variable
ENV PORT=3005
ENV NODE_ENV=production

# Run the server
CMD ["node", "src/server.js"]

