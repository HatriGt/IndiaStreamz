const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function formatTimestamp() {
  return new Date().toISOString();
}

function log(level, color, message, ...args) {
  const timestamp = formatTimestamp();
  const prefix = `${color}${colors.bright}[${timestamp}] [${level}]${colors.reset}`;
  console.log(prefix, message, ...args);
}

module.exports = {
  info: (message, ...args) => log('INFO', colors.cyan, message, ...args),
  success: (message, ...args) => log('SUCCESS', colors.green, message, ...args),
  warn: (message, ...args) => log('WARN', colors.yellow, message, ...args),
  error: (message, ...args) => log('ERROR', colors.red, message, ...args),
  debug: (message, ...args) => log('DEBUG', colors.magenta, message, ...args)
};

