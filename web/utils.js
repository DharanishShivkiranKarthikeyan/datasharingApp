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

export async function chunkEncrypt(ip, minChunks, ipHash) {
  const content = ip.content;
  const chunkSize = Math.ceil(content.length / minChunks);
  const chunks = [];


  // Hash the key string to get a 256-bit (32-byte) key
  const keyData = await subtle.digest('SHA-256', stringToArrayBuffer(ipHash));
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

export async function decryptChunk(chunk, ipHash) {  

  // Hash the key string to get a 256-bit (32-byte) key
  const keyData = await subtle.digest('SHA-256', stringToArrayBuffer(ipHash));
  console.log("GOT TO KEYDATA");
  const keyBuffer = await subtle.importKey(
    'raw',
    keyData,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  console.log("GOT KEYBUFFER");

  // Validate and convert chunk.data
  let encryptedData = chunk.data;
  if (encryptedData instanceof ArrayBuffer) {
    encryptedData = new Uint8Array(encryptedData);
  } else if (Array.isArray(encryptedData)) {
    encryptedData = new Uint8Array(encryptedData);
  } else if (encryptedData instanceof Uint8Array) {
    // Already a Uint8Array, no conversion needed
  } else {
    throw new Error(`chunk.data must be ArrayBuffer, Array, or Uint8Array, got ${encryptedData ? encryptedData.constructor.name : typeof encryptedData}`);
  }

  // Validate and convert chunk.nonce
  let iv = chunk.nonce;
  if (iv instanceof ArrayBuffer) {
    iv = new Uint8Array(iv);
  } else if (Array.isArray(iv)) {
    iv = new Uint8Array(iv);
  } else if (iv instanceof Uint8Array) {
    // Already a Uint8Array, no conversion needed
  } else {
    throw new Error(`chunk.nonce must be ArrayBuffer, Array, or Uint8Array, got ${iv ? iv.constructor.name : typeof iv}`);
  }

  // Check IV length (should be 12 bytes for AES-GCM)
  if (iv.length !== 12) {
    throw new Error(`Invalid IV length: ${iv.length}, expected 12 bytes for AES-GCM`);
  }

  console.log("Encrypted Data:", encryptedData);
  console.log("IV:", iv);

  const decrypted = await subtle.decrypt(
    { name: 'AES-GCM', iv: iv },
    keyBuffer,
    encryptedData
  );
  console.log("GOT TO END");
  return new Uint8Array(decrypted);
}

export function getChunkFileType(chunk) {
  return chunk.file_type;
}