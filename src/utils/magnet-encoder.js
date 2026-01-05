/**
 * Magnet Link Encoder/Decoder Utility
 * Encodes magnet links to URL-safe base64url format for use in URLs
 * Decodes base64url back to original magnet links
 */

/**
 * Encode magnet link to URL-safe base64url format
 * @param {string} magnetLink - The magnet link to encode
 * @returns {string} - URL-safe base64url encoded string
 */
function encodeMagnet(magnetLink) {
  if (!magnetLink) {
    throw new Error('Magnet link is required');
  }
  
  // Convert to Buffer and encode to base64
  const buffer = Buffer.from(magnetLink, 'utf8');
  const base64 = buffer.toString('base64');
  
  // Convert to base64url (URL-safe): replace + with -, / with _, and remove padding =
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Decode base64url encoded string back to magnet link
 * @param {string} encodedMagnet - The base64url encoded string
 * @returns {string} - The original magnet link
 */
function decodeMagnet(encodedMagnet) {
  if (!encodedMagnet) {
    throw new Error('Encoded magnet is required');
  }
  
  try {
    // Convert from base64url to base64: replace - with +, _ with /, and add padding if needed
    let base64 = encodedMagnet
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    
    // Add padding if needed (base64 requires length to be multiple of 4)
    const padding = base64.length % 4;
    if (padding) {
      base64 += '='.repeat(4 - padding);
    }
    
    // Decode from base64 to string
    const buffer = Buffer.from(base64, 'base64');
    return buffer.toString('utf8');
  } catch (error) {
    throw new Error(`Failed to decode magnet: ${error.message}`);
  }
}

module.exports = {
  encodeMagnet,
  decodeMagnet
};
