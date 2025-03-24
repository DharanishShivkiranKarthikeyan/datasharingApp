// web/utils.js
import CryptoJS from 'https://cdn.jsdelivr.net/npm/crypto-js@4.2.0/+esm';

// Use the global crypto.subtle for Web Crypto API in the browser
const subtle = globalThis.crypto?.subtle;
if (!subtle) {
  throw new Error('Web Crypto API is not available in this environment');
}

// Helper to convert ArrayBuffer to hex string
function arrayBufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Helper to convert hex string to ArrayBuffer
function hexToArrayBuffer(hex) {
  const bytes = new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
  return bytes.buffer;
}

// Helper to generate a static nonce (for simplicity; in production, store this with the chunk)
function generateNonce() {
  const nonce = new Uint8Array(12); // 96-bit nonce for AES-GCM
  for (let i = 0; i < 12; i++) {
    nonce[i] = Math.floor(Math.random() * 256);
  }
  return nonce;
}

export function createIntellectualProperty(content, contentType, tags, isPremium, priceUsd, creatorId, fileType) {
  return {
    content: new Uint8Array(content),
    content_type: contentType,
    tags: tags || [],
    is_premium: isPremium,
    price_usd: priceUsd,
    creator_id: new Uint8Array(creatorId),
    file_type: fileType,
  };
}

export function getIpContent(ip) {
  return ip.content;
}

export async function computeFullHash(content) {
  const buffer = await subtle.digest('SHA-256', content);
  return new Uint8Array(buffer);
}

export async function chunkEncrypt(ip, key, minChunks) {
  const content = ip.content;
  const chunkSize = Math.ceil(content.length / minChunks);
  const chunks = [];
  const keyBuffer = await subtle.importKey(
    'raw',
    new Uint8Array(key.slice(0, 32)), // Use first 32 bytes for AES-256
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  for (let i = 0; i < minChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, content.length);
    const chunkData = content.slice(start, end);

    const nonce = generateNonce();
    const encrypted = await subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      keyBuffer,
      chunkData
    );

    const chunk = {
      data: new Uint8Array(encrypted),
      nonce: nonce,
      index: i,
      file_type: ip.file_type,
    };
    chunks.push(chunk);
  }

  return chunks;
}

export function getChunkHash(chunk) {
  const dataToHash = new Uint8Array([...chunk.data, ...chunk.nonce, chunk.index]);
  return computeFullHash(dataToHash);
}

export function getIpMetadata(ip) {
  return {
    content_type: ip.content_type,
    tags: ip.tags,
    is_premium: ip.is_premium,
    price_usd: ip.price_usd,
    creator_id: ip.creator_id,
    file_type: ip.file_type,
  };
}

export function getChunkIndex(chunk) {
  return chunk.index;
}

export async function decryptChunk(chunk, key) {
  const keyBuffer = await subtle.importKey(
    'raw',
    new Uint8Array(key.slice(0, 32)), // Use first 32 bytes for AES-256
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  const decrypted = await subtle.decrypt(
    { name: 'AES-GCM', iv: chunk.nonce },
    keyBuffer,
    chunk.data
  );

  return new Uint8Array(decrypted);
}

export function getChunkFileType(chunk) {
  return chunk.file_type;
}