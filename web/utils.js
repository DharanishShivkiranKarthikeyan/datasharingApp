// web/utils.js
import { createHash } from 'crypto'; // For Node.js environment; for browser, use SubtleCrypto below
import { subtle } from 'crypto'; // Web Crypto API for browser

// Helper to compute SHA-256 hash (browser-compatible)
async function computeSha256(data) {
  const buffer = new Uint8Array(data);
  const hashBuffer = await subtle.digest('SHA-256', buffer);
  return new Uint8Array(hashBuffer);
}

// Helper to generate a random nonce
function generateNonce(length = 12) {
  return crypto.getRandomValues(new Uint8Array(length));
}

// Create metadata for a snippet
function createMetadata(contentType, tags, version, fileSize, fileType) {
  return {
    content_type: contentType || '',
    tags: tags || [],
    version: version || '1.0.0',
    chunk_count: 0,
    file_size: fileSize || 0,
    file_type: fileType || 'text/plain',
  };
}

// Create an Intellectual Property (IP) object
function createIntellectualProperty(content, contentType, tags, isPremium, priceUsd, creatorId, fileType) {
  // Validate inputs
  if (!(content instanceof Uint8Array)) {
    throw new Error('content must be a Uint8Array');
  }
  if (typeof contentType !== 'string') {
    throw new Error('content_type must be a string');
  }
  if (!Array.isArray(tags)) {
    throw new Error('tags must be an array');
  }
  if (typeof isPremium !== 'boolean') {
    throw new Error('is_premium must be a boolean');
  }
  if (typeof priceUsd !== 'number' || isNaN(priceUsd)) {
    throw new Error('price_usd must be a valid number');
  }
  if (!(creatorId instanceof Uint8Array)) {
    throw new Error('creator_id must be a Uint8Array');
  }
  if (typeof fileType !== 'string') {
    throw new Error('file_type must be a string');
  }

  const metadata = createMetadata(contentType, tags, '1.0.0', content.length, fileType);
  const priceDct = isPremium ? Math.floor(priceUsd) : 0; // Free unless premium

  return {
    content,
    metadata,
    is_premium: isPremium,
    price_dct: priceDct,
    creator_id: creatorId,
  };
}

// Create a chunk object
function createChunk(hash, data, index, fileType) {
  return {
    hash,
    data,
    index,
    file_type: fileType,
  };
}

// Getter functions for Intellectual Property
function getIpContent(ip) {
  return ip.content;
}

function getIpMetadata(ip) {
  return ip.metadata;
}

function getIpIsPremium(ip) {
  return ip.is_premium;
}

function getIpPriceDct(ip) {
  return ip.price_dct;
}

function getIpCreatorId(ip) {
  return ip.creator_id;
}

function getIpFileSize(ip) {
  return ip.metadata.file_size;
}

function getIpFileType(ip) {
  return ip.metadata.file_type;
}

// Getter functions for Chunk
function getChunkHash(chunk) {
  return chunk.hash;
}

function getChunkData(chunk) {
  return chunk.data;
}

function getChunkIndex(chunk) {
  return chunk.index;
}

function getChunkFileType(chunk) {
  return chunk.file_type;
}

// Compute chunk size based on file size and minimum chunks
function computeChunkSize(fileSize, minChunks) {
  const SMALL_FILE_THRESHOLD = 1024 * 1024; // 1 MB
  const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10 MB
  const SMALL_CHUNK_SIZE = 64 * 1024; // 64 KB
  const MEDIUM_CHUNK_SIZE = 256 * 1024; // 256 KB
  const LARGE_CHUNK_SIZE = 1024 * 1024; // 1 MB
  const MAX_CHUNKS = 100;

  const baseChunkSize = fileSize < SMALL_FILE_THRESHOLD
    ? SMALL_CHUNK_SIZE
    : fileSize < LARGE_FILE_THRESHOLD
    ? MEDIUM_CHUNK_SIZE
    : LARGE_CHUNK_SIZE;

  let numChunks = Math.ceil(fileSize / baseChunkSize);
  if (numChunks < minChunks) {
    numChunks = minChunks;
  }
  if (numChunks > MAX_CHUNKS) {
    numChunks = MAX_CHUNKS;
  }

  const adjustedChunkSize = Math.ceil(fileSize / numChunks);
  return Math.max(adjustedChunkSize, 1024); // Ensure at least 1 KB
}

// Encrypt content into chunks
async function chunkEncrypt(ip, key, minChunks) {
  const metadata = getIpMetadata(ip);
  const chunkSize = computeChunkSize(metadata.file_size, minChunks);
  const contentBytes = getIpContent(ip);
  const chunks = [];

  // Convert key to CryptoKey
  const cryptoKey = await subtle.importKey(
    'raw',
    new Uint8Array(key),
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  for (let i = 0; i < contentBytes.length; i += chunkSize) {
    const chunkData = contentBytes.slice(i, i + chunkSize);
    const nonce = generateNonce(); // Unique nonce per chunk
    const encryptedData = await subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      cryptoKey,
      chunkData
    );
    const encryptedArray = new Uint8Array(encryptedData);
    const chunkHash = await computeSha256(encryptedArray);
    const chunk = createChunk(chunkHash, encryptedArray, i / chunkSize, metadata.file_type);
    chunks.push(chunk);
  }

  return chunks;
}

// Decrypt a chunk
async function decryptChunk(chunk, key) {
  const cryptoKey = await subtle.importKey(
    'raw',
    new Uint8Array(key),
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  const nonce = new Uint8Array(12); // Must match the nonce used during encryption
  const decryptedData = await subtle.decrypt(
    { name: 'AES-GCM', iv: nonce },
    cryptoKey,
    getChunkData(chunk)
  );
  return new Uint8Array(decryptedData);
}

// Compute full SHA-256 hash of content
async function computeFullHash(content) {
  return await computeSha256(content);
}

export {
  createMetadata,
  createIntellectualProperty,
  createChunk,
  getIpContent,
  getIpMetadata,
  getIpIsPremium,
  getIpPriceDct,
  getIpCreatorId,
  getIpFileSize,
  getIpFileType,
  getChunkHash,
  getChunkData,
  getChunkIndex,
  getChunkFileType,
  computeChunkSize,
  chunkEncrypt,
  decryptChunk,
  computeFullHash,
};