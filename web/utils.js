// Use the global crypto.subtle for Web Crypto API in the browser
const subtle = globalThis.crypto?.subtle;

if (!subtle) {
  throw new Error('Web Crypto API is not available in this environment');
}

// Helper to generate a static nonce (for simplicity; in production, store this with the chunk)
function generateNonce() {
  const nonce = new Uint8Array(12); // 96-bit nonce for AES-GCM
  for (let i = 0; i < 12; i++) {
    nonce[i] = Math.floor(Math.random() * 256);
  }
  return nonce;
}

// Helper function for SHA-256 hashing using Web Crypto
export async function sha256(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hash));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 40);
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

export function getChunkHash(chunk) {
    // Convert chunk.index (a number) to a Uint8Array
    const indexBytes = new Uint8Array(new Int32Array([chunk.index]).buffer);
    const dataToHash = new Uint8Array([...chunk.data, ...chunk.nonce, ...indexBytes]);
    return computeFullHash(dataToHash);
  }

export function getChunkIndex(chunk) {
  return chunk.index;
}

function stringToArrayBuffer(str) {
  const encoder = new TextEncoder();
  return encoder.encode(str).buffer;
}

export async function chunkEncrypt(ip, key, minChunks) {
  const content = ip.content;
  const chunkSize = Math.ceil(content.length / minChunks);
  const chunks = [];

  // Ensure key is a string, not an array
  if (Array.isArray(key)) {
    key = key.join(''); // Convert array of characters back to string if needed
  }

  // Hash the key string to get a 256-bit (32-byte) key
  const keyData = await subtle.digest('SHA-256', stringToArrayBuffer(key));
  const keyBuffer = await subtle.importKey(
    'raw',
    keyData, // This is now a 32-byte ArrayBuffer
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

export async function decryptChunk(chunk, key) {
  // Ensure key is a string, not an array
  if (Array.isArray(key)) {
    key = key.join(''); // Convert array of characters back to string if needed
  }

  // Hash the key string to get a 256-bit (32-byte) key
  const keyData = await subtle.digest('SHA-256', stringToArrayBuffer(key));
  const keyBuffer = await subtle.importKey(
    'raw',
    keyData, // This is now a 32-byte ArrayBuffer
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